// Electron main: the thin shell around verqury-core (ADR-0002, ADR-0003).
// All real logic lives in ./src/api.js and ./src/watcher.js so it stays testable
// without launching Electron. This file only wires: window, tray, IPC, watcher.
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addLog } from 'verqury-core/files';
import * as api from './src/api.js';
import { watchDataRoot } from './src/watcher.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const iconPath = path.join(dir, 'renderer', 'assets', 'icon.png');
const root = api.ensureRoot(api.getRoot());

let win = null;
let tray = null;
let watcher = null;
let refreshTimer = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'Verqury',
    icon: iconPath,
    backgroundColor: '#1a1626',
    webPreferences: {
      preload: path.join(dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(dir, 'renderer', 'index.html'));
  return win;
}

function setupIpc() {
  ipcMain.handle('root:get', () => root);
  ipcMain.handle('stages:get', () => api.getStages());
  ipcMain.handle('projects:list', () => api.getProjects(root));
  ipcMain.handle('project:get', (_e, slug) => api.getProject(root, slug));
  ipcMain.handle('project:setStage', (_e, slug, stage) => api.changeStage(root, slug, stage));
  ipcMain.handle('search:query', (_e, query) => api.runSearch(root, query));
}

function setupWatcher() {
  watcher = watchDataRoot(root, () => {
    if (win && !win.isDestroyed()) win.webContents.send('data:changed');
    // Keep the FTS index current while the app runs (debounced, out-of-process).
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => api.refreshIndex(root), 400);
  });
}

function setupTray() {
  try {
    const img = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
    tray = new Tray(img);
    tray.setToolTip('Verqury — layer, not IDE');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Verqury', click: () => (win && !win.isDestroyed() ? win.show() : createWindow()) },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  } catch (err) {
    console.warn('tray unavailable:', err.message); // non-fatal; window is the deliverable
  }
}

// Headless verification hook (see PROGRESS.md Phase 2). When VERQURY_VERIFY points
// at a directory, prove both Phase-2 "done when" criteria against the RUNNING app:
//   1. a log written on disk appears in the app within ~2s (watcher → live update)
//   2. a stage change driven through the UI bridge lands in project.md
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dom = (js) => win.webContents.executeJavaScript(js);
const timelineCount = () => dom("document.querySelectorAll('.timeline-entry').length");

async function runVerify(outDir) {
  const result = {};
  try {
    await dom('window.__verquryReady');
    result.projects = await dom("document.querySelectorAll('.project-card').length");
    result.detailTitle = await dom("document.querySelector('.detail-title')?.textContent || null");
    const slug = api.getProjects(root)[0].slug;

    // (1) live update: write a log on disk, expect the timeline to grow within ~2s.
    const before = await timelineCount();
    addLog(root, slug, { text: 'verify-harness live update probe', title: 'Live Probe' });
    for (let i = 0; i < 20 && (await timelineCount()) === before; i++) await wait(100);
    const after = await timelineCount();
    result.liveUpdate = { before, after, passed: after === before + 1 };

    // (2) stage change through the preload bridge → assert it persists to project.md.
    await dom(`window.verqury.setStage(${JSON.stringify(slug)}, 'test')`);
    await wait(300);
    const fm = fs.readFileSync(path.join(root, 'projects', slug, 'project.md'), 'utf8');
    result.stageChange = { slug, wroteTestStage: /stage:\s*test/.test(fm) };

    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    if (png.length) fs.writeFileSync(path.join(outDir, 'shot.png'), png);
  } catch (err) {
    result.error = err.message;
  } finally {
    fs.writeFileSync(path.join(outDir, 'verify.json'), JSON.stringify(result, null, 2));
    app.quit();
  }
}

app.whenReady().then(() => {
  setupIpc();
  createWindow();
  setupWatcher();
  setupTray();

  const verifyDir = process.env.VERQURY_VERIFY;
  if (verifyDir) win.webContents.once('did-finish-load', () => setTimeout(() => runVerify(verifyDir), 800));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Stay resident in the tray (a quiet companion). Quit explicitly via the menu.
  if (process.platform !== 'darwin' && !tray) app.quit();
});

app.on('before-quit', () => watcher?.close());

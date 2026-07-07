// Electron main: the thin shell around verqury-core (ADR-0002, ADR-0003).
// All real logic lives in ./src/api.js and ./src/watcher.js so it stays testable
// without launching Electron. This file only wires: window, tray, IPC, watcher.
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, clipboard, shell, globalShortcut, Notification } from 'electron';
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

  ipcMain.handle('guidance:kinds', () => api.getGuidanceKinds());
  ipcMain.handle('guidance:all', () => api.getAllGuidance(root));
  ipcMain.handle('guidance:get', (_e, scope, slug) => api.getGuidance(root, scope, slug));
  ipcMain.handle('guidance:create', (_e, payload) => api.createGuidance(root, payload));
  ipcMain.handle('guidance:promote', (_e, projectSlug, slug) => api.promoteGuidance(root, projectSlug, slug));

  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text ?? '')));
  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(url);
  });

  ipcMain.handle('artifact:kinds', () => api.getArtifactKinds());
  ipcMain.handle('artifacts:list', (_e, filters) => api.getArtifacts(root, filters));
  ipcMain.handle('artifact:get', (_e, projectSlug, id) => api.getArtifact(root, projectSlug, id));
  ipcMain.handle('artifact:delete', (_e, projectSlug, id) => api.deleteArtifact(root, projectSlug, id));
  ipcMain.handle('artifact:retag', (_e, projectSlug, id, tags) => api.tagArtifact(root, projectSlug, id, tags));
  ipcMain.handle('artifact:setKind', (_e, projectSlug, id, kind) => api.changeArtifactKind(root, projectSlug, id, kind));
  ipcMain.handle('project:getActive', () => api.getActive(root));
  ipcMain.handle('project:setActive', (_e, slug) => api.setActive(root, slug));
  ipcMain.handle('capture:now', () => captureFromClipboard()); // manual trigger (UI button / verify)

  ipcMain.handle('packet:list', () => api.getPackets(root));
  ipcMain.handle('packet:render', (_e, packetSlug, projectSlug, opts) => api.renderPacket(root, packetSlug, projectSlug, opts));
  ipcMain.handle('packet:write', (_e, filePath, text) => {
    fs.writeFileSync(filePath, String(text ?? ''));
    return filePath;
  });

  ipcMain.handle('task:routes', () => api.getTaskRoutes());
  ipcMain.handle('task:statuses', () => api.getTaskStatuses());
  ipcMain.handle('tasks:list', (_e, filters) => api.getTasks(root, filters));
  ipcMain.handle('task:get', (_e, projectSlug, id) => api.getTask(root, projectSlug, id));
  ipcMain.handle('task:add', (_e, projectSlug, payload) => api.createTask(root, projectSlug, payload));
  ipcMain.handle('task:update', (_e, projectSlug, id, patch) => api.updateTask(root, projectSlug, id, patch));
  ipcMain.handle('task:delete', (_e, projectSlug, id) => api.deleteTask(root, projectSlug, id));
  ipcMain.handle('task:handoff', (_e, projectSlug, id) => {
    const { payload } = api.renderHandoff(root, projectSlug, id);
    clipboard.writeText(payload);
    api.updateTask(root, projectSlug, id, { status: 'handed-off' });
    return { payload };
  });
  ipcMain.handle('task:attachReport', (_e, projectSlug, id, artifactId) => api.attachReport(root, projectSlug, id, artifactId));
}

function notify(body) {
  try {
    new Notification({ title: 'Verqury', body, silent: true }).show();
  } catch {
    // libnotify may be absent on some Linux setups — capture still succeeds.
  }
}

// The clipboard-capture path shared by the global hotkey and the UI button.
function captureFromClipboard() {
  const outcome = api.captureClipboard(root, () => clipboard.readText());
  if (!outcome.ok) {
    notify(outcome.reason === 'empty' ? 'Clipboard empty — nothing captured' : 'Create a project first to capture');
    return outcome;
  }
  api.refreshIndex(root);
  if (win && !win.isDestroyed()) win.webContents.send('artifact:captured', { project: outcome.project, id: outcome.artifact.id });
  notify(`Captured ${outcome.artifact.kind} → ${outcome.project}`);
  return outcome;
}

function setupHotkey() {
  const accel = 'Control+Alt+C';
  if (!globalShortcut.register(accel, captureFromClipboard)) {
    console.warn(`Could not register global hotkey ${accel} (already in use?)`);
  }
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

    // (3) guidance mode: markdown renders to HTML in the DOM.
    await dom("document.querySelector('.tab[data-mode=guidance]').click()");
    await wait(200);
    result.guidanceCards = await dom("document.querySelectorAll('#list .project-card').length");
    await dom("document.querySelector('#list .project-card')?.click()");
    await wait(200);
    result.markdownRendered = await dom("!!document.querySelector('.markdown h1')");

    // (4) create a project instruction through the bridge → valid file on disk.
    await dom(
      `window.verqury.createGuidance({ scope: ${JSON.stringify(slug)}, title: 'Harness Instruction', kind: 'instruction', body: '# Harness Instruction\\n\\n- do the thing\\n' })`,
    );
    await wait(200);
    const created = path.join(root, 'projects', slug, 'guidance', 'harness-instruction.md');
    result.guidanceCreated = fs.existsSync(created);

    // (5) promote it to global through the bridge → file moves.
    await dom(`window.verqury.promoteGuidance(${JSON.stringify(slug)}, 'harness-instruction')`);
    await wait(200);
    result.guidancePromoted =
      fs.existsSync(path.join(root, 'guidance', 'harness-instruction.md')) && !fs.existsSync(created);

    // (6) clipboard capture: hotkey registered, and the capture path files an
    // artifact into the active project that appears in the inbox and round-trips.
    result.hotkeyRegistered = globalShortcut.isRegistered('Control+Alt+C');
    api.setActive(root, slug);
    const captured = 'git rebase -i HEAD~3 # captured by harness';
    clipboard.writeText(captured);
    captureFromClipboard(); // same path the hotkey invokes
    await wait(300);
    const arts = api.getArtifacts(root, { project: slug });
    result.captureFiledArtifact = arts.length === 1 && fs.existsSync(arts[0].path);
    result.captureRoundTrips = arts.length === 1 && api.getArtifact(root, slug, arts[0].id).body.trim() === captured;
    await dom("document.querySelector('.tab[data-mode=inbox]').click()");
    await wait(200);
    result.inboxCards = await dom("document.querySelectorAll('#list .artifact-card').length");
    await dom("document.querySelector('#list .artifact-card')?.click()");
    await wait(150);

    // (7) session bootstrapper: render terminal-build → narrative + guidance + log.
    const rp = api.renderPacket(root, 'terminal-build', slug, {});
    result.packetHasContext = /build context/.test(rp.text) && /Security Baseline/.test(rp.text) && /Build 93/.test(rp.text);
    const target = path.join(outDir, 'CONTEXT.md');
    await dom(`(async () => { const r = await window.verqury.renderPacket('terminal-build', ${JSON.stringify(slug)}, {}); await window.verqury.writePacket(${JSON.stringify(target)}, r.text); })()`);
    await wait(200);
    result.packetFileWritten = fs.existsSync(target) && /Security Baseline/.test(fs.readFileSync(target, 'utf8'));
    await dom(`(async () => { const r = await window.verqury.renderPacket('terminal-build', ${JSON.stringify(slug)}, {}); await window.verqury.copyToClipboard(r.text); })()`);
    await wait(150);
    result.packetClipboard = clipboard.readText() === rp.text;
    // Bootstrap panel in the UI shows a live preview.
    await dom("document.querySelector('.tab[data-mode=projects]').click()");
    await wait(150);
    await dom("document.querySelector('#list .project-card')?.click()");
    await wait(150);
    await dom("[...document.querySelectorAll('.head-actions button')].find((b) => b.textContent.includes('Bootstrap'))?.click()");
    await wait(300);
    // Select terminal-build in the packet dropdown, then check the live preview.
    await dom("(() => { const s = document.querySelector('.head-actions select'); if (s) { s.value = 'terminal-build'; s.dispatchEvent(new Event('change')); } })()");
    await wait(300);
    result.bootstrapPreview = await dom("(document.querySelector('.artifact-body')?.textContent || '').includes('build context')");

    // (8) task router loop (done-when): create → hand off → capture report → attach → echo.
    const task = api.createTask(root, slug, { title: 'Fetch pricing', route: 'browser-agent', surface: 'browser-agent', body: 'Look up competitor pricing.' });
    await dom(`window.verqury.handoffTask(${JSON.stringify(slug)}, ${JSON.stringify(task.id)})`);
    await wait(200);
    result.taskHandoffClipboard = /Look up competitor pricing/.test(clipboard.readText());
    result.taskHandedOff = api.getTask(root, slug, task.id).status === 'handed-off';
    clipboard.writeText('Report: pricing is $9-19/mo.');
    const rep = captureFromClipboard(); // fake report via the hotkey path
    await dom(`window.verqury.attachReport(${JSON.stringify(slug)}, ${JSON.stringify(task.id)}, ${JSON.stringify(rep.artifact.id)})`);
    await wait(200);
    const closed = api.getTask(root, slug, task.id);
    result.taskClosed = closed.status === 'done' && closed.report === rep.artifact.id;
    result.taskEchoedInTimeline = api.getProject(root, slug).timeline.some((e) => /Task done: Fetch pricing/.test(e.title || ''));
    await dom("document.querySelector('.tab[data-mode=tasks]').click()");
    await wait(200);
    result.taskCards = await dom("document.querySelectorAll('#list .task-card').length");
    await dom("document.querySelector('#list .task-card')?.click()");
    await wait(150);

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
  setupHotkey();

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

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => watcher?.close());

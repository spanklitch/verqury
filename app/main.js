// Electron main: the thin shell around verqury-core (ADR-0002, ADR-0003).
// All real logic lives in ./src/api.js and ./src/watcher.js so it stays testable
// without launching Electron. This file only wires: window, tray, IPC, watcher.
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, clipboard, shell, globalShortcut, Notification } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// Embedded terminal: node-pty spawns a real PTY in the main process and streams
// it to the xterm.js widget in the renderer (ADR-0009). node-pty is a native
// module built for Electron's ABI (electron-rebuild), loaded only here.
let ptyProc = null;
function ptyStart(shell) {
  if (ptyProc) return { alreadyRunning: true };
  const nodePty = require('node-pty');
  const sh = shell || process.env.SHELL || 'bash';
  ptyProc = nodePty.spawn(sh, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: process.env,
  });
  ptyProc.onData((d) => {
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', d);
  });
  ptyProc.onExit(() => {
    ptyProc = null;
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit');
  });
  return { started: true, shell: sh };
}
import { addLog } from 'verqury-core/files';
import * as api from './src/api.js';
import { watchDataRoot } from './src/watcher.js';

const shQuote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;

// Track text WE put on the clipboard, so clipboard-watch doesn't re-capture it.
let selfWrite = '';
function writeClip(text) {
  selfWrite = String(text ?? '');
  clipboard.writeText(selfWrite);
}

// Launch an adapter for a project. `target: 'terminal'` runs the command in the
// embedded terminal at the repo; otherwise it spawns detached externally (ADR-0004).
// Either way the handoff packet is copied to the clipboard.
function launchAdapter(adapterSlug, projectSlug) {
  const adapter = api.getOneAdapter(root, adapterSlug);
  if (!adapter) throw new Error(`No such adapter: ${adapterSlug}`);
  const { project } = api.getProject(root, projectSlug);
  const command = api.resolveAdapterCommand(adapter.command, project);
  let copiedPacket = false;
  if (adapter.packet) {
    try {
      writeClip(api.renderPacket(root, adapter.packet, projectSlug).text);
      copiedPacket = true;
    } catch {
      // packet may have been deleted; launch anyway
    }
  }
  if (adapter.target === 'terminal') {
    ptyStart();
    const cd = project.repo ? `cd ${shQuote(project.repo)} && ` : '';
    if (ptyProc) ptyProc.write(`${cd}${command}\n`);
    if (win && !win.isDestroyed()) win.webContents.send('nav:terminal');
    return { launched: true, target: 'terminal', command, copiedPacket };
  }
  if (command.trim()) {
    spawn(command, { shell: true, detached: true, stdio: 'ignore' }).unref();
  }
  return { launched: Boolean(command.trim()), target: 'external', command, copiedPacket };
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const iconPath = path.join(dir, 'renderer', 'assets', 'icon.png');
const root = api.ensureRoot(api.getRoot());

// Search runs the CLI under the system `node` (ADR-0008). The packaged app ships
// unpacked (asar:false) with the system-ABI better-sqlite3, and `node` — the same
// one that built it — loads it. `$VERQURY_NODE` can override the binary.

const startHidden = process.argv.includes('--hidden'); // autostart-to-tray

let win = null;
let tray = null;
let watcher = null;
let refreshTimer = null;

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'Verqury',
    icon: iconPath,
    backgroundColor: '#1a1626',
    show,
    webPreferences: {
      preload: path.join(dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(dir, 'renderer', 'index.html'));
  // "Where we left off": nudge the renderer to refresh resume reminders each time
  // the window is brought to the foreground (tray-show or first open).
  win.on('show', () => { if (win && !win.isDestroyed()) win.webContents.send('app:shown'); });
  return win;
}

// Start-on-login is implemented the Linux way: a .desktop file in the user's
// autostart dir. Electron's setLoginItemSettings is unreliable on Linux.
const autostartFile = path.join(os.homedir(), '.config', 'autostart', 'verqury.desktop');

function autostartEnabled() {
  return fs.existsSync(autostartFile);
}

function setAutostart(enabled) {
  if (!enabled) {
    fs.rmSync(autostartFile, { force: true });
    return;
  }
  const exec = process.env.APPIMAGE || process.execPath; // the launchable binary
  const desktop = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Verqury',
    `Exec=${exec} --hidden`,
    'X-GNOME-Autostart-enabled=true',
    'Terminal=false',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(autostartFile), { recursive: true });
  fs.writeFileSync(autostartFile, desktop);
}

function setupIpc() {
  ipcMain.handle('root:get', () => root);
  ipcMain.handle('stages:get', () => api.getStages());
  ipcMain.handle('statuses:get', () => api.getStatuses());
  ipcMain.handle('project:create', (_e, payload) => api.makeProject(root, payload));
  ipcMain.handle('projects:list', () => api.getProjects(root));
  ipcMain.handle('project:get', (_e, slug) => api.getProject(root, slug));
  ipcMain.handle('project:setStage', (_e, slug, stage) => api.changeStage(root, slug, stage));
  ipcMain.handle('project:setNarrative', (_e, slug, body) => api.editNarrative(root, slug, body));
  ipcMain.handle('log:add', (_e, slug, payload) => api.createLog(root, slug, payload));
  ipcMain.handle('decision:add', (_e, slug, payload) => api.createDecision(root, slug, payload));
  ipcMain.handle('guidance:setBody', (_e, scope, slug, body) => api.editGuidanceBody(root, scope, slug, body));
  ipcMain.handle('search:query', (_e, query) => api.runSearch(root, query));

  ipcMain.handle('guidance:kinds', () => api.getGuidanceKinds());
  ipcMain.handle('guidance:all', () => api.getAllGuidance(root));
  ipcMain.handle('guidance:get', (_e, scope, slug) => api.getGuidance(root, scope, slug));
  ipcMain.handle('guidance:create', (_e, payload) => api.createGuidance(root, payload));
  ipcMain.handle('guidance:promote', (_e, projectSlug, slug) => api.promoteGuidance(root, projectSlug, slug));

  ipcMain.handle('clipboard:write', (_e, text) => writeClip(text));
  ipcMain.handle('clipboard:read', () => clipboard.readText());
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
  ipcMain.handle('capture:text', (_e, text) => captureText(text)); // drag-and-drop

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
    writeClip(payload);
    api.updateTask(root, projectSlug, id, { status: 'handed-off' });
    return { payload };
  });
  ipcMain.handle('task:attachReport', (_e, projectSlug, id, artifactId) => api.attachReport(root, projectSlug, id, artifactId));
  ipcMain.handle('resume:list', () => api.getResumeReminders(root));

  ipcMain.handle('adapters:list', () => api.getAdapters(root));
  ipcMain.handle('adapter:add', (_e, adapter) => api.createAdapter(root, adapter));
  ipcMain.handle('adapter:update', (_e, slug, patch) => api.updateAdapter(root, slug, patch));
  ipcMain.handle('adapter:remove', (_e, slug) => api.removeAdapter(root, slug));
  ipcMain.handle('adapter:launch', (_e, adapterSlug, projectSlug) => launchAdapter(adapterSlug, projectSlug));

  ipcMain.handle('pty:start', (_e, shell) => ptyStart(shell));
  ipcMain.on('pty:input', (_e, data) => { if (ptyProc) ptyProc.write(data); });
  ipcMain.on('pty:resize', (_e, cols, rows) => { if (ptyProc) { try { ptyProc.resize(cols, rows); } catch { /* size race */ } } });
  // Send a block of text to the terminal as a bracketed paste (so CLIs treat it
  // as pasted input, not line-by-line), and switch to the Terminal tab.
  ipcMain.handle('pty:send', (_e, text) => {
    ptyStart();
    if (ptyProc) ptyProc.write(`\x1b[200~${String(text ?? '')}\x1b[201~`);
    if (win && !win.isDestroyed()) win.webContents.send('nav:terminal');
  });
  ipcMain.handle('clipboard:watch', (_e, on) => { setClipboardWatch(Boolean(on)); return clipboardWatch; });
  ipcMain.handle('clipboard:watching', () => clipboardWatch);
}

function notify(body) {
  try {
    new Notification({ title: 'Verqury', body, silent: true }).show();
  } catch {
    // libnotify may be absent on some Linux setups — capture still succeeds.
  }
}

// Shared capture finisher: index refresh + notify the UI/OS.
function finishCapture(outcome) {
  if (!outcome.ok) {
    notify(outcome.reason === 'empty' ? 'Nothing to capture' : 'Create a project first to capture');
    return outcome;
  }
  api.refreshIndex(root);
  if (win && !win.isDestroyed()) win.webContents.send('artifact:captured', { project: outcome.project, id: outcome.artifact.id });
  notify(`Captured ${outcome.artifact.kind} → ${outcome.project}`);
  return outcome;
}

// Capture from the clipboard (global hotkey / UI button).
function captureFromClipboard() {
  return finishCapture(api.captureClipboard(root, () => clipboard.readText()));
}

// Capture dragged-and-dropped text (drop onto the window).
function captureText(text) {
  return finishCapture(api.captureClipboard(root, () => String(text ?? '')));
}

// Clipboard watch: passively file everything you copy (off by default). Files
// quietly — refreshes lists without yanking focus to the Inbox — and skips text
// Verqury itself put on the clipboard.
let clipboardWatch = false;
let watchSeen = '';
function captureTextQuiet(text) {
  const outcome = api.captureClipboard(root, () => String(text ?? ''));
  if (!outcome.ok) return;
  api.refreshIndex(root);
  if (win && !win.isDestroyed()) win.webContents.send('data:changed');
}
function pollClipboard() {
  if (!clipboardWatch) return;
  const cur = clipboard.readText();
  if (cur === watchSeen) return;
  watchSeen = cur;
  if (cur.trim() && cur !== selfWrite) captureTextQuiet(cur);
}
function setClipboardWatch(on) {
  clipboardWatch = on;
  watchSeen = clipboard.readText(); // don't capture whatever's already on the clipboard
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

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show Verqury', click: () => (win && !win.isDestroyed() ? win.show() : createWindow()) },
    {
      label: 'Watch clipboard (auto-capture)',
      type: 'checkbox',
      checked: clipboardWatch,
      click: (item) => setClipboardWatch(item.checked),
    },
    {
      label: 'Start on login (to tray)',
      type: 'checkbox',
      checked: autostartEnabled(),
      click: (item) => {
        setAutostart(item.checked);
        if (tray) tray.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function setupTray() {
  try {
    const img = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
    tray = new Tray(img);
    tray.setToolTip('Verqury — layer, not IDE');
    tray.on('click', () => (win && !win.isDestroyed() ? win.show() : createWindow()));
    tray.setContextMenu(buildTrayMenu());
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
    const slug = api.getProjects(root)[0].slug; // the seeded project (capture before we add one)

    // (0) project creation via the UI bridge → project.md on disk.
    const beforeProjects = api.getProjects(root).length;
    await dom("window.verqury.createProject({ name: 'Harness Project', stage: 'concept', status: 'active' })");
    await wait(200);
    result.projectCreated =
      api.getProjects(root).length === beforeProjects + 1 &&
      fs.existsSync(path.join(root, 'projects', 'harness-project', 'project.md'));
    if (process.env.VERQURY_HERO) {
      const hero = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, 'hero.png'), hero.toPNG());
    }
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

    // (8b) resume reminders (done-when): flag a task to surface on open, prove it
    // greets you in the resume strip when Verqury opens, then clears when done.
    const rt = api.createTask(root, slug, { title: 'Upload App Preview video' });
    await dom(`window.verqury.updateTask(${JSON.stringify(slug)}, ${JSON.stringify(rt.id)}, { resume: true })`);
    await wait(150);
    result.resumeToggled = api.getTask(root, slug, rt.id).resume === true;
    win.webContents.send('app:shown'); // simulate re-opening Verqury
    await wait(300);
    result.resumeSurfacedOnOpen = await dom("(()=>{const c=document.querySelector('#resume');return !!c && !c.hidden && [...c.querySelectorAll('.resume-card')].some(x=>x.textContent.includes('Upload App Preview video'));})()");
    // The reminder can remember which code tool to relaunch: set resumeAdapter and
    // prove a "Resume in <label>" launch button appears on its card.
    await dom(`window.verqury.updateTask(${JSON.stringify(slug)}, ${JSON.stringify(rt.id)}, { resumeAdapter: 'claude-code' })`);
    win.webContents.send('app:shown');
    await wait(300);
    result.resumeLaunchButton = await dom("(()=>{const card=[...document.querySelectorAll('#resume .resume-card')].find(x=>x.textContent.includes('Upload App Preview video'));return !!card && [...card.querySelectorAll('button')].some(b=>b.textContent.includes('Resume in Claude Code'));})()");
    await dom("(()=>{const card=[...document.querySelectorAll('#resume .resume-card')].find(x=>x.textContent.includes('Upload App Preview video'));card&&[...card.querySelectorAll('button')].find(b=>b.textContent==='Done').click();})()");
    await wait(300);
    result.resumeCleared = api.getTask(root, slug, rt.id).status === 'done'
      && await dom("![...document.querySelectorAll('#resume .resume-card')].some(x=>x.textContent.includes('Upload App Preview video'))");

    // (9) adapter registry (done-when): add a fictional adapter THROUGH THE SETTINGS
    // FORM (zero code), then launch — its command runs and its packet is handed off.
    const sentinel = path.join(outDir, 'adapter-launched.txt');
    await dom("document.querySelector('.tab[data-mode=settings]').click()");
    await wait(150);
    await dom("document.querySelector('#list .btn.wide').click()"); // '+ New adapter'
    await wait(150);
    await dom(`(() => {
      const ins = document.querySelectorAll('.form input');
      ins[0].value = 'Harness';
      ins[1].value = ${JSON.stringify(`echo ok > ${sentinel}`)};
      const sels = document.querySelectorAll('.form select');
      sels[0].value = 'external';       // run-in target
      sels[1].value = 'terminal-build'; // handoff packet
      [...document.querySelectorAll('.detail-actions button')].find((b) => b.textContent === 'Save').click();
    })()`);
    await wait(350);
    result.adapterCards = await dom("document.querySelectorAll('#list .adapter-card').length"); // 4 starters + harness
    clipboard.writeText('none');
    await dom(`window.verqury.launchAdapter('harness', ${JSON.stringify(slug)})`);
    await wait(500);
    result.adapterLaunched = fs.existsSync(sentinel);
    result.adapterHandoffCopied = /build context/.test(clipboard.readText());

    // (10) embedded terminal: open the tab, run a command through the PTY, capture it.
    await dom("document.querySelector('.tab[data-mode=terminal]').click()");
    await wait(700);
    result.terminalMounted = await dom("!!document.querySelector('.term-host .xterm')");
    await dom("window.verqury.ptyInput('echo hello from the Verqury terminal\\n')");
    await wait(600);
    // The shell rendered a prompt into the terminal (DOM renderer content check).
    result.terminalHasPrompt = await dom("(document.querySelector('.term-host .xterm-rows')?.innerText||'').includes('$')");
    // A terminal-target adapter routes its command into the embedded terminal.
    api.createAdapter(root, { slug: 'harness-term', label: 'HarnessTerm', command: 'echo TERMINAL_ADAPTER_OK', target: 'terminal', packet: null, notes: '' });
    const launchRes = await dom(`window.verqury.launchAdapter('harness-term', ${JSON.stringify(slug)})`);
    result.terminalAdapterRouted = Boolean(launchRes && launchRes.target === 'terminal');
    // Navigate away and back — the session must persist and still show a prompt.
    await dom("document.querySelector('.tab[data-mode=projects]').click()");
    await wait(300);
    await dom("document.querySelector('.tab[data-mode=terminal]').click()");
    await wait(500);
    result.terminalPersistsOnReturn = await dom("(document.querySelector('.term-host .xterm-rows')?.innerText||'').includes('$')");
    // Tab overflow check: all tabs fit within the sidebar (none spill past its right edge).
    result.tabsFitSidebar = await dom("(()=>{const sb=document.querySelector('.sidebar').getBoundingClientRect();return [...document.querySelectorAll('.tab')].every(t=>t.getBoundingClientRect().right<=sb.right+1);})()");
    await dom("document.querySelector('.tab[data-mode=projects]').click()"); // end on a normal view for the shot
    await wait(200);

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
  createWindow(!startHidden); // autostart launches hidden into the tray
  setupWatcher();
  setupTray();
  setupHotkey();
  setInterval(pollClipboard, 1000); // clipboard-watch poll (no-op unless enabled)

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
app.on('before-quit', () => {
  watcher?.close();
  try { ptyProc?.kill(); } catch { /* already gone */ }
});

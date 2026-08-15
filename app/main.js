// Electron main: the thin shell around verqury-core (ADR-0002, ADR-0003).
// All real logic lives in ./src/api.js and ./src/watcher.js so it stays testable
// without launching Electron. This file only wires: window, tray, IPC, watcher.
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, clipboard, shell, globalShortcut, Notification } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// ---- Telemetry receiver (ADR-0014) ----
// Lines of code and real cost only exist in Claude Code's OpenTelemetry export, so
// Verqury runs a loopback OTLP listener and joins what arrives to the session records
// the meter already keeps. Optional and off by default: with it disabled — or its port
// taken — the app behaves exactly as before, minus those two numbers.
let otelReceiver = null;

async function syncTelemetry() {
  const cfg = api.getTelemetryConfig(root);
  if (otelReceiver) {
    await otelReceiver.stop();
    otelReceiver = null;
  }
  if (!cfg.enabled) return null;
  otelReceiver = createOtelReceiver({
    port: cfg.port,
    onPayload: (body) => api.ingestTelemetry(root, body),
  });
  const bound = await otelReceiver.start();
  if (bound === null) otelReceiver = null; // port taken — degrade, never block startup
  return bound;
}

// Embedded terminal: node-pty spawns real PTYs in the main process and streams
// them to xterm.js widgets in the renderer (ADR-0009, multi-session ADR-0010).
// node-pty is a native module built for Electron's ABI (electron-rebuild), loaded
// only here. Each terminal tab is one keyed PTY; pty:data / pty:exit carry the id.
const ptys = new Map(); // id -> node-pty process
function ptyStart(id, { shell, cwd } = {}) {
  if (ptys.has(id)) return { alreadyRunning: true, id };
  const nodePty = require('node-pty');
  const sh = shell || process.env.SHELL || 'bash';
  const proc = nodePty.spawn(sh, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: cwd && fs.existsSync(cwd) ? cwd : process.env.HOME,
    // Telemetry is enabled for Verqury-LAUNCHED sessions only (ADR-0014 decision 5):
    // a session started in some other terminal is simply not counted. Empty object
    // when telemetry is off, so this spread is a no-op then.
    env: { ...process.env, ...api.getTelemetryEnv(root) },
  });
  proc.onData((d) => {
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', { id, data: d });
  });
  proc.onExit(() => {
    ptys.delete(id);
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', { id });
  });
  ptys.set(id, proc);
  return { started: true, id, shell: sh };
}
function ptyKill(id) {
  const p = ptys.get(id);
  if (p) { try { p.kill(); } catch { /* already gone */ } ptys.delete(id); }
  return { id };
}
import { addLog, writeHeartbeat, clearHeartbeat, readHeartbeat } from 'verqury-core/files';
import * as api from './src/api.js';
import { watchDataRoot } from './src/watcher.js';
import { createOtelReceiver } from './src/otel-receiver.js';
import * as telegram from './src/telegram.js';
import { makeTransport, sendContextEmail } from './src/mailer.js';
import { parseAskPayload, askCardText, askEmailBody } from './src/ask-card.js';

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
    // Renderer opens (or focuses) a project-pinned tab and runs the command there,
    // so it attaches its xterm listener before any output — no missed first line.
    return {
      launched: true,
      target: 'terminal',
      command,
      copiedPacket,
      pin: { id: `proj:${projectSlug}`, label: `${projectSlug} · ${adapter.label}`, cwd: project.repo || null },
    };
  }
  if (command.trim()) {
    spawn(command, {
      shell: true,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ...api.getTelemetryEnv(root) }, // Verqury-launched ⇒ counted
    }).unref();
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

// ---- One app per data root ----
// Verqury is meant to be a single tray-resident companion, but nothing used to enforce
// it: every launch built a second full instance, and Quit only ended the one whose tray
// icon you clicked. Worse than the wasted memory, two instances both long-poll Telegram
// — which must have exactly ONE consumer (ADR-0011) — so a tap could be swallowed by the
// instance you did not mean.
//
// Electron's lock lives in the userData directory, so an explicit VERQURY_DATA_ROOT gets
// its own userData. That keeps the rule honest (one app per ROOT, not one per machine)
// and lets a throwaway harness or dev run coexist with the installed app, which the
// release procedure depends on.
if (process.env.VERQURY_DATA_ROOT) {
  const key = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 12);
  app.setPath('userData', `${app.getPath('userData')}-root-${key}`);
}
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit(); // a sibling owns this root — hand off and go

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
  ipcMain.handle('sessions:metrics', (_e, slug) => api.getSessionMetrics(root, slug));
  ipcMain.handle('sessions:harvest', (_e, slug) => api.harvestProjectSessions(root, slug));
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
  ipcMain.handle('app:version', () => app.getVersion());

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

  // Remote decision relay (ADR-0011, Phase A): presence + Telegram config. All
  // mutations return the enriched state (incl. tokenSet/hookInstalled) so the
  // renderer never drops that status when toggling presence or enable.
  ipcMain.handle('notify:get', () => notifyState());
  ipcMain.handle('notify:setPresence', (_e, presence) => {
    api.changePresence(root, presence);
    if (tray) tray.setContextMenu(buildTrayMenu());
    syncRelay();
    return notifyState();
  });
  ipcMain.handle('notify:update', (_e, patch) => {
    api.updateNotifyConfig(root, patch);
    syncRelay();
    return notifyState();
  });
  ipcMain.handle('notify:setToken', (_e, token) => { const r = api.setTelegramToken(token); syncRelay(); return r; });
  ipcMain.handle('notify:setSmtp', (_e, password) => { const r = api.setSmtpPassword(password); return { ...notifyState(), ...r }; });

  // Decision inbox (ADR-0011): permission verdict (Phase B) + question answer (Phase C),
  // the same core paths a phone tap/reply drives.
  ipcMain.handle('approvals:list', (_e, filters) => api.getApprovals(root, filters));
  ipcMain.handle('approval:answer', (_e, id, decision) => api.decideApproval(root, id, decision));
  ipcMain.handle('question:answer', (_e, id, answer) => api.answerQuestionInbox(root, id, answer));
  ipcMain.handle('approval:expire', (_e, id) => api.parkApproval(root, id));
  ipcMain.handle('telemetry:get', () => ({ ...api.getTelemetryConfig(root), running: Boolean(otelReceiver) }));
  ipcMain.handle('telemetry:set', async (_e, patch) => {
    api.setTelemetryConfig(root, patch);
    const bound = await syncTelemetry();
    return { ...api.getTelemetryConfig(root), running: Boolean(otelReceiver), boundPort: bound };
  });

  ipcMain.handle('pty:start', (_e, id, opts) => ptyStart(id, opts));
  ipcMain.on('pty:input', (_e, id, data) => { const p = ptys.get(id); if (p) p.write(data); });
  ipcMain.on('pty:resize', (_e, id, cols, rows) => { const p = ptys.get(id); if (p) { try { p.resize(cols, rows); } catch { /* size race */ } } });
  ipcMain.handle('pty:kill', (_e, id) => ptyKill(id));
  // A terminal rang the bell while Verqury was in the background — nudge the OS.
  ipcMain.handle('terminal:notify', (_e, label) => {
    if (win && !win.isDestroyed() && !win.isFocused()) notify(`${label} is waiting for you`);
  });
  ipcMain.handle('clipboard:watch', (_e, on) => { setClipboardWatch(Boolean(on)); return clipboardWatch; });
  ipcMain.handle('clipboard:watching', () => clipboardWatch);
}

// Read-only check: is the Phase-A Notification hook installed + registered? The
// app never rewrites ~/.claude/settings.json (surgical; that's a one-time setup);
// it just reports status so the Settings UI can guide the owner.
function notifyHookInstalled() {
  const script = path.join(os.homedir(), '.claude', 'hooks', 'verqury-notify.cjs');
  if (!fs.existsSync(script)) return false;
  try {
    const settings = fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8');
    return settings.includes('verqury-notify');
  } catch {
    return false;
  }
}

// Enriched notify state for the renderer: core config + secret/hook status.
function notifyState() {
  return { ...api.getNotifyConfig(root), hookInstalled: notifyHookInstalled() };
}

// ---- Remote decision relay — Phase B: the interactive approve-by-tap gate (ADR-0011) ----
// The app is the SINGLE Telegram consumer: it long-polls getUpdates, sends an inline
// [Approve][Deny] card for each pending approval the hook files, and writes the tapped
// verdict into the record — which the blocking hook is polling for. It never decides on
// the owner's behalf; a missed tap expires (in the hook) to the desktop prompt.
const REMIND_AFTER_MS = 7 * 60 * 1000; // "expiring soon" nudge (hook expires at 9 min)
const relayCards = new Map(); // approvalId -> { messageId, remindedAt }
let relayGen = 0; // bumps to retire a stale long-poll loop when config changes
let relayOffset; // Telegram getUpdates offset (in-memory; stale callbacks are ignored)

function relayConfig() {
  const cfg = api.getNotifyConfig(root); // { enabled, presence, telegram:{chatId}, ... }
  return { enabled: cfg.enabled === true, chatId: cfg.telegram?.chatId || '', token: api.readTelegramToken() };
}

// Start or stop the long-poll to match current config. Called at startup and after any
// notify change. Skipped under the headless harness (no network; approvals tested direct).
function syncRelay() {
  if (process.env.VERQURY_VERIFY) return;
  const { enabled, chatId, token } = relayConfig();
  const shouldRun = enabled && Boolean(chatId) && Boolean(token);
  relayGen++; // retire any running loop
  if (shouldRun) {
    const gen = relayGen;
    relayLoop(gen, token, chatId);
    reapExpiredApprovals(); // never card an orphan the relay is only now able to see
    reconcileApprovals();
  }
}

async function relayLoop(gen, token, chatId) {
  while (gen === relayGen) {
    try {
      const res = await telegram.getUpdates(token, relayOffset);
      if (gen !== relayGen) return;
      for (const u of res.result || []) {
        relayOffset = u.update_id + 1;
        if (u.callback_query) await handleCallback(u.callback_query, token, chatId);
        else if (u.message) await handleMessage(u.message, token, chatId);
      }
    } catch {
      await new Promise((r) => setTimeout(r, 5000)); // transient network error — back off
    }
  }
}

// A tap arrived. Permission cards carry a:<id>/d:<id> (allow/deny); question cards carry
// q:<id>:<optIndex> (a chosen option). Record the verdict (the hook/skill is polling for
// it), acknowledge the tap, and neutralize the card so it can't be double-answered.
async function handleCallback(cbq, token, chatId) {
  const data = String(cbq.data || '');
  try {
    const q = data.match(/^q:(.+):(\d+)$/);
    if (q) {
      await resolveQuestionTap(q[1], Number(q[2]), cbq, token, chatId);
      return;
    }
    const m = data.match(/^([ad]):(.+)$/);
    if (!m) return;
    const decision = m[1] === 'a' ? 'allow' : 'deny';
    const id = m[2];
    const card = relayCards.get(id);
    const appr = api.getApprovals(root, {}).find((a) => a.id === id);
    if (!appr || appr.status !== 'pending') {
      await telegram.answerCallbackQuery(token, cbq.id, 'Already handled');
    } else {
      api.decideApproval(root, id, decision);
      await telegram.answerCallbackQuery(token, cbq.id, decision === 'allow' ? 'Approved ✅' : 'Denied ⛔');
      const messageId = card?.messageId ?? cbq.message?.message_id;
      if (messageId) {
        await telegram.editMessageText(token, chatId, messageId, `${decision === 'allow' ? '✅ Approved' : '⛔ Denied'} · ${appr.summary || appr.tool || 'permission'}`);
      }
    }
    relayCards.delete(id);
  } catch {
    /* never throw out of the loop */
  }
}

// A question option was tapped — record it as the free-text answer (the option label).
async function resolveQuestionTap(id, index, cbq, token, chatId) {
  const card = relayCards.get(id);
  const q = api.getApprovals(root, {}).find((a) => a.id === id);
  if (!q || q.status !== 'pending' || q.kind !== 'question') {
    await telegram.answerCallbackQuery(token, cbq.id, 'Already handled');
    relayCards.delete(id);
    return;
  }
  const answer = q.options?.[index] ?? String(index);
  api.answerQuestionInbox(root, id, answer);
  await telegram.answerCallbackQuery(token, cbq.id, `Recorded: ${answer}`.slice(0, 60));
  const messageId = card?.messageId ?? cbq.message?.message_id;
  if (messageId) await telegram.editMessageText(token, chatId, messageId, `💬 Answered · ${q.summary || 'question'}\n→ ${answer}`);
  relayCards.delete(id);
}

// A typed reply arrived (Phase C). Map it to a pending question — first by the card it
// replies to (reply_to_message.message_id), else by a #code in the text — and record the
// free-text answer. Only messages from the configured chat are honoured.
async function handleMessage(msg, token, chatId) {
  try {
    if (String(msg.chat?.id ?? '') !== String(chatId)) return; // ignore other chats
    const text = String(msg.text || '').trim();
    if (!text || text.startsWith('/')) return; // ignore commands/empty
    let id = null;
    const replyId = msg.reply_to_message?.message_id;
    if (replyId) {
      for (const [aid, card] of relayCards) {
        if (card.messageId === replyId) { id = aid; break; }
      }
    }
    if (!id) {
      const code = text.match(/#([0-9A-Za-z]{4,})/);
      if (code) {
        const hit = api.getApprovals(root, {}).find(
          (a) => a.kind === 'question' && a.status === 'pending' && short(a.id).toLowerCase() === code[1].toLowerCase(),
        );
        if (hit) id = hit.id;
      }
    }
    if (!id) return; // not a reply we recognise — stay quiet
    const q = api.getApprovals(root, {}).find((a) => a.id === id);
    if (!q || q.status !== 'pending' || q.kind !== 'question') return;
    const answer = text.replace(/^#[0-9A-Za-z]+\s*/, '').trim() || text;
    api.answerQuestionInbox(root, id, answer);
    const card = relayCards.get(id);
    if (card?.messageId) await telegram.editMessageText(token, chatId, card.messageId, `💬 Answered · ${q.summary || 'question'}\n→ ${answer}`);
    relayCards.delete(id);
    await telegram.sendMessage(token, chatId, `✅ Recorded your answer for #${short(id)}`);
  } catch {
    /* never throw out of the loop */
  }
}

// Reap records whose writer died before its own expiry timer could fire (see
// sweepExpiredApprovals). Runs BEFORE every reconcile so an orphan is expired rather than
// carded — and unlike the reconcile it runs whether or not the relay is configured,
// because expiry is a fact about the record, not a notification.
function reapExpiredApprovals() {
  try {
    api.reapExpiredApprovals(root);
  } catch {
    /* best-effort; the next sweep retries */
  }
}

// Reconcile the phone with the inbox: send a card for each new pending approval, nudge
// the ones nearing expiry, and close out cards whose record has since resolved/expired.
let reconciling = false;
async function reconcileApprovals() {
  if (process.env.VERQURY_VERIFY || reconciling) return;
  const { enabled, chatId, token } = relayConfig();
  if (!enabled || !chatId || !token) return;
  reconciling = true;
  try {
    const notify = api.getNotifyConfig(root); // full config (incl. email) for the context channel
    const all = api.getApprovals(root, {});
    const pendingIds = new Set();
    for (const a of all) {
      if (a.status === 'pending') {
        pendingIds.add(a.id);
        // A question relays to the phone only when Away — Here = desk (it still shows in
        // the Approvals tab and the skill polls it there). This matches the Phase A notify
        // and Phase B gate: phone activity happens Away. (Permissions never reach here when
        // Here — the hook only files a record when Away.) Flipping to Away sends it next sweep.
        if (a.kind === 'question' && notify.presence !== 'away') continue;
        const card = relayCards.get(a.id);
        if (!card) {
          relayCards.set(a.id, { messageId: null, remindedAt: null }); // claim before await (no dup)
          let emailed = false;
          let res;
          if (a.kind === 'question') {
            emailed = await maybeEmailQuestion(a, notify);
            res = await telegram.sendQuestionCard(token, chatId, questionCardText(a, emailed), a.id, a.options || []);
          } else {
            // An AskUserQuestion permission gets the readable card (+ emailed options);
            // anything else is a plain tool permission.
            const digest = askDigest(a);
            if (digest) emailed = await maybeEmailAsk(a, digest, notify);
            const text = digest
              ? askCardText({ code: short(a.id), project: a.project, sessionId: a.sessionId }, digest, emailed)
              : cardText(a);
            res = await telegram.sendApprovalCard(token, chatId, text, a.id);
          }
          const messageId = res?.result?.message_id ?? null;
          if (messageId) relayCards.set(a.id, { messageId, remindedAt: null });
          else {
            // The card did not land. Retrying "next reconcile" is what hid a placeholder
            // bot token for a week: every send 401'd, every record still rode the full
            // 9-min expiry, and nothing anywhere said so. A permission the phone will
            // never show belongs at the desk immediately (ADR-0017). Telegram's own
            // `description` is carried into the record so the reason is legible.
            relayCards.delete(a.id);
            try {
              api.parkUndeliverable(root, a.id, res?.description || 'Telegram send failed');
            } catch {
              /* raced with a tap or a desk answer — that outcome wins, nothing to do */
            }
          }
        } else if (a.kind !== 'question' && card.messageId && !card.remindedAt && Date.now() - Date.parse(a.created) > REMIND_AFTER_MS) {
          // "expiring soon" nudge is permission-only (the hook expires at 9 min; the
          // verqury-ask skill has a longer, non-harness-bound window).
          card.remindedAt = Date.now();
          await telegram.sendMessage(token, chatId, `⏳ Expiring in ~2 min — #${short(a.id)}\n${a.summary || a.tool || 'permission'}`);
        }
      }
    }
    // A card whose record is no longer pending (expired, or answered at the desk) →
    // close it out so the phone reflects the resolution.
    for (const [id, card] of relayCards) {
      if (pendingIds.has(id)) continue;
      const appr = all.find((a) => a.id === id);
      if (appr && card.messageId) {
        if (appr.status === 'expired') {
          await telegram.editMessageText(token, chatId, card.messageId, `⏱ Expired — parked at your desk · ${appr.summary || appr.tool || 'permission'}`);
        } else if (appr.status === 'answered' && appr.kind === 'question') {
          await telegram.editMessageText(token, chatId, card.messageId, `💬 Answered · ${appr.summary || 'question'}\n→ ${appr.answer || ''}`);
        } else if (appr.status === 'answered') {
          await telegram.editMessageText(token, chatId, card.messageId, `${appr.decision === 'allow' ? '✅ Approved' : '⛔ Denied'} · ${appr.summary || appr.tool || 'permission'}`);
        }
      }
      relayCards.delete(id);
    }
  } catch {
    /* best-effort; next reconcile retries */
  } finally {
    reconciling = false;
  }
}

const short = (id) => String(id).slice(-6);
function cardText(a) {
  return [
    `🔔 Approve this? #${short(a.id)}`,
    a.summary || a.tool || 'Permission needed',
    [a.project && `📁 ${a.project}`, a.sessionId && `#${a.sessionId}`].filter(Boolean).join('  '),
  ].filter(Boolean).join('\n');
}

// Phase C question card. Options become buttons; the owner may also reply with text.
function questionCardText(a, emailed) {
  const lines = [`💬 Question #${short(a.id)}`, a.summary || 'A decision is needed'];
  lines.push(a.options?.length ? 'Tap an option or reply with your answer.' : 'Reply to this message with your answer.');
  if (emailed) lines.push('📧 Full context emailed.');
  const meta = [a.project && `📁 ${a.project}`, a.sessionId && `#${a.sessionId}`].filter(Boolean).join('  ');
  if (meta) lines.push(meta);
  return lines.join('\n');
}

// Claude Code's AskUserQuestion arrives as a PERMISSION record whose body is the tool's
// JSON payload. Rendering it for the phone/email lives in app/src/ask-card.js (pure +
// unit-tested); here we only fetch the record body and wire the result to the channels.
// The gate can still only answer allow/deny — approving means "let me answer at my desk".
function askDigest(a) {
  if (a.kind === 'question' || a.tool !== 'AskUserQuestion') return null;
  return parseAskPayload(api.getApprovalById(root, a.id)?.body);
}

// Long-form options for an AskUserQuestion, over the same powerless send-once channel.
async function maybeEmailAsk(a, digest, notify) {
  if (a.emailedAt) return false;
  const body = askEmailBody(digest);
  if (body.length < EMAIL_BODY_THRESHOLD) return false; // only escalate what a card can't carry
  const email = notify.email || {};
  const password = api.readSmtpPassword();
  if (!password || !email.from) return false; // not configured → skip; the card still sends
  try {
    const transport = makeTransport(email, password);
    await sendContextEmail(transport, email, {
      code: short(a.id),
      summary: digest[0]?.question || a.summary || 'question',
      body,
      project: a.project,
    });
    api.markQuestionEmailed(root, a.id);
    return true;
  } catch {
    return false; // best-effort; the card is the authority
  }
}

// preview is body.slice(0,140); a full 140 means the body was long enough to email.
const EMAIL_BODY_THRESHOLD = 140;

// Escalating context email (ADR-0011 Phase C): for a long or needs-context question,
// email the full body ONCE (guarded by emailedAt), then let the card note it. Powerless
// and best-effort — the Telegram card is the authority; a missing/failed email never
// blocks the question. Returns whether an email was sent (so the card can say so).
async function maybeEmailQuestion(a, notify) {
  if (a.kind !== 'question' || a.emailedAt) return false;
  const wants = a.needsContext || (a.preview && a.preview.length >= EMAIL_BODY_THRESHOLD);
  if (!wants) return false;
  const email = notify.email || {};
  const password = api.readSmtpPassword();
  if (!password || !email.from) return false; // not configured → skip email, card still sends
  try {
    const full = api.getApprovalById(root, a.id);
    const transport = makeTransport(email, password);
    await sendContextEmail(transport, email, { code: short(a.id), summary: a.summary || 'question', body: full?.body || '', project: a.project });
    api.markQuestionEmailed(root, a.id);
    return true;
  } catch {
    return false; // email is best-effort; the tap/reply channel is unaffected
  }
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
    // A new pending approval (or a hook-driven expiry) may have landed — relay it.
    reconcileApprovals();
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
    {
      // Remote relay presence (ADR-0011): flip to Away as you leave the desk and
      // pending build decisions ping your phone instead of the local terminal bell.
      label: 'Away (notify my phone)',
      type: 'checkbox',
      checked: api.getNotifyConfig(root).presence === 'away',
      click: (item) => {
        api.changePresence(root, item.checked ? 'away' : 'here');
        if (tray) tray.setContextMenu(buildTrayMenu());
        syncRelay();
        if (win && !win.isDestroyed()) win.webContents.send('notify:changed');
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
    // States the residency plainly: closing the window leaves this running.
    tray.setToolTip('Verqury — running in the tray (Quit here to exit)');
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
  // (-1) CREDENTIAL ISOLATION, before any block can write a secret anywhere. This runs first
  // deliberately: block 11 saves a fixture token, and until 2026-08-14 it could land in the
  // owner's real ~/.claude/.env (engineering-notes §17). Throwing here is the intended
  // behaviour — the finally-block still writes verify.json, so the refusal is visible.
  const realEnv = path.join(os.homedir(), '.claude', '.env');
  const realEnvBefore = api.envFingerprint(realEnv);
  let harnessEnvFile;
  try {
    harnessEnvFile = api.isolateHarnessEnvFile(root, { realEnv });
    result.envFileIsolated = true;
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

    // (11) remote decision relay — Phase A (ADR-0011). Placed BEFORE the terminal
    // block so it never depends on node-pty. Prove the UI writes presence to
    // config.json, the token round-trips to an ISOLATED .env (never ~/.claude),
    // chat_id + enable persist, and the installed Notification hook — driven as a
    // real subprocess — sends when Away+configured and gates when Here.
    await dom("document.querySelector('.settings-nav-card').click()"); // open Notifications panel (still on Settings)
    await wait(200);
    result.notifyPanelShown = await dom("(document.querySelector('.detail-title')?.textContent||'').includes('Notifications')");
    // Flip to Away via the segmented control (the UI path), then configure via bridge.
    await dom("[...document.querySelectorAll('.segmented .seg')].find(b=>b.textContent.includes('Away')).click()");
    await wait(200);
    await dom("(async()=>{ await window.verqury.setTelegramToken('123:HARNESS-SECRET'); await window.verqury.updateNotify({ enabled: true, telegram: { chatId: '55501' } }); })()");
    await wait(200);
    const cfgNotify = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).notify || {};
    result.notifyPresenceAway = cfgNotify.presence === 'away';
    result.notifyEnabledChat = cfgNotify.enabled === true && cfgNotify.telegram?.chatId === '55501';
    result.notifyTokenNotInConfig = !JSON.stringify(cfgNotify).includes('HARNESS-SECRET'); // secret must NOT be in config.json
    // Assert against the path WE isolated, not one re-derived from the code under test. The
    // old line read api.envFilePath() back from the very resolver saveEnvVar had just written
    // through, so it passed identically whether the fixture landed in a throwaway file or in
    // the owner's real ~/.claude/.env — a test that derives its expected location from the
    // code under test cannot detect that the location is wrong (§17).
    const envFile = harnessEnvFile;
    result.notifyTokenInEnv = fs.existsSync(envFile) && /VERQURY_TELEGRAM_BOT_TOKEN=123:HARNESS-SECRET/.test(fs.readFileSync(envFile, 'utf8'));
    // And the negative — the check that would actually have caught the eight-day outage.
    result.realEnvUntouched = api.envFingerprint(realEnv) === realEnvBefore;
    // The installed hook, run as Claude Code would run it (piped payload), Away → sends.
    // The hook script ships to ~/.claude/hooks, not inside the app bundle, so in a
    // PACKAGED run (asar-less resources dir) the repo copy isn't co-located — skip the
    // subprocess checks there (they are proven in dev + the live phone test).
    const hookPath = path.join(dir, '..', 'hooks', 'verqury-notify.cjs');
    if (fs.existsSync(hookPath)) {
      const runHook = (payload) => JSON.parse(execFileSync(process.execPath, [hookPath], {
        input: JSON.stringify(payload),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VERQURY_NOTIFY_DRYRUN: '1', VERQURY_DATA_ROOT: root, VERQURY_ENV_FILE: envFile },
        encoding: 'utf8',
      }).trim());
      // Post-Phase-B division of labour: the notify hook sends for completion/idle...
      const away = runHook({ message: 'Task complete — build finished', cwd: root, session_id: 'abcd1234ef' });
      result.hookSendsWhenAway = away.send === true && away.reason === 'done' && away.tokenPresent === true;
      result.hookTextNoSecret = !JSON.stringify(away).includes('HARNESS-SECRET'); // dry-run output must never carry the token
      // ...but stays SILENT on permission prompts — the Phase B gate owns those (no double-ping).
      const perm = runHook({ message: 'Claude needs your permission to run Bash', cwd: root });
      result.hookSuppressesPermission = perm.send === false && perm.reason === 'permission-handled-by-gate';
      // Flip Here → the hook gates entirely (this is what protects an unattended agent).
      await dom("window.verqury.setPresence('here')");
      await wait(150);
      const here = runHook({ message: 'Task complete — build finished', cwd: root });
      result.hookGatesWhenHere = here.send === false && here.reason === 'here';
    } else {
      result.hookChecksSkipped = 'packaged run — hooks/ not bundled; hook proven in dev + live';
    }
    await dom("document.querySelector('.settings-nav-card').click()"); // re-render → token status reflects
    await wait(150);
    result.notifyTokenStatus = await dom("[...document.querySelectorAll('.status-line')].some(s=>/saved to/.test(s.textContent))");

    // (12) remote decision relay — Phase B (ADR-0011): the interactive approve-by-tap
    // gate. Placed with block 11 (before terminal) so it never needs node-pty. The live
    // Telegram round-trip is proven on the phone; here we prove the file-mediated spine:
    // the PermissionRequest hook FILES a pending approval when Away, the app's Approval
    // inbox surfaces it, a desktop verdict resolves it (the same core path a tap uses),
    // and the hook GATES to the desktop prompt when Here.
    await dom("window.verqury.setPresence('away')"); // block 11 left it Here
    await wait(150);
    const permHook = path.join(dir, '..', 'hooks', 'verqury-permission.cjs');
    if (fs.existsSync(permHook)) {
      const runPerm = (payload, extraEnv = {}) => {
        const out = execFileSync(process.execPath, [permHook], {
          input: JSON.stringify(payload),
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VERQURY_PERMISSION_DRYRUN: '1', VERQURY_DATA_ROOT: root, VERQURY_ENV_FILE: envFile, ...extraEnv },
          encoding: 'utf8',
        }).trim();
        return out ? JSON.parse(out) : {};
      };
      // Away + configured → the hook files a pending approval with a readable summary.
      const filed = runPerm({ tool_name: 'Bash', tool_input: { command: 'git commit -m ship' }, cwd: path.join(root, 'projects', slug), session_id: 'sessB1234567' });
      result.permHookFiled = filed.engage === true && /git commit -m ship/.test(filed.summary || '');
      const pend = api.getPendingApprovals(root);
      result.approvalPendingOnDisk = pend.length === 1 && pend[0].id === filed.id;
      // It surfaces in the Approvals inbox, and the tab shows a waiting count. The
      // watcher (approvals/ is watched from init) pushes data:changed → refresh; give
      // that a beat to settle before rendering the tab.
      await wait(600);
      await dom("document.querySelector('.tab[data-mode=approvals]').click()");
      await wait(250);
      result.approvalInboxCard = await dom("[...document.querySelectorAll('#list .artifact-card .preview')].some(p=>p.textContent.includes('git commit -m ship'))");
      result.approvalTabBadge = await dom("(document.querySelector('.tab[data-mode=approvals]')?.textContent||'').includes('(1)')");
      // A desktop verdict resolves it — the identical core path a phone tap drives.
      await dom(`window.verqury.answerApproval(${JSON.stringify(filed.id)}, 'allow')`);
      await wait(200);
      const resolved = api.getApprovals(root, {}).find((a) => a.id === filed.id);
      result.approvalDesktopAnswered = resolved && resolved.status === 'answered' && resolved.decision === 'allow';
      result.approvalClearedFromPending = api.getPendingApprovals(root).length === 0;
      // Here → the hook engages nothing, so the normal desktop prompt handles it.
      const gated = runPerm({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: root }, { VERQURY_DATA_ROOT: root });
      await dom("window.verqury.setPresence('here')");
      await wait(100);
      const gatedHere = runPerm({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: root });
      result.permHookGatesWhenHere = gated.engage === true && gatedHere.engage === false && gatedHere.reason === 'here';
      // Away but the app is CLOSED: nothing consumes the record, so the gate must
      // decline at once rather than stall the build for the full ~9-min expiry.
      await dom("window.verqury.setPresence('away')");
      await wait(100);
      clearHeartbeat(root);
      const noApp = runPerm({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: root });
      result.permHookNeedsRunningApp = noApp.engage === false && noApp.reason === 'app-not-running';
      writeHeartbeat(root); // we are in fact running; restore before the beat interval would
      const backUp = runPerm({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: root });
      result.permHookRelaysWhenAppUp = backUp.engage === true;
      await dom("window.verqury.setPresence('here')");
      await wait(100);
    } else {
      result.permHookSkipped = 'packaged run — hooks/ not bundled; proven in dev + live';
    }

    // (13) remote decision relay — Phase C (ADR-0011): the verqury-ask skill + question
    // inbox. The live Telegram reply / email is proven on the phone + in the mailer unit
    // test; here we prove the file-mediated spine: the skill FILES a question (kind:
    // question, options, needs-context) → it surfaces in the same inbox → a desktop answer
    // resolves it (the core path a tap/typed-reply drives) → the skill's POLL reads a
    // core-written answer back (the return contract that hands the answer to the model).
    const askScript = path.join(dir, '..', 'skills', 'verqury-ask', 'scripts', 'ask.cjs');
    if (fs.existsSync(askScript)) {
      const runAsk = (args, extraEnv = {}) => execFileSync(process.execPath, [askScript, ...args], {
        input: '', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VERQURY_DATA_ROOT: root, ...extraEnv }, encoding: 'utf8',
      }).trim();
      // File a question (dry-run: write the record + report, skip the block).
      const asked = JSON.parse(runAsk(
        ['--summary', 'Approach A or B for the relay?', '--options', 'A|B', '--body', 'x'.repeat(200), '--needs-context', '--project', slug],
        { VERQURY_ASK_DRYRUN: '1' },
      ) || '{}');
      const qrec = api.getApprovalById(root, asked.id);
      result.askFiledQuestion = Boolean(qrec && qrec.kind === 'question' && qrec.needsContext === true && Array.isArray(qrec.options) && qrec.options.length === 2);
      // It surfaces in the Approvals inbox as a waiting question (same tab as permissions).
      await wait(600);
      await dom("document.querySelector('.tab[data-mode=approvals]').click()");
      await wait(250);
      result.questionInboxCard = await dom("[...document.querySelectorAll('#list .artifact-card .preview')].some(p=>p.textContent.includes('Approach A or B'))");
      // A desktop answer (free text / tapped option) resolves it — the core path a phone
      // tap or typed reply drives — and clears it from pending.
      await dom(`window.verqury.answerQuestion(${JSON.stringify(asked.id)}, 'B')`);
      await wait(200);
      const qResolved = api.getApprovals(root, {}).find((a) => a.id === asked.id);
      result.questionDesktopAnswered = Boolean(qResolved && qResolved.status === 'answered' && qResolved.answer === 'B' && qResolved.kind === 'question');
      // The skill's POLL path reads a core-written answer back (return contract): make a
      // fresh question, answer it via core, then run the skill runner against that id.
      const q2 = api.fileQuestion(root, { summary: 'poll round-trip?', options: ['ok'], project: slug });
      api.answerQuestionInbox(root, q2.id, 'Ship it');
      const polled = runAsk([], { VERQURY_ASK_ID: q2.id, VERQURY_ASK_POLL_MS: '100', VERQURY_ASK_TIMEOUT_MS: '3000' });
      result.askPollReadsAnswer = polled === 'Ship it';
    } else {
      result.askChecksSkipped = 'packaged run — skills/ not bundled; proven in dev';
    }

    // (10) embedded terminal — multi-session tabs (ADR-0010). Opening the view gives
    // a default shell tab; prove independent per-tab sessions, project-pinned reuse,
    // isolation between tabs, persistence across navigation, and close.
    await dom("document.querySelector('.tab[data-mode=terminal]').click()");
    await wait(700);
    result.terminalMounted = await dom("!!document.querySelector('.term-host .xterm')");
    result.terminalDefaultTab = await dom("document.querySelectorAll('.term-tab').length"); // 1 default shell
    // A terminal-target adapter now returns a project pin from main (renderer opens the tab).
    api.createAdapter(root, { slug: 'harness-term', label: 'HarnessTerm', command: 'echo OK', target: 'terminal', packet: null, notes: '' });
    const launchRes = await dom(`window.verqury.launchAdapter('harness-term', ${JSON.stringify(slug)})`);
    result.terminalAdapterPin = Boolean(launchRes && launchRes.target === 'terminal' && launchRes.pin && launchRes.pin.id === `proj:${slug}`);
    // Open a project-pinned tab and run a unique command in it (via the UI path).
    await dom(`window.__verquryTerm.openProjectTerminal({ id: 'proj:${slug}', label: '${slug} · echo', cwd: null }, 'echo PROJ_TAB_MARKER')`);
    await wait(900);
    result.terminalTwoTabs = await dom("document.querySelectorAll('.term-tab').length"); // shell + project
    result.terminalProjectPinned = await dom(`[...document.querySelectorAll('.term-tab-label')].some(t=>t.textContent.includes('${slug} · echo'))`);
    result.terminalActiveRanCommand = await dom("(document.querySelector('.term-host .xterm-rows')?.innerText||'').includes('PROJ_TAB_MARKER')");
    // Reuse: opening the same project id again focuses the tab — no duplicate.
    await dom(`window.__verquryTerm.openProjectTerminal({ id: 'proj:${slug}', label: '${slug} · echo', cwd: null }, '')`);
    await wait(200);
    result.terminalReuseNoDup = (await dom("document.querySelectorAll('.term-tab').length")) === 2;
    // Switch to the first (shell) tab — it has a prompt and NOT the project tab's output.
    await dom("[...document.querySelectorAll('.term-tab .term-tab-label')][0].click()");
    await wait(500);
    result.terminalHasPrompt = await dom("(document.querySelector('.term-host .xterm-rows')?.innerText||'').includes('$')");
    result.terminalTabsIsolated = await dom("!(document.querySelector('.term-host .xterm-rows')?.innerText||'').includes('PROJ_TAB_MARKER')");
    // Bell: a background tab that rings BEL gets an attention indicator; opening it clears it.
    await dom(`window.__verquryTerm.ringBellForTest('proj:${slug}')`);
    await wait(200);
    result.terminalBellAttention = await dom(`(()=>{const t=[...document.querySelectorAll('.term-tab')].find(x=>x.textContent.includes('${slug} · echo'));return !!t && t.classList.contains('attention');})()`);
    await dom(`[...document.querySelectorAll('.term-tab .term-tab-label')].find(l=>l.textContent.includes('${slug} · echo')).click()`);
    await wait(200);
    result.terminalBellCleared = await dom(`(()=>{const t=[...document.querySelectorAll('.term-tab')].find(x=>x.textContent.includes('${slug} · echo'));return !!t && !t.classList.contains('attention');})()`);

    // (15) A bell in a BACKGROUND tab must not disturb the tab you are typing in.
    // Regression guard: onBell used to call the full render(), whose replaceChildren
    // detached and re-appended the active session's container — dropping focus out of
    // its xterm textarea, so the keyboard went dead mid-sentence until you clicked back.
    // Focus the active terminal, ring the OTHER tab, and assert focus never moved and
    // the active tab never changed.
    await dom("document.querySelector('.term-host .xterm-helper-textarea')?.focus()");
    await wait(100);
    const focusedBefore = await dom("!!document.activeElement?.closest('.term-host')");
    const activeLabelBefore = await dom("document.querySelector('.term-tab.active .term-tab-label')?.textContent || ''");
    await dom("window.__verquryTerm.ringBellForTest('shell:1')"); // the other (background) tab
    await wait(250);
    result.bellKeepsFocus = focusedBefore && (await dom("!!document.activeElement?.closest('.term-host')"));
    result.bellKeepsActiveTab = activeLabelBefore === (await dom("document.querySelector('.term-tab.active .term-tab-label')?.textContent || ''"));
    result.bellMarksOtherTab = await dom("[...document.querySelectorAll('.term-tab')].some(t=>t.classList.contains('attention'))");
    // Every open tab carries its own distinct color (set as --tab-color in terminal.js).
    result.tabColorsDistinct = await dom("(()=>{const c=[...document.querySelectorAll('.term-tab')].map(t=>t.style.getPropertyValue('--tab-color').trim()).filter(Boolean);return c.length>1 && new Set(c).size===c.length;})()");
    // Navigate away and back — both sessions persist.
    await dom("document.querySelector('.tab[data-mode=projects]').click()");
    await wait(300);
    await dom("document.querySelector('.tab[data-mode=terminal]').click()");
    await wait(500);
    result.terminalPersistsOnReturn = (await dom("document.querySelectorAll('.term-tab').length")) === 2;
    // Close the project tab via its × — only it disappears.
    await dom(`(()=>{const tab=[...document.querySelectorAll('.term-tab')].find(t=>t.textContent.includes('${slug} · echo'));tab&&tab.querySelector('.term-tab-close').click();})()`);
    await wait(300);
    result.terminalTabClosed = await dom(`document.querySelectorAll('.term-tab').length===1 && ![...document.querySelectorAll('.term-tab-label')].some(t=>t.textContent.includes('${slug} · echo'))`);
    // Tab overflow check: all tabs fit within the sidebar (none spill past its right edge).
    result.tabsFitSidebar = await dom("(()=>{const sb=document.querySelector('.sidebar').getBoundingClientRect();return [...document.querySelectorAll('.tab')].every(t=>t.getBoundingClientRect().right<=sb.right+1);})()");

    // (14) About & updates panel: the Settings card renders the app version + the two
    // verqury.com deep-link buttons + external links. Asserts wiring only (no click →
    // never spawns a browser).
    await dom("document.querySelector('.tab[data-mode=settings]').click()");
    await wait(150);
    await dom("[...document.querySelectorAll('#list .settings-nav-card')].find(c=>c.textContent.includes('About & updates')).click()");
    await wait(200);
    result.aboutDeepLinks = await dom("(()=>{const b=[...document.querySelectorAll('.detail-actions button')].map(x=>x.textContent);return b.some(t=>t.includes('Check for updates'))&&b.some(t=>t.includes('Share an idea'));})()");
    result.aboutVersionShown = await dom("(document.querySelector('.detail-sub')?.textContent||'').includes('Verqury v')");
    result.aboutSiteLink = await dom("[...document.querySelectorAll('.settings-link')].some(a=>a.getAttribute('href')==='https://verqury.com')");

    // (17) Closing the window QUITS (ADR-0016). Wiring assertion only — actually
    // firing it would end the harness run mid-flight — so we assert the two halves
    // that used to make the window survive its own close: nothing listens on the
    // window's `close` to keep it alive, and `window-all-closed` is wired. The
    // end-to-end proof is the packaged close-to-exit probe run at release time.
    // INFORMATIONAL ONLY — deliberately not an assertion. The first cut of this check
    // asserted `windowClose === 0 && appWindowAllClosed === 1`, reasoning that we removed
    // our own close listener and registered exactly one window-all-closed handler. Both
    // constants were wrong: Electron attaches internal close wiring to BrowserWindow, and
    // its browser init registers its own window-all-closed listener (it quits only when it
    // is the SOLE listener — which is precisely why ours has to exist). Observed 1 and 2.
    // Pinning those numbers would assert Electron's internals, pass on a wrong constant,
    // and break on an Electron bump — so the real proof is the close-to-exit probe in
    // scripts/close-probe.mjs, run against the packaged binary at release (ADR-0016).
    const vw = BrowserWindow.getAllWindows()[0];
    result.closeListenerCounts = {
      windowClose: vw ? vw.listenerCount('close') : -1,
      appWindowAllClosed: app.listenerCount('window-all-closed'),
      windows: BrowserWindow.getAllWindows().length,
    };

    // (16) Build-time meter (ADR-0013): harvest a fixture transcript through the
    // preload bridge and assert the meter renders the harvested time, not a zero.
    // VERQURY_TRANSCRIPTS_ROOT is set by the harness runner to a throwaway tree.
    await dom("document.querySelector('.tab[data-mode=projects]').click()");
    await wait(200);
    if (process.env.VERQURY_TRANSCRIPTS_ROOT) {
      const meterSlug = 'harness-metrics';
      api.makeProject(root, { name: 'Harness Metrics', stage: 'build', status: 'active', repo: '/harness/repo' });
      await wait(300);
      const harvest = await dom(`window.verqury.harvestSessions(${JSON.stringify(meterSlug)})`);
      result.meterHarvested = harvest?.harvested === 2;
      result.meterMetrics = harvest?.metrics?.activeLabel === '20m' && harvest?.metrics?.outputTokens === 30;
      result.meterIdempotent =
        (await dom(`window.verqury.harvestSessions(${JSON.stringify(meterSlug)})`))?.metrics?.sessions === 2;
      await dom(`[...document.querySelectorAll('.project-card')].find(c=>c.textContent.includes('Harness Metrics')).click()`);
      await wait(400);
      result.meterRendered = await dom("(document.querySelector('.session-meter .meter-value')?.textContent||'').includes('20m')");
    }

    // (18) Build metrics ingest (ADR-0014): stand the OTLP receiver up, push a
    // real-shaped export at it, and prove the numbers reach the record AND the meter.
    // Uses the harness transcripts tree so the session→project join has something to
    // resolve against — the payload itself carries no cwd.
    if (process.env.VERQURY_TRANSCRIPTS_ROOT) {
      api.setTelemetryConfig(root, { enabled: true, port: 4417 });
      const bound = await syncTelemetry();
      result.telemetryListening = bound === 4417;
      const otlp = {
        resourceMetrics: [{ scopeMetrics: [{ metrics: [
          { name: 'claude_code.lines_of_code.count', sum: { dataPoints: [
            { asInt: '15', attributes: [{ key: 'session.id', value: { stringValue: 'harness-session-one' } }, { key: 'type', value: { stringValue: 'added' } }] },
            { asInt: '3', attributes: [{ key: 'session.id', value: { stringValue: 'harness-session-one' } }, { key: 'type', value: { stringValue: 'removed' } }] },
          ] } },
          { name: 'claude_code.cost.usage', sum: { dataPoints: [
            { asDouble: 0.42, attributes: [{ key: 'session.id', value: { stringValue: 'harness-session-one' } }] },
          ] } },
        ] }] }],
      };
      const post = await fetch('http://127.0.0.1:4417/v1/metrics', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(otlp),
      });
      result.telemetryAccepted = post.status === 200;
      await wait(200);
      const tm = api.getSessionMetrics(root, 'harness-metrics');
      result.telemetryIngested = tm.linesAdded === 15 && tm.linesRemoved === 3;
      // The LOC figure must never render without the date counting began.
      result.telemetryLabelled = tm.locLabel === '18 lines' && Boolean(tm.locSinceLabel);
      // A re-harvest must not wipe what telemetry wrote (the silent-regression case).
      await dom(`window.verqury.harvestSessions('harness-metrics')`);
      await wait(300);
      result.telemetrySurvivesHarvest = api.getSessionMetrics(root, 'harness-metrics').linesAdded === 15;
      await dom("[...document.querySelectorAll('.project-card')].find(c=>c.textContent.includes('Harness Metrics'))?.click()");
      await wait(400);
      result.telemetryMeterRendered = await dom("(document.querySelector('.session-meter')?.textContent||'').includes('18 lines')");
      api.setTelemetryConfig(root, { enabled: false });
      await syncTelemetry();
      result.telemetryStops = otelReceiver === null;
    }

    // (19) One app per data root. The lock is what stops a second launch becoming a
    // second resident app — the state in which Quit ends only the instance whose tray
    // icon you clicked, and two Telegram consumers race for the same tap.
    result.singleInstanceLock = app.hasSingleInstanceLock();
    // A sibling quitting must not take this app's liveness with it. Simulated from the
    // real running app against its own live beat, which is the case that matters.
    writeHeartbeat(root);
    const refused = clearHeartbeat(root, { pid: process.pid + 1 });
    result.heartbeatSurvivesSiblingQuit = refused === false && readHeartbeat(root)?.pid === process.pid;

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

// Marketing capture hook (dev-only, like VERQURY_VERIFY). When VERQURY_CAPTURE points at a
// directory, walk each major view against the (curated) data root and save a clean PNG per
// view, then quit. Never runs in a normal launch. Regenerates the site's "See it" shots.
async function runCapture(outDir) {
  const shot = async (name, settle = 450) => {
    await wait(settle);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
  };
  const clickTab = (mode) => dom(`document.querySelector('.tab[data-mode=${mode}]').click()`);
  try {
    win.setContentSize(1440, 900);
    await dom('window.__verquryReady');
    await wait(700);
    await clickTab('projects');
    await wait(300);
    await dom("(document.querySelector('.project-card')||{click(){}}).click()"); // open Aurora
    await shot('projects', 650);
    await clickTab('tasks');
    await wait(250);
    await dom("(document.querySelector('.task-card')||{click(){}}).click()"); // open a task's detail
    await shot('tasks');
    await clickTab('inbox');
    await wait(250);
    await dom("(document.querySelector('.artifact-card')||{click(){}}).click()"); // open an artifact
    await shot('inbox');
    await clickTab('guidance'); await shot('guidance');
    await clickTab('settings');
    await wait(250);
    await dom("[...document.querySelectorAll('#list .settings-nav-card')].find(c=>c.textContent.includes('About & updates')).click()");
    await shot('about');
    await clickTab('terminal'); await shot('terminal', 1000); // best-effort: opens a live shell
  } catch (err) {
    fs.writeFileSync(path.join(outDir, 'capture-error.txt'), String(err && err.message));
  } finally {
    app.quit();
  }
}

// Someone launched Verqury again — from the desktop icon, the menu, or autostart.
// Treat it as "show me the app", because that is what the second launch meant. Without
// this a second click would look like nothing happened at all.
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  if (!isPrimaryInstance) return; // quitting; never build a second app's worth of state
  setupIpc();
  createWindow(!startHidden); // autostart launches hidden into the tray
  setupWatcher();
  setupTray();
  setupHotkey();
  // Liveness for the PermissionRequest gate: without a fresh beat the hook stops
  // relaying and sends the prompt straight to the desk instead of stalling ~9 min.
  const beat = () => { try { writeHeartbeat(root); } catch { /* non-fatal */ } };
  beat();
  setInterval(beat, 30000); // 3 beats inside the hook's 90s staleness window
  setInterval(pollClipboard, 1000); // clipboard-watch poll (no-op unless enabled)
  syncTelemetry(); // start the OTLP listener if telemetry is on (ADR-0014); no-op when off
  reapExpiredApprovals(); // clear any records orphaned by a hook that died before its timer
  syncRelay(); // start the Telegram long-poll if the relay is configured (ADR-0011 Phase B)
  setInterval(() => {
    reapExpiredApprovals();
    reconcileApprovals();
  }, 30000); // periodic sweep: reap orphans, then expiry nudges + missed events

  const verifyDir = process.env.VERQURY_VERIFY;
  if (verifyDir) win.webContents.once('did-finish-load', () => setTimeout(() => runVerify(verifyDir), 800));

  const captureDir = process.env.VERQURY_CAPTURE;
  if (captureDir) win.webContents.once('did-finish-load', () => setTimeout(() => runCapture(captureDir), 900));

  // Close-to-exit probe (dev-only, like VERQURY_VERIFY/VERQURY_CAPTURE). ADR-0016's claim is
  // that closing the window ENDS the process — which the verify harness cannot assert without
  // ending its own run, and which listener counts cannot prove (see closeListenerCounts).
  // Given this env var, the app writes the marker file and closes its window; the external
  // probe (scripts/close-probe.mjs) then measures whether the process actually exits.
  const closeProbe = process.env.VERQURY_CLOSE_PROBE;
  if (closeProbe) {
    win.webContents.once('did-finish-load', () => setTimeout(() => {
      try { fs.writeFileSync(closeProbe, `${process.pid}\n`); } catch { /* probe reads the exit, not the file */ }
      win.close(); // the real gesture: exactly what the X button does
    }, 900));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Closing the window QUITS (reverses design principle #4; ADR-0016). Staying resident
  // relied on the tray being reachable, and setupTray() fails silently — which left
  // instances alive with no window and no icon, unreachable except by PID. One had been
  // up 15 h spinning the relay long-poll. `before-quit` clears our heartbeat, so the
  // gate falls back to the desk from the next prompt on: away-mode relay needs the app
  // running, and that is the accepted trade for a close button that closes.
  app.quit();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => {
  watcher?.close();
  otelReceiver?.stop(); // release the OTLP port so the next launch can bind it
  // Ours to clear, and only ours: if another instance on this root is still beating,
  // its liveness must survive our exit (the gate would otherwise go to the desk while
  // a perfectly good app is running).
  clearHeartbeat(root, { pid: process.pid }); // the gate falls back to the desk from the next prompt on
  for (const p of ptys.values()) { try { p.kill(); } catch { /* already gone */ } }
  ptys.clear();
});

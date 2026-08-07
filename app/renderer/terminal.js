// Embedded terminal (ADR-0009) — now multi-session (ADR-0010). Each tab is one
// keyed PTY in the main process paired with one xterm.js instance here. A tab strip
// switches between them; each session's container is created once and moved in/out
// of view on switch, so scrollback and the live process survive navigation.
import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';

const sessions = new Map(); // id -> { term, fit, wrap, label, ready, exited }
let activeId = null;
let host = null;     // the mount element currently showing the terminal
let shellSeq = 0;    // counter for plain "Terminal N" shell tabs

// One global pair of PTY listeners; dispatch each event to its session by id.
window.verqury.onPtyData(({ id, data }) => { const s = sessions.get(id); if (s) s.term.write(data); });
window.verqury.onPtyExit(({ id }) => {
  const s = sessions.get(id);
  if (s) { s.exited = true; s.term.write('\r\n\x1b[90m[process exited — relaunch or close this tab]\x1b[0m\r\n'); }
});

const THEME = { background: '#0e1220', foreground: '#e9edf8', cursor: '#7f95ff' };

// Per-tab accent colors so tabs are told apart at a glance. A color is claimed when
// a tab is created and held for that tab's whole life (closing a neighbour never
// re-colors it — the point is muscle memory); a closed tab's color returns to the pool.
const TAB_COLORS = ['#5b8cff', '#f2c14e', '#a97bff', '#4fc98a', '#e8ecf7', '#ef5f6b']; // blue, yellow, purple, green, white, red
function claimColor() {
  const used = new Set([...sessions.values()].map((s) => s.color));
  return TAB_COLORS.find((c) => !used.has(c)) || TAB_COLORS[sessions.size % TAB_COLORS.length];
}

// Bell / attention: when a session's CLI writes BEL (\x07) — the standard "I want
// your attention" signal, e.g. an agent finishing and awaiting input — beep, glow
// its tab (if it isn't the one you're looking at), and nudge the OS if we're hidden.
let bellMuted = false;
let audioCtx = null;
// Browser/Electron autoplay policy starts an AudioContext suspended until a user
// gesture. A bell can fire while you're passively watching an agent (no recent
// gesture) — so unlock the context on your FIRST interaction and keep it warm,
// rather than trying to resume() inside beep() (async: it'd schedule tones against
// a frozen clock and drop them). This is why printf beeped but a passive Claude
// Code bell didn't: typing had unlocked audio, watching hadn't.
function primeAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* audio unavailable */ }
}
window.addEventListener('pointerdown', primeAudio);
window.addEventListener('keydown', primeAudio);

function beep() {
  if (bellMuted) return;
  try {
    if (!audioCtx || audioCtx.state !== 'running') { primeAudio(); return; } // not unlocked yet — glow still fires
    const now = audioCtx.currentTime;
    const tone = (freq, at, dur) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle'; // more presence on small speakers than a pure sine
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.22, now + at + 0.012); // fade in — no click
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + at);
      osc.stop(now + at + dur + 0.02);
    };
    tone(784, 0, 0.14);     // G5
    tone(1047, 0.13, 0.18); // C6 — a rising two-note "ding-ding" that carries
  } catch { /* audio unavailable — the tab glow still fires */ }
}
function onBell(id) {
  const s = sessions.get(id);
  if (!s) return;
  beep();
  // Repaint ONLY the tab strip. A full render() calls replaceChildren, which detaches
  // and re-appends the ACTIVE session's container — and detaching a node drops focus
  // out of the xterm textarea inside it, so a bell in a background tab silently killed
  // the keyboard in the tab you were typing in until you clicked back. The bell must
  // never touch the active tab's DOM: it marks the ringing tab and nothing else.
  if (id !== activeId) { s.attention = true; repaintTabs(); }
  window.verqury.terminalNotify(s.label); // main only shows it if Verqury is hidden
}

function syncActive() {
  const s = sessions.get(activeId);
  if (!s) return;
  try { s.fit.fit(); window.verqury.ptyResize(activeId, s.term.cols, s.term.rows); } catch { /* not laid out yet */ }
}

// Dropping a file onto the terminal should type its PATH, the way a plain terminal
// does — not capture the file. Sources, in order: real files (Electron 41 removed
// File.path, so the path comes from webUtils.getPathForFile via preload), then a
// file:// uri-list, then plain text. Paths are shell-quoted so spaces survive.
const shellQuote = (p) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);
const fileUrlToPath = (u) => { try { return decodeURIComponent(new URL(u).pathname); } catch { return null; } };

function droppedText(dt) {
  if (!dt) return '';
  const files = [...(dt.files || [])]
    .map((f) => { try { return window.verqury.pathForFile(f); } catch { return null; } })
    .filter(Boolean);
  if (files.length) return files.map(shellQuote).join(' ');

  const uris = (dt.getData('text/uri-list') || '')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'));
  const paths = uris.filter((u) => u.startsWith('file://')).map(fileUrlToPath).filter(Boolean);
  if (paths.length) return paths.map(shellQuote).join(' ');
  if (uris.length) return uris.join(' '); // a dragged http(s) link — paste it verbatim

  return dt.getData('text/plain') || '';
}

// Create a session's xterm + container and start its PTY. Does not change the active tab.
function makeSession(id, label, { cwd } = {}) {
  if (sessions.has(id)) return sessions.get(id);
  const term = new Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.onData((d) => window.verqury.ptyInput(id, d));
  term.onBell(() => onBell(id));
  // Ctrl+Shift+C copy selection, Ctrl+Shift+V paste — (plain Ctrl+C is SIGINT).
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true;
    if (e.code === 'KeyC') { const sel = term.getSelection(); if (sel) window.verqury.copyToClipboard(sel); return false; }
    if (e.code === 'KeyV') { window.verqury.readClipboard().then((t) => t && window.verqury.ptyInput(id, t)); return false; }
    return true;
  });

  const wrap = document.createElement('div');
  wrap.className = 'term-host';
  term.open(wrap);
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    const text = droppedText(e.dataTransfer);
    if (text) window.verqury.ptyInput(id, text);
  });
  new ResizeObserver(() => { if (id === activeId) syncActive(); }).observe(wrap);

  const s = { term, fit, wrap, label, color: claimColor(), exited: false, ready: window.verqury.ptyStart(id, { cwd }) };
  sessions.set(id, s);
  return s;
}

// Restart a session's PTY after its process exited (reuses the same tab/xterm).
function restart(id, cwd) {
  const s = sessions.get(id);
  if (!s) return;
  s.exited = false;
  s.term.write('\r\n');
  s.ready = window.verqury.ptyStart(id, { cwd });
}

function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  window.verqury.ptyKill(id);
  try { s.term.dispose(); } catch { /* already disposed */ }
  sessions.delete(id);
  if (activeId === id) activeId = [...sessions.keys()].pop() ?? null;
  render();
}

function setActive(id) {
  activeId = id;
  const s = sessions.get(id);
  if (s) s.attention = false; // looking at it clears its attention flag
  render();
  requestAnimationFrame(() => { syncActive(); sessions.get(activeId)?.term.focus(); });
  setTimeout(syncActive, 150);
}

const mkBtn = (cls, label, title, fn) => {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', fn);
  return b;
};

// Paint the tab strip + toolbar + the active session's container into the host.
function render() {
  if (!host) return;
  if (!sessions.size) {
    const note = document.createElement('div');
    note.className = 'empty';
    note.textContent = 'No terminals open.';
    host.replaceChildren(tabStrip(), note);
    return;
  }
  const active = sessions.get(activeId);
  const toolbar = document.createElement('div');
  toolbar.className = 'term-toolbar';
  toolbar.append(
    mkBtn('btn small', 'Capture selection', 'File the selected text into the active project', () => {
      const sel = active.term.getSelection(); if (sel) window.verqury.captureText(sel);
    }),
    mkBtn('btn small', 'Copy', 'Ctrl+Shift+C', () => { const sel = active.term.getSelection(); if (sel) window.verqury.copyToClipboard(sel); }),
    mkBtn('btn small', 'Paste', 'Ctrl+Shift+V', async () => { const t = await window.verqury.readClipboard(); if (t) window.verqury.ptyInput(activeId, t); }),
    mkBtn('btn small', bellMuted ? '🔕 Muted' : '🔔 Bell', 'Beep + notify when a terminal rings the bell (e.g. an agent awaiting input)', () => { bellMuted = !bellMuted; render(); }),
  );
  host.replaceChildren(tabStrip(), toolbar, active.wrap); // moves the persistent container into view
}

// Swap just the tab strip in place, leaving the active session's container (and the
// focus inside it) untouched. Falls back to a full render if the strip isn't mounted.
function repaintTabs() {
  if (!host) return;
  const mounted = host.querySelector('.term-tabs');
  if (mounted) mounted.replaceWith(tabStrip());
  else render();
}

function tabStrip() {
  const strip = document.createElement('div');
  strip.className = 'term-tabs';
  for (const [id, s] of sessions) {
    const tab = document.createElement('div');
    tab.className = `term-tab${id === activeId ? ' active' : ''}${s.exited ? ' exited' : ''}${s.attention ? ' attention' : ''}`;
    tab.style.setProperty('--tab-color', s.color);
    tab.title = s.label;
    const name = document.createElement('span');
    name.className = 'term-tab-label';
    name.textContent = s.label;
    name.addEventListener('click', () => setActive(id));
    const x = mkBtn('term-tab-close', '×', 'Close this terminal', (e) => { e.stopPropagation(); closeSession(id); });
    tab.append(name, x);
    strip.append(tab);
  }
  strip.append(mkBtn('term-tab-new', '+', 'New shell tab', () => newShellTab()));
  return strip;
}

// ---- exports used by renderer.js ----

// Mount the terminal view into `hostEl`. Opens a default shell tab on first use.
export function mountTerminal(hostEl) {
  host = hostEl;
  if (!sessions.size) { newShellTab(); return; } // newShellTab renders via setActive
  render();
  requestAnimationFrame(syncActive);
}

export function newShellTab() {
  const id = `shell:${++shellSeq}`;
  makeSession(id, `Terminal ${shellSeq}`, {});
  setActive(id);
  return id;
}

// One tab per project (reuse): focus the project's tab, creating or restarting it,
// then run the command in it. `pin` = { id, label, cwd } from the main process.
export async function openProjectTerminal(pin, command) {
  const { id, label, cwd } = pin;
  const existing = sessions.get(id);
  if (!existing) makeSession(id, label, { cwd });
  else { existing.label = label; if (existing.exited) restart(id, cwd); }
  setActive(id);
  if (command) {
    const s = sessions.get(id);
    await s.ready; // ensure the PTY exists in main before writing
    window.verqury.ptyInput(id, command.endsWith('\n') ? command : `${command}\n`);
  }
  return id;
}

// Test-only: write BEL into a session's terminal, exactly as a CLI's bell output
// would arrive over pty:data — exercises the real onBell → attention/beep path.
export function ringBellForTest(id) {
  const s = sessions.get(id);
  if (s) s.term.write('\x07');
}

// Send a block of text to the active terminal as a bracketed paste (CLIs treat it
// as pasted input, not typed line-by-line). Creates a shell tab if none is open.
export async function sendToActiveTerminal(text) {
  if (!sessions.size) newShellTab();
  const s = sessions.get(activeId);
  await s.ready;
  window.verqury.ptyInput(activeId, `\x1b[200~${String(text ?? '')}\x1b[201~`);
}

// Embedded terminal widget: xterm.js in the renderer, wired to the main-process
// PTY over the preload bridge. Runs your real shell and CLIs inside Verqury.
import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';

let term = null;
let fit = null;
let started = false;

function ensureTerm() {
  if (term) return;
  term = new Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: { background: '#0e1220', foreground: '#e9edf8', cursor: '#7f95ff' },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.onData((d) => window.verqury.ptyInput(d));
  window.verqury.onPtyData((d) => term.write(d));
  window.verqury.onPtyExit(() => term.write('\r\n\x1b[90m[process exited — reopen the tab to restart]\x1b[0m\r\n'));
  // Ctrl+Shift+C copy selection, Ctrl+Shift+V paste — (plain Ctrl+C is SIGINT).
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true;
    if (e.code === 'KeyC') { const s = term.getSelection(); if (s) window.verqury.copyToClipboard(s); return false; }
    if (e.code === 'KeyV') { window.verqury.readClipboard().then((t) => t && window.verqury.ptyInput(t)); return false; }
    return true;
  });
}

function sync() {
  try {
    fit.fit();
    window.verqury.ptyResize(term.cols, term.rows);
  } catch { /* not laid out yet */ }
}

// Mount (or re-mount) the terminal into `host` and start the shell once.
export function mountTerminal(host) {
  ensureTerm();

  const mkBtn = (label, title, fn) => {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  const toolbar = document.createElement('div');
  toolbar.className = 'term-toolbar';
  toolbar.append(
    mkBtn('Capture selection', 'File the selected text into the active project', () => {
      const s = term.getSelection();
      if (s) window.verqury.captureText(s);
    }),
    mkBtn('Copy', 'Ctrl+Shift+C', () => { const s = term.getSelection(); if (s) window.verqury.copyToClipboard(s); }),
    mkBtn('Paste', 'Ctrl+Shift+V', async () => { const t = await window.verqury.readClipboard(); if (t) window.verqury.ptyInput(t); }),
  );

  const wrap = document.createElement('div');
  wrap.className = 'term-host';
  host.replaceChildren(toolbar, wrap);
  term.open(wrap);

  // Drop highlighted text onto the terminal → type it into the shell.
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = e.dataTransfer.getData('text/plain');
    if (t) window.verqury.ptyInput(t);
  });

  const ro = new ResizeObserver(() => sync());
  ro.observe(wrap);

  if (!started) {
    started = true;
    window.verqury.ptyStart();
  }
  requestAnimationFrame(() => { sync(); term.focus(); });
  setTimeout(sync, 150);
}

// Programmatically send text to the shell (for "Send to terminal" later).
export function sendToTerminal(text) {
  ensureTerm();
  if (!started) { started = true; window.verqury.ptyStart(); }
  window.verqury.ptyInput(text.endsWith('\n') ? text : `${text}\n`);
}

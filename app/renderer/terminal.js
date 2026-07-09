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
  const wrap = document.createElement('div');
  wrap.className = 'term-host';
  host.replaceChildren(wrap);
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
  setTimeout(() => { sync(); term.focus(); }, 40);
}

// Programmatically send text to the shell (for "Send to terminal" later).
export function sendToTerminal(text) {
  ensureTerm();
  if (!started) { started = true; window.verqury.ptyStart(); }
  window.verqury.ptyInput(text.endsWith('\n') ? text : `${text}\n`);
}

// Spike: prove node-pty loads in Electron and runs a real shell.
import { app } from 'electron';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

app.whenReady().then(() => {
  let pty;
  try {
    pty = require('node-pty');
  } catch (err) {
    console.error('[spike] node-pty failed to load in Electron:', err.message);
    app.exit(1);
    return;
  }
  const term = pty.spawn('bash', ['-lc', 'echo PTY_OK; uname -sm; exit 0'], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: process.env,
  });
  term.onData((d) => process.stdout.write(d));
  term.onExit(() => {
    console.log('[spike] pty exited cleanly — node-pty works in Electron ✓');
    app.quit();
  });
});

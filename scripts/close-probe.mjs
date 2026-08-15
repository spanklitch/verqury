#!/usr/bin/env node
// Close-to-exit probe — the release-time proof of ADR-0016's claim: closing the window
// ENDS the process, rather than leaving a tray-less ghost resident.
//
// Why this is a separate script and not a VERQURY_VERIFY check:
//   * The harness cannot fire a real close — that would end its own run mid-flight.
//   * Listener counts prove nothing. The first attempt asserted "no close listener and
//     exactly one window-all-closed handler"; Electron attaches internal close wiring and
//     registers its own window-all-closed listener, so the true numbers are 1 and 2. Pinning
//     those asserts Electron's internals, not our behaviour, and breaks on an Electron bump.
// So we measure the only thing that actually matters: does the PROCESS exit?
//
// Usage:
//   node scripts/close-probe.mjs <target> [args...] [--timeout=ms]
//   packaged:  node scripts/close-probe.mjs app/dist/Verqury-0.7.0.AppImage
//   dev:       node scripts/close-probe.mjs ./node_modules/.bin/electron app
// (bare `electron` with no app dir loads Electron's default page, never our main.js —
// it will sit there until the timeout, which is not a failure of the claim.)
// Runs against a throwaway data root (its own single-instance lock, per ADR-0015, so it
// never disturbs an installed app). Exit 0 = the claim holds.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const target = process.argv[2];
const rest = process.argv.slice(3);
const timeoutFlag = rest.find((a) => a.startsWith('--timeout='));
const timeoutMs = timeoutFlag ? Number(timeoutFlag.split('=')[1]) : 25000;
const spawnArgs = rest.filter((a) => !a.startsWith('--timeout='));
if (!target || !fs.existsSync(target)) {
  console.error(`close-probe: no such target: ${target ?? '(none)'}`);
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-close-probe-'));
const dataRoot = path.join(tmp, 'root');
const marker = path.join(tmp, 'closed.marker');
fs.mkdirSync(dataRoot, { recursive: true });

console.log(`close-probe: target      ${target}`);
console.log(`close-probe: data root   ${dataRoot}  (throwaway; own instance lock)`);

const started = Date.now();
const child = spawn(target, spawnArgs, {
  env: {
    ...process.env,
    VERQURY_DATA_ROOT: dataRoot,
    VERQURY_CLOSE_PROBE: marker,
    // Never let the probe reach the real credential store (engineering-notes §17).
    VERQURY_ENV_FILE: path.join(tmp, 'probe.env'),
    DISPLAY: process.env.DISPLAY || ':0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  // Own process group, so a timeout kill takes the whole tree. Killing just the direct
  // child leaves Electron's real main process resident — which, during the ADR-0016
  // mutation test, leaked a ghost that then held the global hotkey for hours and failed
  // an unrelated harness check (engineering-notes §18).
  detached: true,
});

let out = '';
child.stdout.on('data', (c) => (out += c));
child.stderr.on('data', (c) => (out += c));

const killer = setTimeout(() => {
  const reached = fs.existsSync(marker);
  console.error(reached
    ? `close-probe: FAIL — window closed but the process was STILL RUNNING ${timeoutMs}ms later. This is exactly the ghost ADR-0016 exists to prevent.`
    : `close-probe: INCONCLUSIVE — never reached the close within ${timeoutMs}ms (marker absent). Wrong target, or the app never finished loading.`);
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  // Hard-exit: the child's grandchildren (Electron zygotes) can hold our stdio pipes open
  // and keep this process alive well past its own deadline.
  process.exit(1);
}, timeoutMs);

child.on('exit', (code, signal) => {
  clearTimeout(killer);
  const ms = Date.now() - started;
  const closedItself = fs.existsSync(marker);
  if (process.exitCode === 1) return; // the timeout already ruled

  if (!closedItself) {
    console.error(`close-probe: FAIL — exited after ${ms}ms but never reached the close (marker absent). The app died for some other reason.`);
    console.error(out.split('\n').slice(-15).join('\n'));
    process.exitCode = 1;
    return;
  }
  if (signal) {
    console.error(`close-probe: FAIL — killed by ${signal} rather than exiting on its own.`);
    process.exitCode = 1;
    return;
  }
  console.log(`close-probe: window closed, process exited on its own after ${ms}ms (code ${code}).`);
  console.log('close-probe: PASS — closing the window ends the process (ADR-0016).');
  process.exitCode = 0;
});

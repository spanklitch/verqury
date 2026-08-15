import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpRoot } from './helpers.js';
import { heartbeatPath, approvalsDir } from '../src/paths.js';
import { markUndeliverable, getApproval } from '../src/approvals.js';
import {
  writeHeartbeat, readHeartbeat, clearHeartbeat, appRunning, HEARTBEAT_STALE_MS,
} from '../src/runtime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const permHook = path.join(here, '..', '..', 'hooks', 'verqury-permission.cjs');

test('a fresh heartbeat from a live pid means the app is running', () => {
  const root = tmpRoot();
  assert.equal(appRunning(root), false); // nothing written yet
  const hb = writeHeartbeat(root);
  assert.equal(hb.pid, process.pid);
  assert.equal(readHeartbeat(root).pid, process.pid);
  assert.equal(appRunning(root), true);
});

test('a stale heartbeat means the app is gone, even if the pid still lives', () => {
  const root = tmpRoot();
  writeHeartbeat(root, { now: new Date(Date.now() - HEARTBEAT_STALE_MS - 1000) });
  assert.equal(appRunning(root), false);
});

test('a dead pid is caught immediately, without waiting out the staleness window', () => {
  const root = tmpRoot();
  // Fresh timestamp, but a pid that cannot be running: kill -9 leaves exactly this.
  writeHeartbeat(root, { pid: 2147483646 });
  assert.equal(appRunning(root), false);
});

test('clearHeartbeat makes the app read as stopped, and is safe to repeat', () => {
  const root = tmpRoot();
  writeHeartbeat(root);
  assert.equal(clearHeartbeat(root), true);
  assert.equal(appRunning(root), false);
  assert.equal(clearHeartbeat(root), false); // already gone
  assert.equal(readHeartbeat(root), null);
});

test('a quitting instance never clears a live sibling\'s heartbeat', () => {
  const root = tmpRoot();
  writeHeartbeat(root, { pid: process.pid }); // the instance that is staying up
  // A second instance, pointed at the same root, quits and cleans up after itself.
  assert.equal(clearHeartbeat(root, { pid: process.pid + 1 }), false);
  assert.equal(appRunning(root), true); // the survivor is still declared alive
  assert.equal(readHeartbeat(root).pid, process.pid);
});

test('an instance still clears its own heartbeat', () => {
  const root = tmpRoot();
  writeHeartbeat(root, { pid: process.pid });
  assert.equal(clearHeartbeat(root, { pid: process.pid }), true);
  assert.equal(appRunning(root), false);
});

test('a heartbeat from a DEAD pid is cleared by anyone — it owns nothing', () => {
  const root = tmpRoot();
  writeHeartbeat(root, { pid: 2 ** 30 }); // a pid that cannot be running
  assert.equal(clearHeartbeat(root, { pid: process.pid }), true);
  assert.equal(readHeartbeat(root), null);
});

test('a pid-less or unreadable heartbeat never becomes unclearable', () => {
  // Written by a version that predates ownership, or half-written. Refusing to clear
  // these would strand the file forever and permanently disable the relay.
  const root = tmpRoot();
  const file = heartbeatPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ updated: new Date().toISOString() }));
  assert.equal(clearHeartbeat(root, { pid: process.pid }), true);

  fs.writeFileSync(file, '{ not json');
  assert.equal(clearHeartbeat(root, { pid: process.pid }), true);
});

test('clearHeartbeat with no pid is unconditional, as the CLI and repair paths expect', () => {
  const root = tmpRoot();
  writeHeartbeat(root, { pid: process.pid });
  assert.equal(clearHeartbeat(root), true);
  assert.equal(readHeartbeat(root), null);
});

test('a corrupt or half-written heartbeat reads as stopped, never throws', () => {
  const root = tmpRoot();
  const file = heartbeatPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  assert.equal(readHeartbeat(root), null);
  assert.equal(appRunning(root), false);
});

test('the heartbeat lives outside the watched markdown tree', () => {
  const root = tmpRoot();
  const rel = path.relative(root, heartbeatPath(root));
  assert.ok(!rel.startsWith('projects'));
  assert.ok(!rel.startsWith('guidance'));
  assert.ok(!rel.startsWith('approvals'));
  assert.ok(!heartbeatPath(root).endsWith('.md')); // watcher only schedules on .md
});

/* ---- cross-reader: the dependency-free hook must agree with core ---- */

// The hook re-implements appRunning (it cannot import core). These prove the two
// readers stay in lock-step — the same contract approvals.test.js keeps for records.
function runPermHook(root, extraEnv = {}) {
  const out = execFileSync(process.execPath, [permHook], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: root }),
    env: {
      ...process.env,
      VERQURY_DATA_ROOT: root,
      VERQURY_PERMISSION_DRYRUN: '1',
      ...extraEnv,
    },
    encoding: 'utf8',
  }).trim();
  return out ? JSON.parse(out) : null;
}

// Away + fully configured, so only app-liveness decides the outcome.
function armRelay(root) {
  const cfgFile = path.join(root, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.notify = { enabled: true, presence: 'away', telegram: { chatId: '42' } };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  const env = path.join(root, 'fake.env');
  fs.writeFileSync(env, 'VERQURY_TELEGRAM_BOT_TOKEN=x\n');
  return env;
}

test('hook declines to relay when the app is not running (the ~9-min stall)', () => {
  const root = tmpRoot();
  const envFile = armRelay(root);
  // No heartbeat at all → nothing would ever consume the record.
  const stopped = runPermHook(root, { VERQURY_ENV_FILE: envFile });
  assert.equal(stopped.engage, false);
  assert.equal(stopped.reason, 'app-not-running');

  // Same config, app alive → it relays exactly as before.
  writeHeartbeat(root);
  const running = runPermHook(root, { VERQURY_ENV_FILE: envFile });
  assert.equal(running.engage, true);

  // And a stale beat is treated as stopped by the hook, matching core.
  writeHeartbeat(root, { now: new Date(Date.now() - HEARTBEAT_STALE_MS - 1000) });
  assert.equal(appRunning(root), false);
  assert.equal(runPermHook(root, { VERQURY_ENV_FILE: envFile }).reason, 'app-not-running');
});

test('liveness is checked last, so a clearer reason still wins', () => {
  const root = tmpRoot();
  const envFile = armRelay(root);
  clearHeartbeat(root);
  const cfgFile = path.join(root, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.notify.presence = 'here';
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  // Being at the desk explains it better than the app being closed.
  assert.equal(runPermHook(root, { VERQURY_ENV_FILE: envFile }).reason, 'here');
});

// The failure this whole path exists for: the app IS running, the gate DOES engage, and
// the send still fails. Before ADR-0017 the hook had no way to learn that, so it rode the
// full window every time. Proven by state, not just by the clock: had it waited out the
// expiry it would have rewritten the record to `expired`.
test('the hook stops waiting the moment a card proves undeliverable', async () => {
  const root = tmpRoot();
  const envFile = armRelay(root);
  writeHeartbeat(root); // app alive, so the gate engages and the hook commits to waiting

  const started = Date.now();
  const child = spawn(process.execPath, [permHook], {
    env: {
      ...process.env,
      VERQURY_DATA_ROOT: root,
      VERQURY_ENV_FILE: envFile,
      VERQURY_PERMISSION_EXPIRE_MS: '60000', // a window far longer than the bail should take
      VERQURY_PERMISSION_POLL_MS: '50',
    },
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: root }));

  // Wait for the record the hook just filed, then fail its send the way the app would.
  const dir = approvalsDir(root);
  let id = null;
  while (!id) {
    const f = fs.existsSync(dir) ? fs.readdirSync(dir).find((x) => x.endsWith('.md')) : null;
    if (f) id = f.replace(/\.md$/, '');
    else await new Promise((r) => setTimeout(r, 20));
  }
  markUndeliverable(root, id, 'Unauthorized');

  assert.equal(await new Promise((r) => child.on('close', r)), 0); // never throws at the agent
  assert.equal(out.trim(), ''); // no decision → the native desktop prompt takes it
  assert.ok(Date.now() - started < 20000, 'bailed early, nowhere near the 60 s window');
  assert.equal(getApproval(root, id).status, 'undeliverable'); // it did NOT ride to expiry
});

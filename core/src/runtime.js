// App liveness, as a file (ADR-0001 — even this is on disk, not an IPC channel).
//
// The relay's two legs have different needs: OUTBOUND (Claude Code → phone) is the
// global hooks and runs with no app at all, but INBOUND (tap/reply → build) needs
// the app, because it is the single Telegram getUpdates consumer. So a permission
// gate that engages while the app is closed files a record nothing will ever answer
// and blocks the build for the full ~9-minute expiry. The heartbeat is how the
// dependency-free hook tells those two situations apart.
import fs from 'node:fs';
import path from 'node:path';
import { heartbeatPath } from './paths.js';

// Three missed beats. Long enough that a busy or briefly-stalled app is not declared
// dead, short enough that the desk fallback feels immediate rather than a hang.
export const HEARTBEAT_STALE_MS = 90 * 1000;

export function writeHeartbeat(root, { pid = process.pid, now = new Date() } = {}) {
  const file = heartbeatPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = { pid, updated: now.toISOString() };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file); // atomic: the hook never reads a half-written beat
  return data;
}

export function clearHeartbeat(root) {
  try {
    fs.unlinkSync(heartbeatPath(root));
    return true;
  } catch {
    return false; // already gone, or never written
  }
}

export function readHeartbeat(root) {
  try {
    const data = JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

// Is that pid still there? Signal 0 checks existence without delivering anything.
// EPERM means it exists but belongs to another user — still alive for our purposes.
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Both tests, because each covers the other's blind spot: a stale timestamp catches
// a wedged app that never cleaned up, and the pid check catches a hard kill -9
// instantly instead of waiting out the staleness window.
export function appRunning(root, { staleMs = HEARTBEAT_STALE_MS, now = Date.now() } = {}) {
  const hb = readHeartbeat(root);
  if (!hb) return false;
  const updated = Date.parse(hb.updated ?? '');
  if (Number.isNaN(updated) || now - updated > staleMs) return false;
  return pidAlive(hb.pid);
}

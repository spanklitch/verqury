// Verqury remote decision relay — Claude Code `PermissionRequest` hook (Phase B).
// Spec: verqury-build-plan.md §8; reasoning: docs/adr/0011-remote-decision-relay.md.
//
// This is the INTERACTIVE gate: when a running Claude Code build asks permission
// to do something (run a command, write a file, …) and Verqury is set to AWAY,
// this hook relays the decision to the phone and blocks until the owner taps
// [Approve] or [Deny] — then returns that verdict to Claude Code. Verqury stays a
// relay: it carries the question and the answer; the human decides. If nobody
// answers in time, it falls back to the normal desktop prompt (never auto-answers).
//
// CONTRACT (verified against current hook docs, not memory — code.claude.com/docs):
//   * `PermissionRequest` output is hookSpecificOutput.decision.behavior, and the
//     ONLY accepted values are "allow" / "deny". There is no "ask".
//   * The desk fallback ("ask") is achieved by emitting NO decision (exit 0, no
//     JSON) → Claude Code shows the normal permission dialog and waits.
//   * Default timeout is 600 s and it FAILS OPEN (timeout ⇒ proceed/allow). So we
//     MUST decide before then: we self-expire at 9 min (60 s margin) and emit
//     nothing, so a missed prompt parks at the desk instead of auto-approving.
//   * Never throw into Claude Code; always exit 0.
//
// Dependency-free (node builtins only); does NOT import verqury-core. It writes the
// pending approval record straight to <root>/approvals/ and polls that file — the
// Verqury app (single Telegram owner) sends the card and writes the tapped answer.
//
// Because that consumer is the APP, the gate also requires the app to be running
// (liveness heartbeat, see appRunning below). It used to engage regardless and
// "expire to the desk: safe" — safe, but it cost NINE MINUTES per prompt with
// nothing on the phone to answer, while the app-independent notify hook kept
// buzzing about other events so the relay still looked alive. Fail fast instead.
//
// Test/override env vars:
//   VERQURY_DATA_ROOT          data root (default ~/FlawedWorks/verqury)
//   VERQURY_ENV_FILE           secrets file (default ~/.claude/.env)
//   VERQURY_PERMISSION_DRYRUN  gate + write the record, then report — no poll loop
//   VERQURY_PERMISSION_EXPIRE_MS / _POLL_MS   shrink the timers for tests
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const HOME = os.homedir();
const EXPIRE_MS = Number(process.env.VERQURY_PERMISSION_EXPIRE_MS) || 9 * 60 * 1000; // 9 min < 600 s ceiling
const POLL_MS = Number(process.env.VERQURY_PERMISSION_POLL_MS) || 2000;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function dataRoot() {
  return process.env.VERQURY_DATA_ROOT || path.join(HOME, 'FlawedWorks', 'verqury');
}

function envFile() {
  return process.env.VERQURY_ENV_FILE || path.join(HOME, '.claude', '.env');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataRoot(), 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

// True iff the token key is present in ~/.claude/.env. The VALUE is never read into
// a variable, logged, or returned — the hook only needs to know the app CAN send.
function tokenPresent() {
  try {
    const txt = fs.readFileSync(envFile(), 'utf8');
    return /^\s*VERQURY_TELEGRAM_BOT_TOKEN\s*=\s*\S/m.test(txt);
  } catch {
    return false;
  }
}

// Is the Verqury app actually running to consume this? Mirrors core/src/runtime.js
// (kept in lock-step by a cross-reader test) — the hook stays dependency-free, so it
// re-reads the heartbeat file rather than importing core.
const HEARTBEAT_STALE_MS = Number(process.env.VERQURY_HEARTBEAT_STALE_MS) || 90 * 1000;

function appRunning(root) {
  let hb;
  try {
    hb = JSON.parse(fs.readFileSync(path.join(root, 'runtime', 'app.json'), 'utf8'));
  } catch {
    return false;
  }
  const updated = Date.parse((hb && hb.updated) || '');
  if (Number.isNaN(updated) || Date.now() - updated > HEARTBEAT_STALE_MS) return false;
  const pid = hb.pid;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // existence check; delivers no signal
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // alive, just not ours
  }
}

// Should we relay this permission request, or let the desktop handle it? Only when
// the owner is Away, notifications are on, a chat_id is set, a token exists for the
// app to send with, AND the app is running to answer. Any gap → desk prompt
// (return { engage: false, reason }).
function gate(cfg, root) {
  const n = cfg.notify || {};
  if (n.enabled !== true) return { engage: false, reason: 'disabled' };
  if (n.presence !== 'away') return { engage: false, reason: 'here' };
  if (!(n.telegram && n.telegram.chatId)) return { engage: false, reason: 'no-chat-id' };
  if (!tokenPresent()) return { engage: false, reason: 'no-token' };
  // Without the app there is no Telegram consumer: the card is never sent and the
  // tap is never read, so engaging would stall the build for the full expiry with
  // nothing on the phone to act on. Fall back to the desk NOW instead.
  if (!appRunning(root)) return { engage: false, reason: 'app-not-running' };
  return { engage: true, reason: 'away' };
}

// A compact one-line summary of what Claude wants to do, per tool. Best-effort and
// defensive — a permission request must never crash the gate on an odd payload.
function summarize(toolName, toolInput) {
  const t = toolName || 'Tool';
  const i = toolInput || {};
  try {
    if (i.command) return `${t}: ${String(i.command).replace(/\s+/g, ' ').slice(0, 120)}`;
    if (i.file_path || i.path) return `${t}: ${path.basename(String(i.file_path || i.path))}`;
    if (i.url) return `${t}: ${String(i.url).slice(0, 120)}`;
    const keys = Object.keys(i);
    return keys.length ? `${t} (${keys.slice(0, 3).join(', ')})` : `${t} needs approval`;
  } catch {
    return `${t} needs approval`;
  }
}

function genId() {
  // Time-prefixed so files sort roughly by creation; opaque to everything else.
  const time = Date.now().toString(36).toUpperCase().padStart(9, '0');
  const rand = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${time}${rand}`;
}

// Flat YAML frontmatter with JSON-quoted scalars — valid YAML that gray-matter
// (the app/core reader) parses back to the same fields. A cross-reader test keeps
// this in lock-step with core/src/approvals.js.
const FIELDS = ['id', 'status', 'decision', 'tool', 'summary', 'project', 'sessionId', 'cwd', 'created', 'answered'];
function serialize(data, body) {
  const fm = FIELDS.map((k) => {
    const v = data[k];
    return `${k}: ${v === null || v === undefined ? 'null' : JSON.stringify(String(v))}`;
  }).join('\n');
  return `---\n${fm}\n---\n${body ? String(body) : ''}`;
}

function writeRecord(root, data, body) {
  const dir = path.join(root, 'approvals');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${data.id}.md`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serialize(data, body));
  fs.renameSync(tmp, file); // atomic: the app never reads a half-written record
  return file;
}

// Poll our record for a verdict the app wrote. Tolerant of quoted or unquoted YAML
// (the app rewrites via gray-matter). Returns 'allow' | 'deny' | null.
function readVerdict(file) {
  let txt;
  try {
    txt = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (!/^status:\s*"?answered"?/m.test(txt)) return null;
  const m = txt.match(/^decision:\s*"?(allow|deny)"?/m);
  return m ? m[1] : null;
}

function sleepSync(ms) {
  // Real (non-busy) synchronous sleep — this hook is intentionally a blocking gate.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function emitDecision(behavior) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior } } }) + '\n',
  );
}

function main() {
  const raw = readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    payload = {};
  }

  const root = dataRoot();
  const cfg = readConfig();
  const g = gate(cfg, root);

  if (!g.engage) {
    // Not relaying → emit nothing → the normal desktop permission dialog handles it.
    if (process.env.VERQURY_PERMISSION_DRYRUN) {
      process.stdout.write(JSON.stringify({ engage: false, reason: g.reason }) + '\n');
    }
    return;
  }

  const cwd = payload.cwd ? String(payload.cwd) : null;
  const data = {
    id: genId(),
    status: 'pending',
    decision: null,
    tool: payload.tool_name || null,
    summary: summarize(payload.tool_name, payload.tool_input),
    project: cwd ? path.basename(cwd) : null, // best-effort; core echoes only if it resolves
    sessionId: payload.session_id ? String(payload.session_id).slice(0, 12) : null,
    cwd,
    created: new Date().toISOString(),
    answered: null,
  };
  const body = payload.tool_input ? JSON.stringify(payload.tool_input, null, 2) + '\n' : '';
  const file = writeRecord(root, data, body);

  if (process.env.VERQURY_PERMISSION_DRYRUN) {
    // Report what we filed without blocking for a human — for headless verification.
    process.stdout.write(JSON.stringify({ engage: true, id: data.id, summary: data.summary, file }) + '\n');
    return;
  }

  // Block (self-timed) until the owner taps or the window closes.
  const start = Date.now();
  while (Date.now() - start < EXPIRE_MS) {
    sleepSync(POLL_MS);
    const verdict = readVerdict(file);
    if (verdict) {
      emitDecision(verdict); // allow | deny → returned to Claude Code
      return;
    }
  }

  // Expired: record it (so the inbox shows it parked) and emit NOTHING → desk prompt.
  try {
    const { data: cur } = { data };
    cur.status = 'expired';
    cur.answered = new Date().toISOString();
    fs.writeFileSync(file, serialize(cur, body));
  } catch {
    /* recording the expiry is best-effort; the desk fallback below is what matters */
  }
}

try {
  main();
} catch {
  /* never break the agent — emitting nothing falls back to the desktop prompt */
}

// Verqury remote decision relay — Claude Code `Notification` hook (Phase A).
// Spec: verqury-build-plan.md §8; reasoning: docs/adr/0011-remote-decision-relay.md.
//
// Fires whenever Claude Code raises a notification (needs permission / is waiting
// for input / finished). When Verqury is set to AWAY and notifications are enabled,
// it pings Telegram so the owner can SEE the pending decision from the phone
// (Phase A shows; Phase B will let you approve). Otherwise it does nothing.
//
// CONTRACT — this hook must never harm the agent:
//   * NON-BLOCKING: side-effects only, it never returns a decision.
//   * It ALWAYS exits 0 and never throws into Claude Code.
//   * The bot token is read but NEVER logged, printed, or echoed.
//
// It is deliberately DEPENDENCY-FREE (node builtins only) and does NOT import
// verqury-core: it reads config.json (presence, chat_id) and ~/.claude/.env (token)
// straight off disk, so it stays fast and works even when the Verqury app is closed.
// CommonJS (.cjs) so it runs cleanly from ~/.claude/hooks with no package.json.
//
// Install: copied to ~/.claude/hooks/verqury-notify.cjs and registered as a
// Notification hook in ~/.claude/settings.json. See hooks/README.md.
//
// Test/override env vars:
//   VERQURY_DATA_ROOT     — data root (default ~/FlawedWorks/verqury)
//   VERQURY_ENV_FILE      — secrets file (default ~/.claude/.env)
//   VERQURY_NOTIFY_DRYRUN — if set, print the decision instead of sending
//                           (token is reported only as a boolean, never its value)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

const HOME = os.homedir();

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

// Minimal .env reader — KEY=value, tolerant of quotes and surrounding space.
function envValue(key) {
  try {
    const txt = fs.readFileSync(envFile(), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    /* no .env yet */
  }
  return '';
}

// Turn a hook payload + config into a send decision. Pure — the core of the
// dry-run proof. Never includes the token in its output.
function buildNotification(payload, cfg, token) {
  const n = cfg.notify || {};
  if (n.enabled !== true) return { send: false, reason: 'disabled' };
  if (n.presence !== 'away') return { send: false, reason: 'here' };
  const chatId = (n.telegram && n.telegram.chatId) || '';
  if (!token) return { send: false, reason: 'no-token' };
  if (!chatId) return { send: false, reason: 'no-chat-id' };

  const message = String(payload.message || '');
  // Best-effort classify: the Notification hook reliably means "Claude wants you";
  // completion is fuzzier (see ADR-0011), so lean on the message text.
  const done = /complet|finished|\bdone\b/i.test(message);
  const header = done ? '✅ Claude Code — done' : '🔔 Claude Code needs you';
  const cwd = payload.cwd ? path.basename(String(payload.cwd)) : '';
  const sid = payload.session_id ? String(payload.session_id).slice(0, 8) : '';
  const text = [
    header,
    message || (done ? 'Task complete.' : 'Waiting for your input.'),
    [cwd && `📁 ${cwd}`, sid && `#${sid}`].filter(Boolean).join('  '),
  ]
    .filter(Boolean)
    .join('\n');

  return { send: true, reason: done ? 'done' : 'needs-you', chatId, text };
}

function sendTelegram(token, chatId, text) {
  const body = JSON.stringify({ chat_id: chatId, text });
  const req = https.request(
    {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    },
    (res) => {
      res.on('data', () => {});
      res.on('end', () => {});
    },
  );
  req.on('error', () => {}); // never surface a network error into the agent
  req.on('timeout', () => req.destroy());
  req.write(body);
  req.end();
}

// Optional diagnostic — OFF by default, opt in with VERQURY_NOTIFY_DEBUG=1 on the
// hook command in settings.json. Appends every invocation to ~/.claude/verqury-notify.log
// so you can see WHAT Claude Code sends and WHEN it fires (notification type, focus-gated
// timing, etc.). Records the raw payload, gate state, and decision — never the token.
function debugLog(raw, cfg, decision) {
  if (!process.env.VERQURY_NOTIFY_DEBUG) return;
  try {
    const n = (cfg && cfg.notify) || {};
    const line = JSON.stringify({
      t: new Date().toISOString(),
      presence: n.presence,
      enabled: n.enabled,
      decision: decision.reason,
      sent: Boolean(decision.send),
      payload: String(raw || '').slice(0, 600),
    }) + '\n';
    fs.appendFileSync(path.join(HOME, '.claude', 'verqury-notify.log'), line);
  } catch {
    /* diagnostics must never break the hook */
  }
}

function main() {
  const raw = readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    payload = {};
  }
  const token = envValue('VERQURY_TELEGRAM_BOT_TOKEN');
  const cfg = readConfig();
  const decision = buildNotification(payload, cfg, token);
  debugLog(raw, cfg, decision);

  if (process.env.VERQURY_NOTIFY_DRYRUN) {
    // Report the decision for headless verification. Token is a boolean only.
    process.stdout.write(
      JSON.stringify({ send: decision.send, reason: decision.reason, tokenPresent: Boolean(token), text: decision.text || null }) + '\n',
    );
    return;
  }
  if (decision.send) sendTelegram(token, decision.chatId, decision.text);
}

try {
  main();
} catch {
  /* never break the agent */
}

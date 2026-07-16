// Verqury remote decision relay — verqury-ask runner (Phase C).
// Spec: verqury-build-plan.md §8; reasoning: docs/adr/0011-remote-decision-relay.md.
//
// This is the agent's OWN clarifying-question path (distinct from the deterministic
// PermissionRequest hook). The model runs this script when it needs a decision from
// the owner: it files a `question` record in the Decision Inbox, BLOCKS while polling
// that record, and prints the owner's answer to stdout — which becomes the script's
// Bash result the model reads. Verqury stays a relay: it carries the question and the
// answer; the human decides. Nothing here ever answers on the human's behalf.
//
// The Verqury app (single Telegram owner) is what surfaces the question — a Telegram
// card (tap an option or reply with text) and, for long/needs-context questions, an
// email carrying the full context (#code correlates the two). The desktop Approvals
// tab can also answer it. This script only writes/polls files — exactly like the
// Phase-B hook — so it is dependency-free (node builtins only) and does NOT import
// verqury-core. A cross-reader test keeps its serializer in lock-step with core.
//
// CONTRACT — never harm the caller:
//   * Always exits 0; never throws into the agent.
//   * On no answer within the window it prints a clear "ask at the desk" fallback and
//     exits 0 — the model then decides its next step (it never proceeds AS the human).
//
// Usage (from SKILL.md):
//   node ask.cjs --summary "<one line>" [--options "a|b|c"] \
//        [--body "<context>" | --body-file <path>] [--needs-context] \
//        [--timeout-ms <n>] [--poll-ms <n>]
//
// Env / test overrides:
//   VERQURY_DATA_ROOT       data root (default ~/FlawedWorks/verqury)
//   VERQURY_ASK_TIMEOUT_MS  default 20 min; VERQURY_ASK_POLL_MS default 3 s
//   VERQURY_ASK_DRYRUN      file the record + print {id,file,...}, skip the poll (tests)
//   VERQURY_ASK_ID          poll THIS existing record instead of creating one (tests)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const HOME = os.homedir();
const TIMEOUT_MS = Number(process.env.VERQURY_ASK_TIMEOUT_MS) || 20 * 60 * 1000;
const POLL_MS = Number(process.env.VERQURY_ASK_POLL_MS) || 3000;

function dataRoot() {
  return process.env.VERQURY_DATA_ROOT || path.join(HOME, 'FlawedWorks', 'verqury');
}

// Tiny flag parser: --key value, and --flag (boolean). Unknown flags are ignored.
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function genId() {
  const time = Date.now().toString(36).toUpperCase().padStart(9, '0');
  const rand = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${time}${rand}`;
}

// Flat YAML frontmatter that gray-matter (the app/core reader) parses back to the same
// fields. Arrays serialize as a JSON flow sequence (valid YAML); booleans bare; scalars
// JSON-quoted. Kept in lock-step with core/src/approvals.js via a cross-reader test.
const FIELDS = ['id', 'kind', 'status', 'decision', 'tool', 'summary', 'options', 'answer', 'needsContext', 'emailedAt', 'project', 'sessionId', 'cwd', 'created', 'answered'];
function yamlValue(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => String(x)));
  return JSON.stringify(String(v));
}
function serialize(data, body) {
  const fm = FIELDS.map((k) => `${k}: ${yamlValue(data[k])}`).join('\n');
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

// Poll our record for the answer the app (or desktop) wrote. Tolerant of quoted or
// unquoted YAML (the app rewrites via gray-matter). Returns the answer string or null.
function readAnswer(file) {
  let txt;
  try {
    txt = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (!/^status:\s*"?answered"?/m.test(txt)) return null;
  const m = txt.match(/^answer:\s*(.+?)\s*$/m);
  if (!m) return '';
  let v = m[1];
  if (/^".*"$/.test(v)) {
    try {
      v = JSON.parse(v);
    } catch {
      v = v.slice(1, -1);
    }
  } else if (/^'.*'$/.test(v)) {
    v = v.slice(1, -1).replace(/''/g, "'");
  }
  return String(v);
}

function markExpired(file) {
  try {
    let txt = fs.readFileSync(file, 'utf8');
    if (/^status:\s*"?answered"?/m.test(txt)) return; // a late answer beat us
    txt = txt.replace(/^status:\s*.*$/m, 'status: "expired"').replace(/^answered:\s*.*$/m, `answered: ${JSON.stringify(new Date().toISOString())}`);
    fs.writeFileSync(file, txt);
  } catch {
    /* recording the expiry is best-effort */
  }
}

function sleepSync(ms) {
  // Real (non-busy) synchronous sleep — this runner is intentionally a blocking gate.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readBody(args) {
  if (args['body-file']) {
    try {
      return fs.readFileSync(args['body-file'], 'utf8');
    } catch {
      return '';
    }
  }
  if (typeof args.body === 'string') return args.body;
  return '';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = dataRoot();

  // Test hook: poll an existing record instead of creating one (proves the read path).
  let file;
  let id = process.env.VERQURY_ASK_ID;
  if (id) {
    file = path.join(root, 'approvals', `${id}.md`);
  } else {
    id = genId();
    const options = args.options ? String(args.options).split('|').map((s) => s.trim()).filter(Boolean) : [];
    const data = {
      id,
      kind: 'question',
      status: 'pending',
      decision: null,
      tool: null,
      summary: args.summary ? String(args.summary) : 'A decision is needed',
      options,
      answer: null,
      needsContext: Boolean(args['needs-context']),
      emailedAt: null,
      project: args.project ? String(args.project) : null,
      sessionId: args.session ? String(args.session).slice(0, 12) : null,
      cwd: process.cwd(),
      created: new Date().toISOString(),
      answered: null,
    };
    file = writeRecord(root, data, readBody(args));

    if (process.env.VERQURY_ASK_DRYRUN) {
      process.stdout.write(JSON.stringify({ id, file, options, needsContext: data.needsContext }) + '\n');
      return;
    }
  }

  // Block (self-timed) until the owner answers — on the phone or at the desk.
  const timeout = Number(process.env.VERQURY_ASK_TIMEOUT_MS) || TIMEOUT_MS;
  const poll = Number(process.env.VERQURY_ASK_POLL_MS) || POLL_MS;
  const start = Date.now();
  // Check once up-front (a pre-answered record returns immediately — the test path).
  let answer = readAnswer(file);
  while (answer === null && Date.now() - start < timeout) {
    sleepSync(poll);
    answer = readAnswer(file);
  }

  if (answer !== null) {
    process.stdout.write(String(answer) + '\n');
    return;
  }

  // No answer in the window → park it and tell the model to fall back to the desk.
  markExpired(file);
  process.stdout.write(`[verqury-ask] No answer received within ${Math.round(timeout / 60000)} min (#${String(id).slice(-6)}). Ask the owner directly at the desk, or proceed at your discretion.\n`);
}

try {
  main();
} catch {
  // Never break the agent — a failure here just means no remote answer.
  process.stdout.write('[verqury-ask] Relay unavailable — ask the owner directly.\n');
}

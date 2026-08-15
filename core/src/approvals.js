// Remote decision relay — Decision Inbox (ADR-0011, plan §8 Phase B + C).
// The third file-backed inbox beside artifacts (P4) and tasks (P6): each pending
// decision from a running Claude Code build becomes a markdown record under
// <root>/approvals/. Two KINDS share this inbox (ADR-0011):
//   * `permission` (Phase B) — a yes/no gate the PermissionRequest hook files; the
//     answer is a `decision` ∈ allow|deny returned to the paused tool.
//   * `question`   (Phase C) — the agent's OWN clarifying question, filed by the
//     `verqury-ask` skill; carries free-form `options` + a long-form `body`, and the
//     answer is free `answer` text (a tapped option or a typed reply) returned to the
//     model. When the body is long or `needsContext`, the app also emails the context.
// Stored GLOBALLY (not per-project) like packets (ADR-0007) so the dependency-free
// writers (hook / skill) can file one without resolving a project; the record carries
// a best-effort `project` for the timeline echo. Named "approvals" to avoid colliding
// with the per-project architecture-decision log (memory/decisions). Pure file I/O
// (ADR-0001) — Telegram/email/SQLite hold no truth; the markdown record is the only one.
//
// Lifecycle: the hook/skill writes `pending`; the app (single Telegram owner) sends a
// card (+ email for long questions) and, on a tap/reply, writes `answered` + the
// verdict; the hook/skill polls the file and returns it. If nobody answers, it expires.
import fs from 'node:fs';
import path from 'node:path';
import { approvalsDir } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { ulid } from './ids.js';
import { listProjects } from './projects.js';
import { addLog } from './memory.js';

// `undeliverable` = the card never reached Telegram, so no tap can ever arrive. It is a
// terminal state like `expired`, reached in seconds instead of nine minutes (ADR-0017).
export const APPROVAL_STATUSES = ['pending', 'answered', 'expired', 'undeliverable'];
// The two record kinds that share the inbox (ADR-0011). A missing `kind` on older
// records means 'permission' (Phase B shipped without the field).
export const APPROVAL_KINDS = ['permission', 'question'];
// The two values Claude Code's PermissionRequest hook accepts (decision.behavior).
// There is deliberately no 'ask' — an unanswered approval expires to the native
// desktop prompt by the hook emitting NO decision (see ADR-0011). Questions are not
// constrained this way: their answer is free text (a tapped option or a typed reply).
export const APPROVAL_DECISIONS = ['allow', 'deny'];

function approvalFile(root, id) {
  const file = path.join(approvalsDir(root), `${id}.md`);
  return fs.existsSync(file) ? file : null;
}

// Write a doc atomically (temp + rename) so the concurrently-polling hook never
// reads a half-written record.
function writeDocAtomic(file, data, body) {
  const tmp = `${file}.tmp`;
  writeDoc(tmp, data, body);
  fs.renameSync(tmp, file);
}

// Create a pending approval. Mirrors the hook's own writer (see
// hooks/verqury-permission.cjs) — a cross-reader test keeps the two in lock-step.
export function createApproval(root, { tool, summary, command = '', project = null, sessionId = null, cwd = null } = {}) {
  const dir = approvalsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const id = ulid();
  const data = {
    id,
    kind: 'permission',
    status: 'pending',
    decision: null,
    tool: tool ?? null,
    summary: summary ?? (tool ? `${tool} needs approval` : 'Permission needed'),
    project: project ?? null,
    sessionId: sessionId ?? null,
    cwd: cwd ?? null,
    created: new Date().toISOString(),
    answered: null,
  };
  const file = path.join(dir, `${id}.md`);
  writeDocAtomic(file, data, command ? `${String(command).trim()}\n` : '');
  return { ...data, path: file };
}

// Create a pending QUESTION (Phase C) — the agent's own clarifying question, filed
// by the verqury-ask skill (which has its own dependency-free writer; a cross-reader
// test keeps them in lock-step). `options` are discrete choices (rendered as Telegram
// buttons / desktop buttons); `body` is the long-form context that gets emailed when
// `needsContext` or the body is long. The answer is free text (see answerQuestion).
export function createQuestion(root, { summary, options = [], body = '', project = null, needsContext = false, sessionId = null, cwd = null } = {}) {
  const dir = approvalsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const id = ulid();
  const data = {
    id,
    kind: 'question',
    status: 'pending',
    decision: null, // unused for questions; kept so the record shape is uniform
    tool: null,
    summary: summary ?? 'A decision is needed',
    options: Array.isArray(options) ? options.filter((o) => String(o).trim()) : [],
    answer: null,
    needsContext: Boolean(needsContext),
    emailedAt: null,
    project: project ?? null,
    sessionId: sessionId ?? null,
    cwd: cwd ?? null,
    created: new Date().toISOString(),
    answered: null,
  };
  const file = path.join(dir, `${id}.md`);
  writeDocAtomic(file, data, body ? `${String(body).trim()}\n` : '');
  return { ...data, path: file };
}

export function getApproval(root, id) {
  const file = approvalFile(root, id);
  if (!file) return null;
  const { data, body } = readDoc(file);
  return { ...data, id: data.id ?? id, body, path: file };
}

export function listApprovals(root, { status } = {}) {
  const dir = approvalsDir(root);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const { data, body } = readDoc(path.join(dir, f));
    if (status && data.status !== status) continue;
    out.push({
      id: data.id ?? f.replace(/\.md$/, ''),
      kind: data.kind ?? 'permission', // pre-Phase-C records have no kind → permission
      status: data.status ?? null,
      decision: data.decision ?? null,
      tool: data.tool ?? null,
      summary: data.summary ?? null,
      options: Array.isArray(data.options) ? data.options : [],
      answer: data.answer ?? null,
      needsContext: Boolean(data.needsContext),
      emailedAt: data.emailedAt ?? null,
      error: data.error ?? null, // why an `undeliverable` record never reached the phone
      project: data.project ?? null,
      sessionId: data.sessionId ?? null,
      cwd: data.cwd ?? null,
      created: data.created ?? null,
      answered: data.answered ?? null,
      preview: body.replace(/\s+/g, ' ').trim().slice(0, 140),
      path: path.join(dir, f),
    });
  }
  return out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

export function pendingApprovals(root) {
  return listApprovals(root, { status: 'pending' });
}

// Record the owner's verdict (allow|deny). Writes it into the record (the hook is
// polling for it) and echoes a line into the project timeline when the record's
// `project` resolves to a real project — same loop-closing move as a Phase-6 report.
export function answerApproval(root, id, decision) {
  if (!APPROVAL_DECISIONS.includes(decision)) {
    throw new Error(`Invalid approval decision: "${decision}". Expected one of: ${APPROVAL_DECISIONS.join(', ')}`);
  }
  const file = approvalFile(root, id);
  if (!file) throw new Error(`No such approval: ${id}`);
  const { data, body } = readDoc(file);
  if ((data.kind ?? 'permission') !== 'permission') {
    throw new Error(`Approval ${id} is a ${data.kind}, not a permission (use answerQuestion)`);
  }
  data.status = 'answered';
  data.decision = decision;
  data.answered = new Date().toISOString();
  writeDocAtomic(file, data, body);
  echoToTimeline(root, data, `Remote ${decision === 'allow' ? 'approved' : 'denied'}: ${data.summary ?? data.tool ?? 'permission'}`);
  return { ...data, id: data.id ?? id, path: file };
}

// Record the owner's answer to a QUESTION (Phase C). The answer is free text — a
// tapped option or a typed Telegram reply — so it is not constrained to a vocabulary
// (unlike a permission's allow/deny). Stored in `answer` (leaving `decision` for the
// permission kind); the polling verqury-ask skill reads it back and returns it to the
// model. Echoes into the project timeline like a permission verdict does.
export function answerQuestion(root, id, answer) {
  const text = String(answer ?? '').trim();
  if (!text) throw new Error('answerQuestion needs a non-empty answer');
  const file = approvalFile(root, id);
  if (!file) throw new Error(`No such approval: ${id}`);
  const { data, body } = readDoc(file);
  if ((data.kind ?? 'permission') !== 'question') {
    throw new Error(`Approval ${id} is a ${data.kind ?? 'permission'}, not a question (use answerApproval)`);
  }
  data.status = 'answered';
  data.answer = text;
  data.answered = new Date().toISOString();
  writeDocAtomic(file, data, body);
  echoToTimeline(root, data, `Remote answer to "${data.summary ?? 'question'}": ${text}`.slice(0, 200));
  return { ...data, id: data.id ?? id, body, path: file };
}

// Stamp `emailedAt` so the app's relay sends the long-form context email exactly once
// (Phase C). Idempotence lives in the caller (it checks emailedAt before sending).
export function markEmailed(root, id) {
  const file = approvalFile(root, id);
  if (!file) throw new Error(`No such approval: ${id}`);
  const { data, body } = readDoc(file);
  data.emailedAt = new Date().toISOString();
  writeDocAtomic(file, data, body);
  return { ...data, id: data.id ?? id, path: file };
}

// Mark an approval as expired (nobody answered in the window). The hook falls back
// to the desktop prompt; this just records the outcome for the inbox/audit trail.
export function expireApproval(root, id) {
  const file = approvalFile(root, id);
  if (!file) throw new Error(`No such approval: ${id}`);
  const { data, body } = readDoc(file);
  if (data.status === 'answered') return { ...data, id: data.id ?? id, path: file }; // a tap beat the timer
  data.status = 'expired';
  data.answered = data.answered ?? new Date().toISOString();
  writeDocAtomic(file, data, body);
  echoToTimeline(root, data, `Remote approval expired → parked at the desk: ${data.summary ?? data.tool ?? 'permission'}`);
  return { ...data, id: data.id ?? id, path: file };
}

// The card could not be sent (bad token, blocked bot, Telegram API error, network gone).
// Nothing will ever arrive on the phone, so waiting out the full window buys nothing but
// silence — record it and let the writer park at the desk AT ONCE. This extends the
// v0.6.3 fail-fast principle from "can we send?" (app liveness, checked before the wait)
// to "did we send?" (checked after the attempt): a token that is present but invalid used
// to look identical to a healthy relay for the entire nine minutes, every time, for a week.
// `reason` is Telegram's own `description` where we have one — the record is the only place
// that failure is ever visible, so it must not be dropped.
export function markUndeliverable(root, id, reason = '') {
  const file = approvalFile(root, id);
  if (!file) throw new Error(`No such approval: ${id}`);
  const { data, body } = readDoc(file);
  // A tap or a desk answer beat the failed send — never overwrite a real outcome.
  if (data.status !== 'pending') return { ...data, id: data.id ?? id, path: file };
  data.status = 'undeliverable';
  data.error = String(reason || 'send failed').slice(0, 200);
  data.answered = data.answered ?? new Date().toISOString();
  writeDocAtomic(file, data, body);
  echoToTimeline(root, data, `Remote approval undeliverable (${data.error}) → parked at the desk: ${data.summary ?? data.tool ?? 'permission'}`);
  return { ...data, id: data.id ?? id, path: file };
}

// ---- Expiry sweep: the app is the expiry AUTHORITY; the writer's timer is the fast path ----
// The hook/skill counts its own window down from inside its own process — which is the
// fast path, and dies with it. End the session, Ctrl+C, sleep or kill it and the record
// it filed stays `pending` forever, because nothing else ever reaped it. On the next app
// start those zombies draw fresh Telegram cards: phantom approvals for tool calls that
// finished hours ago, where a tap accomplishes nothing. The app outlives any one hook, so
// it sweeps. Windows mirror the two writers' defaults (there is no per-record window in
// the format); the grace margin lets the writer's own expiry win the ordinary race, and
// since both writers only ever SHRINK their window via env (for tests), a sweep can never
// reap out from under a live waiter.
export const PERMISSION_EXPIRE_MS = 9 * 60 * 1000; // hooks/verqury-permission.cjs
export const QUESTION_EXPIRE_MS = 20 * 60 * 1000; // the verqury-ask skill (ask.cjs)
const SWEEP_GRACE_MS = 60 * 1000;

export function sweepExpiredApprovals(root, { now = Date.now() } = {}) {
  const reaped = [];
  for (const a of pendingApprovals(root)) {
    const window = a.kind === 'question' ? QUESTION_EXPIRE_MS : PERMISSION_EXPIRE_MS;
    const created = Date.parse(a.created ?? '');
    if (!Number.isFinite(created)) continue; // undateable — leave it visible rather than guess
    if (now - created <= window + SWEEP_GRACE_MS) continue;
    try {
      reaped.push(expireApproval(root, a.id));
    } catch {
      /* raced with an answer or a delete — the next sweep reads the truth */
    }
  }
  return reaped;
}

export function deleteApproval(root, id) {
  const file = approvalFile(root, id);
  if (!file) throw new Error(`No such approval: ${id}`);
  fs.rmSync(file);
  return { id };
}

// Log to the record's project only if it resolves to a real one — the hook's
// project guess is best-effort (cwd basename), so a miss is silent, never an error.
function echoToTimeline(root, data, text) {
  const slug = data.project;
  if (!slug) return;
  const exists = listProjects(root).some((p) => p.slug === slug);
  if (!exists) return;
  try {
    addLog(root, slug, { text, title: text.slice(0, 60) });
  } catch {
    /* timeline echo is best-effort; never fail an answer over it */
  }
}

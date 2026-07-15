// Remote decision relay — Approval Inbox (ADR-0011, plan §8 Phase B).
// The third file-backed inbox beside artifacts (P4) and tasks (P6): each pending
// permission request from a running Claude Code build becomes a markdown record
// under <root>/approvals/. Stored GLOBALLY (not per-project) like packets
// (ADR-0007) so the dependency-free PermissionRequest hook can write one without
// resolving a project; the record carries a best-effort `project` for the timeline
// echo. Named "approvals" to avoid colliding with the per-project architecture-
// decision log (memory/decisions). Pure file I/O (ADR-0001) — Telegram/SQLite hold
// no truth; the markdown record is the only source of it.
//
// Lifecycle: the hook writes `pending`; the app (single Telegram owner) sends a
// card and, on a tap, writes `answered` + the decision; the hook polls the file
// and returns the verdict. If nobody answers, the hook expires it to the desk.
import fs from 'node:fs';
import path from 'node:path';
import { approvalsDir } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { ulid } from './ids.js';
import { listProjects } from './projects.js';
import { addLog } from './memory.js';

export const APPROVAL_STATUSES = ['pending', 'answered', 'expired'];
// The two values Claude Code's PermissionRequest hook accepts (decision.behavior).
// There is deliberately no 'ask' — an unanswered approval expires to the native
// desktop prompt by the hook emitting NO decision (see ADR-0011).
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
      status: data.status ?? null,
      decision: data.decision ?? null,
      tool: data.tool ?? null,
      summary: data.summary ?? null,
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
  data.status = 'answered';
  data.decision = decision;
  data.answered = new Date().toISOString();
  writeDocAtomic(file, data, body);
  echoToTimeline(root, data, `Remote ${decision === 'allow' ? 'approved' : 'denied'}: ${data.summary ?? data.tool ?? 'permission'}`);
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

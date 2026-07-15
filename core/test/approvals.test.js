import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpRoot } from './helpers.js';
import { createProject } from '../src/projects.js';
import { projectTimeline } from '../src/memory.js';
import { approvalsDir } from '../src/paths.js';
import {
  createApproval, getApproval, listApprovals, pendingApprovals,
  answerApproval, expireApproval, APPROVAL_DECISIONS,
} from '../src/approvals.js';

test('createApproval writes a pending record and lists it', () => {
  const root = tmpRoot();
  const a = createApproval(root, { tool: 'Bash', summary: 'Bash: git commit', command: 'git commit -m wip' });
  assert.equal(a.status, 'pending');
  assert.equal(a.decision, null);
  assert.ok(fs.existsSync(a.path));
  assert.equal(pendingApprovals(root).length, 1);
  const got = getApproval(root, a.id);
  assert.equal(got.tool, 'Bash');
  assert.match(got.body, /git commit/); // command stored verbatim in the body
});

test('answerApproval records the verdict and clears it from pending', () => {
  const root = tmpRoot();
  const a = createApproval(root, { tool: 'Bash', summary: 'rm build' });
  const answered = answerApproval(root, a.id, 'deny');
  assert.equal(answered.status, 'answered');
  assert.equal(answered.decision, 'deny');
  assert.ok(answered.answered);
  assert.equal(pendingApprovals(root).length, 0);
  assert.equal(listApprovals(root, { status: 'answered' }).length, 1);
});

test('answerApproval rejects anything but allow/deny', () => {
  const root = tmpRoot();
  const a = createApproval(root, { tool: 'Bash', summary: 'x' });
  assert.throws(() => answerApproval(root, a.id, 'ask'), /Invalid approval decision/);
  assert.deepEqual(APPROVAL_DECISIONS, ['allow', 'deny']); // no 'ask' — that's emit-nothing at the hook
});

test('answering echoes into the project timeline when the project resolves', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Verqury', slug: 'verqury' });
  const a = createApproval(root, { tool: 'Bash', summary: 'Bash: deploy', project: 'verqury' });
  answerApproval(root, a.id, 'allow');
  const tl = projectTimeline(root, 'verqury');
  assert.ok(tl.some((e) => /Remote approved/.test(e.title || '')));
});

test('a bad project guess is silent, never an error', () => {
  const root = tmpRoot();
  const a = createApproval(root, { tool: 'Bash', summary: 'x', project: 'no-such-project' });
  assert.doesNotThrow(() => answerApproval(root, a.id, 'allow')); // echo is best-effort
});

test('expireApproval parks a pending record; a prior answer wins', () => {
  const root = tmpRoot();
  const a = createApproval(root, { tool: 'Bash', summary: 'x' });
  const e = expireApproval(root, a.id);
  assert.equal(e.status, 'expired');
  // If it was already answered, expire must not overwrite the verdict.
  const b = createApproval(root, { tool: 'Bash', summary: 'y' });
  answerApproval(root, b.id, 'allow');
  const e2 = expireApproval(root, b.id);
  assert.equal(e2.status, 'answered');
  assert.equal(e2.decision, 'allow');
});

// The dependency-free hook (hooks/verqury-permission.cjs) writes records with its own
// flat-YAML serializer. This proves core reads a hook-shaped file back identically —
// the contract that keeps the two writers in lock-step.
test('core reads a hook-serialized record (cross-reader contract)', () => {
  const root = tmpRoot();
  fs.mkdirSync(approvalsDir(root), { recursive: true });
  const id = '0ABC123HOOKWRITTEN';
  const fm = [
    'id: ' + JSON.stringify(id),
    'status: ' + JSON.stringify('pending'),
    'decision: null',
    'tool: ' + JSON.stringify('Bash'),
    'summary: ' + JSON.stringify('Bash: git push --force'),
    'project: ' + JSON.stringify('verqury'),
    'sessionId: ' + JSON.stringify('sess12345678'),
    'cwd: ' + JSON.stringify('/home/x/verqury'),
    'created: ' + JSON.stringify(new Date().toISOString()),
    'answered: null',
  ].join('\n');
  fs.writeFileSync(path.join(approvalsDir(root), `${id}.md`), `---\n${fm}\n---\n{"command":"git push --force"}\n`);
  const got = getApproval(root, id);
  assert.equal(got.status, 'pending');
  assert.equal(got.tool, 'Bash');
  assert.equal(got.summary, 'Bash: git push --force');
  assert.equal(got.sessionId, 'sess12345678');
  // And core can answer it, which the hook would then read back.
  const answered = answerApproval(root, id, 'deny');
  assert.equal(answered.decision, 'deny');
});

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
  createQuestion, answerQuestion, markEmailed, APPROVAL_KINDS,
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

/* ---- Phase C: questions (verqury-ask) share the inbox by kind ---- */

test('createApproval defaults to the permission kind; missing kind reads as permission', () => {
  const root = tmpRoot();
  const a = createApproval(root, { tool: 'Bash', summary: 'x' });
  assert.equal(a.kind, 'permission');
  assert.deepEqual(APPROVAL_KINDS, ['permission', 'question']);
  // A pre-Phase-C record with no `kind` frontmatter still reads as a permission.
  fs.mkdirSync(approvalsDir(root), { recursive: true });
  const id = '0OLDNOKINDRECORD01';
  fs.writeFileSync(path.join(approvalsDir(root), `${id}.md`),
    `---\nid: ${JSON.stringify(id)}\nstatus: "pending"\ndecision: null\ntool: "Bash"\nsummary: "old"\n---\n`);
  assert.equal(listApprovals(root).find((x) => x.id === id).kind, 'permission');
});

test('createQuestion files a question with options + long body, answered by free text', () => {
  const root = tmpRoot();
  const q = createQuestion(root, {
    summary: 'Rename module to relay?',
    options: ['yes', 'no', 'later'],
    body: 'A paragraph of context explaining the tradeoff.',
    needsContext: true,
    project: 'verqury',
  });
  assert.equal(q.kind, 'question');
  assert.equal(q.status, 'pending');
  assert.deepEqual(q.options, ['yes', 'no', 'later']);
  assert.equal(q.needsContext, true);
  assert.equal(q.emailedAt, null);
  const listed = listApprovals(root, { status: 'pending' })[0];
  assert.equal(listed.kind, 'question');
  assert.deepEqual(listed.options, ['yes', 'no', 'later']);
  // The answer is FREE text (a tapped option or a typed reply), not allow/deny.
  const answered = answerQuestion(root, q.id, 'yes — go with relay');
  assert.equal(answered.status, 'answered');
  assert.equal(answered.answer, 'yes — go with relay');
  assert.ok(answered.answered);
  assert.equal(pendingApprovals(root).length, 0);
});

test('answerQuestion rejects a permission record; answerApproval rejects a question', () => {
  const root = tmpRoot();
  const perm = createApproval(root, { tool: 'Bash', summary: 'permission' });
  assert.throws(() => answerQuestion(root, perm.id, 'anything'), /not a question/);
  const q = createQuestion(root, { summary: 'a question', options: ['a', 'b'] });
  assert.throws(() => answerApproval(root, q.id, 'allow')); // wrong lane
  assert.throws(() => answerQuestion(root, q.id, '   '), /non-empty/); // blank answer rejected
});

test('answering a question echoes into the project timeline', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Verqury', slug: 'verqury' });
  const q = createQuestion(root, { summary: 'Ship it?', options: ['ship', 'hold'], project: 'verqury' });
  answerQuestion(root, q.id, 'ship');
  const tl = projectTimeline(root, 'verqury');
  assert.ok(tl.some((e) => /Remote answer to "Ship it\?": ship/.test(e.title || '') || /Remote answer/.test(e.title || '')));
});

test('markEmailed stamps emailedAt once (relay sends the context email exactly once)', () => {
  const root = tmpRoot();
  const q = createQuestion(root, { summary: 'long one', needsContext: true, body: 'x'.repeat(300) });
  assert.equal(listApprovals(root)[0].emailedAt, null);
  markEmailed(root, q.id);
  assert.ok(listApprovals(root)[0].emailedAt);
});

// The verqury-ask skill (skills/verqury-ask/scripts/ask.cjs) writes question records
// with its own dependency-free serializer (options as a JSON flow sequence, needsContext
// bare boolean). This proves core reads a skill-shaped record back identically and can
// answer it — the return-path contract the polling skill then reads.
test('core reads a skill-serialized question record (cross-reader contract)', () => {
  const root = tmpRoot();
  fs.mkdirSync(approvalsDir(root), { recursive: true });
  const id = '0ASKWRITTENQUESTION';
  const fm = [
    'id: ' + JSON.stringify(id),
    'kind: ' + JSON.stringify('question'),
    'status: ' + JSON.stringify('pending'),
    'decision: null',
    'tool: null',
    'summary: ' + JSON.stringify('Approach A or B?'),
    'options: ["A","B"]',
    'answer: null',
    'needsContext: true',
    'emailedAt: null',
    'project: ' + JSON.stringify('verqury'),
    'sessionId: null',
    'cwd: ' + JSON.stringify('/home/x/verqury'),
    'created: ' + JSON.stringify(new Date().toISOString()),
    'answered: null',
  ].join('\n');
  fs.writeFileSync(path.join(approvalsDir(root), `${id}.md`), `---\n${fm}\n---\nLong context body here.\n`);
  const got = getApproval(root, id);
  assert.equal(got.kind, 'question');
  assert.deepEqual(got.options, ['A', 'B']);
  assert.equal(got.needsContext, true);
  assert.match(got.body, /Long context body/);
  // And core can answer it, which the polling skill then reads back.
  const answered = answerQuestion(root, id, 'A');
  assert.equal(answered.answer, 'A');
  assert.equal(answered.status, 'answered');
});

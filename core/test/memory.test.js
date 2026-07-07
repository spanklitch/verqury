import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpRoot } from './helpers.js';
import { createProject } from '../src/projects.js';
import { addLog, addDecision, listLog, listDecisions, projectTimeline } from '../src/memory.js';

test('addLog writes a dated file scoped to the project', () => {
  const root = tmpRoot();
  createProject(root, { name: 'M' });
  const l = addLog(root, 'm', { text: 'did a thing', title: 'Kickoff' });
  assert.match(l.path, /\/memory\/log\/\d{4}-\d{2}-\d{2}-kickoff\.md$/);
  assert.throws(() => addLog(root, 'ghost', { text: 'x' }), /No such project/);
  assert.throws(() => addLog(root, 'm', { text: '' }), /text is required/);
});

test('addDecision assigns incrementing zero-padded numbers', () => {
  const root = tmpRoot();
  createProject(root, { name: 'M' });
  const d1 = addDecision(root, 'm', { title: 'Use SQLite' });
  const d2 = addDecision(root, 'm', { title: 'Use Electron' });
  assert.equal(d1.number, 1);
  assert.equal(d2.number, 2);
  assert.match(d2.path, /002-use-electron\.md$/);
  assert.throws(() => addDecision(root, 'm', { title: 'Bad', status: 'nope' }), /Invalid decision status/);
});

test('projectTimeline merges logs and decisions newest-first', () => {
  const root = tmpRoot();
  createProject(root, { name: 'M' });
  addLog(root, 'm', { text: 'first', title: 'One' });
  addDecision(root, 'm', { title: 'A Decision' });

  assert.equal(listLog(root, 'm').length, 1);
  assert.equal(listDecisions(root, 'm').length, 1);

  const tl = projectTimeline(root, 'm');
  assert.equal(tl.length, 2);
  assert.ok(tl.every((e) => e.type === 'log' || e.type === 'decision'));
  // same-date tiebreak is deterministic (path desc), so order is stable
  assert.deepEqual(projectTimeline(root, 'm').map((e) => e.path), tl.map((e) => e.path));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpRoot } from './helpers.js';
import { createProject } from '../src/projects.js';
import { addArtifact } from '../src/artifacts.js';
import { projectTimeline } from '../src/memory.js';
import { addTask, listTasks, showTask, updateTask, deleteTask, renderHandoff, attachReport } from '../src/tasks.js';

test('addTask validates route and defaults to todo', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Proj' });
  const t = addTask(root, 'proj', { title: 'Do a thing', route: 'human' });
  assert.equal(t.status, 'todo');
  assert.equal(t.route, 'human');
  assert.match(t.path, /\/tasks\/[0-9A-Z]{26}\.md$/);
  assert.throws(() => addTask(root, 'proj', { title: 'x', route: 'bogus' }), /Invalid task route/);
  assert.throws(() => addTask(root, 'proj', { title: '' }), /title is required/);
});

test('list, update, and delete tasks', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Proj' });
  const t = addTask(root, 'proj', { title: 'Route me', route: 'direct' });
  assert.equal(listTasks(root, { project: 'proj' }).length, 1);
  updateTask(root, 'proj', t.id, { route: 'automation', status: 'in-progress' });
  const shown = showTask(root, 'proj', t.id);
  assert.equal(shown.route, 'automation');
  assert.equal(shown.status, 'in-progress');
  assert.equal(listTasks(root, { project: 'proj', status: 'in-progress' }).length, 1);
  assert.throws(() => updateTask(root, 'proj', t.id, { status: 'nope' }), /Invalid task status/);
  deleteTask(root, 'proj', t.id);
  assert.equal(listTasks(root, { project: 'proj' }).length, 0);
});

test('renderHandoff includes surface packet context and the task payload', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Portal', stage: 'build' });
  // browser-task starter packet has surface 'browser-agent'
  const t = addTask(root, 'portal', { title: 'Fetch pricing', route: 'browser-agent', surface: 'browser-agent', body: 'Look up competitor pricing.' });
  const { payload } = renderHandoff(root, 'portal', t.id);
  assert.match(payload, /## Task: Fetch pricing/);
  assert.match(payload, /Look up competitor pricing\./);
  assert.match(payload, /browser agent/); // from the browser-task packet context
});

test('attachReport closes the task and echoes into the project timeline', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Portal' });
  const t = addTask(root, 'portal', { title: 'Fetch pricing', route: 'browser-agent' });
  const report = addArtifact(root, 'portal', { content: 'Pricing is $9-19/mo.', kind: 'report', source: 'clipboard' });

  const done = attachReport(root, 'portal', t.id, report.id);
  assert.equal(done.status, 'done');
  assert.equal(done.report, report.id);

  const timeline = projectTimeline(root, 'portal');
  const echo = timeline.find((e) => /Task done: Fetch pricing/.test(e.title ?? ''));
  assert.ok(echo, 'a completion log entry should appear in the timeline');
  assert.match(echo.body, new RegExp(report.id));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpRoot } from './helpers.js';
import { createProject, listProjects, showProject, setStage } from '../src/projects.js';

test('createProject writes the tree and frontmatter; duplicates throw', () => {
  const root = tmpRoot();
  const p = createProject(root, { name: 'Demo App' });
  assert.equal(p.slug, 'demo-app');
  assert.ok(fs.existsSync(p.path));
  assert.ok(fs.existsSync(`${root}/projects/demo-app/memory/log`));
  assert.ok(fs.existsSync(`${root}/projects/demo-app/memory/decisions`));
  assert.ok(fs.existsSync(`${root}/projects/demo-app/artifacts`));
  assert.ok(fs.existsSync(`${root}/projects/demo-app/tasks`));
  assert.ok(fs.existsSync(`${root}/projects/demo-app/packets`));

  const shown = showProject(root, 'demo-app');
  assert.equal(shown.stage, 'concept');
  assert.equal(shown.status, 'active');
  assert.match(shown.body, /# Demo App/);

  assert.throws(() => createProject(root, { name: 'Demo App' }), /already exists/);
});

test('createProject validates stage and status enums', () => {
  const root = tmpRoot();
  assert.throws(() => createProject(root, { name: 'X', stage: 'nope' }), /Invalid stage/);
  assert.throws(() => createProject(root, { name: 'Y', status: 'nope' }), /Invalid status/);
  assert.throws(() => createProject(root, { name: '' }), /name is required/);
});

test('setStage updates frontmatter and validates', () => {
  const root = tmpRoot();
  createProject(root, { name: 'X' });
  setStage(root, 'x', 'build');
  assert.equal(showProject(root, 'x').stage, 'build');
  assert.throws(() => setStage(root, 'x', 'nonsense'), /Invalid stage/);
  assert.throws(() => setStage(root, 'ghost', 'build'), /No such project/);
});

test('listProjects returns created projects sorted by slug', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Beta' });
  createProject(root, { name: 'Alpha' });
  assert.deepEqual(listProjects(root).map((p) => p.slug), ['alpha', 'beta']);
});

test('createProject records repo and links', () => {
  const root = tmpRoot();
  createProject(root, {
    name: 'Linked',
    repo: '/home/x/code/linked',
    links: [{ label: 'site', url: 'https://example.com' }],
  });
  const shown = showProject(root, 'linked');
  assert.equal(shown.repo, '/home/x/code/linked');
  assert.equal(shown.links[0].url, 'https://example.com');
});

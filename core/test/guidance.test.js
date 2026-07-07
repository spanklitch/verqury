import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpRoot } from './helpers.js';
import { createProject } from '../src/projects.js';
import { addGuidance, listGuidance, showGuidance } from '../src/guidance.js';

test('addGuidance writes global and project-scoped files', () => {
  const root = tmpRoot();
  const g = addGuidance(root, { title: 'Security Standard', kind: 'standard', tags: ['sec'] });
  assert.equal(g.slug, 'security-standard');
  assert.ok(fs.existsSync(`${root}/guidance/security-standard.md`));

  createProject(root, { name: 'Proj' });
  addGuidance(root, { scope: 'proj', title: 'Naming Rules', kind: 'instruction' });
  assert.ok(fs.existsSync(`${root}/projects/proj/guidance/naming-rules.md`));

  const globalList = listGuidance(root);
  assert.deepEqual(globalList.map((x) => x.slug), ['security-standard']);
  const projList = listGuidance(root, { scope: 'proj' });
  assert.deepEqual(projList.map((x) => x.slug), ['naming-rules']);

  const shown = showGuidance(root, 'global', 'security-standard');
  assert.deepEqual(shown.tags, ['sec']);
});

test('addGuidance validates kind and rejects duplicates', () => {
  const root = tmpRoot();
  assert.throws(() => addGuidance(root, { title: 'Bad', kind: 'nope' }), /Invalid kind/);
  addGuidance(root, { title: 'Once', kind: 'skill' });
  assert.throws(() => addGuidance(root, { title: 'Once', kind: 'skill' }), /already exists/);
});

test('addGuidance to a missing project throws', () => {
  const root = tmpRoot();
  assert.throws(() => addGuidance(root, { scope: 'ghost', title: 'X', kind: 'skill' }), /No such project/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpRoot } from './helpers.js';
import { createProject } from '../src/projects.js';
import { addLog } from '../src/memory.js';
import { rebuildIndex, refreshIndex, search } from '../src/search.js';

test('search finds projects; refresh tracks additions and deletions; rebuild is clean', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Searchable Widget' });
  rebuildIndex(root);

  let hits = search(root, 'Searchable');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].type, 'project');

  // A new log entry is picked up by incremental refresh.
  addLog(root, 'searchable-widget', { text: 'zebra pattern insight', title: 'Insight' });
  refreshIndex(root);
  hits = search(root, 'zebra');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].type, 'log');

  // Deleting the file and refreshing removes it from the index.
  fs.rmSync(hits[0].path);
  refreshIndex(root);
  assert.equal(search(root, 'zebra').length, 0);

  // The index is safe to delete and fully rebuild (ADR-0001).
  fs.rmSync(`${root}/index.sqlite`, { force: true });
  const n = rebuildIndex(root);
  assert.ok(n >= 1);
  assert.equal(search(root, 'Searchable').length, 1);
});

test('search filters by type and project', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Alpha' });
  createProject(root, { name: 'Beta' });
  addLog(root, 'alpha', { text: 'shared keyword here', title: 'Note' });
  rebuildIndex(root);

  assert.equal(search(root, 'Alpha', { type: 'log' }).length, 0);
  assert.equal(search(root, 'keyword', { type: 'log' }).length, 1);
  assert.equal(search(root, 'keyword', { project: 'beta' }).length, 0);
});

test('search on an un-built index returns empty, and empty query throws', () => {
  const root = tmpRoot();
  assert.deepEqual(search(root, 'anything'), []);
  assert.throws(() => search(root, '  '), /query is required/);
});

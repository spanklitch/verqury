import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from 'verqury-core/files';
import { createProject } from 'verqury-core/files';
import { addLog } from 'verqury-core/files';
import * as api from '../src/api.js';

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-app-'));
  init(dir);
  return dir;
}

test('getProject returns project detail plus its timeline', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Portal' });
  addLog(root, 'portal', { text: 'kickoff note', title: 'Kickoff' });
  const { project, timeline } = api.getProject(root, 'portal');
  assert.equal(project.slug, 'portal');
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].type, 'log');
});

test('changeStage persists to project.md', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Portal' });
  api.changeStage(root, 'portal', 'build');
  assert.equal(api.getProject(root, 'portal').project.stage, 'build');
});

test('runSearch returns FTS hits via the node subprocess', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Findable Thing' });
  api.refreshIndex(root); // build the index out-of-process
  const hits = api.runSearch(root, 'Findable');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].project, 'findable-thing');
});

test('getStages exposes the stage vocabulary', () => {
  assert.ok(api.getStages().includes('build'));
});

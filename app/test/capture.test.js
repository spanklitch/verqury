import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, createProject } from 'verqury-core/files';
import * as api from '../src/api.js';

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-capture-'));
  init(dir);
  return dir;
}

test('captureClipboard files an artifact into the active project', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Alpha' });
  createProject(root, { name: 'Beta' });
  api.setActive(root, 'beta');

  const outcome = api.captureClipboard(root, () => 'npm run build');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.project, 'beta');
  assert.equal(outcome.artifact.kind, 'command');
  // round-trip: stored body equals the captured text
  assert.equal(api.getArtifact(root, 'beta', outcome.artifact.id).body.trim(), 'npm run build');
});

test('captureClipboard falls back to the first project when none is active', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Only' });
  const outcome = api.captureClipboard(root, () => 'a note');
  assert.equal(outcome.project, 'only');
});

test('captureClipboard reports empty clipboard and no-project cases', () => {
  const root = tmpRoot();
  assert.deepEqual(api.captureClipboard(root, () => '   '), { ok: false, reason: 'empty' });
  assert.deepEqual(api.captureClipboard(root, () => 'text'), { ok: false, reason: 'no-project' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(root, args) {
  return execFileSync('node', [CLI, ...args], {
    env: { ...process.env, VERQURY_DATA_ROOT: root },
    encoding: 'utf8',
  });
}

// The Phase 1 success criterion: init → project create → search works end-to-end.
test('CLI round-trip: init, project create, search', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-cli-'));
  run(root, ['init']);
  assert.ok(fs.existsSync(path.join(root, 'config.json')));

  run(root, ['project', 'create', 'demo']);
  assert.ok(fs.existsSync(path.join(root, 'projects', 'demo', 'project.md')));

  const listed = run(root, ['project', 'list']);
  assert.match(listed, /^demo\t/m);

  const found = run(root, ['search', 'demo']);
  assert.match(found, /project\/demo\tdemo/);
  assert.match(found, /projects\/demo\/project\.md/);
});

test('CLI: log and decision flow into search', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-cli-'));
  run(root, ['init']);
  run(root, ['project', 'create', 'M']);
  run(root, ['log', 'add', 'm', 'flywheel', 'momentum', 'note', '--title', 'Kickoff']);
  run(root, ['decision', 'add', 'm', 'Adopt', 'the', 'widget']);

  assert.match(run(root, ['search', 'flywheel']), /log\/m/);
  assert.match(run(root, ['search', 'widget']), /decision\/m/);
});

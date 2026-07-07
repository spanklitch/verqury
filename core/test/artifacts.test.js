import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpRoot } from './helpers.js';
import { createProject } from '../src/projects.js';
import {
  addArtifact,
  listArtifacts,
  showArtifact,
  deleteArtifact,
  retagArtifact,
  setArtifactKind,
  guessKind,
} from '../src/artifacts.js';
import { ulid } from '../src/ids.js';

test('ulid is 26 chars, time-sortable, and unique', () => {
  const a = ulid(1000);
  const b = ulid(2000);
  assert.equal(a.length, 26);
  assert.ok(a < b); // later timestamp sorts after
  assert.notEqual(ulid(), ulid());
});

test('guessKind classifies common fragments', () => {
  assert.equal(guessKind('https://example.com/x'), 'url');
  assert.equal(guessKind('git commit -m "x"'), 'command');
  assert.equal(guessKind('```\ncode\n```'), 'snippet');
  assert.equal(guessKind('const x = 1;\nconsole.log(x);'), 'snippet');
  assert.equal(guessKind('Remember to call the client back tomorrow.'), 'note');
});

test('addArtifact writes a verbatim file with guessed kind', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Proj' });
  const a = addArtifact(root, 'proj', { content: 'npm run build', source: 'clipboard' });
  assert.equal(a.kind, 'command');
  assert.match(a.path, /\/artifacts\/\d{4}-\d{2}\/[0-9A-Z]{26}\.md$/);
  const shown = showArtifact(root, 'proj', a.id);
  assert.equal(shown.body.trim(), 'npm run build'); // stored verbatim → copy-back round-trips
  assert.throws(() => addArtifact(root, 'ghost', { content: 'x' }), /No such project/);
  assert.throws(() => addArtifact(root, 'proj', { content: '' }), /content is required/);
});

test('list, retag, set-kind, and delete an artifact', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Proj' });
  const a = addArtifact(root, 'proj', { content: 'a plain note', kind: 'note' });

  assert.equal(listArtifacts(root, { project: 'proj' }).length, 1);
  assert.equal(listArtifacts(root, { project: 'proj', kind: 'command' }).length, 0);

  retagArtifact(root, 'proj', a.id, ['idea', 'client']);
  assert.deepEqual(showArtifact(root, 'proj', a.id).tags, ['idea', 'client']);
  assert.equal(listArtifacts(root, { project: 'proj', tag: 'idea' }).length, 1);

  setArtifactKind(root, 'proj', a.id, 'prompt');
  assert.equal(showArtifact(root, 'proj', a.id).kind, 'prompt');
  assert.throws(() => setArtifactKind(root, 'proj', a.id, 'bogus'), /Invalid artifact kind/);

  deleteArtifact(root, 'proj', a.id);
  assert.equal(listArtifacts(root, { project: 'proj' }).length, 0);
  assert.throws(() => showArtifact(root, 'proj', a.id), /No such artifact/);
});

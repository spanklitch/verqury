import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpRoot } from './helpers.js';
import { listAdapters, getAdapter, addAdapter, updateAdapter, removeAdapter, resolveCommand } from '../src/adapters.js';

test('init seeds the four starter adapters', () => {
  const root = tmpRoot();
  assert.deepEqual(listAdapters(root).map((a) => a.slug).sort(), ['browser-agent', 'claude-chat', 'claude-code', 'cursor']);
});

test('add, update, and remove a config-only adapter (zero code)', () => {
  const root = tmpRoot();
  const a = addAdapter(root, { label: 'My Agent', command: 'run {{repo}}', packet: 'terminal-build', notes: 'x' });
  assert.equal(a.slug, 'my-agent');
  assert.equal(getAdapter(root, 'my-agent').command, 'run {{repo}}');
  assert.throws(() => addAdapter(root, { label: 'My Agent' }), /already exists/);
  assert.throws(() => addAdapter(root, { label: '' }), /label is required/);

  updateAdapter(root, 'my-agent', { command: 'launch {{repo}}', notes: 'y' });
  assert.equal(getAdapter(root, 'my-agent').command, 'launch {{repo}}');

  removeAdapter(root, 'my-agent');
  assert.equal(getAdapter(root, 'my-agent'), null);
});

test('resolveCommand substitutes repo and project fields', () => {
  const cmd = resolveCommand('term --cwd={{repo}} --title={{project.name}}', { repo: '/x/y', name: 'Portal', slug: 'portal' });
  assert.equal(cmd, 'term --cwd=/x/y --title=Portal');
});

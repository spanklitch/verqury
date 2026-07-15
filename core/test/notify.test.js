import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpRoot } from './helpers.js';
import { getNotify, setPresence, updateNotify, PRESENCE } from '../src/notify.js';
import { readConfig } from '../src/config.js';

test('notify defaults to Here, disabled, no chat_id and no secret', () => {
  const root = tmpRoot();
  const n = getNotify(root);
  assert.equal(n.presence, 'here');
  assert.equal(n.enabled, false);
  assert.equal(n.telegram.chatId, '');
  // The bot token is a secret; notify config must never carry it.
  assert.equal('token' in n, false);
  assert.equal('token' in n.telegram, false);
});

test('setPresence toggles Here/Away and persists to config.json', () => {
  const root = tmpRoot();
  setPresence(root, 'away');
  assert.equal(getNotify(root).presence, 'away');
  assert.equal(readConfig(root).notify.presence, 'away');
  setPresence(root, 'here');
  assert.equal(getNotify(root).presence, 'here');
  assert.throws(() => setPresence(root, 'nowhere'), /Invalid presence/);
});

test('updateNotify deep-merges enabled + telegram.chatId without dropping siblings', () => {
  const root = tmpRoot();
  updateNotify(root, { enabled: true });
  updateNotify(root, { telegram: { chatId: '123456789' } });
  const n = getNotify(root);
  assert.equal(n.enabled, true); // not clobbered by the telegram patch
  assert.equal(n.telegram.chatId, '123456789');
  assert.deepEqual(PRESENCE, ['here', 'away']);
});

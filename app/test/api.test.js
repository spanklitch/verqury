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

test('Telegram token round-trips to an isolated .env (0600), value never returned', () => {
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-env-')), '.env');
  process.env.VERQURY_ENV_FILE = envFile;
  try {
    assert.equal(api.hasEnvVar('VERQURY_TELEGRAM_BOT_TOKEN'), false);
    const r1 = api.setTelegramToken('123:SECRET-abc');
    assert.equal(r1.tokenSet, true);
    // Renderer-facing result must not carry the secret value.
    assert.equal(JSON.stringify(r1).includes('SECRET'), false);
    assert.match(fs.readFileSync(envFile, 'utf8'), /VERQURY_TELEGRAM_BOT_TOKEN=123:SECRET-abc/);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);

    // Updating replaces the key in place (no duplicate lines).
    api.saveEnvVar('OTHER_KEY', 'keep');
    api.setTelegramToken('999:NEW');
    const txt = fs.readFileSync(envFile, 'utf8');
    assert.equal((txt.match(/VERQURY_TELEGRAM_BOT_TOKEN=/g) || []).length, 1);
    assert.match(txt, /VERQURY_TELEGRAM_BOT_TOKEN=999:NEW/);
    assert.match(txt, /OTHER_KEY=keep/); // sibling preserved
  } finally {
    delete process.env.VERQURY_ENV_FILE;
  }
});

test('getNotifyConfig merges core presence with tokenSet status', () => {
  const root = tmpRoot();
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-env-')), '.env');
  process.env.VERQURY_ENV_FILE = envFile;
  try {
    api.changePresence(root, 'away');
    api.updateNotifyConfig(root, { enabled: true, telegram: { chatId: '42' } });
    const n = api.getNotifyConfig(root);
    assert.equal(n.presence, 'away');
    assert.equal(n.enabled, true);
    assert.equal(n.telegram.chatId, '42');
    assert.equal(n.tokenSet, false);
    api.setTelegramToken('t');
    assert.equal(api.getNotifyConfig(root).tokenSet, true);
  } finally {
    delete process.env.VERQURY_ENV_FILE;
  }
});

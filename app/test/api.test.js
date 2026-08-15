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

test('session metrics come back labelled, and zeroed before a harvest', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Meter', repo: '/repo/meter' });
  const m = api.getSessionMetrics(root, 'meter');
  assert.equal(m.sessions, 0);
  assert.equal(m.activeLabel, '0s');
});

test('harvestProjectSessions returns the refreshed metrics with it', () => {
  const root = tmpRoot();
  const transcripts = fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-app-tx-'));
  const dir = path.join(transcripts, '-repo-meter');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sess-1.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: '2026-08-01T10:00:00.000Z', cwd: '/repo/meter', message: { model: 'm', usage: { output_tokens: 5 } } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-08-01T10:10:00.000Z', cwd: '/repo/meter', message: { model: 'm', usage: { output_tokens: 5 } } }),
  ].join('\n'));

  createProject(root, { name: 'Meter', repo: '/repo/meter' });
  process.env.VERQURY_TRANSCRIPTS_ROOT = transcripts;
  try {
    const r = api.harvestProjectSessions(root, 'meter');
    assert.equal(r.harvested, 1);
    assert.equal(r.metrics.sessions, 1);
    assert.equal(r.metrics.outputTokens, 10);
    assert.equal(r.metrics.activeLabel, '10m'); // gap is under the idle cap, so it all counts
  } finally {
    delete process.env.VERQURY_TRANSCRIPTS_ROOT;
  }
});

/* ---- Harness credential isolation (engineering-notes §17) ---- */
// The regression: the verify harness saved a fixture token through envFilePath(), which
// falls back to the real ~/.claude/.env when VERQURY_ENV_FILE is unset — so a release run
// wiped the owner's live Telegram token. These pin the guard that now prevents it.

function withEnvFileUnset(fn) {
  const prev = process.env.VERQURY_ENV_FILE;
  delete process.env.VERQURY_ENV_FILE;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.VERQURY_ENV_FILE;
    else process.env.VERQURY_ENV_FILE = prev;
  }
}

test('an unset VERQURY_ENV_FILE is redirected into the throwaway root, never the real .env', () => {
  const root = tmpRoot();
  const fakeReal = path.join(tmpRoot(), '.env-real');
  withEnvFileUnset(() => {
    const chosen = api.isolateHarnessEnvFile(root, { realEnv: fakeReal });
    assert.equal(chosen, path.join(root, 'harness.env'));
    assert.equal(api.envFilePath(), path.join(root, 'harness.env')); // saveEnvVar follows it
  });
});

test('an env file aimed AT the real credential store is overridden, not honoured', () => {
  const root = tmpRoot();
  const fakeReal = path.join(tmpRoot(), '.env-real');
  const prev = process.env.VERQURY_ENV_FILE;
  process.env.VERQURY_ENV_FILE = fakeReal; // the exact mistake the release runs made
  try {
    assert.equal(api.isolateHarnessEnvFile(root, { realEnv: fakeReal }), path.join(root, 'harness.env'));
  } finally {
    if (prev === undefined) delete process.env.VERQURY_ENV_FILE;
    else process.env.VERQURY_ENV_FILE = prev;
  }
});

test('an already-safe override is left alone', () => {
  const root = tmpRoot();
  const safe = path.join(tmpRoot(), 'runner-chosen.env');
  const prev = process.env.VERQURY_ENV_FILE;
  process.env.VERQURY_ENV_FILE = safe;
  try {
    assert.equal(api.isolateHarnessEnvFile(root, { realEnv: path.join(tmpRoot(), '.env-real') }), safe);
  } finally {
    if (prev === undefined) delete process.env.VERQURY_ENV_FILE;
    else process.env.VERQURY_ENV_FILE = prev;
  }
});

test('it REFUSES rather than run when the path cannot be moved off the real .env', () => {
  const root = tmpRoot();
  // Pathological: the real store IS where isolation would land, so there is nowhere safe.
  const cornered = path.join(root, 'harness.env');
  withEnvFileUnset(() => {
    assert.throws(() => api.isolateHarnessEnvFile(root, { realEnv: cornered }), /refused to run/);
  });
});

test('envFingerprint detects a rewrite, and is null when there is nothing to protect', () => {
  const root = tmpRoot();
  const f = path.join(root, 'probe.env');
  assert.equal(api.envFingerprint(f), null); // no file → nothing to guard
  fs.writeFileSync(f, 'VERQURY_TELEGRAM_BOT_TOKEN=real\n');
  const before = api.envFingerprint(f);
  assert.ok(before);
  fs.writeFileSync(f, 'VERQURY_TELEGRAM_BOT_TOKEN=123:HARNESS-SECRET\n'); // the wipe
  assert.notEqual(api.envFingerprint(f), before);
});

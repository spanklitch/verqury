import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpRoot } from './helpers.js';
import { createProject } from '../src/projects.js';
import {
  slugifyCwd,
  summarizeTranscript,
  findTranscripts,
  harvestSessions,
  listSessions,
  projectMetrics,
  IDLE_GAP_SECONDS,
} from '../src/sessions.js';

// Build a fake ~/.claude/projects tree. Records are the subset of the real
// transcript shape the harvester actually reads.
function transcriptTree() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-transcripts-'));
}

function writeTranscript(base, dirName, sessionId, records) {
  const dir = path.join(base, dirName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return file;
}

function assistant(timestamp, cwd, usage, model = 'claude-opus-5') {
  return { type: 'assistant', timestamp, cwd, message: { model, usage } };
}

const USAGE = {
  input_tokens: 10,
  output_tokens: 100,
  cache_creation_input_tokens: 1000,
  cache_read_input_tokens: 10000,
};

test('slugifyCwd flattens a path the way Claude Code names its directories', () => {
  assert.equal(slugifyCwd('/home/dev/claude-projects/verqury'), '-home-dev-claude-projects-verqury');
  assert.equal(slugifyCwd('/home/dev'), '-home-dev');
});

test('summarizeTranscript totals tokens and separates active from wall time', () => {
  const base = transcriptTree();
  // Two minutes of work, an 8-hour gap (laptop left open), then one more minute.
  const file = writeTranscript(base, '-repo', 'sess-1', [
    assistant('2026-08-01T10:00:00.000Z', '/repo', USAGE),
    assistant('2026-08-01T10:02:00.000Z', '/repo', USAGE),
    assistant('2026-08-01T18:02:00.000Z', '/repo', USAGE),
    assistant('2026-08-01T18:03:00.000Z', '/repo', USAGE),
  ]);
  const s = summarizeTranscript(file);

  assert.equal(s.sessionId, 'sess-1');
  assert.equal(s.cwd, '/repo');
  assert.equal(s.model, 'claude-opus-5');
  assert.equal(s.inputTokens, 40);
  assert.equal(s.outputTokens, 400);
  assert.equal(s.cacheWrite, 4000);
  assert.equal(s.cacheRead, 40000);

  assert.equal(s.wallSeconds, 8 * 3600 + 180); // first record to last
  // 120s + (8h gap capped at the idle threshold) + 60s
  assert.equal(s.activeSeconds, 120 + IDLE_GAP_SECONDS + 60);
  assert.ok(s.activeSeconds < s.wallSeconds);
});

test('summarizeTranscript survives malformed lines and missing usage', () => {
  const base = transcriptTree();
  const dir = path.join(base, '-repo');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sess-2.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', timestamp: '2026-08-01T10:00:00.000Z', cwd: '/repo' }),
    '{ this is not json',
    JSON.stringify(assistant('2026-08-01T10:01:00.000Z', '/repo', USAGE)),
    JSON.stringify({ type: 'assistant', timestamp: '2026-08-01T10:02:00.000Z', message: {} }),
    '', // trailing blank, as a live-appended file has
  ].join('\n'));

  const s = summarizeTranscript(file);
  assert.equal(s.outputTokens, 100); // only the one record carrying usage
  assert.equal(s.wallSeconds, 120);
});

test('summarizeTranscript returns null when there is nothing to measure', () => {
  const base = transcriptTree();
  const file = writeTranscript(base, '-repo', 'empty', []);
  assert.equal(summarizeTranscript(file), null);
  assert.equal(summarizeTranscript(path.join(base, 'nope.jsonl')), null);
});

test('findTranscripts matches on cwd, including subdirectories, and rejects neighbours', () => {
  const base = transcriptTree();
  writeTranscript(base, '-repo-mine', 'a', [assistant('2026-08-01T10:00:00.000Z', '/repo/mine', USAGE)]);
  writeTranscript(base, '-repo-mine-app', 'b', [assistant('2026-08-01T11:00:00.000Z', '/repo/mine/app', USAGE)]);
  // A sibling whose path merely starts with the same string — must NOT match.
  writeTranscript(base, '-repo-mine-other', 'c', [assistant('2026-08-01T12:00:00.000Z', '/repo/mine-other', USAGE)]);

  // Discovery order is incidental (sessions are ordered by start time later).
  const found = findTranscripts('/repo/mine', { transcriptsRoot: base })
    .map((f) => path.basename(f))
    .sort();
  assert.deepEqual(found, ['a.jsonl', 'b.jsonl']);
});

test('harvest writes one record per session, is idempotent, and rolls up', () => {
  const root = tmpRoot();
  const base = transcriptTree();
  createProject(root, { name: 'Proj', repo: '/repo/proj' });

  writeTranscript(base, '-repo-proj', 'sess-a', [
    assistant('2026-08-01T10:00:00.000Z', '/repo/proj', USAGE),
    assistant('2026-08-01T10:05:00.000Z', '/repo/proj', USAGE),
  ]);
  writeTranscript(base, '-repo-proj', 'sess-b', [
    assistant('2026-08-02T10:00:00.000Z', '/repo/proj', USAGE),
    assistant('2026-08-02T10:10:00.000Z', '/repo/proj', USAGE),
  ]);

  const first = harvestSessions(root, 'proj', { transcriptsRoot: base });
  assert.equal(first.harvested, 2);
  assert.ok(fs.existsSync(path.join(root, 'projects', 'proj', 'sessions', 'sess-a.md')));

  // Re-harvesting updates in place rather than duplicating — the session id is the filename.
  const second = harvestSessions(root, 'proj', { transcriptsRoot: base });
  assert.equal(second.harvested, 2);
  assert.equal(fs.readdirSync(path.join(root, 'projects', 'proj', 'sessions')).length, 2);

  const listed = listSessions(root, { project: 'proj' });
  assert.deepEqual(listed.map((s) => s.sessionId), ['sess-a', 'sess-b']); // sorted by start

  const m = projectMetrics(root, 'proj');
  assert.equal(m.sessions, 2);
  assert.equal(m.activeSeconds, 300 + 600);
  assert.equal(m.outputTokens, 400);
  assert.equal(m.cacheRead, 40000);
  assert.equal(m.firstStarted, '2026-08-01T10:00:00.000Z');
  assert.equal(m.lastEnded, '2026-08-02T10:10:00.000Z');
});

test('harvest is a no-op for a project with no repo, and rejects unknown projects', () => {
  const root = tmpRoot();
  const base = transcriptTree();
  createProject(root, { name: 'NoRepo' });
  assert.equal(harvestSessions(root, 'norepo', { transcriptsRoot: base }).harvested, 0);
  assert.throws(() => harvestSessions(root, 'ghost', { transcriptsRoot: base }), /No such project/);
});

test('metrics are zeroed, not undefined, before anything is harvested', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Fresh', repo: '/repo/fresh' });
  const m = projectMetrics(root, 'fresh');
  assert.equal(m.sessions, 0);
  assert.equal(m.activeSeconds, 0);
  assert.equal(m.firstStarted, null);
  assert.deepEqual(listSessions(root, { project: 'fresh' }), []);
});

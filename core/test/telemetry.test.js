import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpRoot } from './helpers.js';
import { createProject } from '../src/projects.js';
import { projectPaths } from '../src/paths.js';
import { readDoc } from '../src/frontmatter.js';
import { harvestSessions, listSessions, projectMetrics } from '../src/sessions.js';
import { parseOtlpMetrics, projectForSession, ingestOtlp } from '../src/telemetry.js';

// Shape of a real OTLP/HTTP JSON export, reduced to the parts we read. Field names and
// the cumulative-counter behaviour were captured from a live Claude Code session.
function payload(sessionId, { added = 6, removed = 0, cost = 0.0133265 } = {}) {
  const dp = (value, attrs) => ({
    asInt: typeof value === 'number' && Number.isInteger(value) ? String(value) : undefined,
    asDouble: Number.isInteger(value) ? undefined : value,
    attributes: Object.entries({ 'session.id': sessionId, ...attrs }).map(([key, v]) => ({
      key,
      value: typeof v === 'string' ? { stringValue: v } : { intValue: v },
    })),
  });
  return {
    resourceMetrics: [{
      scopeMetrics: [{
        metrics: [
          { name: 'claude_code.lines_of_code.count', sum: { dataPoints: [dp(added, { type: 'added' }), dp(removed, { type: 'removed' })] } },
          { name: 'claude_code.cost.usage', sum: { dataPoints: [dp(cost, {})] } },
          { name: 'claude_code.session.count', sum: { dataPoints: [dp(1, {})] } },
        ],
      }],
    }],
  };
}

// A transcripts tree with one session file whose cwd is inside `repo` — the join that
// tells telemetry (which carries no cwd) which project a session belongs to.
function transcriptFor(sessionId, repo) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-tx-'));
  const dir = path.join(base, String(repo).replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'user', cwd: repo, timestamp: '2026-08-10T10:00:00Z' },
    { type: 'assistant', cwd: repo, timestamp: '2026-08-10T10:05:00Z', message: { model: 'claude-opus-5', usage: { output_tokens: 3 } } },
  ];
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return base;
}

test('parseOtlpMetrics pulls lines of code and cost out of a real-shaped payload', () => {
  const [sample] = parseOtlpMetrics(payload('sess-1'));
  assert.equal(sample.sessionId, 'sess-1');
  assert.equal(sample.linesAdded, 6);
  assert.equal(sample.linesRemoved, 0);
  assert.equal(sample.costUsd, 0.0133265);
});

test('the counters are cumulative, so a later export REPLACES an earlier one', () => {
  // One short session produced three exports, each carrying the running total. Summing
  // them would triple-count — the whole reason this is last-value-wins.
  const root = tmpRoot();
  createProject(root, { name: 'Aurora', stage: 'build', status: 'active', repo: '/repo/aurora' });
  const transcriptsRoot = transcriptFor('sess-2', '/repo/aurora');

  ingestOtlp(root, payload('sess-2', { added: 6, cost: 0.01 }), { transcriptsRoot });
  ingestOtlp(root, payload('sess-2', { added: 19, cost: 0.04 }), { transcriptsRoot });

  const [session] = listSessions(root, { project: 'aurora' });
  assert.equal(session.linesAdded, 19); // not 25
  assert.equal(session.costUsd, 0.04); // not 0.05
});

test('a session is attributed to its project through the transcript, not the payload', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Aurora', stage: 'build', status: 'active', repo: '/repo/aurora' });
  createProject(root, { name: 'Borealis', stage: 'build', status: 'active', repo: '/repo/borealis' });
  const transcriptsRoot = transcriptFor('sess-3', '/repo/borealis');

  assert.equal(projectForSession(root, 'sess-3', { transcriptsRoot }), 'borealis');
  const res = ingestOtlp(root, payload('sess-3'), { transcriptsRoot });
  assert.equal(res.applied, 1);
  assert.equal(listSessions(root, { project: 'aurora' }).length, 0);
  assert.equal(listSessions(root, { project: 'borealis' })[0].linesAdded, 6);
});

test('a session belonging to no known project is counted, not guessed at', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Aurora', stage: 'build', status: 'active', repo: '/repo/aurora' });
  const transcriptsRoot = transcriptFor('sess-4', '/somewhere/else');
  const res = ingestOtlp(root, payload('sess-4'), { transcriptsRoot });
  assert.deepEqual(res, { applied: 0, unmatched: 1 });
});

test('harvesting after telemetry does not wipe the telemetry columns (and vice versa)', () => {
  // The two writers come at one record from opposite ends. This is the regression that
  // would otherwise be silent: re-harvest, and the lines-of-code number vanishes.
  const root = tmpRoot();
  createProject(root, { name: 'Aurora', stage: 'build', status: 'active', repo: '/repo/aurora' });
  const transcriptsRoot = transcriptFor('sess-5', '/repo/aurora');

  ingestOtlp(root, payload('sess-5', { added: 42 }), { transcriptsRoot });
  harvestSessions(root, 'aurora', { transcriptsRoot });

  const [session] = listSessions(root, { project: 'aurora' });
  assert.equal(session.linesAdded, 42); // survived the harvest
  assert.equal(session.outputTokens, 3); // and the harvest still wrote its own columns
  assert.ok(session.started);

  // Now the other direction: telemetry landing on an already-harvested record.
  ingestOtlp(root, payload('sess-5', { added: 50 }), { transcriptsRoot });
  const [after] = listSessions(root, { project: 'aurora' });
  assert.equal(after.linesAdded, 50);
  assert.equal(after.outputTokens, 3); // harvest columns survived the telemetry write
});

test('telemetry can land before the transcript is ever harvested', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Aurora', stage: 'build', status: 'active', repo: '/repo/aurora' });
  const transcriptsRoot = transcriptFor('sess-6', '/repo/aurora');
  ingestOtlp(root, payload('sess-6'), { transcriptsRoot });
  const file = path.join(projectPaths(root, 'aurora').sessions, 'sess-6.md');
  assert.ok(fs.existsSync(file));
  assert.equal(readDoc(file).data.linesAdded, 6);
});

test('projectMetrics reports LOC as a floor, with the date it started counting', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Aurora', stage: 'build', status: 'active', repo: '/repo/aurora' });
  const transcriptsRoot = transcriptFor('sess-7', '/repo/aurora');
  harvestSessions(root, 'aurora', { transcriptsRoot }); // a session with NO telemetry
  ingestOtlp(root, payload('sess-7', { added: 12, removed: 4 }), { transcriptsRoot });

  const m = projectMetrics(root, 'aurora');
  assert.equal(m.linesAdded, 12);
  assert.equal(m.linesRemoved, 4);
  assert.equal(m.locSessions, 1); // only sessions that actually reported count
  assert.ok(m.locSince, 'a start date is required — a bare LOC number would imply completeness');
  assert.equal(m.sessions, 1);
});

test('a malformed or foreign payload yields nothing rather than throwing', () => {
  // This runs on a network boundary; the input is not ours to trust.
  assert.deepEqual(parseOtlpMetrics('not json at all'), []);
  assert.deepEqual(parseOtlpMetrics({}), []);
  assert.deepEqual(parseOtlpMetrics({ resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'x' }] }] }] }), []);
  // A datapoint with no session.id cannot be attributed, so it is dropped, not guessed.
  const orphan = { resourceMetrics: [{ scopeMetrics: [{ metrics: [
    { name: 'claude_code.lines_of_code.count', sum: { dataPoints: [{ asInt: '5', attributes: [{ key: 'type', value: { stringValue: 'added' } }] }] } },
  ] }] }] };
  assert.deepEqual(parseOtlpMetrics(orphan), []);
});

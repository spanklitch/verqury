// Telemetry ingest (ADR-0014). Claude Code exports OpenTelemetry metrics that the
// transcripts cannot supply — lines of code, and cost in real USD — and pushes them
// over OTLP/HTTP as JSON. This module is the whole contract with that format: parse a
// payload, resolve which project the session belongs to, and merge the numbers into
// the per-session record ADR-0013 already writes. Nothing else reads OTLP.
//
// Two things about the format are load-bearing and NOT in the docs, both learned by
// capturing real payloads (engineering-notes §15):
//
//   1. Counters are CUMULATIVE and re-exported on every interval. One short session
//      produced three exports, each carrying the running total. Summing them would
//      triple-count, so the merge is LAST-VALUE-WINS per session + attribute.
//   2. The payload carries `session.id` but NO cwd, so it cannot say which project it
//      belongs to. The transcript can: it is named <session-id>.jsonl and holds the
//      cwd. So telemetry is joined to a project THROUGH the transcript — a join this
//      module verified on live data before relying on it (ADR-0014 decision 6).
import fs from 'node:fs';
import path from 'node:path';
import { projectPaths, transcriptsRoot } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { listProjects } from './projects.js';
import { readConfig, writeConfig } from './config.js';
import { findTranscripts } from './sessions.js';

const num = (dp) => (typeof dp.asInt === 'string' ? Number(dp.asInt) : (dp.asInt ?? dp.asDouble ?? 0));

function attrs(dp) {
  const out = {};
  for (const a of dp.attributes ?? []) {
    const v = a.value ?? {};
    out[a.key] = v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? null;
  }
  return out;
}

// Reduce one OTLP/HTTP JSON export into per-session numbers. Never throws on shape:
// an unrecognised payload yields no samples rather than an error, because this runs
// on a network boundary where the input is not ours to trust.
export function parseOtlpMetrics(payload) {
  let doc = payload;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch {
      return [];
    }
  }
  const bySession = new Map();
  const touch = (id) => {
    if (!bySession.has(id)) bySession.set(id, { sessionId: id });
    return bySession.get(id);
  };

  for (const rm of doc?.resourceMetrics ?? []) {
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        const points = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
        for (const dp of points) {
          const a = attrs(dp);
          const id = a['session.id'];
          if (!id) continue; // a datapoint we cannot attribute is a datapoint we drop
          const s = touch(id);
          const value = num(dp);
          // Last value wins: these are cumulative counters, not deltas (see header).
          if (metric.name === 'claude_code.lines_of_code.count') {
            if (a.type === 'added') s.linesAdded = value;
            else if (a.type === 'removed') s.linesRemoved = value;
          } else if (metric.name === 'claude_code.cost.usage') {
            s.costUsd = value;
          }
        }
      }
    }
  }
  return [...bySession.values()];
}

// Which project owns a session? The payload cannot say, so ask the transcript: it is
// named <session-id>.jsonl and its cwd decides (the same rule harvesting uses, so a
// session started in a repo SUBDIRECTORY resolves identically).
export function projectForSession(root, sessionId, opts = {}) {
  const base = transcriptsRoot(opts.transcriptsRoot);
  if (!fs.existsSync(base)) return null;
  for (const project of listProjects(root)) {
    if (!project.repo) continue;
    for (const file of findTranscripts(project.repo, opts)) {
      if (path.basename(file) === `${sessionId}.jsonl`) return project.slug;
    }
  }
  return null;
}

// Merge parsed samples into the per-session records. Telemetry may arrive before the
// transcript is ever harvested, so a missing record is CREATED with just these fields;
// a later harvest fills in the timing and token columns around them.
export function applyTelemetry(root, samples, opts = {}) {
  let applied = 0;
  let unmatched = 0;

  for (const sample of samples) {
    const slug = opts.project ?? projectForSession(root, sample.sessionId, opts);
    if (!slug) {
      unmatched += 1; // a session outside every known project — nothing to attribute it to
      continue;
    }
    const dir = projectPaths(root, slug).sessions;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${sample.sessionId}.md`);

    let data = { sessionId: sample.sessionId, project: slug };
    let body = '';
    if (fs.existsSync(file)) {
      const doc = readDoc(file);
      data = { ...doc.data };
      body = doc.body;
    }
    for (const key of ['linesAdded', 'linesRemoved', 'costUsd']) {
      if (sample[key] !== undefined) data[key] = sample[key];
    }
    data.telemetryAt = new Date().toISOString();
    writeDoc(file, data, body);
    applied += 1;
  }

  return { applied, unmatched };
}

// The whole ingest path in one call: raw request body → records on disk.
export function ingestOtlp(root, payload, opts = {}) {
  return applyTelemetry(root, parseOtlpMetrics(payload), opts);
}

// ---- Settings (config.json, same shape as notify) ----
// OFF by default and loopback-only, both deliberate (ADR-0014 decision 4): the app
// must behave identically with the receiver disabled, and the port is configurable
// because binding OTLP's conventional 4318 unconditionally would collide with any
// real collector on the machine.
export function defaultTelemetry() {
  return { enabled: false, port: 4318 };
}

export function getTelemetry(root) {
  let stored = {};
  try {
    stored = readConfig(root).telemetry ?? {};
  } catch {
    stored = {};
  }
  return { ...defaultTelemetry(), ...stored };
}

export function updateTelemetry(root, patch = {}) {
  const config = readConfig(root);
  config.telemetry = { ...(config.telemetry ?? {}), ...patch };
  writeConfig(root, config);
  return getTelemetry(root);
}

// The environment a Verqury-launched session needs for its metrics to reach us.
// Enablement is Verqury-only by decision (ADR-0014 decision 5): a session started
// anywhere else is not counted, and nothing pretends otherwise.
//
// The endpoint MUST be the per-signal variable carrying the full /v1/metrics path.
// The generic OTEL_EXPORTER_OTLP_ENDPOINT is gRPC-only, and pointing it at an
// http/json receiver silently exports nothing (engineering-notes §15).
export function telemetryEnv(root) {
  const cfg = getTelemetry(root);
  if (!cfg.enabled) return {};
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `http://127.0.0.1:${cfg.port}/v1/metrics`,
    // Identity attributes are dropped at the source (ADR-0014 decision 8) — the
    // standard set includes user.email and this repo is public.
    OTEL_METRICS_INCLUDE_ACCOUNT_UUID: 'false',
    OTEL_METRICS_INCLUDE_SESSION_ID: 'true', // the join key; without it nothing attributes
  };
}

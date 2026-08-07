// Session metrics (ADR-0013). Claude Code writes one JSONL transcript per session;
// we harvest it into projects/<slug>/sessions/<session-id>.md so the numbers become
// file-backed truth (ADR-0001) that outlives the transcript format.
//
// The transcript CONTENTS are an undocumented internal format — only the path is
// documented. That risk is contained here: nothing else in the codebase reads a
// transcript, and parsing degrades to a partial record rather than throwing.
import fs from 'node:fs';
import path from 'node:path';
import { projectPaths, transcriptsRoot } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { listProjects } from './projects.js';

// A gap longer than this is someone walking away, not thinking. Measured against
// this project's own transcripts, wall-clock reads ~5x active time without it.
export const IDLE_GAP_SECONDS = 15 * 60;

// How far into a transcript to look for the `cwd` that identifies its project.
// It lands on line 3-4 in practice; the cap keeps a malformed file cheap.
const CWD_SCAN_LINES = 50;

// Claude Code names a transcript directory after the cwd with the separators
// flattened. Used only to find candidate files fast — `cwd` inside the file is
// what actually decides, so an unknown edge case in this rule costs speed, not
// correctness.
export function slugifyCwd(dir) {
  return String(dir).replace(/[^a-zA-Z0-9]/g, '-');
}

// Compact build-time reading shared by the CLI and the app meter.
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A truncated or half-written line is expected: the transcript is appended
      // to live. Skip it rather than losing the whole session.
    }
  }
  return out;
}

function readCwd(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const head = text.split('\n', CWD_SCAN_LINES).join('\n');
  for (const rec of parseLines(head)) {
    if (rec.cwd) return rec.cwd;
  }
  return null;
}

// A session belongs to a project if it ran in the project's repo or below it.
function underRepo(cwd, repo) {
  if (!cwd || !repo) return false;
  const a = path.resolve(cwd);
  const b = path.resolve(repo);
  return a === b || a.startsWith(`${b}${path.sep}`);
}

// Reduce one transcript to its numbers. Never throws on bad content.
export function summarizeTranscript(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const stamps = [];
  let cwd = null;
  let model = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWrite = 0;
  let cacheRead = 0;

  for (const rec of parseLines(text)) {
    if (!cwd && rec.cwd) cwd = rec.cwd;
    const t = Date.parse(rec.timestamp ?? '');
    if (!Number.isNaN(t)) stamps.push(t);
    if (rec.type !== 'assistant') continue;
    const message = rec.message ?? {};
    if (message.model) model = message.model;
    const u = message.usage;
    if (!u) continue;
    inputTokens += u.input_tokens ?? 0;
    outputTokens += u.output_tokens ?? 0;
    cacheWrite += u.cache_creation_input_tokens ?? 0;
    cacheRead += u.cache_read_input_tokens ?? 0;
  }

  if (!stamps.length) return null;
  stamps.sort((a, b) => a - b);

  let activeMs = 0;
  for (let i = 1; i < stamps.length; i += 1) {
    activeMs += Math.min(stamps[i] - stamps[i - 1], IDLE_GAP_SECONDS * 1000);
  }

  return {
    sessionId: path.basename(file).replace(/\.jsonl$/, ''),
    cwd,
    model,
    started: new Date(stamps[0]).toISOString(),
    ended: new Date(stamps[stamps.length - 1]).toISOString(),
    activeSeconds: Math.round(activeMs / 1000),
    wallSeconds: Math.round((stamps[stamps.length - 1] - stamps[0]) / 1000),
    inputTokens,
    outputTokens,
    cacheWrite,
    cacheRead,
  };
}

// Transcript directories worth opening for a repo. A session run from a
// SUBDIRECTORY of the repo gets its own directory, so match on the slug as a
// prefix rather than exactly — otherwise those sessions vanish. The prefix only
// narrows the search; `cwd` inside each file still decides, which is what
// rejects a same-prefix neighbour like /repo/mine-other. Falls back to scanning
// everything if the slug rule matches nothing.
function candidateDirs(base, repo) {
  if (!fs.existsSync(base)) return [];
  let dirs;
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  const prefix = slugifyCwd(repo);
  const narrowed = dirs.filter((d) => d.name.startsWith(prefix));
  return (narrowed.length ? narrowed : dirs).map((d) => path.join(base, d.name));
}

export function findTranscripts(repo, opts = {}) {
  if (!repo) return [];
  const base = transcriptsRoot(opts.transcriptsRoot);
  const found = [];
  for (const dir of candidateDirs(base, repo)) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      if (underRepo(readCwd(file), repo)) found.push(file);
    }
  }
  return found.sort();
}

function sessionBody(s) {
  const hours = (s.activeSeconds / 3600).toFixed(1);
  return `Claude Code session in ${s.cwd ?? 'unknown'} — ${hours}h active, `
    + `${s.outputTokens.toLocaleString('en-US')} output tokens${s.model ? ` (${s.model})` : ''}.\n`;
}

// Read every transcript belonging to a project and write one record per session.
// Idempotent: the session id is the filename, so re-harvesting updates in place.
export function harvestSessions(root, projectSlug, opts = {}) {
  const project = listProjects(root).find((p) => p.slug === projectSlug);
  if (!project) throw new Error(`No such project: ${projectSlug}`);
  if (!project.repo) return { harvested: 0, skipped: 0, sessions: [] };

  const dir = projectPaths(root, projectSlug).sessions;
  const sessions = [];
  let skipped = 0;

  for (const file of findTranscripts(project.repo, opts)) {
    const summary = summarizeTranscript(file);
    if (!summary) {
      skipped += 1;
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    const data = {
      ...summary,
      project: projectSlug,
      harvested: new Date().toISOString(),
    };
    writeDoc(path.join(dir, `${summary.sessionId}.md`), data, sessionBody(summary));
    sessions.push(data);
  }

  return { harvested: sessions.length, skipped, sessions };
}

export function listSessions(root, { project } = {}) {
  const slugs = project ? [project] : listProjects(root).map((p) => p.slug);
  const out = [];
  for (const slug of slugs) {
    const dir = projectPaths(root, slug).sessions;
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const { data } = readDoc(path.join(dir, name));
      out.push({
        sessionId: data.sessionId ?? name.replace(/\.md$/, ''),
        project: data.project ?? slug,
        started: data.started ?? null,
        ended: data.ended ?? null,
        activeSeconds: data.activeSeconds ?? 0,
        wallSeconds: data.wallSeconds ?? 0,
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        cacheWrite: data.cacheWrite ?? 0,
        cacheRead: data.cacheRead ?? 0,
        model: data.model ?? null,
      });
    }
  }
  return out.sort((a, b) => String(a.started).localeCompare(String(b.started)));
}

// Roll a project's sessions up into the numbers the meter shows. Token counts stay
// separate on purpose — cache reads dwarf the rest and are the cheapest tokens, so
// one summed "tokens" figure would mislead (ADR-0013).
export function projectMetrics(root, projectSlug) {
  const sessions = listSessions(root, { project: projectSlug });
  const total = {
    sessions: sessions.length,
    activeSeconds: 0,
    wallSeconds: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite: 0,
    cacheRead: 0,
    firstStarted: sessions[0]?.started ?? null,
    lastEnded: null,
  };
  for (const s of sessions) {
    total.activeSeconds += s.activeSeconds;
    total.wallSeconds += s.wallSeconds;
    total.inputTokens += s.inputTokens;
    total.outputTokens += s.outputTokens;
    total.cacheWrite += s.cacheWrite;
    total.cacheRead += s.cacheRead;
    if (!total.lastEnded || String(s.ended) > total.lastEnded) total.lastEnded = s.ended;
  }
  return total;
}

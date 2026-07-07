// Project memory: append-oriented log entries and numbered decision records
// (ADR-lite). Pure file I/O (ADR-0001).
import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { slugify } from './slug.js';
import { DECISION_STATUSES, assertEnum, today } from './schema.js';

function ensureProject(root, slug) {
  const p = projectPaths(root, slug);
  if (!fs.existsSync(p.file)) throw new Error(`No such project: ${slug}`);
  return p;
}

export function addLog(root, projectSlug, { text, title } = {}) {
  if (!text || !String(text).trim()) throw new Error('Log text is required');
  const p = ensureProject(root, projectSlug);
  fs.mkdirSync(p.log, { recursive: true });

  const date = today();
  // Slug from title, else a time-of-day token so multiple untitled entries differ.
  const stem = title ? slugify(title) : new Date().toISOString().slice(11, 19).replace(/:/g, '');
  const name = `${date}-${stem || 'note'}`;
  let file = path.join(p.log, `${name}.md`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(p.log, `${name}-${n}.md`);

  const data = { date, title: title ?? null, kind: 'log' };
  writeDoc(file, data, text.endsWith('\n') ? text : `${text}\n`);
  return { project: projectSlug, date, title: title ?? null, path: file };
}

export function addDecision(root, projectSlug, { title, body = '', status = 'accepted' } = {}) {
  if (!title || !String(title).trim()) throw new Error('Decision title is required');
  assertEnum(status, DECISION_STATUSES, 'decision status');
  const p = ensureProject(root, projectSlug);
  fs.mkdirSync(p.decisions, { recursive: true });

  const existing = fs.readdirSync(p.decisions).filter((f) => /^\d+-/.test(f));
  const nums = existing.map((f) => parseInt(f, 10)).filter(Number.isFinite);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const num = String(next).padStart(3, '0');
  const stem = slugify(title) || 'decision';
  const file = path.join(p.decisions, `${num}-${stem}.md`);

  const data = { number: next, title, date: today(), status, kind: 'decision' };
  writeDoc(file, data, body || '## Context\n\n## Decision\n\n## Consequences\n');
  return { project: projectSlug, number: next, title, path: file };
}

export function listLog(root, projectSlug) {
  const p = ensureProject(root, projectSlug);
  if (!fs.existsSync(p.log)) return [];
  return fs.readdirSync(p.log)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const file = path.join(p.log, f);
      const { data, body } = readDoc(file);
      return { type: 'log', date: data.date ?? f.slice(0, 10), title: data.title ?? null, body, path: file };
    });
}

export function listDecisions(root, projectSlug) {
  const p = ensureProject(root, projectSlug);
  if (!fs.existsSync(p.decisions)) return [];
  return fs.readdirSync(p.decisions)
    .filter((f) => /^\d+-/.test(f) && f.endsWith('.md'))
    .map((f) => {
      const file = path.join(p.decisions, f);
      const { data, body } = readDoc(file);
      return {
        type: 'decision',
        number: data.number ?? parseInt(f, 10),
        date: data.date ?? null,
        title: data.title ?? f,
        status: data.status ?? null,
        body,
        path: file,
      };
    });
}

// Log entries and decisions merged newest-first for the project detail view.
export function projectTimeline(root, projectSlug) {
  return [...listLog(root, projectSlug), ...listDecisions(root, projectSlug)].sort((a, b) => {
    const byDate = String(b.date ?? '').localeCompare(String(a.date ?? ''));
    return byDate !== 0 ? byDate : String(b.path).localeCompare(String(a.path));
  });
}

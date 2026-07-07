// Project memory: append-oriented log entries and numbered decision records
// (ADR-lite). Pure file I/O (ADR-0001).
import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from './paths.js';
import { writeDoc } from './frontmatter.js';
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

// Project registry: create/list/show + stage tracking. Pure file I/O (ADR-0001);
// the caller (CLI/app) is responsible for refreshing the search index.
import fs from 'node:fs';
import path from 'node:path';
import { projectsDir, projectPaths } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { slugify } from './slug.js';
import { STAGES, STATUSES, assertEnum, today } from './schema.js';

const SUBDIRS = ['guidance', 'memory/decisions', 'memory/log', 'artifacts', 'tasks', 'packets'];

export function createProject(root, { name, slug, stage = 'concept', status = 'active', repo = null, links = [], body } = {}) {
  if (!name || !String(name).trim()) throw new Error('Project name is required');
  const finalSlug = slugify(slug || name);
  if (!finalSlug) throw new Error(`Could not derive a slug from "${name}"`);
  assertEnum(stage, STAGES, 'stage');
  assertEnum(status, STATUSES, 'status');

  const p = projectPaths(root, finalSlug);
  if (fs.existsSync(p.base)) throw new Error(`Project already exists: ${finalSlug}`);
  for (const sub of SUBDIRS) fs.mkdirSync(path.join(p.base, sub), { recursive: true });

  const data = { name, slug: finalSlug, created: today(), stage, status, repo, links };
  const finalBody = body && body.trim()
    ? (body.endsWith('\n') ? body : `${body}\n`)
    : `# ${name}\n\n_Narrative — the concept, current thinking, and where this project stands._\n`;
  writeDoc(p.file, data, finalBody);
  return { ...data, path: p.file };
}

export function listProjects(root) {
  const dir = projectsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const file = projectPaths(root, d.name).file;
      if (!fs.existsSync(file)) return null;
      const { data } = readDoc(file);
      return {
        slug: d.name,
        name: data.name ?? d.name,
        stage: data.stage ?? null,
        status: data.status ?? null,
        repo: data.repo ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function showProject(root, slug) {
  const p = projectPaths(root, slug);
  if (!fs.existsSync(p.file)) throw new Error(`No such project: ${slug}`);
  const { data, body } = readDoc(p.file);
  return { ...data, slug, body, path: p.file };
}

export function setNarrative(root, slug, body) {
  const p = projectPaths(root, slug);
  if (!fs.existsSync(p.file)) throw new Error(`No such project: ${slug}`);
  const { data } = readDoc(p.file);
  writeDoc(p.file, data, body.endsWith('\n') ? body : `${body}\n`);
  return { slug };
}

export function setStage(root, slug, stage) {
  assertEnum(stage, STAGES, 'stage');
  const p = projectPaths(root, slug);
  if (!fs.existsSync(p.file)) throw new Error(`No such project: ${slug}`);
  const { data, body } = readDoc(p.file);
  data.stage = stage;
  writeDoc(p.file, data, body);
  return { ...data, slug };
}

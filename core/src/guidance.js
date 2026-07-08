// Guidance library: reusable markdown assets (skills, standards, instructions,
// templates), either global or scoped to a project. Pure file I/O (ADR-0001).
import fs from 'node:fs';
import path from 'node:path';
import { globalGuidanceDir, projectPaths } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { slugify } from './slug.js';
import { GUIDANCE_KINDS, assertEnum, today } from './schema.js';
import { listProjects } from './projects.js';

// scope is 'global' (or falsy) for the top-level library, else a project slug.
function guidanceDirFor(root, scope) {
  if (!scope || scope === 'global') return globalGuidanceDir(root);
  const p = projectPaths(root, scope);
  if (!fs.existsSync(p.base)) throw new Error(`No such project: ${scope}`);
  return p.guidance;
}

export function addGuidance(root, { scope = 'global', title, slug, kind, tags = [], body = '' } = {}) {
  if (!title || !String(title).trim()) throw new Error('Guidance title is required');
  assertEnum(kind, GUIDANCE_KINDS, 'kind');
  const finalSlug = slugify(slug || title);
  if (!finalSlug) throw new Error(`Could not derive a slug from "${title}"`);

  const dir = guidanceDirFor(root, scope);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${finalSlug}.md`);
  if (fs.existsSync(file)) throw new Error(`Guidance already exists: ${scope}/${finalSlug}`);

  const now = today();
  const data = { title, slug: finalSlug, kind, tags, created: now, updated: now };
  writeDoc(file, data, body || `# ${title}\n`);
  return { scope, ...data, path: file };
}

export function listGuidance(root, { scope = 'global' } = {}) {
  const dir = guidanceDirFor(root, scope);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .map((n) => {
      const { data } = readDoc(path.join(dir, n));
      return {
        scope,
        slug: data.slug ?? n.replace(/\.md$/, ''),
        title: data.title ?? n,
        kind: data.kind ?? null,
        tags: data.tags ?? [],
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function showGuidance(root, scope, slug) {
  const dir = guidanceDirFor(root, scope);
  const file = path.join(dir, `${slugify(slug)}.md`);
  if (!fs.existsSync(file)) throw new Error(`No such guidance: ${scope}/${slug}`);
  const { data, body } = readDoc(file);
  return { scope, ...data, slug: data.slug ?? slug, body, path: file };
}

// Global guidance plus every project's guidance, for the unified library view.
export function setGuidanceBody(root, scope, slug, body) {
  const dir = guidanceDirFor(root, scope);
  const file = path.join(dir, `${slugify(slug)}.md`);
  if (!fs.existsSync(file)) throw new Error(`No such guidance: ${scope}/${slug}`);
  const { data } = readDoc(file);
  data.updated = today();
  writeDoc(file, data, body.endsWith('\n') ? body : `${body}\n`);
  return { scope, slug };
}

export function listAllGuidance(root) {
  const all = listGuidance(root, { scope: 'global' });
  for (const p of listProjects(root)) all.push(...listGuidance(root, { scope: p.slug }));
  return all;
}

// Move a project-scoped guidance file up into the global library (ADR-0001: it is
// literally a file move + a bumped `updated` date).
export function promoteGuidance(root, projectSlug, slug) {
  const finalSlug = slugify(slug);
  const src = path.join(guidanceDirFor(root, projectSlug), `${finalSlug}.md`);
  if (!fs.existsSync(src)) throw new Error(`No such guidance: ${projectSlug}/${finalSlug}`);
  const destDir = globalGuidanceDir(root);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${finalSlug}.md`);
  if (fs.existsSync(dest)) throw new Error(`Global guidance already exists: ${finalSlug}`);

  const { data, body } = readDoc(src);
  data.updated = today();
  writeDoc(dest, data, body);
  fs.rmSync(src);
  return { scope: 'global', slug: finalSlug, path: dest };
}

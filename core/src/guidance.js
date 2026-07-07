// Guidance library: reusable markdown assets (skills, standards, instructions,
// templates), either global or scoped to a project. Pure file I/O (ADR-0001).
import fs from 'node:fs';
import path from 'node:path';
import { globalGuidanceDir, projectPaths } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { slugify } from './slug.js';
import { GUIDANCE_KINDS, assertEnum, today } from './schema.js';

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

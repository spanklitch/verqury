// Artifact inbox: captured prompts, commands, snippets, reports, notes, and URLs
// become durable per-project files (plan §3). Stored at
// projects/<slug>/artifacts/YYYY-MM/<ulid>.md. The body is the captured content
// VERBATIM (not fenced) so copy-back round-trips exactly and agents read it clean;
// `kind` in the frontmatter signals whether it's code. Pure file I/O (ADR-0001).
import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { ulid } from './ids.js';
import { listProjects } from './projects.js';
import { ARTIFACT_KINDS, ARTIFACT_SOURCES, assertEnum } from './schema.js';

function ensureProject(root, slug) {
  const p = projectPaths(root, slug);
  if (!fs.existsSync(p.file)) throw new Error(`No such project: ${slug}`);
  return p;
}

// Best-effort classification of a captured fragment. 'prompt'/'report' are set
// deliberately (by source), never guessed.
export function guessKind(content) {
  const t = String(content ?? '').trim();
  if (!t) return 'note';
  if (/^https?:\/\/\S+$/.test(t)) return 'url';
  if (/^```/.test(t)) return 'snippet';
  const first = t.split('\n', 1)[0];
  if (/^(\$\s|#\s|sudo\b|npm\b|npx\b|yarn\b|pnpm\b|git\b|cd\s|ls\b|mkdir\b|rm\s|cp\s|mv\s|node\b|python3?\b|pip3?\b|docker\b|kubectl\b|curl\b|wget\b|brew\b|apt\b|make\b|bash\b|sh\s|echo\b|cat\b|grep\b|sed\b|awk\b)/.test(first)) {
    return 'command';
  }
  if (/\n/.test(t) && /[{}();]|=>|\b(function|const|let|var|import|export|def|class|return)\b/.test(t)) {
    return 'snippet';
  }
  return 'note';
}

export function addArtifact(root, projectSlug, { content, kind, source = 'clipboard', tags = [], title } = {}) {
  if (!content || !String(content).trim()) throw new Error('Artifact content is required');
  const p = ensureProject(root, projectSlug);
  const finalKind = kind ?? guessKind(content);
  assertEnum(finalKind, ARTIFACT_KINDS, 'artifact kind');
  assertEnum(source, ARTIFACT_SOURCES, 'artifact source');

  const captured = new Date().toISOString();
  const dir = path.join(p.artifacts, captured.slice(0, 7)); // YYYY-MM
  fs.mkdirSync(dir, { recursive: true });

  let id = ulid();
  let file = path.join(dir, `${id}.md`);
  while (fs.existsSync(file)) {
    id = ulid();
    file = path.join(dir, `${id}.md`);
  }

  const data = { id, captured, source, kind: finalKind, project: projectSlug, tags, title: title ?? null };
  writeDoc(file, data, String(content).endsWith('\n') ? String(content) : `${content}\n`);
  return { ...data, path: file };
}

function artifactFile(root, projectSlug, id) {
  const base = projectPaths(root, projectSlug).artifacts;
  if (!fs.existsSync(base)) return null;
  for (const month of fs.readdirSync(base)) {
    const file = path.join(base, month, `${id}.md`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

export function listArtifacts(root, { project, kind, tag } = {}) {
  const slugs = project ? [project] : listProjects(root).map((p) => p.slug);
  const out = [];
  for (const slug of slugs) {
    const base = projectPaths(root, slug).artifacts;
    if (!fs.existsSync(base)) continue;
    for (const month of fs.readdirSync(base)) {
      const mdir = path.join(base, month);
      if (!fs.statSync(mdir).isDirectory()) continue;
      for (const f of fs.readdirSync(mdir)) {
        if (!f.endsWith('.md')) continue;
        const { data, body } = readDoc(path.join(mdir, f));
        if (kind && data.kind !== kind) continue;
        if (tag && !(data.tags ?? []).includes(tag)) continue;
        out.push({
          id: data.id ?? f.replace(/\.md$/, ''),
          project: data.project ?? slug,
          kind: data.kind ?? null,
          source: data.source ?? null,
          captured: data.captured ?? null,
          tags: data.tags ?? [],
          title: data.title ?? null,
          preview: body.replace(/\s+/g, ' ').trim().slice(0, 140),
          path: path.join(mdir, f),
        });
      }
    }
  }
  return out.sort((a, b) => String(b.captured).localeCompare(String(a.captured)));
}

export function showArtifact(root, projectSlug, id) {
  const file = artifactFile(root, projectSlug, id);
  if (!file) throw new Error(`No such artifact: ${projectSlug}/${id}`);
  const { data, body } = readDoc(file);
  return { ...data, id: data.id ?? id, project: data.project ?? projectSlug, body, path: file };
}

export function deleteArtifact(root, projectSlug, id) {
  const file = artifactFile(root, projectSlug, id);
  if (!file) throw new Error(`No such artifact: ${projectSlug}/${id}`);
  fs.rmSync(file);
  return { id, project: projectSlug };
}

export function retagArtifact(root, projectSlug, id, tags) {
  const file = artifactFile(root, projectSlug, id);
  if (!file) throw new Error(`No such artifact: ${projectSlug}/${id}`);
  const { data, body } = readDoc(file);
  data.tags = Array.isArray(tags) ? tags : [];
  writeDoc(file, data, body);
  return { ...data, tags: data.tags };
}

export function setArtifactKind(root, projectSlug, id, kind) {
  assertEnum(kind, ARTIFACT_KINDS, 'artifact kind');
  const file = artifactFile(root, projectSlug, id);
  if (!file) throw new Error(`No such artifact: ${projectSlug}/${id}`);
  const { data, body } = readDoc(file);
  data.kind = kind;
  writeDoc(file, data, body);
  return { ...data, kind };
}

// Session bootstrapper: packet templates assemble the right context for a work
// surface (chat / terminal agent / browser agent) and render it against a chosen
// project. Packets are GLOBAL reusable templates at <root>/packets/<slug>.md
// (ADR-0007) — the project is a render-time parameter via {{project.*}} vars.
// Pure file I/O (ADR-0001).
import fs from 'node:fs';
import path from 'node:path';
import { packetsDir } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { slugify } from './slug.js';
import { today } from './schema.js';
import { showProject } from './projects.js';
import { listLog } from './memory.js';

// Minimal glob: '*' matches within a path segment, across any depth of segments.
// Enough for the include patterns packets use (guidance/*.md, projects/<slug>/guidance/*.md).
function globFiles(root, pattern) {
  const segments = pattern.split('/').filter(Boolean);
  let dirs = [root];
  segments.forEach((seg, i) => {
    const isLast = i === segments.length - 1;
    const rx = seg.includes('*')
      ? new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$')
      : null;
    const next = [];
    for (const dir of dirs) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (rx ? rx.test(e.name) : e.name === seg) {
          const full = path.join(dir, e.name);
          if (isLast ? e.isFile() : e.isDirectory()) next.push(full);
        }
      }
    }
    dirs = next;
  });
  return dirs;
}

function substitute(text, vars) {
  return String(text).replace(/\{\{([^}]+)\}\}/g, (whole, raw) => {
    const key = raw.trim();
    if (key in vars) return vars[key];
    const m = key.match(/^log:(\d+)$/);
    if (m) return vars.__log(Number(m[1]));
    if (key === 'log') return vars.__log();
    return whole; // leave unrecognized markers intact so typos are visible
  });
}

export function addPacket(root, { title, slug, surface = null, includes = [], output = null, body = '' } = {}) {
  if (!title || !String(title).trim()) throw new Error('Packet title is required');
  const finalSlug = slugify(slug || title);
  if (!finalSlug) throw new Error(`Could not derive a slug from "${title}"`);
  fs.mkdirSync(packetsDir(root), { recursive: true });
  const file = path.join(packetsDir(root), `${finalSlug}.md`);
  if (fs.existsSync(file)) throw new Error(`Packet already exists: ${finalSlug}`);
  const now = today();
  const data = { title, slug: finalSlug, surface, includes, output, created: now, updated: now };
  writeDoc(file, data, body);
  return { ...data, path: file };
}

export function listPackets(root) {
  const dir = packetsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .map((n) => {
      const { data } = readDoc(path.join(dir, n));
      return {
        slug: data.slug ?? n.replace(/\.md$/, ''),
        title: data.title ?? n,
        surface: data.surface ?? null,
        includes: data.includes ?? [],
        output: data.output ?? null,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function showPacket(root, slug) {
  const file = path.join(packetsDir(root), `${slugify(slug)}.md`);
  if (!fs.existsSync(file)) throw new Error(`No such packet: ${slug}`);
  const { data, body } = readDoc(file);
  return { slug: data.slug ?? slug, title: data.title ?? slug, surface: data.surface ?? null, includes: data.includes ?? [], output: data.output ?? null, body, path: file };
}

// Render a packet against a project: expand {{project.*}}, {{includes}}, {{log:N}}.
export function renderPacket(root, packetSlug, projectSlug, { logN = 5 } = {}) {
  const packet = showPacket(root, packetSlug);
  const project = showProject(root, projectSlug); // throws if the project is missing

  const seen = new Set();
  const includeParts = [];
  for (const pattern of packet.includes ?? []) {
    const resolved = pattern.replaceAll('{{project.slug}}', project.slug);
    for (const file of globFiles(root, resolved)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const { data, body } = readDoc(file);
      includeParts.push(`### ${data.title ?? path.basename(file, '.md')}\n\n${body.trim()}`);
    }
  }

  const logs = listLog(root, projectSlug).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const renderLog = (n = logN) =>
    logs.slice(0, n)
      .map((l) => `- **${l.date}** ${l.title ?? ''}`.trimEnd() + (l.body?.trim() ? `\n  ${l.body.trim().replace(/\n/g, '\n  ')}` : ''))
      .join('\n');

  const vars = {
    'project.name': project.name ?? '',
    'project.slug': project.slug ?? '',
    'project.stage': project.stage ?? '',
    'project.status': project.status ?? '',
    'project.repo': project.repo ?? '',
    'project.narrative': (project.body ?? '').trim(),
    includes: includeParts.join('\n\n'),
    __log: renderLog,
  };

  const text = substitute(packet.body, vars);
  const output = packet.output && project.repo ? substitute(packet.output, vars) : null;
  return { text, output, packet: packet.slug, project: project.slug };
}

// The starter packets shipped in every data root (seeded by init).
export const STARTER_PACKETS = [
  {
    title: 'Chat Ideation',
    slug: 'chat-ideation',
    surface: 'claude-chat',
    includes: [],
    output: null,
    body: `You are helping me think through **{{project.name}}** (stage: {{project.stage}}).

## Current narrative
{{project.narrative}}

## Recent progress
{{log:5}}

Pressure-test the concept, surface risks and gaps, and propose the next moves.
`,
  },
  {
    title: 'Terminal Build',
    slug: 'terminal-build',
    surface: 'claude-code',
    includes: ['guidance/*.md', 'projects/{{project.slug}}/guidance/*.md'],
    output: '{{project.repo}}/VERQURY_CONTEXT.md',
    body: `# {{project.name}} — build context

- Stage: {{project.stage}} · Status: {{project.status}}
- Repo: {{project.repo}}

## Narrative
{{project.narrative}}

## Guidance (standards & instructions)
{{includes}}

## Recent log
{{log:8}}
`,
  },
  {
    title: 'Browser Task',
    slug: 'browser-task',
    surface: 'browser-agent',
    includes: [],
    output: null,
    body: `Task for a browser agent, in service of **{{project.name}}**.

## Context
{{project.narrative}}

## The task
<!-- describe the web task here -->

When finished, paste back a short completion report so it can be captured.
`,
  },
];

export function ensureStarterPackets(root) {
  fs.mkdirSync(packetsDir(root), { recursive: true });
  for (const p of STARTER_PACKETS) {
    const file = path.join(packetsDir(root), `${p.slug}.md`);
    if (fs.existsSync(file)) continue;
    const now = today();
    const { body, ...meta } = p;
    writeDoc(file, { ...meta, created: now, updated: now }, body);
  }
}

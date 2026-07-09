// Adapter registry: AI surfaces defined purely as configuration (ADR-0004) —
// a slug, a label, a launch command template, an optional handoff packet, and
// notes. Adding or swapping an AI tool is a config edit, never a code change.
// Adapters live in config.json (see config.js).
import { readConfig, writeConfig } from './config.js';
import { slugify } from './slug.js';

export function listAdapters(root) {
  try {
    return readConfig(root).adapters ?? [];
  } catch {
    return [];
  }
}

export function getAdapter(root, slug) {
  return listAdapters(root).find((a) => a.slug === slug) ?? null;
}

export function addAdapter(root, { slug, label, command = '', packet = null, notes = '', target = 'external' } = {}) {
  if (!label || !String(label).trim()) throw new Error('Adapter label is required');
  const finalSlug = slugify(slug || label);
  if (!finalSlug) throw new Error(`Could not derive a slug from "${label}"`);
  const config = readConfig(root);
  config.adapters = config.adapters ?? [];
  if (config.adapters.some((a) => a.slug === finalSlug)) throw new Error(`Adapter already exists: ${finalSlug}`);
  const adapter = { slug: finalSlug, label, command, packet, notes, target };
  config.adapters.push(adapter);
  writeConfig(root, config);
  return adapter;
}

export function updateAdapter(root, slug, patch = {}) {
  const config = readConfig(root);
  const idx = (config.adapters ?? []).findIndex((a) => a.slug === slug);
  if (idx === -1) throw new Error(`No such adapter: ${slug}`);
  config.adapters[idx] = { ...config.adapters[idx], ...patch, slug }; // slug is immutable
  writeConfig(root, config);
  return config.adapters[idx];
}

export function removeAdapter(root, slug) {
  const config = readConfig(root);
  config.adapters = (config.adapters ?? []).filter((a) => a.slug !== slug);
  writeConfig(root, config);
  return { slug };
}

// Substitute {{repo}} / {{project.*}} in a command template.
export function resolveCommand(command, project) {
  return String(command ?? '')
    .replaceAll('{{repo}}', project.repo ?? '')
    .replaceAll('{{project.slug}}', project.slug ?? '')
    .replaceAll('{{project.name}}', project.name ?? '');
}

// Slugs align with the starter packets' `surface` values so tasks/packets route
// to the matching launch. Commands target XFCE/X11 (ADR-0003).
export const STARTER_ADAPTERS = [
  {
    slug: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    packet: 'terminal-build',
    target: 'terminal',
    notes: 'Terminal-first AI coding agent, run in the embedded terminal at the project repo.',
  },
  {
    slug: 'claude-chat',
    label: 'Claude Chat',
    command: 'xdg-open https://claude.ai/new',
    packet: 'chat-ideation',
    notes: 'Browser chat for ideation and planning.',
  },
  {
    slug: 'cursor',
    label: 'Cursor',
    command: 'cursor {{repo}}',
    packet: 'terminal-build',
    notes: 'Editor-embedded AI, opened on the project repo.',
  },
  {
    slug: 'browser-agent',
    label: 'Browser Agent (Comet)',
    command: 'xdg-open https://www.perplexity.ai',
    packet: 'browser-task',
    notes: 'Agentic browsing for multi-step web tasks.',
  },
];

// Seed the starter adapters once (tracked by a config flag so a user who deletes
// some/all of them is not re-seeded on the next launch).
export function ensureStarterAdapters(root) {
  const config = readConfig(root);
  if (config.adaptersSeeded) return;
  config.adapters = config.adapters?.length ? config.adapters : STARTER_ADAPTERS.map((a) => ({ ...a }));
  config.adaptersSeeded = true;
  writeConfig(root, config);
}

// File-only surface of verqury-core: everything backed by plain markdown, with
// NO native dependency. The Electron main process imports this (not the '.'
// barrel) so it never loads better-sqlite3 — search runs out-of-process instead
// (ADR-0006). The search index API lives in ./search.js.
export * from './paths.js';
export * from './config.js';
export * from './init.js';
export * from './projects.js';
export * from './guidance.js';
export * from './memory.js';
export * from './artifacts.js';
export * from './packets.js';
export * from './tasks.js';
export * from './adapters.js';
export * from './schema.js';
export { ulid } from './ids.js';
export { slugify } from './slug.js';
export { readDoc, writeDoc } from './frontmatter.js';

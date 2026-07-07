// verqury-core public API. The markdown data root is the source of truth
// (ADR-0001); the SQLite index is a rebuildable cache.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;

export * from './paths.js';
export * from './config.js';
export * from './init.js';
export * from './projects.js';
export * from './guidance.js';
export * from './memory.js';
export * from './search.js';
export * from './schema.js';
export { slugify } from './slug.js';
export { readDoc, writeDoc } from './frontmatter.js';

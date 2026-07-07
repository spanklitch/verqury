// verqury-core public API. The markdown data root is the source of truth
// (ADR-0001); the SQLite index is a rebuildable cache. Native-free consumers
// (e.g. the Electron main process) should import 'verqury-core/files' instead,
// which omits the sqlite-backed search module (ADR-0006).
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;

export * from './files.js';
export * from './search.js';

// The app's data API — plain functions the Electron main process wires to IPC.
// Deliberately Electron-free so it is testable under plain Node (ADR-0002).
//
// File reads/writes go through verqury-core's native-free 'files' surface,
// loaded in-process. Search goes through a short-lived `node` subprocess running
// the CLI, so better-sqlite3 is never loaded into Electron (ADR-0006). We spawn
// the *system* node (ABI-matched to the installed better-sqlite3), not Electron's
// embedded node.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  resolveRoot,
  init,
  listProjects,
  showProject,
  setStage,
  projectTimeline,
  STAGES,
} from 'verqury-core/files';

const require = createRequire(import.meta.url);
const CLI = require.resolve('verqury-core/cli');
const NODE = process.env.VERQURY_NODE || 'node';

export function getRoot() {
  return resolveRoot();
}

export function ensureRoot(root) {
  init(root);
  return root;
}

export function getProjects(root) {
  return listProjects(root);
}

export function getProject(root, slug) {
  return { project: showProject(root, slug), timeline: projectTimeline(root, slug) };
}

export function changeStage(root, slug, stage) {
  return setStage(root, slug, stage);
}

export function getStages() {
  return STAGES;
}

function cli(root, args) {
  return execFileSync(NODE, [CLI, ...args], {
    env: { ...process.env, VERQURY_DATA_ROOT: root },
    encoding: 'utf8',
  });
}

export function runSearch(root, query) {
  if (!query || !query.trim()) return [];
  try {
    return JSON.parse(cli(root, ['search', query, '--json']) || '[]');
  } catch {
    return [];
  }
}

export function refreshIndex(root) {
  try {
    cli(root, ['index', 'refresh']);
  } catch {
    // The index is a rebuildable cache (ADR-0001); a failed refresh is non-fatal.
  }
}

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
  addGuidance,
  listAllGuidance,
  showGuidance,
  promoteGuidance as corePromoteGuidance,
  addArtifact,
  listArtifacts,
  showArtifact,
  deleteArtifact as coreDeleteArtifact,
  retagArtifact,
  setArtifactKind,
  getActiveProject,
  setActiveProject,
  STAGES,
  GUIDANCE_KINDS,
  ARTIFACT_KINDS,
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

export function getGuidanceKinds() {
  return GUIDANCE_KINDS;
}

export function getAllGuidance(root) {
  return listAllGuidance(root);
}

export function getGuidance(root, scope, slug) {
  return showGuidance(root, scope, slug);
}

export function createGuidance(root, payload) {
  return addGuidance(root, payload);
}

export function promoteGuidance(root, projectSlug, slug) {
  return corePromoteGuidance(root, projectSlug, slug);
}

export function getArtifactKinds() {
  return ARTIFACT_KINDS;
}

export function getArtifacts(root, filters) {
  return listArtifacts(root, filters ?? {});
}

export function getArtifact(root, projectSlug, id) {
  return showArtifact(root, projectSlug, id);
}

export function addArtifactTo(root, projectSlug, payload) {
  return addArtifact(root, projectSlug, payload);
}

export function deleteArtifact(root, projectSlug, id) {
  return coreDeleteArtifact(root, projectSlug, id);
}

export function tagArtifact(root, projectSlug, id, tags) {
  return retagArtifact(root, projectSlug, id, tags);
}

export function changeArtifactKind(root, projectSlug, id, kind) {
  return setArtifactKind(root, projectSlug, id, kind);
}

export function getActive(root) {
  return getActiveProject(root);
}

export function setActive(root, slug) {
  return setActiveProject(root, slug);
}

// The clipboard-capture path, shared by the global hotkey. `readClipboard` is
// injected by the caller (Electron main) so this stays Electron-free and testable.
export function captureClipboard(root, readClipboard) {
  const text = readClipboard();
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  const project = getActiveProject(root) ?? listProjects(root)[0]?.slug;
  if (!project) return { ok: false, reason: 'no-project' };
  const artifact = addArtifact(root, project, { content: text, source: 'clipboard' });
  return { ok: true, project, artifact };
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

// The app's data API — plain functions the Electron main process wires to IPC.
// Deliberately Electron-free so it is testable under plain Node (ADR-0002).
//
// File reads/writes go through verqury-core's native-free 'files' surface,
// loaded in-process. Search goes through a short-lived node subprocess running
// the CLI, so better-sqlite3 is never loaded into Electron (ADR-0006). Which node
// runs it is configurable (see configureNode): dev/tests use the system node;
// the packaged app uses Electron's own embedded node (ADR-0008).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  resolveRoot,
  init,
  createProject,
  listProjects,
  showProject,
  setStage,
  setNarrative,
  projectTimeline,
  addLog,
  addDecision,
  addGuidance,
  listAllGuidance,
  showGuidance,
  setGuidanceBody,
  promoteGuidance as corePromoteGuidance,
  addArtifact,
  listArtifacts,
  showArtifact,
  deleteArtifact as coreDeleteArtifact,
  retagArtifact,
  setArtifactKind,
  getActiveProject,
  setActiveProject,
  listPackets,
  renderPacket as coreRenderPacket,
  addTask,
  listTasks,
  showTask,
  updateTask as coreUpdateTask,
  deleteTask as coreDeleteTask,
  renderHandoff as coreRenderHandoff,
  attachReport as coreAttachReport,
  listAdapters,
  getAdapter,
  addAdapter,
  updateAdapter as coreUpdateAdapter,
  removeAdapter as coreRemoveAdapter,
  resolveCommand,
  STAGES,
  STATUSES,
  GUIDANCE_KINDS,
  ARTIFACT_KINDS,
  TASK_ROUTES,
  TASK_STATUSES,
} from 'verqury-core/files';

const require = createRequire(import.meta.url);
const CLI = require.resolve('verqury-core/cli');

// How the search subprocess is launched. Default: the system `node` on PATH
// (dev + tests). The packaged app calls configureNode() to run the CLI under
// Electron's embedded node instead (ADR-0008).
let nodeConfig = { bin: process.env.VERQURY_NODE || 'node', env: {} };

export function configureNode(cfg) {
  nodeConfig = { ...nodeConfig, ...cfg };
}

export function getRoot() {
  return resolveRoot();
}

export function ensureRoot(root) {
  init(root);
  return root;
}

export function getStatuses() {
  return STATUSES;
}

export function makeProject(root, payload) {
  return createProject(root, payload);
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

export function editNarrative(root, slug, body) {
  return setNarrative(root, slug, body);
}

export function createLog(root, slug, payload) {
  return addLog(root, slug, payload);
}

export function createDecision(root, slug, payload) {
  return addDecision(root, slug, payload);
}

export function editGuidanceBody(root, scope, slug, body) {
  return setGuidanceBody(root, scope, slug, body);
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

export function getPackets(root) {
  return listPackets(root);
}

export function renderPacket(root, packetSlug, projectSlug, opts) {
  return coreRenderPacket(root, packetSlug, projectSlug, opts ?? {});
}

export function getTaskRoutes() {
  return TASK_ROUTES;
}

export function getTaskStatuses() {
  return TASK_STATUSES;
}

export function getTasks(root, filters) {
  return listTasks(root, filters ?? {});
}

export function getTask(root, projectSlug, id) {
  return showTask(root, projectSlug, id);
}

export function createTask(root, projectSlug, payload) {
  return addTask(root, projectSlug, payload);
}

export function updateTask(root, projectSlug, id, patch) {
  return coreUpdateTask(root, projectSlug, id, patch);
}

export function deleteTask(root, projectSlug, id) {
  return coreDeleteTask(root, projectSlug, id);
}

export function renderHandoff(root, projectSlug, id) {
  return coreRenderHandoff(root, projectSlug, id);
}

export function attachReport(root, projectSlug, id, artifactId) {
  return coreAttachReport(root, projectSlug, id, artifactId);
}

export function getAdapters(root) {
  return listAdapters(root);
}

export function getOneAdapter(root, slug) {
  return getAdapter(root, slug);
}

export function createAdapter(root, adapter) {
  return addAdapter(root, adapter);
}

export function updateAdapter(root, slug, patch) {
  return coreUpdateAdapter(root, slug, patch);
}

export function removeAdapter(root, slug) {
  return coreRemoveAdapter(root, slug);
}

export function resolveAdapterCommand(command, project) {
  return resolveCommand(command, project);
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
  return execFileSync(nodeConfig.bin, [CLI, ...args], {
    env: { ...process.env, ...nodeConfig.env, VERQURY_DATA_ROOT: root },
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

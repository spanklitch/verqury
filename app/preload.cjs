// Preload bridge (CommonJS, runs in the sandboxed isolated world). Exposes a
// small, explicit API to the renderer — no Node, no ipcRenderer leakage.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('verqury', {
  getRoot: () => ipcRenderer.invoke('root:get'),
  getStages: () => ipcRenderer.invoke('stages:get'),
  getStatuses: () => ipcRenderer.invoke('statuses:get'),
  createProject: (payload) => ipcRenderer.invoke('project:create', payload),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  getProject: (slug) => ipcRenderer.invoke('project:get', slug),
  setStage: (slug, stage) => ipcRenderer.invoke('project:setStage', slug, stage),
  search: (query) => ipcRenderer.invoke('search:query', query),

  guidanceKinds: () => ipcRenderer.invoke('guidance:kinds'),
  listAllGuidance: () => ipcRenderer.invoke('guidance:all'),
  getGuidance: (scope, slug) => ipcRenderer.invoke('guidance:get', scope, slug),
  createGuidance: (payload) => ipcRenderer.invoke('guidance:create', payload),
  promoteGuidance: (projectSlug, slug) => ipcRenderer.invoke('guidance:promote', projectSlug, slug),

  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  artifactKinds: () => ipcRenderer.invoke('artifact:kinds'),
  listArtifacts: (filters) => ipcRenderer.invoke('artifacts:list', filters),
  getArtifact: (projectSlug, id) => ipcRenderer.invoke('artifact:get', projectSlug, id),
  deleteArtifact: (projectSlug, id) => ipcRenderer.invoke('artifact:delete', projectSlug, id),
  retagArtifact: (projectSlug, id, tags) => ipcRenderer.invoke('artifact:retag', projectSlug, id, tags),
  setArtifactKind: (projectSlug, id, kind) => ipcRenderer.invoke('artifact:setKind', projectSlug, id, kind),
  getActiveProject: () => ipcRenderer.invoke('project:getActive'),
  setActiveProject: (slug) => ipcRenderer.invoke('project:setActive', slug),
  captureNow: () => ipcRenderer.invoke('capture:now'),
  captureText: (text) => ipcRenderer.invoke('capture:text', text),

  listPackets: () => ipcRenderer.invoke('packet:list'),
  renderPacket: (packetSlug, projectSlug, opts) => ipcRenderer.invoke('packet:render', packetSlug, projectSlug, opts),
  writePacket: (filePath, text) => ipcRenderer.invoke('packet:write', filePath, text),

  taskRoutes: () => ipcRenderer.invoke('task:routes'),
  taskStatuses: () => ipcRenderer.invoke('task:statuses'),
  listTasks: (filters) => ipcRenderer.invoke('tasks:list', filters),
  getTask: (projectSlug, id) => ipcRenderer.invoke('task:get', projectSlug, id),
  addTask: (projectSlug, payload) => ipcRenderer.invoke('task:add', projectSlug, payload),
  updateTask: (projectSlug, id, patch) => ipcRenderer.invoke('task:update', projectSlug, id, patch),
  deleteTask: (projectSlug, id) => ipcRenderer.invoke('task:delete', projectSlug, id),
  handoffTask: (projectSlug, id) => ipcRenderer.invoke('task:handoff', projectSlug, id),
  attachReport: (projectSlug, id, artifactId) => ipcRenderer.invoke('task:attachReport', projectSlug, id, artifactId),

  listAdapters: () => ipcRenderer.invoke('adapters:list'),
  addAdapter: (adapter) => ipcRenderer.invoke('adapter:add', adapter),
  updateAdapter: (slug, patch) => ipcRenderer.invoke('adapter:update', slug, patch),
  removeAdapter: (slug) => ipcRenderer.invoke('adapter:remove', slug),
  launchAdapter: (adapterSlug, projectSlug) => ipcRenderer.invoke('adapter:launch', adapterSlug, projectSlug),

  onDataChanged: (cb) => ipcRenderer.on('data:changed', () => cb()),
  onArtifactCaptured: (cb) => ipcRenderer.on('artifact:captured', (_e, info) => cb(info)),
});

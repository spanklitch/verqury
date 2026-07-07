// Preload bridge (CommonJS, runs in the sandboxed isolated world). Exposes a
// small, explicit API to the renderer — no Node, no ipcRenderer leakage.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('verqury', {
  getRoot: () => ipcRenderer.invoke('root:get'),
  getStages: () => ipcRenderer.invoke('stages:get'),
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

  onDataChanged: (cb) => ipcRenderer.on('data:changed', () => cb()),
});

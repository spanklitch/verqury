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
  onDataChanged: (cb) => ipcRenderer.on('data:changed', () => cb()),
});

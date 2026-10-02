const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('firaw', {
  choose: kind => ipcRenderer.invoke('dialog:choose', kind),
  open: spec => ipcRenderer.invoke('workspace:open', spec),
  detail: (key, format) => ipcRenderer.invoke('workspace:detail', key, format),
  save: payload => ipcRenderer.invoke('workspace:save', payload),
  saveAsset: payload => ipcRenderer.invoke('workspace:save-asset', payload),
  export: resolutions => ipcRenderer.invoke('workspace:export', resolutions),
  saveSession: session => ipcRenderer.invoke('workspace:session-save', session),
  loadSession: () => ipcRenderer.invoke('workspace:session-load'),
  models: startIfNeeded => ipcRenderer.invoke('ai:models', !!startIfNeeded),
  hardware: () => ipcRenderer.invoke('ai:hardware'),
  recommend: settings => ipcRenderer.invoke('ai:recommend', settings),
  install: model => ipcRenderer.invoke('ai:install', model),
  onPullProgress: callback => ipcRenderer.on('ai:pull-progress', (_event, update) => callback(update)),
  onBatchProgress: callback => ipcRenderer.on('ai:batch-progress', (_event, update) => callback(update)),
  onShellPaths: callback => ipcRenderer.on('shell:paths', (_event, paths) => callback(paths)),
  resolve: payload => ipcRenderer.invoke('ai:resolve', payload),
  resolveBatch: payload => ipcRenderer.invoke('ai:resolve-batch', payload),
  cancelBatch: () => ipcRenderer.invoke('ai:cancel-batch'),
  show: file => ipcRenderer.invoke('shell:show', file)
});

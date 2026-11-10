const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('miraDetached', Object.freeze({
  command: action => { if (['pin', 'reattach', 'back', 'forward', 'reload', 'stop', 'external'].includes(action) || (action?.type === 'navigate' && typeof action.url === 'string')) ipcRenderer.send('mira:detached-command', action) },
  onState: callback => ipcRenderer.on('mira:detached-state', (_event, state) => callback(state)),
}))

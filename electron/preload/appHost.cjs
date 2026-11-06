const { contextBridge, ipcRenderer } = require('electron')

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('miraAppHost', Object.freeze({
    ready: () => ipcRenderer.send('mira-app:ready'),
  }))
  ipcRenderer.on('mira-app:connect', event => {
    if (event.ports.length !== 1) return
    window.postMessage({ type: 'mira:app-connect' }, '*', [event.ports[0]])
  })
  ipcRenderer.on('mira-app:browser-event', (_event, value) => window.postMessage({ type: 'mira:workbench-browser-event', value }, '*'))
}

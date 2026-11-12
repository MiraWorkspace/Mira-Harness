import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('resourceManager', {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  windowCommand: (action: 'state' | 'fullscreen-state' | 'minimize' | 'maximize' | 'close') => ipcRenderer.invoke('window:resource-command', action),
  onFullscreen: (callback: (fullscreen: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, fullscreen: boolean) => callback(fullscreen)
    ipcRenderer.on('window:resource-fullscreen', listener)
    return () => ipcRenderer.removeListener('window:resource-fullscreen', listener)
  },
  onMaximized: (callback: (maximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:resource-maximized', listener)
    return () => ipcRenderer.removeListener('window:resource-maximized', listener)
  },
  getSnapshot: () => ipcRenderer.invoke('window:resource-snapshot'),
  storage: { clean: (id: string) => ipcRenderer.invoke('window:resource-storage-clean', id), scan: () => ipcRenderer.invoke('window:resource-storage'), cancel: () => ipcRenderer.invoke('window:resource-storage-cancel'), reveal: (path: string) => ipcRenderer.invoke('window:resource-storage-reveal', path) },
  network: { getSnapshot: () => ipcRenderer.invoke('window:resource-network'), clear: () => ipcRenderer.invoke('window:resource-network-clear') },
})

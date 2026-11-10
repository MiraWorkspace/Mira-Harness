import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('resourceManager', {
  getSnapshot: () => ipcRenderer.invoke('window:resource-snapshot'),
  storage: { clean: (id: string) => ipcRenderer.invoke('window:resource-storage-clean', id), scan: () => ipcRenderer.invoke('window:resource-storage'), cancel: () => ipcRenderer.invoke('window:resource-storage-cancel'), reveal: (path: string) => ipcRenderer.invoke('window:resource-storage-reveal', path) },
  network: { getSnapshot: () => ipcRenderer.invoke('window:resource-network'), clear: () => ipcRenderer.invoke('window:resource-network-clear') },
})

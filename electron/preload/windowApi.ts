import { ipcRenderer, webFrame, webUtils } from 'electron'

let fullScreen = false
ipcRenderer.on('window:fullscreen-changed', (_event, value: boolean) => { fullScreen = value })

export const windowApi = {
  openResourceManager: () => ipcRenderer.invoke('window:resource-open'),
  windowChrome: process.platform === 'darwin' ? 'macos-overlay' : (process.platform === 'win32' ? 'windows-overlay' : 'standard'),
  setTitleBarChrome: (chrome: { color: string; symbolColor: string; height?: number }) => ipcRenderer.invoke('window:set-titlebar-chrome', chrome),
  windowCommand: (action: string) => ipcRenderer.invoke('window:command', action),
  getDesktopZoomFactor: () => webFrame.getZoomFactor(),
  isFullScreen: () => fullScreen,
  onFullScreenChanged: (listener: (fullScreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: boolean) => listener(value)
    ipcRenderer.on('window:fullscreen-changed', handler)
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler)
  },
  onDesktopZoomChanged: (listener: (factor: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, factor: number) => listener(factor)
    ipcRenderer.on('window:zoom-changed', handler)
    return () => ipcRenderer.removeListener('window:zoom-changed', handler)
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onWindowShortcut: (listener: (input: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, input: Parameters<typeof listener>[0]) => listener(input)
    ipcRenderer.on('window:shortcut', handler)
    return () => ipcRenderer.removeListener('window:shortcut', handler)
  },
  onWindowCloseContext: (listener: () => void) => {
    const handler = () => listener()
    ipcRenderer.on('window:close-context', handler)
    return () => ipcRenderer.removeListener('window:close-context', handler)
  },
  onWindowNavigate: (listener: (path: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, path: string) => listener(path)
    ipcRenderer.on('window:navigate', handler)
    return () => ipcRenderer.removeListener('window:navigate', handler)
  },
}

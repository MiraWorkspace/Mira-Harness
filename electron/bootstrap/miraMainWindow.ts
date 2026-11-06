import { BaseWindow, BrowserWindow, WebContentsView, type BrowserWindowConstructorOptions } from 'electron'

const shellViews = new WeakMap<BrowserWindow, WebContentsView>()

/** Makes the shell a real native sibling of installed apps, so it can overlay them. */
export function createMiraMainWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
  const { webPreferences, ...chrome } = options
  const window = new BaseWindow(chrome)
  const view = new WebContentsView({ webPreferences: webPreferences ?? {} })
  view.setBackgroundColor(options.backgroundColor ?? '#fff')
  window.contentView.addChildView(view)
  const resize = () => { const { width, height } = window.getContentBounds(); view.setBounds({ x: 0, y: 0, width, height }) }
  window.on('resize', resize)
  resize()
  // Keep the shell-facing BrowserWindow contract used by existing Mira services.
  const shell = Object.assign(window, {
    webContents: view.webContents,
    loadURL: view.webContents.loadURL.bind(view.webContents),
    loadFile: view.webContents.loadFile.bind(view.webContents),
  }) as unknown as BrowserWindow
  shellViews.set(shell, view)
  view.webContents.on('page-title-updated', (_event, title) => { if (!window.isDestroyed()) window.setTitle(title) })
  view.webContents.once('did-finish-load', () => shell.emit('ready-to-show'))
  window.once('closed', () => { if (!view.webContents.isDestroyed()) view.webContents.close() })
  return shell
}

export function miraShellView(window: BrowserWindow) { return shellViews.get(window) }

export function miraWindows(): BrowserWindow[] {
  return BaseWindow.getAllWindows().filter(window => 'webContents' in window) as BrowserWindow[]
}

export function focusedMiraWindow(): BrowserWindow | null {
  const window = BaseWindow.getFocusedWindow()
  return window && 'webContents' in window ? window as BrowserWindow : null
}

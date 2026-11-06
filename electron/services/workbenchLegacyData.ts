import { WebContentsView, session } from 'electron'

const allowedIds = new Set(['mira-workbench', 'mira-workbench-test'])

/** Reads the old Workbench key from the default Chromium session without changing it. */
export async function readWorkbenchLegacySites(appId: string, port: number | undefined, legacyPort: number | undefined): Promise<string | null> {
  if (!allowedIds.has(appId)) throw new Error('应用没有所需权限')
  if (!Number.isInteger(port) || port! < 1 || port! > 65535 || (legacyPort !== undefined && legacyPort !== port)) throw new Error('旧工作台数据来源不可用')
  const url = `http://127.0.0.1:${port}/mira-internal/legacy-workbench`
  const view = new WebContentsView({ webPreferences: { session: session.defaultSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
  const contents = view.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('will-redirect', event => event.preventDefault())
  try {
    await contents.loadURL('about:blank')
    contents.debugger.attach('1.3')
    await contents.debugger.sendCommand('Network.enable')
    await contents.debugger.sendCommand('Network.setBypassServiceWorker', { bypass: true })
    await contents.loadURL(url)
    if (contents.getURL() !== url) throw new Error('旧工作台数据来源无效')
    const value: unknown = await contents.executeJavaScript(`localStorage.getItem(${JSON.stringify(`${appId}.sites.v1`)})`)
    if (value !== null && (typeof value !== 'string' || value.length > 4 * 1024 * 1024)) throw new Error('旧工作台数据无效')
    if (contents.getURL() !== url) throw new Error('旧工作台数据来源无效')
    return value as string | null
  } finally {
    if (!contents.isDestroyed()) {
      if (contents.debugger.isAttached()) contents.debugger.detach()
      contents.close()
    }
  }
}

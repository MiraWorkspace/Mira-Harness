import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { WORKBENCH_BROWSER_PARTITION, configureWorkbenchPopupHandling, isAllowedHostedBrowserUrl } from '../security/hostedBrowser'
import { bindAppViewShortcuts } from './appViewShortcuts'

type Bounds = { x: number; y: number; width: number; height: number }
type Tab = { view: WebContentsView; requestedUrl: string; error?: string; faviconUrl?: string | null }

/** Browser pages belong to one Workbench view, never to the shell or another app. */
export class WorkbenchBrowserViews {
  private readonly tabs = new Map<string, Tab>()
  private appBounds: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  private layout?: { tabId: string; bounds: Bounds; visible: boolean }

  constructor(private readonly owner: BrowserWindow, private readonly app: WebContents, private readonly viewAdded = () => {}) {}

  private emit(value: Record<string, unknown>) { if (!this.app.isDestroyed()) this.app.send('mira-app:browser-event', value) }
  private state(tabId: string) {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.view.webContents.isDestroyed()) return
    const contents = tab.view.webContents, history = contents.navigationHistory
    this.emit({ type: 'state', tabId, url: tab.error ? tab.requestedUrl : contents.getURL() || tab.requestedUrl, title: contents.getTitle(), loading: contents.isLoading(), canGoBack: history.canGoBack(), canGoForward: history.canGoForward(), ...(tab.error ? { error: tab.error } : {}), ...(tab.faviconUrl !== undefined ? { faviconUrl: tab.faviconUrl } : {}) })
  }

  open(tabId: string, value: string) {
    this.validateId(tabId)
    if (!isAllowedHostedBrowserUrl(value) || value.length > 8192) throw new Error('网页地址无效')
    const existing = this.tabs.get(tabId)
    if (existing) {
      existing.requestedUrl = value; existing.error = undefined; existing.faviconUrl = null
      void existing.view.webContents.loadURL(value).catch(() => { if (this.tabs.get(tabId) === existing && existing.requestedUrl === value && !existing.error) { existing.error = '网页加载失败'; this.state(tabId) } })
      return
    }
    if (this.tabs.size >= 32) throw new Error('浏览器标签过多')
    const view = new WebContentsView({ webPreferences: { partition: WORKBENCH_BROWSER_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
    const contents = view.webContents, tab: Tab = { view, requestedUrl: value }
    const unbindShortcuts = bindAppViewShortcuts(this.owner, contents)
    contents.once('destroyed', unbindShortcuts)
    this.tabs.set(tabId, tab)
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    configureWorkbenchPopupHandling(contents, url => this.emit({ type: 'open-tab', url }))
    contents.on('will-navigate', event => { if (!isAllowedHostedBrowserUrl(event.url)) event.preventDefault() })
    contents.on('will-redirect', event => { if (!isAllowedHostedBrowserUrl(event.url)) event.preventDefault() })
    contents.on('did-start-loading', () => { tab.error = undefined; this.state(tabId) })
    const update = () => this.state(tabId)
    contents.on('did-stop-loading', update)
    contents.on('did-navigate', update)
    contents.on('did-navigate-in-page', update)
    contents.on('page-title-updated', update)
    contents.on('page-favicon-updated', (_event, favicons) => { tab.faviconUrl = favicons.find(isAllowedHostedBrowserUrl) ?? null; this.state(tabId) })
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => { if (isMainFrame && code !== -3) { tab.error = description || '网页加载失败'; this.state(tabId) } })
    contents.on('render-process-gone', () => { tab.error = '网页进程已退出'; this.state(tabId) })
    contents.once('destroyed', () => { if (this.tabs.get(tabId) === tab) { this.tabs.delete(tabId); if (!this.owner.isDestroyed()) this.owner.contentView.removeChildView(view) } })
    this.owner.contentView.addChildView(view)
    this.viewAdded()
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    void contents.loadURL(value).catch(() => { if (this.tabs.get(tabId) === tab && tab.requestedUrl === value && !tab.error) { tab.error = '网页加载失败'; this.state(tabId) } })
    this.sync()
  }

  control(tabId: string, action: string) {
    const tab = this.tab(tabId), contents = tab.view.webContents, history = contents.navigationHistory
    if (action === 'close') { this.close(tabId); return }
    if (action === 'back') { if (history.canGoBack()) history.goBack() }
    else if (action === 'forward') { if (history.canGoForward()) history.goForward() }
    else if (action === 'reload') contents.reload()
    else if (action === 'stop') contents.stop()
    else throw new Error('浏览器操作无效')
  }

  setLayout(tabId: string, bounds: Bounds, visible: boolean) {
    this.validateId(tabId)
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(value => Number.isFinite(value) && value >= 0) || typeof visible !== 'boolean') throw new Error('浏览器尺寸无效')
    this.layout = { tabId, bounds, visible }
    this.sync()
  }

  setAppBounds(bounds: Bounds) { this.appBounds = bounds; this.sync() }
  private sync() {
    const layout = this.layout, zoom = this.owner.webContents.getZoomFactor(), app = this.appBounds
    for (const [id, tab] of this.tabs) {
      if (!layout?.visible || id !== layout.tabId) { tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); continue }
      const x = Math.min(app.width, Math.round(layout.bounds.x * zoom)), y = Math.min(app.height, Math.round(layout.bounds.y * zoom))
      tab.view.setBounds({ x: app.x + x, y: app.y + y, width: Math.min(Math.round(layout.bounds.width * zoom), app.width - x), height: Math.min(Math.round(layout.bounds.height * zoom), app.height - y) })
    }
  }

  private validateId(id: string) { if (typeof id !== 'string' || !id || id.length > 128) throw new Error('浏览器标签无效') }
  private tab(id: string) { this.validateId(id); const tab = this.tabs.get(id); if (!tab || tab.view.webContents.isDestroyed()) throw new Error('浏览器标签已关闭'); return tab }
  private close(id: string) { const tab = this.tab(id); this.tabs.delete(id); if (!this.owner.isDestroyed()) this.owner.contentView.removeChildView(tab.view); tab.view.webContents.close() }
  dispose() { for (const id of [...this.tabs.keys()]) this.close(id) }
}

import { WebContentsView, type BrowserWindow, type WebContents, type WebFrameMain, type View } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { OwnedViewSession } from './ownedViewSession'
import { dirname, join } from 'node:path'
import { AppHostSession } from './appHostSession'
import type { AppRuntime, InstalledPlatformApp } from './appRuntime'
import type { AppSdkDispatcher } from './appSdkDispatcher'
import { appNetworkPolicy } from '../security/appNetworkPolicy'
import { WorkbenchBrowserViews } from './workbenchBrowserViews'
import { bindAppViewShortcuts } from './appViewShortcuts'
import { miraShellView } from '../bootstrap/miraMainWindow'
import { DetachedViewWindow } from './detachedViewWindow'

type Bounds = { x: number; y: number; width: number; height: number }
interface AppView { appId: string; owner: BrowserWindow; view: WebContentsView; session: AppHostSession | OwnedViewSession; browser?: WorkbenchBrowserViews; parentId?: number; bounds: Bounds; childLayout?: { bounds: Bounds; visible: boolean }; detached?: DetachedViewWindow; cleanup(): void }

/** Manages isolated native application views. Callers must authenticate the owner frame. */
export class AppViewManager {
  private readonly views = new Map<number, AppView>()
  private readonly overlays = new Map<BrowserWindow, { id: number; focus?: WebContents }>()
  private readonly workbenchOverlays = new Map<number, { before: View[]; focus?: WebContents }>()

  constructor(private readonly runtime: AppRuntime, private readonly dispatcher: AppSdkDispatcher, private readonly resolveEntry: (id: string) => InstalledPlatformApp & { url: string }, private readonly preloadPath = join(__dirname, '../preload/appHost.cjs')) {}

  open(owner: BrowserWindow, appId: string) {
    if (owner.isDestroyed()) throw new Error('应用窗口已关闭')
    const approved = this.runtime.requireApproval(appId)
    if (!approved.firstParty) throw new Error('仅支持第一方子应用')
    const entry = this.resolveEntry(appId)
    if (entry.id !== approved.id || entry.installationId !== approved.installationId) throw new Error('应用已变化，请重新打开')
    return this.createView(owner, appId, entry.url)
  }

  private createView(owner: BrowserWindow, appId: string, url: string, parentId?: number, resourceCleanup?: () => void, partitionKey = appId) {
    const network = appNetworkPolicy(url)
    const view = new WebContentsView({ webPreferences: { partition: `persist:mira-app-${partitionKey}`, preload: this.preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false } })
    const contents = view.webContents, id = contents.id, appSession = contents.session
    const unbindShortcuts = bindAppViewShortcuts(owner, contents)
    contents.setZoomFactor(owner.webContents.getZoomFactor())
    appSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    appSession.setPermissionCheckHandler(() => false)
    appSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !network.allows(details.url) }))
    appSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') callback({ responseHeaders: network.headers(details.responseHeaders) })
      else callback({ responseHeaders: details.responseHeaders })
    })
    const preventDownload = (event: Electron.Event) => event.preventDefault()
    appSession.on('will-download', preventDownload)
    let cleaned = false, attached = false, session: AppHostSession | OwnedViewSession | undefined
    const browser = !resourceCleanup && ['mira-workbench', 'mira-workbench-test'].includes(appId) ? new WorkbenchBrowserViews(owner, contents, () => this.raiseOverlay(owner), join(dirname(this.preloadPath), 'detachedView.cjs')) : undefined
    const ownerNavigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (event.isMainFrame && !event.isSameDocument) cleanup()
    }
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      if (this.overlays.get(owner)?.id === id) this.setShellOverlay(owner, id, false)
      this.workbenchOverlays.delete(id)
      const detached = this.views.get(id)?.detached
      detached?.dispose()
      this.views.delete(id)
      const parent = parentId === undefined ? undefined : this.views.get(parentId)
      if (parent && !parent.view.webContents.isDestroyed()) parent.session.event('views.closed', { viewId: id })
      for (const child of this.views.values()) if (child.parentId === id) child.cleanup()
      owner.webContents.removeListener('destroyed', cleanup)
      owner.webContents.removeListener('did-start-navigation', ownerNavigation)
      contents.removeListener('destroyed', cleanup)
      unbindShortcuts()
      appSession.removeListener('will-download', preventDownload)
      browser?.dispose()
      resourceCleanup?.()
      if (attached && !detached && !owner.isDestroyed()) owner.contentView.removeChildView(view)
      if (session) session.dispose()
      else if (!contents.isDestroyed()) contents.close()
    }
    try {
      session = resourceCleanup ? new OwnedViewSession(contents, url, (event, value) => this.views.get(parentId!)?.session.event(event, value)) : new AppHostSession(contents, appId, url, this.runtime, this.dispatcher, message => {
        if (!owner.isDestroyed()) owner.webContents.send('mira-app:failed', { id, message })
      })
      this.views.set(id, { appId, owner, view, session, browser, parentId, bounds: { x: 0, y: 0, width: 0, height: 0 }, cleanup })
      owner.webContents.once('destroyed', cleanup)
      owner.webContents.on('did-start-navigation', ownerNavigation)
      contents.once('destroyed', cleanup)
      owner.contentView.addChildView(view)
      this.raiseOverlay(owner)
      attached = true
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      void session.load().catch(() => {
        if (!owner.isDestroyed()) owner.webContents.send('mira-app:failed', { id, message: '应用加载失败，请重试。' })
        cleanup()
      })
    } catch (error) { cleanup(); throw error }
    return id
  }

  ready(sender: WebContents, frame: WebFrameMain | null) {
    return this.views.get(sender.id)?.session.ready(sender, frame) ?? false
  }

  setBounds(owner: BrowserWindow, id: number, bounds: Bounds) {
    const item = this.views.get(id)
    if (!item || item.owner !== owner || owner.isDestroyed()) throw new Error('应用视图无效')
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('应用视图尺寸无效')
    const area = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor()
    const x = Math.round(bounds.x * zoom), y = Math.round(bounds.y * zoom), width = Math.round(bounds.width * zoom), height = Math.round(bounds.height * zoom)
    const next = { x: Math.min(x, area.width), y: Math.min(y, area.height), width: Math.min(width, Math.max(0, area.width - x)), height: Math.min(height, Math.max(0, area.height - y)) }
    item.bounds = next
    if (item.detached) return
    item.view.setBounds(next)
    item.browser?.setAppBounds(next)
    item.view.webContents.setZoomFactor(zoom)
    for (const child of this.views.values()) if (child.parentId === id) this.syncChild(item, child)
  }

  close(owner: BrowserWindow, id: number) {
    const item = this.views.get(id)
    if (!item || item.owner !== owner) throw new Error('应用视图无效')
    item.cleanup()
  }

  closeApp(appId: string) {
    for (const item of this.views.values()) if (item.appId === appId) item.cleanup()
  }

  setShellOverlay(owner: BrowserWindow, id: number, open: boolean) {
    const item = this.views.get(id)
    if (!item || item.owner !== owner || item.parentId !== undefined || typeof open !== 'boolean') throw new Error('应用视图无效')
    if (owner.isDestroyed()) { this.overlays.delete(owner); return }
    if (open) {
      if (!this.overlays.has(owner)) {
        const focus = owner.contentView.children.find(view => 'webContents' in view && (view as WebContentsView).webContents.isFocused()) as WebContentsView | undefined
        this.overlays.set(owner, { id, focus: focus?.webContents })
      }
      miraShellView(owner)!.setBackgroundColor('#00000000')
      this.raiseOverlay(owner)
      owner.webContents.focus()
    } else {
      const overlay = this.overlays.get(owner)
      if (!overlay || overlay.id !== id) return
      this.overlays.delete(owner)
      owner.contentView.addChildView(miraShellView(owner)!, 0)
      if (overlay.focus && !overlay.focus.isDestroyed()) overlay.focus.focus()
    }
  }

  private raiseOverlay(owner: BrowserWindow) {
    for (const id of this.workbenchOverlays.keys()) {
      const item = this.views.get(id)
      if (item?.owner === owner && !owner.isDestroyed()) owner.contentView.addChildView(item.view)
    }
    if (this.overlays.has(owner) && !owner.isDestroyed()) owner.contentView.addChildView(miraShellView(owner)!)
  }

  private setWorkbenchOverlay(ownerId: number, open: boolean) {
    const item = this.views.get(ownerId)
    if (!item?.browser || item.parentId !== undefined || item.owner.isDestroyed()) throw new Error('应用没有所需权限')
    const owner = item.owner
    if (open) {
      if (!this.workbenchOverlays.has(ownerId)) {
        const focus = owner.contentView.children.find(view => 'webContents' in view && (view as WebContentsView).webContents.isFocused()) as WebContentsView | undefined
        const siblings = owner.contentView.children
        // The shell can move above the menu, so restore relative to the other siblings.
        this.workbenchOverlays.set(ownerId, { before: siblings.slice(0, siblings.indexOf(item.view)).filter(view => view !== miraShellView(owner)), focus: focus?.webContents })
      }
      item.view.setBackgroundColor('#00000000')
      this.raiseOverlay(owner)
      if (!this.overlays.has(owner)) item.view.webContents.focus()
    } else {
      const overlay = this.workbenchOverlays.get(ownerId)
      if (!overlay) return
      this.workbenchOverlays.delete(ownerId)
      const siblings = owner.contentView.children.filter(view => view !== item.view)
      const before = overlay.before.findLast(view => siblings.includes(view))
      const index = before ? siblings.indexOf(before) + 1 : !this.overlays.has(owner) && siblings[0] === miraShellView(owner) ? 1 : 0
      owner.contentView.addChildView(item.view, index)
      this.raiseOverlay(owner)
      if (!this.overlays.has(owner) && overlay.focus && !overlay.focus.isDestroyed()) overlay.focus.focus()
    }
  }

  workbenchBrowser(ownerId: number, input: Record<string, unknown>) {
    const browser = this.views.get(ownerId)?.browser
    if (!browser) throw new Error('应用没有所需权限')
    if (input.type === 'overlay' && typeof input.open === 'boolean') return this.setWorkbenchOverlay(ownerId, input.open)
    if (input.type === 'open' && typeof input.tabId === 'string' && typeof input.url === 'string') return browser.open(input.tabId, input.url)
    if (input.type === 'control' && typeof input.tabId === 'string' && typeof input.action === 'string') return browser.control(input.tabId, input.action, input.muted === true, typeof input.dragOffset === 'number' && Number.isFinite(input.dragOffset) ? input.dragOffset : undefined, input.presentation)
    if (input.type === 'layout' && typeof input.tabId === 'string') return browser.setLayout(input.tabId, input.bounds as Bounds, input.visible as boolean)
    throw new Error('请求参数无效')
  }

  private emitDetached(item: AppView, detached: boolean) {
    const target = item.parentId === undefined ? item.view.webContents : this.views.get(item.parentId)?.view.webContents
    if (target && !target.isDestroyed()) target.send('mira-app:detached-event', { id: item.view.webContents.id, detached })
  }

  private detachChild(item: AppView, dragOffset?: number, presentation?: unknown) {
    if (item.detached) return
    item.detached = new DetachedViewWindow({ presentation, kind: 'miniapp', dragOffset, dragSource: this.views.get(item.parentId!)?.view.webContents, owner: item.owner, view: item.view, title: item.view.webContents.getTitle() || item.appId, preloadPath: join(dirname(this.preloadPath), 'detachedView.cjs'), onReattach: () => {
      if (this.views.get(item.view.webContents.id) !== item) return
      item.detached = undefined
      this.syncChildAfterAttach(item)
      this.emitDetached(item, false)
    } })
    this.emitDetached(item, true)
  }

  private syncChildAfterAttach(item: AppView) {
    const parent = item.parentId === undefined ? undefined : this.views.get(item.parentId)
    if (parent) this.syncChild(parent, item)
  }

  ownedView(ownerId: number, input: Record<string, unknown>, resources: { mount(id: string, directory: string, entry: string): string; unmount(id: string): void }, directory?: string) {
    const parent = this.views.get(ownerId)
    if (!parent || parent.parentId !== undefined || parent.owner.isDestroyed()) throw new Error('应用没有所需权限')
    if (input.type === 'open') {
      if (!directory || typeof input.entry !== 'string' || typeof input.key !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.key)) throw new Error('视图入口无效')
      const id = `resource-${randomUUID()}`, url = resources.mount(id, directory, input.entry)
      const partition = createHash('sha256').update(`${parent.appId}:${input.key}`).digest('hex')
      try { return this.createView(parent.owner, parent.appId, url, ownerId, () => resources.unmount(id), partition) }
      catch (error) { resources.unmount(id); throw error }
    }
    if (!Number.isSafeInteger(input.id)) throw new Error('应用视图 ID 无效')
    const child = this.views.get(input.id as number)
    if (!child || child.parentId !== ownerId || !(child.session instanceof OwnedViewSession)) throw new Error('应用视图无效')
    if (input.type === 'close') { child.cleanup(); return }
    if (input.type === 'detach') { this.detachChild(child, typeof input.dragOffset === 'number' && Number.isFinite(input.dragOffset) ? input.dragOffset : undefined, input.presentation); return }
    if (input.type === 'end-drag') { child.detached?.endDrag(); return }
    if (input.type === 'reattach') { child.detached?.reattach(); return }
    if (input.type === 'reload') return child.session.reload()
    if (input.type === 'mute' && typeof input.muted === 'boolean') { child.view.webContents.setAudioMuted(input.muted); return }
    if (input.type === 'reply') {
      if (typeof input.requestId !== 'string' || typeof input.ok !== 'boolean') throw new Error('请求参数无效')
      child.session.reply(input.requestId, input.ok, input.value, typeof input.error === 'string' ? input.error.slice(0, 1000) : undefined); return
    }
    if (input.type === 'event') {
      if (typeof input.event !== 'string' || input.event.length > 128) throw new Error('请求参数无效')
      child.session.event(input.event, input.value); return
    }
    if (input.type === 'layout') {
      const bounds = input.bounds as Bounds
      if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(value => Number.isFinite(value) && value >= 0) || typeof input.visible !== 'boolean') throw new Error('应用视图尺寸无效')
      child.childLayout = { bounds, visible: input.visible }; this.syncChild(parent, child); return
    }
    throw new Error('请求参数无效')
  }

  ownerWindow(ownerId: number) {
    const item = this.views.get(ownerId)
    if (!item || item.parentId !== undefined || item.owner.isDestroyed()) throw new Error('应用视图无效')
    return item.owner
  }

  workbenchOwner(ownerId: number) {
    const item = this.views.get(ownerId)
    if (!item?.browser || item.owner.isDestroyed()) throw new Error('应用没有所需权限')
    return item.owner
  }

  private syncChild(parent: AppView, child: AppView) {
    if (child.detached) return
    const layout = child.childLayout, bounds = parent.bounds, zoom = parent.owner.webContents.getZoomFactor()
    if (!layout?.visible) { child.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); return }
    const x = Math.min(bounds.width, Math.round(layout.bounds.x * zoom)), y = Math.min(bounds.height, Math.round(layout.bounds.y * zoom))
    child.view.setBounds({ x: bounds.x + x, y: bounds.y + y, width: Math.min(Math.round(layout.bounds.width * zoom), bounds.width - x), height: Math.min(Math.round(layout.bounds.height * zoom), bounds.height - y) })
    child.view.webContents.setZoomFactor(zoom)
  }

  themeChanged(theme: 'light' | 'dark') { for (const item of this.views.values()) item.session.themeChanged(theme) }

  resourceViews() {
    return [...this.views.values()].filter(item => !item.view.webContents.isDestroyed()).map(item => {
      const contents = item.view.webContents
      return { id: contents.id, name: contents.getTitle() || item.appId, detail: `${item.appId}${item.parentId === undefined ? ' · 子应用' : ' · 子应用视图'}` }
    })
  }

  closeAll() { for (const item of this.views.values()) item.cleanup() }
}

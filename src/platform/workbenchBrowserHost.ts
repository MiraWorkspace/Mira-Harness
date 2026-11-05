import { MiraHostedBrowsers } from './miraHostedBrowsers'
import type { HarnessBrowserBounds } from './firstPartyHarness'

// Workbench is a cross-origin iframe: only the shell can create Electron guests.
export class WorkbenchBrowserHost {
  private port?: MessagePort
  private tabs = new Set<string>()
  private layout?: { tabId: string; bounds: HarnessBrowserBounds; visible: boolean }
  private browsers: MiraHostedBrowsers
  private resize: ResizeObserver
  constructor(private frame: HTMLIFrameElement, private stage: HTMLElement) {
    this.browsers = new MiraHostedBrowsers(() => stage, state => {
      this.port?.postMessage({ type: 'state', tabId: state.browserId, ...state })
    }, undefined, 'persist:mira-workbench')
    this.resize = new ResizeObserver(() => this.syncLayout())
    this.resize.observe(frame); this.resize.observe(stage)
  }
  connect(event: MessageEvent, url: string) {
    if (event.source !== this.frame.contentWindow || event.origin !== new URL(url).origin || event.data?.type !== 'mira:workbench-browser-connect') return
    this.reset()
    const channel = new MessageChannel()
    const port = this.port = channel.port1
    port.onmessage = event => { if (this.port === port) this.receive(event.data) }
    this.frame.contentWindow?.postMessage({ type: 'mira:workbench-browser-connected' }, event.origin, [channel.port2])
  }
  private receive(message: unknown) {
    if (!message || typeof message !== 'object') return
    const input = message as Record<string, unknown>, tabId = input.tabId
    if (input.type === 'dispose') { this.reset(); return }
    if (typeof tabId !== 'string' || !tabId || tabId.length > 128) return
    if (input.type === 'open') {
      if (typeof input.url !== 'string') return
      let url: URL
      try { url = new URL(input.url) } catch { return }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
      this.tabs.add(tabId)
      const port = this.port
      void this.browsers.navigate('workbench', url.href, { x: 0, y: 0, width: 0, height: 0 }, tabId, false).then(() => this.syncLayout()).catch(error => {
        if (this.port === port && this.tabs.has(tabId)) port?.postMessage({ type: 'state', tabId, loading: false, error: error instanceof Error ? error.message : '网页加载失败' })
      })
    } else if (input.type === 'layout') {
      const bounds = input.bounds as HarnessBrowserBounds | undefined
      if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return
      this.layout = { tabId, bounds, visible: input.visible === true }
      this.syncLayout()
    } else if (input.type === 'control' && this.tabs.has(tabId)) {
      const action = input.action
      if (action !== 'back' && action !== 'forward' && action !== 'reload' && action !== 'stop' && action !== 'close') return
      if (action === 'close') this.tabs.delete(tabId)
      this.browsers.control('workbench', action, tabId)
    }
  }
  private syncLayout() {
    const layout = this.layout
    if (!layout) return
    for (const tab of this.tabs) this.browsers.control('workbench', 'hide', tab)
    if (!layout.visible || !this.tabs.has(layout.tabId) || !this.frame.getClientRects().length) return
    const frame = this.frame.getBoundingClientRect(), stage = this.stage.getBoundingClientRect(), bounds = layout.bounds
    this.browsers.setBounds('workbench', {
      x: Math.max(0, frame.x - stage.x + bounds.x), y: Math.max(0, frame.y - stage.y + bounds.y),
      width: Math.min(bounds.width, Math.max(0, frame.width - bounds.x)), height: Math.min(bounds.height, Math.max(0, frame.height - bounds.y)),
    }, layout.tabId)
    this.browsers.control('workbench', 'show', layout.tabId)
  }
  reset() { this.port?.close(); this.port = undefined; this.tabs.clear(); this.layout = undefined; this.browsers.clear() }
  dispose() { this.reset(); this.resize.disconnect() }
}

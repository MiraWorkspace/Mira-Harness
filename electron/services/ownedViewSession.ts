import { MessageChannelMain, type WebContents, type WebFrameMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { AppFrameGuard } from '../security/appFrameGuard'
/** Transport only. The owning application implements and authorizes every child method. */
export class OwnedViewSession {
  private readonly guard: AppFrameGuard
  private channel?: MessageChannelMain
  private requested = false
  private disposed = false
  private readonly pending = new Map<string, { childId: string; timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly contents: WebContents, private readonly entry: string, private readonly emit: (event: string, value: unknown) => void) {
    this.guard = new AppFrameGuard(contents, entry, () => this.dispose()); contents.on('did-finish-load', this.loaded)
  }
  load() { return this.contents.loadURL(this.entry) }
  reload() {
    this.guard.prepareReload()
    for (const item of this.pending.values()) clearTimeout(item.timer)
    this.pending.clear()
    this.channel?.port1.postMessage({ type: 'mira:disconnect' })
    this.channel?.port1.close(); this.channel?.port2.close()
    this.channel = undefined; this.requested = false
    return this.load()
  }
  ready(sender: WebContents, frame: WebFrameMain | null) {
    if (this.disposed || sender !== this.contents || frame !== this.contents.mainFrame || this.channel) return false
    this.requested = true; this.loaded(); return true
  }
  private readonly loaded = () => {
    if (!this.requested || this.channel || !this.guard.isReady()) return
    const channel = this.channel = new MessageChannelMain()
    channel.port1.on('message', ({ data }) => {
      if (channel !== this.channel) return
      if (data?.type === 'mira:disconnect') { this.dispose(); return }
      if (data?.type !== 'mira:request' || typeof data.id !== 'string' || !data.id || data.id.length > 128 || typeof data.method !== 'string' || data.method.length > 128) return
      if (this.pending.size >= 32) { channel.port1.postMessage({ type: 'mira:response', id: data.id, ok: false, error: { code: 'BUSY', message: '请求过多' } }); return }
      const requestId = randomUUID(), timer = setTimeout(() => this.reply(requestId, false, undefined, '请求超时'), 90000)
      this.pending.set(requestId, { childId: data.id, timer })
      this.emit('views.request', { viewId: this.contents.id, requestId, method: data.method, params: data.params })
    })
    channel.port1.start(); this.contents.postMessage('mira-app:connect', null, [channel.port2])
  }
  reply(requestId: string, ok: boolean, value?: unknown, error?: string) {
    const pending = this.pending.get(requestId); if (!pending || this.disposed) return
    clearTimeout(pending.timer); this.pending.delete(requestId)
    this.channel?.port1.postMessage({ type: 'mira:response', id: pending.childId, ok, value, error: ok ? undefined : { code: 'APPLICATION_DENIED', message: error || '请求被宿主应用拒绝' } })
  }
  event(event: string, value: unknown) { if (!this.disposed) this.channel?.port1.postMessage({ type: 'mira:event', event, value }) }
  themeChanged() { /* The owner authorizes appearance events. */ }
  dispose() {
    if (this.disposed) return
    this.disposed = true; this.contents.removeListener('did-finish-load', this.loaded)
    for (const item of this.pending.values()) clearTimeout(item.timer)
    this.pending.clear(); this.channel?.port1.postMessage({ type: 'mira:disconnect' }); this.channel?.port1.close(); this.channel?.port2.close(); this.guard.dispose()
    if (!this.contents.isDestroyed()) this.contents.close()
  }
}

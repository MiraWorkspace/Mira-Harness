import { MessageChannelMain, type WebContents } from 'electron'
import { AppFrameGuard } from '../security/appFrameGuard'
import { AppSdkConnection } from './appSdkConnection'
import { AppSdkMainPort } from './appSdkMainPort'
import type { AppRuntime } from './appRuntime'
import type { AppSdkDispatcher } from './appSdkDispatcher'

/** Owns one isolated app WebContents; only its main frame may request a connection. */
export class AppHostSession {
  private readonly guard: AppFrameGuard
  private connection?: AppSdkConnection
  private requested = false
  private disposed = false

  constructor(private readonly contents: WebContents, private readonly appId: string, private readonly entry: string, private readonly runtime: AppRuntime, private readonly dispatcher: AppSdkDispatcher, private readonly onError: (message: string) => void) {
    this.guard = new AppFrameGuard(contents, entry, () => this.dispose())
    contents.on('did-finish-load', this.onLoaded)
  }

  load() { return this.contents.loadURL(this.entry) }

  ready(sender: WebContents, frame: Electron.WebFrameMain | null) {
    if (this.disposed || sender !== this.contents || !frame || frame !== this.contents.mainFrame || this.connection) return false
    this.requested = true
    if (this.guard.isReady()) this.connect()
    return true
  }

  private readonly onLoaded = () => { if (this.requested && this.guard.isReady()) this.connect() }

  private connect() {
    if (this.disposed || this.connection || !this.guard.isReady()) return
    let sessionId: string | undefined
    let channel: MessageChannelMain | undefined
    try {
      sessionId = this.runtime.open(this.appId, this.contents.id)
      channel = new MessageChannelMain()
      this.connection = new AppSdkConnection(new AppSdkMainPort(channel.port1), this.dispatcher, this.runtime, sessionId, this.contents.id)
      if (!this.guard.isReady()) throw new Error('应用页面已变化')
      this.contents.postMessage('mira-app:connect', null, [channel.port2])
    } catch {
      this.connection?.close()
      this.connection = undefined
      if (sessionId) this.runtime.revokeSession(sessionId, this.contents.id)
      channel?.port1.close(); channel?.port2.close()
      try { this.onError('应用连接失败，请重新打开应用。') }
      finally { this.dispose() }
    }
  }

  event(event: string, value: unknown) { this.connection?.event(event, value) }

  themeChanged(theme: 'light' | 'dark') { this.connection?.themeChanged(theme) }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.contents.removeListener('did-finish-load', this.onLoaded)
    this.connection?.close()
    this.connection = undefined
    this.guard.dispose()
    if (!this.contents.isDestroyed()) this.contents.close()
  }
}

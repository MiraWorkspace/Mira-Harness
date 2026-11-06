export type AppValue = string | number | null
export type AppColumn = { name: string; type: 'TEXT' | 'INTEGER' | 'REAL'; primaryKey?: boolean; notNull?: boolean }
export type AppOperation =
  | { type: 'insert'; table: string; values: Record<string, AppValue> }
  | { type: 'update'; table: string; values: Record<string, AppValue>; where: Record<string, AppValue> }
  | { type: 'delete'; table: string; where: Record<string, AppValue> }
  | { type: 'select'; table: string; where?: Record<string, AppValue>; orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>; limit?: number; offset?: number }
export type AppMigration = { version: number; tables?: Array<{ name: string; columns: AppColumn[] }>; addColumns?: Array<{ table: string; column: AppColumn }>; operations?: AppOperation[] }
export type Theme = 'light' | 'dark'
export interface AppContext { appId: string; apiVersion: { major: number; minor: number }; capabilities: string[] }
export interface ModelRequest { prompt: string; providerId?: string; modelId?: string }
export interface ModelResult { text: string }
export interface NotificationRequest { title: string; body?: string }
export type WorkbenchBrowserRequest =
  | { type: 'open'; tabId: string; url: string }
  | { type: 'control'; tabId: string; action: 'back' | 'forward' | 'reload' | 'stop' | 'close' }
  | { type: 'layout'; tabId: string; visible: boolean; bounds: { x: number; y: number; width: number; height: number } }

export class MiraSdkError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'MiraSdkError' }
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

/** A port is supplied by the Mira host for one app instance and must not be shared. */
export class MiraAppSdk {
  private readonly pending = new Map<string, Pending>()
  private readonly themeListeners = new Set<(theme: Theme) => void>()
  private closed = false

  constructor(private readonly port: MessagePort, private readonly timeoutMs = 30000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid request timeout')
    port.addEventListener('message', this.onMessage)
    port.addEventListener('messageerror', this.onMessageError)
    port.start()
  }

  private readonly onMessage = (event: MessageEvent) => {
    const data: unknown = event.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) return
    const message = data as Record<string, unknown>
    if (message.type === 'mira:disconnect') { this.dispose(); return }
    if (message.type === 'mira:event' && message.event === 'appearance.changed' && (message.value === 'light' || message.value === 'dark')) {
      for (const listener of this.themeListeners) listener(message.value)
      return
    }
    if (message.type !== 'mira:response' || typeof message.id !== 'string') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    if (message.ok !== true && message.ok !== false) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.ok) pending.resolve(message.value)
    else {
      const error = message.error && typeof message.error === 'object' ? message.error as Record<string, unknown> : {}
      pending.reject(new MiraSdkError(typeof error.code === 'string' ? error.code : 'PLATFORM_ERROR', typeof error.message === 'string' ? error.message : 'Mira request failed'))
    }
  }

  private readonly onMessageError = () => { this.dispose() }

  private request<T>(method: string, params?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    if (this.closed) return Promise.reject(new MiraSdkError('DISCONNECTED', 'Mira connection is closed'))
    const id = crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new MiraSdkError('TIMEOUT', 'Mira request timed out')) }, timeoutMs)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      try { this.port.postMessage({ type: 'mira:request', id, method, params }) }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new MiraSdkError('DISCONNECTED', 'Mira request could not be sent')) }
    })
  }

  readonly context = { get: () => this.request<AppContext>('context.get') }
  readonly storage = {
    migrate: (migrations: AppMigration[]) => this.request<number>('storage.migrate', { migrations }),
    transaction: (operations: AppOperation[]) => this.request<unknown[]>('storage.transaction', { operations }),
    importLegacyWorkbenchSites: () => this.request<string | null>('storage.importLegacyWorkbenchSites'),
  }
  readonly appearance = {
    get: () => this.request<Theme>('appearance.get'),
    subscribe: (listener: (theme: Theme) => void) => {
      if (this.closed) throw new MiraSdkError('DISCONNECTED', 'Mira connection is closed')
      this.themeListeners.add(listener)
      return () => { this.themeListeners.delete(listener) }
    },
  }
  readonly models = { generate: (request: ModelRequest) => this.request<ModelResult>('models.generate', request, Math.max(this.timeoutMs, 75000)) }
  readonly notifications = { send: (request: NotificationRequest) => this.request<void>('notifications.send', request) }
  readonly workbench = {
    browser: (request: WorkbenchBrowserRequest) => this.request<void>('workbench.browser', request),
    apps: () => this.request<Array<{ id: string; name: string; icon?: string; enabled: boolean; approved: boolean }>>('workbench.apps'),
    review: (appId: string) => this.request<boolean>('workbench.review', { appId }, Math.max(this.timeoutMs, 300000)),
    install: () => this.request<boolean>('workbench.install', undefined, Math.max(this.timeoutMs, 300000)),
    uninstall: (appId: string) => this.request<boolean>('workbench.uninstall', { appId }, Math.max(this.timeoutMs, 300000)),
    revoke: (appId: string) => this.request<boolean>('workbench.revoke', { appId }, Math.max(this.timeoutMs, 300000)),
    app: (request: { type: 'open'; appId: string } | { type: 'close'; id: number } | { type: 'layout'; id: number; visible: boolean; bounds: { x: number; y: number; width: number; height: number } }) => this.request<number | void>('workbench.app', request),
  }

  dispose() {
    if (this.closed) return
    this.closed = true
    try { this.port.postMessage({ type: 'mira:disconnect' }) } catch { /* The host may already have closed the connection. */ }
    this.port.removeEventListener('message', this.onMessage)
    this.port.removeEventListener('messageerror', this.onMessageError)
    this.port.close()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new MiraSdkError('DISCONNECTED', 'Mira connection is closed')) }
    this.pending.clear()
    this.themeListeners.clear()
  }
}

/** Accepts a connection from the parent frame or Mira's isolated application preload. */
export function connectMiraApp(timeoutMs = 10000): Promise<MiraAppSdk> {
  const nativeHost = (window as Window & { miraAppHost?: { ready?: () => void } }).miraAppHost
  const topLevel = window.parent === window
  if (topLevel && typeof nativeHost?.ready !== 'function') return Promise.reject(new MiraSdkError('UNAVAILABLE', 'Mira host is unavailable'))
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('Invalid connection timeout'))
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive) }
    const receive = (event: MessageEvent) => {
      if (event.source !== (topLevel ? window : window.parent) || event.data?.type !== 'mira:app-connect' || !event.ports[0]) return
      cleanup()
      resolve(new MiraAppSdk(event.ports[0]))
    }
    const timer = setTimeout(() => { cleanup(); reject(new MiraSdkError('TIMEOUT', 'Mira connection timed out')) }, timeoutMs)
    window.addEventListener('message', receive)
    if (topLevel) nativeHost!.ready!()
    else window.parent.postMessage({ type: 'mira:app-ready' }, '*')
  })
}

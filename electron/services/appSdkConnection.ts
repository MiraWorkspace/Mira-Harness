import type { AppSdkDispatcher } from './appSdkDispatcher'
import type { AppRuntime } from './appRuntime'
import { AppModelError } from './appModelError'
import { AppWebError } from './appWebService'

export interface AppPort {
  postMessage(message: unknown): void
  close(): void
  start(): void
  addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void): void
}

function publicError(error: unknown) {
  if (error instanceof AppModelError || error instanceof AppWebError) return { code: error.code, message: error.message }
  const message = error instanceof Error ? error.message : ''
  if (message.includes('授权') || message === '应用没有所需权限') return { code: 'CAPABILITY_DENIED', message: '应用授权无效或已撤销' }
  if (message === '不支持的应用方法') return { code: 'UNKNOWN_METHOD', message }
  if (message === '请求参数无效' || message === '请求方法无效') return { code: 'INVALID_REQUEST', message }
  return { code: 'PLATFORM_ERROR', message: '应用请求失败，请检查参数后重试' }
}

/** The host binds this connection to a validated application frame before construction. */
export class AppSdkConnection {
  private closed = false
  private readonly inFlight = new Set<string>()

  constructor(private readonly port: AppPort, private readonly dispatcher: AppSdkDispatcher, private readonly runtime: AppRuntime, private readonly sessionId: string, private readonly ownerId: number) {
    port.addEventListener('message', this.receive)
    port.addEventListener('messageerror', this.close)
    port.start()
  }

  private readonly receive = (event: MessageEvent) => {
    const value: unknown = event.data
    if (this.closed || !value || typeof value !== 'object' || Array.isArray(value)) return
    const request = value as Record<string, unknown>
    if (request.type === 'mira:disconnect') { this.close(); return }
    if (request.type !== 'mira:request' || typeof request.id !== 'string' || !request.id || request.id.length > 128 || typeof request.method !== 'string' || !request.method || request.method.length > 128) return
    const id = request.id
    if (this.inFlight.has(id)) return
    if (this.inFlight.size >= 32) {
      this.send({ type: 'mira:response', id, ok: false, error: { code: 'BUSY', message: '应用请求过多，请稍后重试' } })
      return
    }
    this.inFlight.add(id)
    void this.dispatcher.invoke(this.sessionId, this.ownerId, request.method, request.params).then(
      result => this.send({ type: 'mira:response', id, ok: true, value: result }),
      error => this.send({ type: 'mira:response', id, ok: false, error: publicError(error) }),
    ).finally(() => this.inFlight.delete(id))
  }

  private send(message: unknown) {
    if (this.closed) return
    try { this.port.postMessage(message) } catch { this.close() }
  }

  event(event: string, value: unknown) { this.send({ type: 'mira:event', event, value }) }

  themeChanged(theme: 'light' | 'dark') {
    if (this.closed) return
    try {
      const context = this.runtime.authorize(this.sessionId, this.ownerId)
      if (!context.capabilities.includes('appearance:read')) return
      this.runtime.authorize(this.sessionId, this.ownerId, 'appearance:read')
    }
    catch { this.close(); return }
    this.send({ type: 'mira:event', event: 'appearance.changed', value: theme })
  }

  readonly close = () => {
    if (this.closed) return
    this.closed = true
    try { this.port.postMessage({ type: 'mira:disconnect' }) } catch { /* The app may already have closed its port. */ }
    this.port.removeEventListener('message', this.receive)
    this.port.removeEventListener('messageerror', this.close)
    this.port.close()
    this.runtime.revokeSession(this.sessionId, this.ownerId)
    this.inFlight.clear()
  }
}

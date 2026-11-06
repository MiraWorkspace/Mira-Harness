import { Notification } from 'electron'

interface NotificationHandle {
  once(event: 'show' | 'failed' | 'close', listener: () => void): this
  show(): void
  close(): void
}

/** Platform notification adapter; app names are resolved from installed packages. */
export class AppNotificationService {
  private readonly recent = new Map<string, number[]>()
  private readonly active = new Set<NotificationHandle>()
  private readonly pending = new Map<NotificationHandle, (error?: Error) => void>()
  private disposed = false

  constructor(
    private readonly resolveName: (appId: string) => string | undefined,
    private readonly create: (options: { title: string; body: string }) => NotificationHandle = options => new Notification(options),
    private readonly supported: () => boolean = () => Notification.isSupported(),
    private readonly now: () => number = Date.now,
  ) {}

  async notify(input: { appId: string; title: string; body?: string }) {
    if (this.disposed || !this.supported()) throw new Error('系统通知不可用')
    const name = this.resolveName(input.appId)
    if (!name) throw new Error('应用未安装或已停用')
    const now = this.now(), times = (this.recent.get(input.appId) ?? []).filter(time => now - time < 60000)
    if (times.length >= 10) throw new Error('通知发送过于频繁')
    times.push(now); this.recent.set(input.appId, times)
    const notification = this.create({ title: `Mira · ${name}`, body: [input.title, input.body].filter(Boolean).join('\n') })
    this.active.add(notification)
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.pending.delete(notification)
        if (error) { this.active.delete(notification); reject(error) }
        else resolve()
      }
      const timer = setTimeout(() => { notification.close(); finish(new Error('系统通知未能送达')) }, 10000)
      this.pending.set(notification, finish)
      notification.once('show', () => finish())
      notification.once('failed', () => finish(new Error('系统通知未能送达')))
      notification.once('close', () => { this.active.delete(notification); finish(new Error('系统通知已关闭')) })
      try { notification.show() } catch { finish(new Error('系统通知未能送达')) }
    })
  }

  dispose() {
    this.disposed = true
    for (const notification of this.active) {
      this.pending.get(notification)?.(new Error('系统通知已关闭'))
      notification.close()
    }
    this.active.clear()
    this.pending.clear()
    this.recent.clear()
  }
}

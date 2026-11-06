import type { MessagePortMain } from 'electron'
import type { AppPort } from './appSdkConnection'

/** Adapt Electron's main-process MessagePort to the SDK connection interface. */
export class AppSdkMainPort implements AppPort {
  private readonly messages = new Map<(event: MessageEvent) => void, (event: Electron.MessageEvent) => void>()
  private readonly closes = new Map<(event: MessageEvent) => void, () => void>()

  constructor(private readonly port: MessagePortMain) {}
  postMessage(message: unknown) { this.port.postMessage(message) }
  start() { this.port.start() }
  close() { this.port.close() }

  addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void) {
    if (type === 'message') {
      if (this.messages.has(listener)) return
      const adapted = (event: Electron.MessageEvent) => listener(event as unknown as MessageEvent)
      this.messages.set(listener, adapted)
      this.port.on('message', adapted)
    } else {
      if (this.closes.has(listener)) return
      const adapted = () => listener({} as MessageEvent)
      this.closes.set(listener, adapted)
      this.port.on('close', adapted)
    }
  }

  removeEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void) {
    if (type === 'message') {
      const adapted = this.messages.get(listener)
      if (adapted) { this.port.removeListener('message', adapted); this.messages.delete(listener) }
    } else {
      const adapted = this.closes.get(listener)
      if (adapted) { this.port.removeListener('close', adapted); this.closes.delete(listener) }
    }
  }
}

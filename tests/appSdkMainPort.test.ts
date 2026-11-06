import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { AppSdkMainPort } from '../electron/services/appSdkMainPort'

describe('main-process application port adapter', () => {
  it('adapts Electron messages and remote close and removes listeners', () => {
    const raw = Object.assign(new EventEmitter(), { postMessage: vi.fn(), start: vi.fn(), close: vi.fn() })
    const port = new AppSdkMainPort(raw as never), message = vi.fn(), close = vi.fn()
    port.addEventListener('message', message); port.addEventListener('messageerror', close)
    port.start(); port.postMessage({ value: 1 })
    raw.emit('message', { data: { value: 2 } }); raw.emit('close')
    expect(message).toHaveBeenCalledWith({ data: { value: 2 } })
    expect(close).toHaveBeenCalledOnce()
    expect(raw.start).toHaveBeenCalledOnce()
    expect(raw.postMessage).toHaveBeenCalledWith({ value: 1 })
    port.removeEventListener('message', message); port.removeEventListener('messageerror', close)
    raw.emit('message', { data: 3 }); raw.emit('close')
    expect(message).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce()
    port.close(); expect(raw.close).toHaveBeenCalledOnce()
  })
})

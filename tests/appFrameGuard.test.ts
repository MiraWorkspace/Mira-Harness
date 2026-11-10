import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { AppFrameGuard } from '../electron/security/appFrameGuard'

const entry = 'http://127.0.0.1:8123/apps/micro-example/index.html'
function fixture() {
  const contents = Object.assign(new EventEmitter(), { url: entry, getURL() { return this.url }, isDestroyed: () => false, setWindowOpenHandler: vi.fn() })
  const invalidate = vi.fn(), guard = new AppFrameGuard(contents as never, entry, invalidate)
  const start = (url = entry, isSameDocument = false) => contents.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument })
  return { contents, invalidate, guard, start }
}

describe('application frame navigation guard', () => {
  it('requires the intended local entry to finish loading before it is ready', () => {
    const { contents, guard, start, invalidate } = fixture()
    expect(guard.isReady()).toBe(false)
    start(); contents.emit('did-finish-load')
    expect(guard.isReady()).toBe(true)
    contents.url = `${entry}#section`
    start(contents.url, true)
    expect(guard.isReady()).toBe(true)
    expect(invalidate).not.toHaveBeenCalled()
    guard.dispose()
  })

  it('revokes before a page-initiated navigation or redirect and cannot reauthorize', () => {
    const { contents, guard, start, invalidate } = fixture()
    start(); contents.emit('did-finish-load')
    const event = { preventDefault: vi.fn() }
    contents.emit('will-navigate', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledOnce()
    expect(guard.isReady()).toBe(false)
    start(); contents.emit('did-finish-load')
    expect(guard.isReady()).toBe(false)
    guard.dispose()
  })

  it('allows only a trusted owner to prepare a same-entry reload', () => {
    const { contents, guard, start, invalidate } = fixture()
    expect(() => guard.prepareReload()).toThrow('就绪')
    start(); contents.emit('did-finish-load')
    guard.prepareReload(); start(); contents.emit('did-finish-load')
    expect(guard.isReady()).toBe(true)
    expect(invalidate).not.toHaveBeenCalled()
    start()
    expect(guard.isReady()).toBe(false)
    expect(invalidate).toHaveBeenCalledOnce()
    expect(() => guard.prepareReload()).toThrow('就绪')
    guard.dispose()
  })

  it('rejects a different app entry and invalidates on process exit', () => {
    const first = fixture()
    first.start('http://127.0.0.1:8123/apps/micro-other/index.html')
    expect(first.invalidate).toHaveBeenCalledOnce()
    first.guard.dispose()
    const second = fixture()
    second.start(); second.contents.emit('did-finish-load'); second.contents.emit('render-process-gone')
    expect(second.guard.isReady()).toBe(false)
    expect(second.invalidate).toHaveBeenCalledOnce()
    second.guard.dispose()
  })
})

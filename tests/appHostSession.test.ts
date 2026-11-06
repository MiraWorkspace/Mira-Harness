import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const channels = vi.hoisted(() => ({ created: [] as Array<{ port1: unknown; port2: unknown }> }))
vi.mock('electron', () => ({
  MessageChannelMain: class {
    port1 = Object.assign(new EventEmitter(), { postMessage: vi.fn(), start: vi.fn(), close: vi.fn() })
    port2 = { close: vi.fn() }
    constructor() { channels.created.push(this) }
  },
}))

import { AppHostSession } from '../electron/services/appHostSession'

const entry = 'http://127.0.0.1:8123/apps/micro-example/index.html'
function fixture() {
  const frame = {}, contents = Object.assign(new EventEmitter(), {
    id: 27, mainFrame: frame, url: entry, getURL() { return this.url }, isDestroyed: () => false,
    setWindowOpenHandler: vi.fn(), postMessage: vi.fn(), loadURL: vi.fn(async () => undefined), close: vi.fn(),
  })
  const runtime = { open: vi.fn(() => 'grant'), revokeSession: vi.fn(), authorize: vi.fn(() => ({ appId: 'example', capabilities: [] })) }
  const onError = vi.fn(), session = new AppHostSession(contents as never, 'example', entry, runtime as never, {} as never, onError)
  const start = () => contents.emit('did-start-navigation', { url: entry, isMainFrame: true, isSameDocument: false })
  return { frame, contents, runtime, onError, session, start }
}
beforeEach(() => { channels.created.length = 0 })

describe('isolated application host session', () => {
  it('waits for the verified entry and accepts only its own main frame', () => {
    const { contents, frame, session, runtime, start } = fixture()
    expect(session.ready({} as never, frame as never)).toBe(false)
    expect(session.ready(contents as never, {} as never)).toBe(false)
    start()
    expect(session.ready(contents as never, frame as never)).toBe(true)
    expect(runtime.open).not.toHaveBeenCalled()
    contents.emit('did-finish-load')
    expect(runtime.open).toHaveBeenCalledExactlyOnceWith('example', 27)
    expect(contents.postMessage).toHaveBeenCalledExactlyOnceWith('mira-app:connect', null, [channels.created[0].port2])
    expect(session.ready(contents as never, frame as never)).toBe(false)
    session.dispose()
    expect(runtime.revokeSession).toHaveBeenCalledWith('grant', 27)
    expect(contents.close).toHaveBeenCalledOnce()
  })

  it('revokes a connected session on navigation and refuses any later ready request', () => {
    const { contents, frame, session, runtime, start } = fixture()
    start(); contents.emit('did-finish-load'); session.ready(contents as never, frame as never)
    const event = { preventDefault: vi.fn() }
    contents.emit('will-navigate', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(runtime.revokeSession).toHaveBeenCalledWith('grant', 27)
    expect(session.ready(contents as never, frame as never)).toBe(false)
    session.dispose()
  })

  it('closes ports and revokes the grant when handoff fails', () => {
    const { contents, frame, session, runtime, onError, start } = fixture()
    contents.postMessage.mockImplementation(() => { throw new Error('handoff failed') })
    start(); contents.emit('did-finish-load'); session.ready(contents as never, frame as never)
    expect(runtime.revokeSession).toHaveBeenCalledWith('grant', 27)
    expect(onError).toHaveBeenCalledOnce()
    expect(channels.created[0].port2.close).toHaveBeenCalledOnce()
    expect(session.ready(contents as never, frame as never)).toBe(false)
  })
})

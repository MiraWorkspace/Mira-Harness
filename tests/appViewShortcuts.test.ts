import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { bindAppViewShortcuts } from '../electron/services/appViewShortcuts'

function fixture() {
  const send = vi.fn(), owner = { isDestroyed: () => false, webContents: { send } }
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, executeJavaScript: vi.fn(async () => false) })
  const dispose = bindAppViewShortcuts(owner as never, contents as never)
  const key = (overrides = {}) => {
    const event = { preventDefault: vi.fn() }
    contents.emit('before-input-event', event, { type: 'keyDown', key: 'k', code: 'KeyK', meta: process.platform === 'darwin', control: process.platform !== 'darwin', shift: false, alt: false, isAutoRepeat: false, isComposing: false, ...overrides })
    return event
  }
  return { send, contents, dispose, key }
}

it('routes only shell shortcuts from focused native content and unbinds on disposal', () => {
  const { send, dispose, key } = fixture()
  expect(key().preventDefault).toHaveBeenCalledOnce()
  expect(send).toHaveBeenCalledWith('window:shortcut', expect.objectContaining({ key: 'k' }))
  key({ key: 'p', shift: true }); key({ key: ',' }); key({ key: 'i' })
  expect(send).toHaveBeenCalledTimes(4)
  for (const input of [{ key: 'c' }, { key: 'a' }, { key: 'k', alt: true }, { key: 'k', meta: false, control: false }, { isComposing: true }]) expect(key(input).preventDefault).not.toHaveBeenCalled()
  key({ isAutoRepeat: true }); key({ type: 'keyUp' })
  expect(send).toHaveBeenCalledTimes(4)
  dispose(); key()
  expect(send).toHaveBeenCalledTimes(4)
})

it('preserves theme shortcut exclusions inside the focused app or website', async () => {
  const { key, contents, send } = fixture()
  key({ key: 'l', shift: true })
  await Promise.resolve()
  expect(send).toHaveBeenCalledOnce()
  contents.executeJavaScript.mockResolvedValueOnce(true)
  key({ key: 'l', shift: true })
  await Promise.resolve()
  expect(send).toHaveBeenCalledOnce()
})

it.each(['darwin', 'win32'])('uses the correct host modifier on %s', platform => {
  const spy = vi.spyOn(process, 'platform', 'get').mockReturnValue(platform as NodeJS.Platform)
  try {
    const { key, send } = fixture()
    key({ meta: platform === 'darwin', control: platform !== 'darwin' })
    key({ meta: platform !== 'darwin', control: platform === 'darwin' })
    expect(send).toHaveBeenCalledOnce()
  } finally { spy.mockRestore() }
})

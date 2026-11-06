import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../electron/preload/appHost.cjs', import.meta.url), 'utf8')
function run(isMainFrame: boolean) {
  const handlers = new Map<string, (event: { ports: unknown[] }) => void>()
  const contextBridge = { exposeInMainWorld: vi.fn() }
  const ipcRenderer = { send: vi.fn(), on: vi.fn((channel, handler) => handlers.set(channel, handler)) }
  const window = { postMessage: vi.fn() }
  runInNewContext(source, { require: (name: string) => { if (name !== 'electron') throw new Error('Unexpected module'); return { contextBridge, ipcRenderer } }, process: { isMainFrame }, window })
  return { handlers, contextBridge, ipcRenderer, window }
}

describe('sandboxed application preload', () => {
  it('exposes only the ready signal in the main frame and transfers exactly one host port', () => {
    const fixture = run(true)
    expect(fixture.contextBridge.exposeInMainWorld).toHaveBeenCalledOnce()
    const [name, bridge] = fixture.contextBridge.exposeInMainWorld.mock.calls[0] as [string, { ready(): void }]
    expect(name).toBe('miraAppHost')
    expect(Object.keys(bridge)).toEqual(['ready'])
    bridge.ready(); expect(fixture.ipcRenderer.send).toHaveBeenCalledExactlyOnceWith('mira-app:ready')
    fixture.handlers.get('mira-app:connect')!({ ports: [] })
    expect(fixture.window.postMessage).not.toHaveBeenCalled()
    const port = {}
    fixture.handlers.get('mira-app:connect')!({ ports: [port] })
    expect(fixture.window.postMessage).toHaveBeenCalledWith({ type: 'mira:app-connect' }, '*', [port])
  })

  it('exposes nothing to subframes', () => {
    const fixture = run(false)
    expect(fixture.contextBridge.exposeInMainWorld).not.toHaveBeenCalled()
    expect(fixture.ipcRenderer.on).not.toHaveBeenCalled()
  })
})

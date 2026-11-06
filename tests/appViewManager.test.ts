import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ views: [] as any[], nextId: 100 }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    WebContentsView: class {
      options: unknown
      webContents: any
      setBounds = vi.fn()
      constructor(options: unknown) {
        this.options = options
        const appSession = Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn() } })
        this.webContents = Object.assign(new EventEmitter(), {
          id: mocks.nextId++, mainFrame: {}, session: appSession, url: '', destroyed: false,
          getURL() { return this.url }, isDestroyed() { return this.destroyed }, isFocused: vi.fn(() => true), focus: vi.fn(), setWindowOpenHandler: vi.fn(), setZoomFactor: vi.fn(), postMessage: vi.fn(), send: vi.fn(),
          loadURL(url: string) { this.url = url; return Promise.resolve() },
          close() { this.destroyed = true; this.emit('destroyed') },
        })
        mocks.views.push(this)
      }
    },
    MessageChannelMain: class {
      port1 = Object.assign(new EventEmitter(), { postMessage: vi.fn(), start: vi.fn(), close: vi.fn() })
      port2 = { close: vi.fn() }
    },
  }
})
vi.mock('../electron/bootstrap/miraMainWindow', () => ({ miraShellView: (owner: any) => owner.shellView }))
import { AppViewManager } from '../electron/services/appViewManager'

const app = { id: 'sample', installationId: 'a'.repeat(64), enabled: true, firstParty: true, requiredCapabilities: ['storage:app'], url: 'http://127.0.0.1:8123/apps/micro-sample/index.html' }
function fixture() {
  const ownerContents = Object.assign(new EventEmitter(), { send: vi.fn(), getZoomFactor: () => 1, isFocused: () => false, focus: vi.fn() })
  const shell = { webContents: ownerContents, setBounds: vi.fn(), setBackgroundColor: vi.fn() }
  const contentView = { children: [shell] as any[], addChildView: vi.fn((view, index?: number) => { const old = contentView.children.indexOf(view); if (old >= 0) contentView.children.splice(old, 1); contentView.children.splice(index ?? contentView.children.length, 0, view) }), removeChildView: vi.fn(view => { const old = contentView.children.indexOf(view); if (old >= 0) contentView.children.splice(old, 1) }) }
  const owner = Object.assign(new EventEmitter(), { shellView: shell, webContents: ownerContents, isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }), contentView })
  const runtime = { requireApproval: vi.fn(() => app), open: vi.fn(() => 'grant'), revokeSession: vi.fn() }
  const resolve = vi.fn(() => app)
  const manager = new AppViewManager(runtime as never, {} as never, resolve, '/isolated/appHost.cjs')
  return { owner, shell, ownerContents, runtime, resolve, manager }
}
beforeEach(() => { mocks.views.length = 0; mocks.nextId = 100 })

describe('isolated application view manager', () => {
  it('opens a first-party app without consent and creates a sandboxed per-app view, with bounded owner-only layout', () => {
    const { owner, runtime, manager } = fixture()
    const id = manager.open(owner as never, 'sample'), view = mocks.views[0]
    expect(runtime.requireApproval).toHaveBeenCalledWith('sample')
    expect(view.options.webPreferences).toMatchObject({ partition: 'persist:mira-app-sample', sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false, preload: '/isolated/appHost.cjs' })
    expect(owner.contentView.children).toContain(view)
    manager.setBounds(owner as never, id, { x: 700, y: 500, width: 300, height: 300 })
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 700, y: 500, width: 100, height: 100 })
    expect(() => manager.setBounds({} as never, id, { x: 0, y: 0, width: 10, height: 10 })).toThrow('无效')
    const download = { preventDefault: vi.fn() }; view.webContents.session.emit('will-download', download)
    expect(download.preventDefault).toHaveBeenCalledOnce()
    const root = owner.contentView
    manager.close(owner as never, id)
    expect(view.webContents.destroyed).toBe(true)
    expect(root.children).not.toContain(view)
  })

  it('does not create a view for an unapproved or changed installation', () => {
    const { owner, runtime, resolve, manager } = fixture()
    runtime.requireApproval.mockImplementationOnce(() => { throw new Error('未授权') })
    expect(() => manager.open(owner as never, 'sample')).toThrow('未授权')
    resolve.mockReturnValueOnce({ ...app, installationId: 'b'.repeat(64) })
    expect(() => manager.open(owner as never, 'sample')).toThrow('已变化')
    expect(mocks.views).toHaveLength(0)
  })

  it('refuses to open a third-party miniapp directly from the shell', () => {
    const { owner, runtime, manager } = fixture()
    runtime.requireApproval.mockReturnValue({ ...app, firstParty: false })
    expect(() => manager.open(owner as never, 'sample')).toThrow('只能通过子应用')
    expect(mocks.views).toHaveLength(0)
  })

  it('closes the view on shell navigation and refuses a forged ready sender', () => {
    const { owner, ownerContents, manager } = fixture()
    manager.open(owner as never, 'sample')
    const view = mocks.views[0], contents = view.webContents
    expect(manager.ready({ id: contents.id } as never, contents.mainFrame)).toBe(false)
    ownerContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(contents.destroyed).toBe(true)
    expect(manager.ready(contents, contents.mainFrame)).toBe(false)
  })

  it('binds a miniapp to its Workbench view and clips and closes it with its parent', () => {
    const { owner, runtime, resolve, manager } = fixture()
    const workbench = { ...app, id: 'mira-workbench', url: 'http://127.0.0.1:8123/apps/micro-mira-workbench/index.html' }
    runtime.requireApproval.mockImplementation(id => id === 'mira-workbench' ? workbench : { ...app, firstParty: false })
    resolve.mockImplementation(id => id === 'mira-workbench' ? workbench : { ...app, firstParty: false })
    const parent = manager.open(owner as never, 'mira-workbench')
    manager.setBounds(owner as never, parent, { x: 20, y: 30, width: 500, height: 400 })
    const child = manager.workbenchApp(parent, { type: 'open', appId: 'sample' }) as number
    expect(runtime.requireApproval).toHaveBeenCalledWith('sample')
    manager.workbenchApp(parent, { type: 'layout', id: child, visible: true, bounds: { x: 100, y: 100, width: 500, height: 500 } })
    expect(mocks.views[1].setBounds).toHaveBeenLastCalledWith({ x: 120, y: 130, width: 400, height: 300 })
    manager.setBounds(owner as never, parent, { x: 0, y: 0, width: 0, height: 0 })
    expect(mocks.views[1].setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    manager.setBounds(owner as never, parent, { x: 20, y: 30, width: 500, height: 400 })
    expect(mocks.views[1].setBounds).toHaveBeenLastCalledWith({ x: 120, y: 130, width: 400, height: 300 })
    expect(() => manager.workbenchApp(child, { type: 'close', id: child })).toThrow('权限')
    expect(() => manager.workbenchApp(parent, { type: 'open', appId: 'mira-workbench' })).toThrow('ID')
    manager.close(owner as never, parent)
    expect(mocks.views[0].webContents.destroyed).toBe(true)
    expect(mocks.views[1].webContents.destroyed).toBe(true)
  })
})


it('layers shell overlays above live app, miniapp and browser views and restores focus', () => {
  const { owner, shell, runtime, resolve, manager } = fixture()
  const workbench = { ...app, id: 'mira-workbench' }
  runtime.requireApproval.mockImplementation(id => id === workbench.id ? workbench : { ...app, firstParty: false })
  resolve.mockImplementation(id => id === workbench.id ? workbench : { ...app, firstParty: false })
  const id = manager.open(owner as never, workbench.id)
  manager.setBounds(owner as never, id, { x: 0, y: 40, width: 800, height: 560 })
  const view = mocks.views[0], boundsCalls = view.setBounds.mock.calls.length
  manager.setShellOverlay(owner as never, id, true)
  expect(owner.contentView.children.at(-1)).toBe(shell)
  expect(shell.setBackgroundColor).toHaveBeenCalledWith('#00000000')
  expect(owner.webContents.focus).toHaveBeenCalledOnce()
  expect(view.setBounds).toHaveBeenCalledTimes(boundsCalls)
  const mini = manager.workbenchApp(id, { type: 'open', appId: 'sample' })
  manager.workbenchBrowser(id, { type: 'open', tabId: 'page', url: 'https://example.com' })
  expect(owner.contentView.children.at(-1)).toBe(shell)
  expect(() => manager.setShellOverlay({} as never, id, true)).toThrow('无效')
  expect(() => manager.setShellOverlay(owner as never, mini as number, true)).toThrow('无效')
  manager.setShellOverlay(owner as never, id, false)
  expect(owner.contentView.children[0]).toBe(shell)
  expect(view.webContents.focus).toHaveBeenCalledOnce()
  expect(view.setBounds).toHaveBeenCalledTimes(boundsCalls)
  manager.closeAll()
})

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ views: [] as any[] }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { WebContentsView: class {
    webContents: any
    setBounds = vi.fn()
    constructor(public options: unknown) {
      const navigationHistory = { canGoBack: vi.fn(() => true), canGoForward: vi.fn(() => false), goBack: vi.fn(), goForward: vi.fn() }
      this.webContents = Object.assign(new EventEmitter(), { navigationHistory, session: { setPermissionRequestHandler: vi.fn() }, setWindowOpenHandler: vi.fn(), getURL: () => 'https://example.com/', getTitle: () => 'Example', isLoading: () => false, isDestroyed: () => false, loadURL: vi.fn(async () => undefined), close: vi.fn(), reload: vi.fn(), stop: vi.fn() })
      mock.views.push(this)
    }
  } }
})
import { WorkbenchBrowserViews } from '../electron/services/workbenchBrowserViews'

function fixture() {
  const owner = { isDestroyed: () => false, webContents: { getZoomFactor: () => 2 }, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } }
  const app = { isDestroyed: () => false, send: vi.fn() }
  return { owner, app, browser: new WorkbenchBrowserViews(owner as never, app as never) }
}
beforeEach(() => { mock.views.length = 0 })

describe('Workbench browser views', () => {
  it('bounds, controls and disposes tabs belonging to the application view', () => {
    const { browser, owner, app } = fixture()
    browser.setAppBounds({ x: 10, y: 20, width: 800, height: 600 })
    browser.open('one', 'https://example.com/')
    const view = mock.views[0]
    expect(view.options).toMatchObject({ webPreferences: { partition: 'persist:mira-workbench', sandbox: true, nodeIntegration: false } })
    browser.setLayout('one', { x: 50, y: 100, width: 500, height: 400 }, true)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 110, y: 220, width: 700, height: 400 })
    browser.setAppBounds({ x: 0, y: 0, width: 0, height: 0 })
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    browser.setAppBounds({ x: 10, y: 20, width: 800, height: 600 })
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 110, y: 220, width: 700, height: 400 })
    view.webContents.emit('did-stop-loading')
    expect(app.send).toHaveBeenCalledWith('mira-app:browser-event', expect.objectContaining({ type: 'state', tabId: 'one', title: 'Example' }))
    browser.control('one', 'back')
    expect(view.webContents.navigationHistory.goBack).toHaveBeenCalledOnce()
    browser.setLayout('home', { x: 0, y: 0, width: 0, height: 0 }, false)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    browser.dispose()
    expect(owner.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(view.webContents.close).toHaveBeenCalledOnce()
  })

  it('blocks unsafe URLs and relays tabs while allowing login popups', () => {
    const { browser, app } = fixture()
    expect(() => browser.open('bad', 'file:///private')).toThrow('地址')
    browser.open('one', 'https://example.com/')
    const handler = mock.views[0].webContents.setWindowOpenHandler.mock.calls[0][0]
    expect(handler({ url: 'https://example.com/new', disposition: 'new-window' })).toMatchObject({ action: 'allow' })
    expect(handler({ url: 'https://example.com/new', disposition: 'foreground-tab' })).toEqual({ action: 'deny' })
    expect(app.send).toHaveBeenCalledWith('mira-app:browser-event', { type: 'open-tab', url: 'https://example.com/new' })
    expect(handler({ url: 'file:///private', disposition: 'new-window' })).toEqual({ action: 'deny' })
    expect(() => browser.setLayout('one', { x: NaN, y: 0, width: 1, height: 1 }, true)).toThrow('尺寸')
    browser.dispose()
  })

  it('navigates an existing tab without replacing its view or history', () => {
    const { browser, owner } = fixture()
    browser.open('one', 'https://example.com/')
    const view = mock.views[0]
    browser.open('one', 'https://example.com/next')
    expect(mock.views).toHaveLength(1)
    expect(owner.contentView.addChildView).toHaveBeenCalledOnce()
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('https://example.com/next')
    browser.control('one', 'back')
    expect(view.webContents.navigationHistory.goBack).toHaveBeenCalledOnce()
    expect(() => browser.open('one', 'file:///private')).toThrow('地址')
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(2)
    browser.dispose()
  })

  it('reports the newly requested URL when navigation in an existing tab fails', async () => {
    const { browser, app } = fixture()
    browser.open('one', 'https://example.com/')
    mock.views[0].webContents.loadURL.mockRejectedValueOnce(new Error('offline'))
    browser.open('one', 'https://example.com/unavailable')
    await Promise.resolve()
    expect(app.send).toHaveBeenLastCalledWith('mira-app:browser-event', expect.objectContaining({ tabId: 'one', url: 'https://example.com/unavailable', error: '网页加载失败' }))
    browser.dispose()
  })

  it('ignores an interrupted load after a newer address has been submitted', async () => {
    const { browser, app } = fixture()
    browser.open('one', 'https://example.com/')
    let rejectLoad!: (error: Error) => void
    mock.views[0].webContents.loadURL.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLoad = reject }))
    browser.open('one', 'https://example.com/slow')
    browser.open('one', 'https://example.com/new')
    rejectLoad(new Error('ERR_ABORTED'))
    await Promise.resolve()
    expect(app.send).not.toHaveBeenCalled()
    browser.dispose()
  })
})

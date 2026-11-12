import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ windows: [] as any[], sampleFails: false, cpus: [{ times: { user: 10, idle: 90 } }], metrics: [{ pid: 42, type: 'Browser', cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 2048 } }] }))
vi.mock('../electron/bootstrap/miraMainWindow', () => ({ miraWindows: () => state.windows }))
vi.mock('../electron/bootstrap/resourceProcesses', () => ({ createChildResourceSampler: () => ({ sample: vi.fn(async () => { if (state.sampleFails) throw new Error('unavailable'); return [] }), reset: vi.fn() }) }))
vi.mock('electron', () => ({
  app: { isPackaged: true, getAppMetrics: () => state.metrics },
  webContents: { getAllWebContents: () => [] },
  BrowserWindow: class {
    static getAllWindows() { return state.windows }
    callbacks: Record<string, Function> = {}
    id = state.windows.length + 1
    destroyed = false
    constructor(public options: any) { state.windows.push(this) }
    webContents = { id: 100 + this.id, getOSProcessId: () => 1000 + this.id, session: { webRequest: { onBeforeRequest: vi.fn() } }, on: vi.fn(), send: vi.fn(), setWindowOpenHandler: vi.fn() }
    on(event: string, callback: Function) { this.callbacks[event] = callback }
    once(event: string, callback: Function) { this.callbacks[event] = callback }
    isDestroyed() { return this.destroyed }
    isMinimized() { return true }
    isMaximized = vi.fn(() => false); isFullScreen = vi.fn(() => false); minimize = vi.fn(); maximize = vi.fn(); unmaximize = vi.fn(); close = vi.fn()
    restore = vi.fn(); show = vi.fn(); focus = vi.fn(); loadFile = vi.fn(); loadURL = vi.fn(); setMenu = vi.fn()
  },
}))
vi.mock('node:os', () => ({ default: { cpus: () => state.cpus, totalmem: () => 8192, freemem: () => 2048 } }))
beforeEach(() => { vi.resetModules(); state.windows = []; state.sampleFails = false; state.cpus = [{ times: { user: 10, idle: 90 } }] })
it.each(['win32', 'darwin', 'linux'])('configures the title bar on %s', async platform => {
  vi.stubGlobal('process', { ...process, platform })
  try {
    const service = await import('../electron/bootstrap/resourceManager')
    service.openResourceManager()
    const window = state.windows[0]
    if (platform === 'win32') {
      expect(window.options).toMatchObject({ frame: false, titleBarStyle: 'hidden', autoHideMenuBar: true })
      expect(window.setMenu).toHaveBeenCalledWith(null)
    } else if (platform === 'darwin') {
      expect(window.options).toMatchObject({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 17 } })
      expect(window.options.frame).not.toBe(false)
      expect(window.setMenu).not.toHaveBeenCalled()
    } else {
      expect(window.options.titleBarStyle).toBeUndefined()
      expect(window.setMenu).not.toHaveBeenCalled()
    }
  } finally { vi.unstubAllGlobals() }
})
it('reports the resource window fullscreen state and forwards transitions', async () => {
  const service = await import('../electron/bootstrap/resourceManager')
  service.openResourceManager()
  const window = state.windows[0]
  expect(service.resourceWindowCommand(101, 'fullscreen-state')).toBe(false)
  window.isFullScreen.mockReturnValue(true)
  expect(service.resourceWindowCommand(101, 'fullscreen-state')).toBe(true)
  window.callbacks['enter-full-screen']()
  window.callbacks['leave-full-screen']()
  expect(window.webContents.send.mock.calls).toEqual([
    ['window:resource-fullscreen', true], ['window:resource-fullscreen', false],
  ])
  expect(() => service.resourceWindowCommand(999, 'fullscreen-state')).toThrow()
})
it('limits resource window commands to the resource window', async () => {
  const service = await import('../electron/bootstrap/resourceManager')
  service.openResourceManager()
  const window = state.windows[0]
  expect(() => service.resourceWindowCommand(999, 'close')).toThrow()
  expect(() => service.resourceWindowCommand(101, 'quit')).toThrow()
  service.resourceWindowCommand(101, 'minimize'); expect(window.minimize).toHaveBeenCalledOnce()
  service.resourceWindowCommand(101, 'maximize'); expect(window.maximize).toHaveBeenCalledOnce()
  window.isMaximized.mockReturnValue(true)
  service.resourceWindowCommand(101, 'maximize'); expect(window.unmaximize).toHaveBeenCalledOnce()
  service.resourceWindowCommand(101, 'close'); expect(window.close).toHaveBeenCalledOnce()
})
it('opens one isolated window, restores it, closes and reopens, and blocks reopening during exit', async () => {
  const service = await import('../electron/bootstrap/resourceManager')
  service.openResourceManager()
  const window = state.windows[0]
  expect(window.options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false })
  expect(window.loadFile.mock.calls[0][0]).toContain('resource-manager.html')
  window.callbacks['ready-to-show'](); expect(window.show).toHaveBeenCalledOnce()
  service.openResourceManager(); expect(state.windows).toHaveLength(1); expect(window.restore).toHaveBeenCalledOnce(); expect(window.focus).toHaveBeenCalledOnce()
  window.destroyed = true; window.callbacks.closed(); service.openResourceManager(); expect(state.windows).toHaveLength(2)
  service.stopResourceManager(); service.openResourceManager(); expect(state.windows).toHaveLength(2)
  const second = state.windows[1]; second.callbacks['ready-to-show'](); expect(second.show).not.toHaveBeenCalled()
})
it('restricts reads to the monitor and reports real CPU deltas and converts Electron KB to bytes', async () => {
  const service = await import('../electron/bootstrap/resourceManager')
  await expect(service.getResourceSnapshot(101)).rejects.toThrow()
  service.openResourceManager()
  await expect(service.getResourceSnapshot(999)).rejects.toThrow()
  const first = await service.getResourceSnapshot(101)
  expect(first.system.cpuPercent).toBeNull()
  expect(first.processes[0]).toMatchObject({ pid: 42, cpuPercent: 3, memoryBytes: 2097152, name: 'Mira 主进程' })
  state.cpus = [{ times: { user: 30, idle: 170 } }]
  expect((await service.getResourceSnapshot(101)).system).toMatchObject({ cpuPercent: 20, memoryUsedBytes: 6144, memoryTotalBytes: 8192 })
  service.stopResourceManager(); await expect(service.getResourceSnapshot(101)).rejects.toThrow()
})
it('retains Electron measurements on native sampling failure and clears the warning after recovery', async () => {
  const service = await import('../electron/bootstrap/resourceManager')
  service.openResourceManager(); state.sampleFails = true
  const partial = await service.getResourceSnapshot(101)
  expect(partial.warning).toContain('子进程采样失败')
  expect(partial.processes[0]).toMatchObject({ pid: 42, memoryBytes: 2097152 })
  state.sampleFails = false
  expect((await service.getResourceSnapshot(101)).warning).toBeUndefined()
  service.stopResourceManager()
})

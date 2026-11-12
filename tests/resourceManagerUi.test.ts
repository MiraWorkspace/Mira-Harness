// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import ResourceManager from '../src/resource-manager/ResourceManager.vue'
let app: App | undefined, container: HTMLDivElement | undefined
afterEach(() => { app?.unmount(); container?.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('renders Windows controls and follows maximized state', async () => {
  const windowCommand = vi.fn(async (_action: string) => false), unsubscribe = vi.fn()
  let updateMaximized: (value: boolean) => void = () => {}
  vi.stubGlobal('window', Object.assign(window, { resourceManager: { isWindows: true, windowCommand, onMaximized: (callback: typeof updateMaximized) => { updateMaximized = callback; return unsubscribe }, getSnapshot: vi.fn(async () => ({ system: {}, processes: [] })), storage: { cancel: vi.fn() }, network: {} } }))
  container = document.createElement('div'); document.body.append(container); app = createApp(ResourceManager); app.mount(container)
  await nextTick()
  expect(container.querySelector('.resource-header--macos')).toBeNull()
  container.querySelector<HTMLButtonElement>('[aria-label="最小化"]')!.click()
  container.querySelector<HTMLButtonElement>('[aria-label="最大化"]')!.click()
  updateMaximized(true); await nextTick()
  expect(container.querySelector('[aria-label="还原"]')).not.toBeNull()
  container.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click()
  expect(windowCommand.mock.calls.map(call => call[0])).toEqual(['state', 'minimize', 'maximize', 'close'])
  app.unmount(); app = undefined; expect(unsubscribe).toHaveBeenCalledOnce()
})
it('keeps macOS traffic lights beside the heading and releases their space in fullscreen', async () => {
  const windowCommand = vi.fn(async () => true), unsubscribe = vi.fn()
  let updateFullscreen: (value: boolean) => void = () => {}
  vi.stubGlobal('window', Object.assign(window, { resourceManager: { isMac: true, isWindows: false, windowCommand, onFullscreen: (callback: typeof updateFullscreen) => { updateFullscreen = callback; return unsubscribe }, getSnapshot: vi.fn(async () => ({ system: {}, processes: [] })), storage: { cancel: vi.fn() }, network: {} } }))
  container = document.createElement('div'); document.body.append(container); app = createApp(ResourceManager); app.mount(container)
  await nextTick(); await nextTick()
  expect(windowCommand).toHaveBeenCalledWith('fullscreen-state')
  expect(container.querySelector('.resource-header--macos.resource-header--fullscreen')).not.toBeNull()
  expect(container.querySelector('.resource-window-controls')).toBeNull()
  updateFullscreen(false); await nextTick()
  expect(container.querySelector('.resource-header--macos')).not.toBeNull()
  expect(container.querySelector('.resource-header--fullscreen')).toBeNull()
  updateFullscreen(true); await nextTick()
  expect(container.querySelector('.resource-header--fullscreen')).not.toBeNull()
  app.unmount(); app = undefined; expect(unsubscribe).toHaveBeenCalledOnce()
})
it('shows process purposes and plugin state, keeps groups collapsible, and pauses usage polling on storage', async () => {
  vi.useFakeTimers()
  const snapshot = { system: { cpuPercent: 20, memoryUsedBytes: 4096, memoryTotalBytes: 8192 }, processes: [{ pid: 1, name: 'Mira 主进程', cpuPercent: 2, memoryBytes: 2048, detail: '任务调度与数据管理' }, { pid: 2, name: '共享页面进程', category: 'ui', cpuPercent: 1, memoryBytes: 4096, views: [{ id: 1, name: '设置', status: '正在交互', detail: '/settings' }, { id: 2, name: '任务界面', status: '后台', detail: '/apps/mira-harness/' }] }], plugins: [{ id: 'review@local', name: '代码审查', category: 'community-plugin', status: '已启用 · 待调用', detail: '2 Skill · 按需执行', pids: [] }] }
  const getSnapshot = vi.fn(async () => snapshot), scan = vi.fn(async () => ({ root: '/data', totalBytes: 0, finishedAt: 1, volume: null, errors: 0, categories: [] })), cancel = vi.fn(async () => undefined)
  vi.stubGlobal('window', Object.assign(window, { resourceManager: { getSnapshot, storage: { scan, cancel, reveal: vi.fn() }, network: { getSnapshot: vi.fn(async () => ({ records: [], dropped: 0 })), clear: vi.fn() } } }))
  container = document.createElement('div'); document.body.append(container); app = createApp(ResourceManager); app.mount(container)
  await nextTick(); await nextTick()
  expect(container.querySelectorAll('.usage-group')).toHaveLength(5)
  expect(container.querySelector('.process-heading')?.textContent).toBe('进程 / 用途PIDCPU')
  expect(container.textContent).toContain('任务调度与数据管理')
  expect(container.textContent).toContain('代码审查已启用 · 待调用')
  expect(container.querySelectorAll('.resource-view')).toHaveLength(2)
  expect(container.querySelector('[data-testid=resource-manager-group-ui]')?.textContent).toContain('1 个进程')
  expect(container.querySelector('[data-testid=resource-manager-group-builtin-plugin]')?.textContent).toContain('尚未安装内置插件')
  expect(container.textContent).not.toContain('暂无进程')
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('[role=tab]')]
  buttons[1].click(); await nextTick()
  expect(container.querySelector('.process-heading')?.textContent).toBe('进程 / 用途PID内存')
  container.querySelector<HTMLButtonElement>('[data-testid=resource-manager-group-base] .group-heading')!.click(); await nextTick()
  expect(container.querySelector('[data-testid=resource-manager-group-base] .process-row')).toBeNull()
  buttons[2].click(); await nextTick(); await nextTick(); expect(scan).toHaveBeenCalledOnce()
  const count = getSnapshot.mock.calls.length; await vi.advanceTimersByTimeAsync(3000); expect(getSnapshot).toHaveBeenCalledTimes(count)
  buttons[0].click(); await nextTick(); expect(cancel).toHaveBeenCalledOnce(); expect(getSnapshot).toHaveBeenCalledTimes(count + 1)
})

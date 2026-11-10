// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import StorageSection from '../src/resource-manager/StorageSection.vue'
import type { MiraStorageSnapshot } from '../src/config/resourceManager'
let app: App | undefined, container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 6; i++) await nextTick() }
afterEach(() => { app?.unmount(); container?.remove() })
const fixture = (): MiraStorageSnapshot => ({
  root: '/data', finishedAt: 1, totalBytes: 108, volume: { totalBytes: 1000, freeBytes: 600 }, errors: 0,
  categories: [
    { id: 'apps', title: '子应用安装文件', bytes: 8, files: 1, entries: [{ name: '小说工作室 · novel', ownerId: 'novel', ownerName: '小说工作室', path: '/data/apps/novel', bytes: 8, files: 1 }] },
    { id: 'partitions', title: '浏览器与子应用站点数据', bytes: 100, files: 2, entries: [{ name: '小说工作室网页数据', ownerId: 'novel', ownerName: '小说工作室', path: '/data/Partitions/mira-app-novel', bytes: 100, cacheBytes: 60, files: 2 }] },
  ], actions: [{ id: 'cache-1', ownerId: 'novel', kind: 'cache', title: '清理 小说工作室 缓存', description: '保留登录状态、会话和业务数据。', bytes: 60 }, { id: 'data-1', ownerId: 'novel', kind: 'site-data', title: '清除 小说工作室 站点数据', description: '登录状态和未同步的网页数据会丢失。', bytes: 100 }],
})
async function mount(clean = vi.fn(async () => true)) {
  const bridge = { scan: vi.fn(async () => fixture()), cancel: vi.fn(async () => {}), reveal: vi.fn(async () => {}), clean }
  container = document.createElement('div'); document.body.append(container)
  app = createApp(StorageSection, { bridge }); app.mount(container); await flush()
  return bridge
}
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)!
it('groups all app bytes together, reveals measured files, and separates safe cache actions from site-data deletion', async () => {
  const bridge = await mount()
  expect(container.textContent).toContain('Mira 与子应用')
  expect(container.textContent).toContain('不包含应用程序本体、外部项目及授权目录中的文件')
  expect(container.querySelectorAll('.storage-group-button')).toHaveLength(1)
  container.querySelector<HTMLButtonElement>('.storage-group-button')!.click(); await flush()
  expect(container.textContent).toContain('/data/Partitions/mira-app-novel')
  expect(container.textContent).toContain('未同步的网页数据会丢失')
  container.querySelector<HTMLButtonElement>('.storage-reveal')!.click(); await flush()
  expect(bridge.reveal).toHaveBeenCalledWith('/data/Partitions/mira-app-novel')
  button('按用途').click(); await flush()
  expect(container.querySelectorAll('.storage-group-button')).toHaveLength(2)
  expect(container.querySelectorAll('.storage-cleanup-row')).toHaveLength(0)
})
it('opens cache-only actions, respects native cancellation and refreshes after completed cleanup', async () => {
  const clean = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true), bridge = await mount(clean)
  button('查看清理项目').click(); await flush()
  expect(container.querySelector<HTMLInputElement>('.storage-clean-filter input')!.checked).toBe(true)
  expect(container.querySelectorAll('.storage-cleanup-row')).toHaveLength(1)
  button('清理缓存').click(); await flush()
  expect(clean).toHaveBeenCalledWith('cache-1'); expect(bridge.scan).toHaveBeenCalledOnce()
  button('清理缓存').click(); await flush()
  expect(bridge.scan).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[role="status"]')?.textContent).toContain('存储统计已更新')
})
it('preserves displayed statistics on rescan failure and provides useful search empty states', async () => {
  const bridge = await mount()
  bridge.scan.mockRejectedValueOnce(new Error('busy'))
  button('重新扫描').click(); await flush()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('现有统计保留')
  expect(container.textContent).toContain('小说工作室')
  const input = container.querySelector<HTMLInputElement>('.storage-search input')!; input.value = 'no matching app'; input.dispatchEvent(new Event('input')); await flush()
  expect(container.textContent).toContain('没有符合筛选条件')
})
it('reports cleanup failures and prevents double submission while an operation is pending', async () => {
  let reject!: (error: Error) => void
  const clean = vi.fn(() => new Promise<boolean>((_resolve, fail) => { reject = fail })); await mount(clean)
  button('查看清理项目').click(); await flush(); button('清理缓存').click(); await flush()
  expect(button('正在处理…').disabled).toBe(true)
  reject(new Error('disk busy')); await flush()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('部分项目可能已处理')
  expect(clean).toHaveBeenCalledOnce()
})
it('names used and free space directly and keeps application composition separate from whole-disk capacity', async () => {
  await mount()
  expect(container.querySelector('.storage-footprint .storage-measure')?.textContent).toBe('已占用 108 B')
  expect(container.querySelector('.storage-volume .storage-measure')?.textContent).toBe('剩余可用 600 B')
  expect(container.querySelector('.storage-disk-share')?.textContent).toBe('约占整块磁盘 10.80%')
  expect(container.querySelector('.storage-volume-bar')?.getAttribute('aria-label')).toContain('系统及其余文件约占 29.20%，剩余可用 60.00%')
  expect(container.querySelector('.storage-volume-legend')?.textContent).toContain('系统及其余文件约 292 B')
  expect(container.querySelector('.storage-comparison button')?.getAttribute('aria-label')).toContain('占 Mira 数据 92.6%')
  expect(container.querySelector('.storage-composition')).toBeNull()
})

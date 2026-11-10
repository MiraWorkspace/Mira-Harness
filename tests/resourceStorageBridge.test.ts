import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiraStorageSnapshot } from '../src/config/resourceManager'
const state = vi.hoisted(() => ({ root: '', windows: [] as any[], snapshot: {} as MiraStorageSnapshot, confirm: vi.fn(), cache: vi.fn(async () => {}), code: vi.fn(async () => {}), data: vi.fn(async () => {}) }))
vi.mock('../electron/bootstrap/miraMainWindow', () => ({ miraWindows: () => [] }))
vi.mock('node:worker_threads', () => ({ Worker: class {
  once(event: string, callback: Function) { if (event === 'message') queueMicrotask(() => callback({ ok: true, snapshot: structuredClone(state.snapshot) })); return this }
  terminate() {}
} }))
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => state.root }, webContents: { getAllWebContents: () => [] },
  session: { defaultSession: { clearCache: state.cache, clearCodeCaches: state.code, clearStorageData: state.data, getStoragePath: () => state.root }, fromPartition: () => ({ clearCache: state.cache, clearCodeCaches: state.code, clearStorageData: state.data }) }, dialog: { showMessageBox: state.confirm },
  BrowserWindow: class {
    constructor() { state.windows.push(this) }
    webContents = { id: 101, session: { webRequest: { onBeforeRequest() {} } }, on() {}, setWindowOpenHandler() {} }
    isDestroyed() { return false } on() {} once() {} loadFile() {}
  },
}))
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); state.windows = []; state.confirm.mockResolvedValue({ response: 0 })
  state.root = await mkdtemp(join(tmpdir(), 'mira-cleanup-bridge-'))
  await mkdir(join(state.root, 'Cache'))
  state.snapshot = { root: state.root, totalBytes: 8, errors: 0, volume: null, finishedAt: 1, categories: [{ id: 'cache', title: '缓存', files: 1, bytes: 8, entries: [{ name: 'Cache', path: join(state.root, 'Cache'), ownerId: 'mira', ownerName: 'Mira', files: 1, bytes: 8, cacheBytes: 8 }] }] }
})
afterEach(async () => { await rm(state.root, { recursive: true, force: true }) })
async function setup() {
  const service = await import('../electron/bootstrap/resourceManager'); service.openResourceManager()
  const snapshot = await service.getResourceStorage(101)
  return { service, id: snapshot.actions![0].id }
}
it('requires the resource window, a current issued target, and native confirmation', async () => {
  const { service, id } = await setup()
  await expect(service.cleanResourceStorage(999, id)).rejects.toThrow()
  await expect(service.cleanResourceStorage(101, state.root)).rejects.toThrow()
  expect(await service.cleanResourceStorage(101, id)).toBe(false)
  expect(state.cache).not.toHaveBeenCalled()
  expect(state.confirm.mock.calls[0][1]).toMatchObject({ defaultId: 0, cancelId: 0 })
  state.confirm.mockResolvedValue({ response: 1 })
  expect(await service.cleanResourceStorage(101, id)).toBe(true)
  expect(state.cache).toHaveBeenCalledOnce(); expect(state.code).toHaveBeenCalledOnce(); expect(state.data).not.toHaveBeenCalled()
  await expect(service.cleanResourceStorage(101, id)).rejects.toThrow('失效')
})
it('invalidates stale targets after a rescan and prevents racing scans or repeated cleanup', async () => {
  const { service, id } = await setup()
  const newer = await service.getResourceStorage(101)
  await expect(service.cleanResourceStorage(101, id)).rejects.toThrow('失效')
  let confirm!: (value: { response: number }) => void
  state.confirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve }))
  const nextId = newer.actions![0].id, pending = service.cleanResourceStorage(101, nextId)
  await expect(service.getResourceStorage(101)).rejects.toThrow('正在清理')
  await expect(service.cleanResourceStorage(101, nextId)).rejects.toThrow()
  confirm({ response: 0 }); expect(await pending).toBe(false)
})
it('rechecks filesystem boundaries after confirmation before calling destructive APIs', async () => {
  const { service, id } = await setup()
  state.confirm.mockImplementationOnce(async () => { await symlink(state.root, join(state.root, 'Cache/replaced')); return { response: 1 } })
  await expect(service.cleanResourceStorage(101, id)).rejects.toThrow('符号链接')
  expect(state.cache).not.toHaveBeenCalled()
})

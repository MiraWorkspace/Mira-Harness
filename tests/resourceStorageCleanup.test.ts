import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanResourceStorage } from '../electron/bootstrap/resourceStorage'
import { executeStorageCleanup, storageCleanupTargets, validateStorageCleanupPath } from '../electron/bootstrap/resourceStorageCleanup'
let root: string
const apps = [{ id: 'novel', name: '小说工作室', identity: 'installation-1' }]
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'mira-cleanup-'))
  for (const [name, data] of Object.entries({ 'Cache/data': '12345', 'GPUCache/data': '12', 'Partitions/mira-app-novel/Cache/data': '123', 'Partitions/mira-app-novel/Code Cache/data': '12', 'Partitions/mira-app-novel/Cookies': 'cookie', 'app-data/novel.sqlite': 'database', 'app-data/files/novel/story': 'private', 'apps/novel/app.js': 'application' })) {
    await mkdir(join(root, name, '..'), { recursive: true }); await writeFile(join(root, name), data)
  }
  return scanResourceStorage(root, new AbortController().signal, apps)
}
it('attributes application bytes and measures only supported cache types without inflating totals', async () => {
  const snapshot = await fixture(), targets = storageCleanupTargets(snapshot, apps)
  const partition = snapshot.categories.find(category => category.id === 'partitions')!.entries[0]
  expect(partition).toMatchObject({ ownerId: 'novel', ownerName: '小说工作室', bytes: 11, cacheBytes: 5 })
  expect(snapshot.totalBytes).toBe(44)
  expect(targets.filter(target => target.kind === 'cache').reduce((sum, target) => sum + target.bytes, 0)).toBe(10)
  expect(targets.find(target => target.kind === 'database')).toMatchObject({ ownerId: 'novel', appIdentity: 'installation-1', bytes: 8 })
  expect(new Set(targets.map(target => target.id)).size).toBe(targets.length)
  expect(storageCleanupTargets(snapshot, [])).not.toContainEqual(expect.objectContaining({ kind: 'database' }))
})
it('clears caches through session APIs without clearing cookies, web storage or business databases', async () => {
  const targets = storageCleanupTargets(await fixture(), apps)
  const browser = { clearCache: vi.fn(async () => {}), clearCodeCaches: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}) }
  const dependencies = { session: vi.fn(() => browser), clearDatabase: vi.fn() }
  const cache = targets.find(target => target.kind === 'cache' && target.ownerId === 'novel')!
  await validateStorageCleanupPath(root, cache.path, cache.kind)
  await executeStorageCleanup(cache, dependencies)
  expect(dependencies.session).toHaveBeenCalledWith(join(root, 'Partitions/mira-app-novel'))
  expect(browser.clearCache).toHaveBeenCalledOnce(); expect(browser.clearCodeCaches).toHaveBeenCalledWith({})
  expect(browser.clearStorageData).not.toHaveBeenCalled(); expect(dependencies.clearDatabase).not.toHaveBeenCalled()
  await executeStorageCleanup(targets.find(target => target.kind === 'site-data')!, dependencies)
  expect(browser.clearStorageData).toHaveBeenCalledOnce()
  await executeStorageCleanup(targets.find(target => target.kind === 'database')!, dependencies)
  expect(dependencies.clearDatabase).toHaveBeenCalledWith('novel', 'installation-1')
})
it('rejects outside paths, replaced partition directories and linked cache descendants', async () => {
  await fixture()
  await expect(validateStorageCleanupPath(root, join(root, '..'))).rejects.toThrow()
  await symlink(join(root, 'apps'), join(root, 'Partitions/linked'))
  await expect(validateStorageCleanupPath(root, join(root, 'Partitions/linked'), 'site-data')).rejects.toThrow()
  await symlink(join(root, 'app-data/novel.sqlite'), join(root, 'Cache/linked'))
  await expect(validateStorageCleanupPath(root, root, 'cache')).rejects.toThrow('符号链接')
})
it('propagates partial cleanup failures instead of claiming success', async () => {
  const target = storageCleanupTargets(await fixture(), apps).find(target => target.kind === 'cache')!
  await expect(executeStorageCleanup(target, { session: () => ({ clearCache: async () => { throw new Error('disk busy') }, clearCodeCaches: vi.fn(), clearStorageData: vi.fn() }), clearDatabase: vi.fn() })).rejects.toThrow('disk busy')
})

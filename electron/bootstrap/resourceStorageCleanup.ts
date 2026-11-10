import { randomUUID } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { MiraStorageAction, MiraStorageSnapshot } from '../../src/config/resourceManager'
import { insideResourceRoot } from './resourceStorage'

export interface StorageApp { id: string; name: string; identity?: string }
export interface StorageCleanupTarget extends MiraStorageAction { path: string; appIdentity?: string }

/** Targets are issued by the main process from its last scan, never supplied as renderer paths. */
export function storageCleanupTargets(snapshot: MiraStorageSnapshot, apps: StorageApp[]): StorageCleanupTarget[] {
  const targets: StorageCleanupTarget[] = []
  const entries = snapshot.categories.flatMap(category => category.entries.map(entry => ({ ...entry, category: category.id })))
  const mainCache = entries.filter(entry => entry.category === 'cache').reduce((sum, entry) => sum + (entry.cacheBytes ?? 0), 0)
  function cache(path: string, ownerId: string, name: string, bytes: number) {
    if (bytes > 0) targets.push({ id: randomUUID(), kind: 'cache', ownerId, path, bytes, title: `清理 ${name} 缓存`, description: '清除网页与代码缓存，保留登录状态、会话和业务数据。下次打开页面可能稍慢。' })
  }
  cache(snapshot.root, 'mira', 'Mira 界面', mainCache)
  for (const entry of entries.filter(entry => entry.category === 'partitions')) {
    cache(entry.path, entry.ownerId!, entry.name, entry.cacheBytes ?? 0)
    if (entry.bytes > 0) targets.push({ id: randomUUID(), ownerId: entry.ownerId!, kind: 'site-data', path: entry.path, bytes: entry.bytes, title: `清除 ${entry.name} 站点数据`, description: '清除该浏览分区的 Cookie、登录状态、本地存储与网页缓存。未同步的网页数据会丢失；请先关闭相关网页，完成后重新打开。不会删除应用数据库和私有文件。' })
  }
  for (const app of apps) {
    const bytes = entries.filter(entry => entry.category === 'app-data' && entry.ownerId === app.id && /\.sqlite(?:-(?:wal|shm|journal))?$/.test(entry.path)).reduce((sum, entry) => sum + entry.bytes, 0)
    if (bytes > 0) targets.push({ id: randomUUID(), ownerId: app.id, kind: 'database', path: join(snapshot.root, 'app-data'), appIdentity: app.identity, bytes, title: `清除 ${app.name} 数据库`, description: '应用将关闭，主数据库与隔离数据库会永久删除。安装文件、私有文件、授权目录中的文件和网页登录状态保留。此操作不可撤销。' })
  }
  return targets
}

export async function validateStorageCleanupPath(root: string, path: string, kind?: MiraStorageAction['kind']) {
  if (!insideResourceRoot(root, path)) throw new Error('清理范围无效，请重新扫描')
  const parts = relative(root, path).split(/[\\/]/).filter(Boolean)
  let current = root
  for (const part of ['', ...parts]) {
    if (part) current = join(current, part)
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('数据目录已变化，请重新扫描')
  }
  async function rejectLinks(directory: string) {
    const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error })
    if (!info) return
    if (info.isSymbolicLink()) throw new Error('清理范围包含符号链接，请先检查文件位置')
    if (!info.isDirectory()) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('清理范围包含符号链接，请先检查文件位置')
      if (entry.isDirectory()) await rejectLinks(join(directory, entry.name))
    }
  }
  if (kind === 'site-data') await rejectLinks(path)
  if (kind === 'cache') for (const name of ['Cache', 'Code Cache']) await rejectLinks(join(path, name))
}

export async function executeStorageCleanup(target: StorageCleanupTarget, dependencies: {
  session(path: string): { clearCache(): Promise<void>; clearCodeCaches(options: Record<string, never>): Promise<void>; clearStorageData(): Promise<void> }
  clearDatabase(id: string, identity?: string): void
}) {
  if (target.kind === 'database') { dependencies.clearDatabase(target.ownerId, target.appIdentity); return }
  const browserSession = dependencies.session(target.path)
  if (target.kind === 'site-data') await browserSession.clearStorageData()
  await browserSession.clearCache()
  await browserSession.clearCodeCaches({})
}

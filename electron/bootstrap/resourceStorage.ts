import { readdir, lstat, statfs } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import type { MiraStorageSnapshot } from '../../src/config/resourceManager'
const categories = [
  { id: 'apps', title: '子应用安装文件', description: '已安装的子应用及更新文件，按应用列出', names: ['apps'] },
  { id: 'app-data', title: '子应用业务数据', description: '子应用数据库、私有文件与目录授权记录', names: ['app-data'] },
  { id: 'partitions', title: '浏览器与子应用站点数据', description: '各独立分区的网页缓存、登录状态与本地存储', names: ['Partitions'] },
  { id: 'sessions', title: 'Mira 会话与数据库', description: 'Mira 的对话记录和公共数据库', names: ['sessions', 'state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm'] },
  { id: 'artifacts', title: '工具输出与产物', description: '附件与工作流产物', names: ['attachments', 'workflow-artifacts'] },
  { id: 'logs', title: '日志与崩溃报告', description: '运行日志与崩溃诊断文件', names: ['logs', 'Crashpad'] },
  { id: 'runtimes', title: '运行时与插件', description: 'Mira 数据目录内的 Skill、插件与运行文件', names: ['skills', 'plugins'] },
  { id: 'config', title: '配置与工作区', description: '应用配置、记忆与内置工作区', names: ['config', 'memories', 'workspace', 'AGENTS.md'] },
  { id: 'cache', title: 'Mira 缓存', description: 'Mira 界面的网页代码与图形缓存', names: ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache'] },
  { id: 'site-data', title: 'Mira 网页存储与状态', description: 'Mira 界面的登录状态、本地存储与浏览器配置', names: ['Cookies', 'Cookies-journal', 'DIPS', 'DIPS-wal', 'DIPS-shm', 'Local State', 'Local Storage', 'Network', 'Network Persistent State', 'Preferences', 'Service Worker', 'Session Storage', 'Shared Dictionary', 'SharedStorage', 'SharedStorage-wal', 'SharedStorage-shm', 'TransportSecurity', 'Trust Tokens', 'Trust Tokens-journal', 'WebStorage', 'blob_storage', 'IndexedDB'] },
  { id: 'trash', title: '文件回收站', description: 'Mira 暂存的已删除项目文件', names: ['trash'] },
  { id: 'other', title: '待识别文件', description: '尚未识别用途的文件；可查看名称与路径', names: [] },
]
export function insideResourceRoot(root: string, path: string) { const back = relative(root, path); return !isAbsolute(back) && back !== '..' && !back.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) }
export async function scanResourceStorage(root: string, signal: AbortSignal, apps: { id: string; name: string }[] = []): Promise<MiraStorageSnapshot> {
  let errors = 0
  async function measure(path: string): Promise<{ bytes: number; files: number }> {
    signal.throwIfAborted()
    try {
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) return { bytes: 0, files: 0 }
      if (!stat.isDirectory()) return { bytes: stat.size, files: 1 }
      let bytes = 0, files = 0
      for (const name of await readdir(path)) { const child = await measure(join(path, name)); bytes += child.bytes; files += child.files }
      return { bytes, files }
    } catch (error) { signal.throwIfAborted(); errors++; return { bytes: 0, files: 0 } }
  }
  const groups: MiraStorageSnapshot['categories'] = categories.map(({ id, title, description }) => ({ id, title, description, bytes: 0, files: 0, entries: [] }))
  const appNames = new Map([['mira-workbench', 'Workbench'], ['mira-workbench-test', 'Workbench（测试版）'], ...apps.map(app => [app.id, app.name] as [string, string])])
  const namespaceOwners = [...appNames.keys()].map(id => ({ id, prefix: `scope-${createHash('sha256').update(id).digest('hex').slice(0, 24)}-` }))
  function appLabel(id: string) { return appNames.has(id) ? `${appNames.get(id)} · ${id}` : id }
  function entryLabel(category: string, path: string): { name: string; detail?: string } {
    const parts = relative(root, path).split(process.platform === 'win32' ? '\\' : '/'), name = parts[parts.length - 1]
    if (category === 'apps') return { name: appLabel(name), detail: name.startsWith('.') ? '安装辅助或待更新文件' : '子应用安装文件' }
    if (category === 'partitions') {
      if (name === 'mira-workbench') return { name: 'Workbench 浏览器', detail: 'Workbench 打开的网页，共享浏览分区' }
      if (name === 'mira-harness-browser') return { name: 'Mira 任务浏览器', detail: '任务中打开的网页，共享浏览分区' }
      if (name.startsWith('mira-app-')) {
        const id = name.slice('mira-app-'.length)
        return { name: appNames.has(id) ? appLabel(id) : /^[a-f0-9]{64}$/.test(id) ? '子应用独立视图' : appLabel(id), detail: '子应用网页缓存、登录状态与本地存储' }
      }
      return { name, detail: '独立网页分区' }
    }
    if (category === 'app-data') {
      if (parts[1] === 'files' && parts.length > 2) return { name: appLabel(name), detail: '子应用私有文件' }
      if (parts[1] === 'file-grants' && parts.length > 2) return { name: appLabel(name.replace(/\.json$/, '')), detail: '目录授权记录（不包含外部目录内容）' }
      const id = name.replace(/\.sqlite(?:-(?:wal|shm|journal))?$/, '')
      const owner = namespaceOwners.find(owner => id.startsWith(owner.prefix))
      return { name: appLabel(owner?.id ?? id), detail: owner ? `子应用隔离数据库 · ${name}` : /\.sqlite/.test(name) ? `子应用数据库 · ${name}` : name }
    }
    return { name }
  }
  async function addEntry(group: MiraStorageSnapshot['categories'][number], path: string) {
    const result = await measure(path)
    const parts = relative(root, path).split(process.platform === 'win32' ? '\\' : '/')
    const name = parts[parts.length - 1]
    let ownerId = 'mira', ownerName = 'Mira'
    if (['apps', 'app-data'].includes(group.id) && !name.startsWith('.')) {
      const id = name.replace(/\.sqlite(?:-(?:wal|shm|journal))?$|\.json$/g, '')
      const owner = namespaceOwners.find(owner => id.startsWith(owner.prefix))
      ownerId = owner?.id ?? id; ownerName = appNames.get(ownerId) ?? ownerId
    } else if (group.id === 'partitions') {
      if (name === 'mira-workbench') { ownerId = 'browser:workbench'; ownerName = 'Workbench 浏览器' }
      else if (name === 'mira-harness-browser') { ownerId = 'mira'; ownerName = 'Mira' }
      else { ownerId = name.startsWith('mira-app-') ? name.slice(9) : `partition:${name}`; ownerName = appNames.get(ownerId) ?? (/^[a-f0-9]{64}$/.test(ownerId) ? '子应用独立视图' : ownerId) }
    }
    let cacheBytes = group.id === 'cache' && ['Cache', 'Code Cache'].includes(name) ? result.bytes : 0
    if (group.id === 'partitions') for (const cache of ['Cache', 'Code Cache']) {
      const cachePath = join(path, cache)
      try { if ((await lstat(path)).isSymbolicLink()) break; await lstat(cachePath) }
      catch { continue }
      cacheBytes += (await measure(cachePath)).bytes
    }
    group.entries.push({ ...entryLabel(group.id, path), ownerId, ownerName, cacheBytes, path, ...result }); group.bytes += result.bytes; group.files += result.files
  }
  // Split only known containers; every file belongs to one measured entry.
  async function splitContainer(group: MiraStorageSnapshot['categories'][number], path: string, splitDataFiles = false) {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) { await addEntry(group, path); return }
    for (const name of await readdir(path)) {
      signal.throwIfAborted()
      const child = join(path, name)
      if (splitDataFiles && ['files', 'file-grants'].includes(name)) await splitContainer(group, child)
      else await addEntry(group, child)
    }
  }
  for (const name of await readdir(root)) {
    signal.throwIfAborted()
    const spec = categories.find(category => category.names.includes(name)) ?? categories[categories.length - 1]
    const group = groups.find(group => group.id === spec.id)!
    const path = join(root, name)
    try {
      if (['apps', 'app-data', 'partitions'].includes(group.id)) await splitContainer(group, path, group.id === 'app-data')
      else await addEntry(group, path)
    } catch { signal.throwIfAborted(); errors++ }
  }
  for (const group of groups) group.entries.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
  let volume: MiraStorageSnapshot['volume'] = null
  try { const stat = await statfs(root); volume = { totalBytes: stat.blocks * stat.bsize, freeBytes: stat.bavail * stat.bsize } } catch { /* Unknown disk capacity is displayed explicitly. */ }
  signal.throwIfAborted()
  return { root, finishedAt: Date.now(), totalBytes: groups.reduce((sum, group) => sum + group.bytes, 0), volume, categories: groups, errors }
}

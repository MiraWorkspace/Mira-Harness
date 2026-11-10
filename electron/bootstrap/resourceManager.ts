import { app, BrowserWindow, shell, session, dialog } from 'electron'
import os from 'node:os'
import { resolve, basename } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { MiraStorageSnapshot } from '../../src/config/resourceManager'
import { storageCleanupTargets, validateStorageCleanupPath, executeStorageCleanup, type StorageCleanupTarget } from './resourceStorageCleanup'
import { insideResourceRoot } from './resourceStorage'
import { createResourceNetwork } from './resourceNetwork'
import { join } from 'node:path'
import type { MiraResourceSnapshot } from '../../src/config/resourceManager'
import { collectResourceViews, describeResourcePlugins, identifyChildProcesses, type ResourceInventorySources } from './resourceInventory'
import { createChildResourceSampler } from './resourceProcesses'

let instance: BrowserWindow | null = null
const network = createResourceNetwork()
let storageScan: AbortController | undefined
let storagePaths = new Set<string>()
let cleanupTargets = new Map<string, StorageCleanupTarget>()
let cleaningStorage = false
let quitting = false
let previousCpu: { busy: number; total: number } | undefined
const children = createChildResourceSampler()
let inventory: ResourceInventorySources | undefined
let pluginCache: { at: number; items: ReturnType<ResourceInventorySources['plugins']> } | undefined

export function configureResourceManager(sources: ResourceInventorySources) { inventory = sources; pluginCache = undefined }

export function stopResourceManager() {
  quitting = true
  network.stop(); storageScan?.abort(); storagePaths.clear(); cleanupTargets.clear()
  previousCpu = undefined
  children.reset(); pluginCache = undefined
}

export function openResourceManager() {
  if (quitting) return
  if (instance && !instance.isDestroyed()) {
    if (instance.isMinimized()) instance.restore()
    instance.show(); instance.focus()
    return
  }
  const window = new BrowserWindow({
    width: 1040, height: 760, minWidth: 640, minHeight: 420,
    title: 'Mira 资源管理器', backgroundColor: '#1e1e1e', show: false,
    webPreferences: { preload: join(__dirname, '../preload/resourceManager.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  instance = window
  network.start()
  const appSession = window.webContents.session
  const requestObserver: NonNullable<Parameters<typeof window.webContents.session.webRequest.onBeforeRequest>[0]> = (details, callback) => {
    network.record(details.method, details.url, details.webContents?.getOSProcessId() ?? process.pid, details.webContentsId ? 'renderer' : 'main')
    callback({})
  }
  const stopObservation = () => { network.stop(); storageScan?.abort(); storagePaths.clear(); cleanupTargets.clear(); appSession.webRequest.onBeforeRequest(null) }
  window.webContents.on('render-process-gone', stopObservation)
  window.webContents.on('destroyed', stopObservation)
  appSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, requestObserver)
  previousCpu = undefined
  children.reset(); pluginCache = undefined
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.once('ready-to-show', () => { if (!quitting && !window.isDestroyed()) window.show() })
  window.on('closed', () => { if (instance === window) { instance = null; previousCpu = undefined; stopObservation() } })
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key.toLowerCase() === 'w' && (process.platform === 'darwin' ? input.meta : input.control)) { event.preventDefault(); window.close() }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/resource-manager.html`)
  else void window.loadFile(join(__dirname, '../renderer/resource-manager.html'))
}

export function isResourceManagerWindow(window: BrowserWindow) { return instance === window }

export async function getResourceSnapshot(senderId: number): Promise<MiraResourceSnapshot> {
  authorizeResources(senderId)
  let childProcesses: Awaited<ReturnType<typeof children.sample>> = [], warning: string | undefined
  try { childProcesses = await children.sample() }
  catch { children.reset(); warning = '子进程采样失败，当前仅显示 Electron 进程；下次刷新将重试。' }
  authorizeResources(senderId)
  const cpus = os.cpus()
  let busy = 0, total = 0
  for (const cpu of cpus) for (const [key, time] of Object.entries(cpu.times)) { total += time; if (key !== 'idle') busy += time }
  const baseline = previousCpu
  previousCpu = { busy, total }
  const cpuPercent = baseline && total > baseline.total ? Math.max(0, Math.min(100, 100 * (busy - baseline.busy) / (total - baseline.total))) : null
  const memoryTotalBytes = os.totalmem()
  const views = collectResourceViews(inventory?.views() ?? [], instance!.webContents.id)
  // Plugin declarations read package files; refresh them less often than process counters.
  if (!pluginCache || Date.now() - pluginCache.at >= 5000) pluginCache = { at: Date.now(), items: inventory?.plugins() ?? [] }
  const plugins = pluginCache.items, connections = inventory?.connections() ?? []
  const metrics = app.getAppMetrics(), metricPids = new Set(metrics.map(metric => metric.pid))
  const nativeRows = identifyChildProcesses(childProcesses.filter(row => !metricPids.has(row.pid)).map(row => ({
    pid: row.pid, parentPid: row.parentPid, name: row.name, category: 'other' as const, cpuPercent: row.cpuPercent, memoryBytes: row.memoryBytes, detail: `子进程 · 父 PID ${row.parentPid}`,
  })), plugins, connections, inventory?.terminals() ?? [])
  const names: Record<string, string> = { Browser: 'Mira 主进程', GPU: '图形处理', Tab: '页面渲染进程', Utility: '后台服务', 'Zygote': '进程服务' }
  const purposes: Record<string, string> = { Browser: '应用服务、模型调用、任务调度与数据管理', GPU: '页面合成、图形加速与视频处理', Utility: 'Chromium 后台服务', Zygote: 'Chromium 进程启动服务' }
  const processes: MiraResourceSnapshot['processes'] = [...metrics.map(metric => {
    const pages = views.get(metric.pid)
    return { pid: metric.pid, category: pages?.length ? 'ui' as const : 'base' as const,
      name: pages?.length === 1 ? pages[0].name : pages?.length ? `共享页面进程 · ${pages.length} 个界面` : metric.type === 'Utility' ? metric.name || metric.serviceName || names.Utility : names[metric.type] ?? metric.name ?? metric.type,
      detail: pages?.length ? pages.length > 1 ? '以下界面共享此进程，占用合并统计' : undefined : [purposes[metric.type], metric.serviceName].filter(Boolean).join(' · '), views: pages,
      cpuPercent: Math.max(0, metric.cpu.percentCPUUsage / (process.platform === 'linux' ? Math.max(1, cpus.length) : 1)),
      memoryBytes: metric.memory.workingSetSize * 1024 }
  }), ...nativeRows]
  return {
    sampledAt: Date.now(), system: { cpuPercent, memoryTotalBytes, memoryUsedBytes: Math.max(0, memoryTotalBytes - os.freemem()) },
    processes, plugins: describeResourcePlugins(plugins, connections, processes), warning,
  }
}

export function authorizeResources(senderId: number) {
  if (quitting || !instance || instance.isDestroyed() || senderId !== instance.webContents.id) throw new Error('资源采样不可用')
}
export async function getResourceStorage(senderId: number) {
  authorizeResources(senderId)
  if (cleaningStorage) throw new Error('正在清理，请稍后重新扫描')
  cleanupTargets.clear()
  storageScan?.abort()
  const controller = new AbortController(); storageScan = controller
  const snapshot = await new Promise<MiraStorageSnapshot>((resolveSnapshot, reject) => {
    const worker = new Worker(join(__dirname, 'resourceStorage.worker.js'), { workerData: { root: app.getPath('userData'), apps: inventory?.storageApps?.() ?? [] } })
    const abort = () => { void worker.terminate(); reject(new Error('扫描已取消')) }
    controller.signal.addEventListener('abort', abort, { once: true })
    worker.once('message', (message: { ok: boolean; snapshot: MiraStorageSnapshot }) => {
      if (message.ok) resolveSnapshot(message.snapshot); else reject(new Error('计算失败'))
    })
    worker.once('error', reject)
    worker.once('exit', code => { controller.signal.removeEventListener('abort', abort); if (code !== 0) reject(new Error('计算失败')) })
  })
  authorizeResources(senderId)
  controller.signal.throwIfAborted()
  storagePaths = new Set(snapshot.categories.flatMap(category => category.entries.map(entry => entry.path)))
  const targets = storageCleanupTargets(snapshot, inventory?.storageApps?.() ?? [])
  cleanupTargets = new Map(targets.map(target => [target.id, target]))
  snapshot.actions = targets.map(({ path: _path, appIdentity: _identity, ...action }) => action)
  return snapshot
}
export function cancelResourceStorage(senderId: number) { authorizeResources(senderId); storageScan?.abort() }
export function revealResourceStorage(senderId: number, path: unknown) {
  authorizeResources(senderId)
  if (typeof path !== 'string' || !insideResourceRoot(app.getPath('userData'), resolve(path)) || !storagePaths.has(path)) throw new Error('数据路径无效')
  shell.showItemInFolder(path)
}
export function getResourceNetwork(senderId: number) { authorizeResources(senderId); return network.snapshot() }
export function clearResourceNetwork(senderId: number) { authorizeResources(senderId); network.clear() }

export async function cleanResourceStorage(senderId: number, id: unknown) {
  authorizeResources(senderId)
  const target = typeof id === 'string' ? cleanupTargets.get(id) : undefined
  if (!target || cleaningStorage) throw new Error('清理项目已失效，请重新扫描')
  cleaningStorage = true
  try {
    const window = instance!
    const result = await dialog.showMessageBox(window, { type: 'warning', title: '存储管理', message: target.title + '？', detail: target.description, buttons: ['取消', target.kind === 'cache' ? '清理缓存' : '永久清除'], defaultId: 0, cancelId: 0, noLink: true })
    if (result.response !== 1) return false
    authorizeResources(senderId)
    if (instance !== window || cleanupTargets.get(target.id) !== target) throw new Error('清理项目已失效，请重新扫描')
    await validateStorageCleanupPath(app.getPath('userData'), target.path, target.kind)
    authorizeResources(senderId)
    if (cleanupTargets.get(target.id) !== target) throw new Error('清理项目已失效，请重新扫描')
    cleanupTargets.clear()
    await executeStorageCleanup(target, {
      session: path => {
        const browserSession = path === app.getPath('userData') ? session.defaultSession : session.fromPartition(`persist:${basename(path)}`)
        if (browserSession.getStoragePath() !== path) throw new Error('浏览分区路径已变化，请重新扫描')
        return browserSession
      },
      clearDatabase: (appId, identity) => { if (!inventory?.clearStorageDatabase) throw new Error('应用服务不可用'); inventory.clearStorageDatabase(appId, identity) },
    })
    return true
  } finally { cleaningStorage = false }
}

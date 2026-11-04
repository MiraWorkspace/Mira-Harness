import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { DEFAULT_APPS_CATALOG_URL, appCompatibilityError, appRelativePath, compatibleAppRelease, parseAppsCatalog, parseLocalAppManifest, validateCatalogUrl, type AppsCatalog, type AppsState, type InstalledApp, type LocalAppManifest } from '../../src/config/miraApps'
import type { MicroApp, PlatformSnapshot } from '../../src/types'
import type { MiraPaths } from '../storage/miraPaths'
import type { LocalMicroAppServer } from '../adapters/localMicroAppServer'

interface AppDatabase { getSnapshot(): PlatformSnapshot; savePreference(key: string, value: unknown): unknown }
const ENABLED_KEY = 'localAppsEnabled'
const URL_KEY = 'appsCatalogUrl'
const MAX_CATALOG_BYTES = 1024 * 1024
function inside(root: string, path: string) { const suffix = relative(root, path); return !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) }
function packageFile(root: string, path: string) {
  appRelativePath(path)
  const file = realpathSync(resolve(root, path))
  if (!inside(root, file) || !statSync(file).isFile()) throw new Error('包内文件不存在或超出应用目录')
  return file
}

export class MiraApps {
  private installed: InstalledApp[] = []
  private manifests = new Map<string, LocalAppManifest>()
  private catalog?: AppsCatalog
  private cachedUrl = ''
  private checkedAt?: string
  private cached = false
  private catalogError?: string
  private refreshing?: Promise<AppsState>
  private installing = false
  private pendingRestart = new Map<string, 'install' | 'uninstall'>()

  constructor(private readonly paths: MiraPaths, private readonly database: AppDatabase, private readonly server: LocalMicroAppServer, private readonly shellVersion: string, private readonly fetcher: typeof fetch) {
    const cache = join(paths.config, 'apps-catalog-cache.json')
    if (existsSync(cache)) {
      try {
        if (statSync(cache).size > MAX_CATALOG_BYTES + 4096) throw new Error('目录缓存过大')
        const stored = JSON.parse(readFileSync(cache, 'utf8'))
        this.cachedUrl = validateCatalogUrl(stored.url)
        this.catalog = parseAppsCatalog(stored.catalog)
        if (typeof stored.checkedAt === 'string') this.checkedAt = stored.checkedAt
        this.cached = true
      } catch { this.catalogError = '目录缓存无效，请重新检查更新' }
    }
  }

  scan() {
    mkdirSync(this.paths.apps, { recursive: true })
    const root = realpathSync(this.paths.apps)
    const installed: InstalledApp[] = []
    this.manifests.clear()
    const reserved = new Set(['main', ...this.database.getSnapshot().microApps.map(app => app.code)])
    for (const dir of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (dir.name.startsWith('.') || (!dir.isDirectory() && !dir.isSymbolicLink())) continue
      const directory = join(root, dir.name)
      const item: InstalledApp = { id: dir.name, name: dir.name, directory, enabled: false, test: false }
      try {
        if (dir.isSymbolicLink()) throw new Error('应用目录不能是符号链接')
        const file = packageFile(directory, 'app-manifest.json')
        if (statSync(file).size > 65536) throw new Error('应用清单不能超过 64 KB')
        const manifest = parseLocalAppManifest(JSON.parse(readFileSync(file, 'utf8')))
        Object.assign(item, { name: manifest.name, version: manifest.version, description: manifest.description, test: manifest.test })
        if (manifest.id !== dir.name) throw new Error('应用 ID 必须与目录名一致')
        if (reserved.has(manifest.id)) throw new Error('应用 ID 与已登记应用冲突，请使用独立测试 ID')
        packageFile(directory, manifest.entry)
        if (manifest.icon) packageFile(directory, manifest.icon)
        const error = appCompatibilityError(manifest, this.shellVersion)
        if (error) throw new Error(error)
        if (manifest.requiredCapabilities.length) throw new Error('此本地加载通道暂不支持宿主能力授权')
        this.manifests.set(item.id, manifest)
      } catch (error) { item.error = error instanceof Error ? error.message : '应用清单读取失败' }
      installed.push(item)
    }
    this.installed = installed
    this.syncResources()
    return this.state()
  }

  snapshot(): PlatformSnapshot {
    const snapshot = this.database.getSnapshot()
    const enabled = snapshot.preferences[ENABLED_KEY] as Record<string, boolean> | undefined
    const local: MicroApp[] = this.installed.filter(item => !item.error && this.pendingRestart.get(item.id) !== 'install').map((item, index) => {
      const manifest = this.manifests.get(item.id)!
      return { id: `micro-${item.id}`, code: item.id, name: item.name, description: item.description, version: item.version, test: item.test, localApp: true,
        icon: 'lucide:app-window', iconUrl: item.iconUrl, entry: { type: 'local-directory', directory: item.directory }, entryPath: manifest.entry,
        sort: 100 + index, enabled: enabled?.[item.id] !== false, integrationMode: 'iframe', runtimeConfig: { kind: 'iframe', iframe: { profile: 'compatible' } } }
    })
    return { ...snapshot, microApps: [...snapshot.microApps, ...local] }
  }

  private syncResources() {
    const snapshot = this.snapshot()
    this.server.setApps(snapshot.microApps)
    for (const item of this.installed) {
      const app = snapshot.microApps.find(app => app.localApp && app.code === item.id)
      item.enabled = app?.enabled ?? false
      item.iconUrl = undefined
      const manifest = this.manifests.get(item.id)
      if (item.enabled && manifest?.icon && this.server.port) {
        item.iconUrl = new URL(manifest.icon, this.server.getEntryUrl(`micro-${item.id}`)).href
      }
    }
  }

  state(): AppsState {
    const snapshot = this.snapshot()
    for (const app of snapshot.microApps) if (app.localApp) app.iconUrl = this.installed.find(item => item.id === app.code)?.iconUrl
    const url = typeof snapshot.preferences[URL_KEY] === 'string' && snapshot.preferences[URL_KEY] ? snapshot.preferences[URL_KEY] as string : DEFAULT_APPS_CATALOG_URL
    const matching = this.cachedUrl === url
    return { directory: this.paths.apps, installed: this.installed.map(item => ({ ...item })), pendingRestart: [...this.pendingRestart].map(([id, action]) => ({ id, action })), catalog: matching ? this.catalog : undefined, catalogUrl: url, checkedAt: matching ? this.checkedAt : undefined, cached: matching && this.cached, catalogError: this.catalogError, snapshot }
  }

  setEnabled(id: string, enabled: boolean) {
    if (typeof enabled !== 'boolean' || !this.manifests.has(id)) throw new Error('未找到有效的本地应用')
    const previous = this.database.getSnapshot().preferences[ENABLED_KEY] as Record<string, boolean> | undefined
    this.database.savePreference(ENABLED_KEY, { ...previous, [id]: enabled })
    this.syncResources()
    return this.state()
  }

  private applicationDirectory(id: string) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('应用 ID 无效')
    if (id === 'main' || this.database.getSnapshot().microApps.some(app => app.code === id)) throw new Error('不能安装或卸载内置应用')
    return join(realpathSync(this.paths.apps), id)
  }

  async install(id: string): Promise<AppsState> {
    if (this.installing) throw new Error('正在安装应用，请稍后重试')
    if (this.pendingRestart.has(id)) throw new Error('请先重启 Mira 以完成应用更改')
    this.scan()
    const destination = this.applicationDirectory(id)
    if (lstatSync(destination, { throwIfNoEntry: false })) throw new Error('应用目录已存在，请先卸载后重新安装')
    const catalog = this.state().catalog
    const application = catalog?.apps.find(app => app.id === id)
    const release = application && !catalog?.example ? compatibleAppRelease(application, this.shellVersion) : undefined
    if (!release) throw new Error('没有可安装的兼容版本，请先检查应用目录')
    const pkg = release.package
    if (!pkg.sizeBytes || pkg.sizeBytes > 64 * 1024 * 1024) throw new Error('应用安装包不能超过 64 MB')
    this.installing = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000)
    let temporary: string | undefined
    try {
      const response = await this.fetcher(pkg.url, { signal: controller.signal })
      if (!response.ok) throw new Error(`安装包下载失败（HTTP ${response.status}）`)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('安装包响应为空')
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          length += chunk.value.length
          if (length > pkg.sizeBytes) { await reader.cancel(); throw new Error('安装包大小与目录不一致') }
          chunks.push(chunk.value)
        }
      } finally { reader.releaseLock() }
      const bytes = Buffer.concat(chunks)
      if (length !== pkg.sizeBytes) throw new Error('安装包大小与目录不一致')
      if (createHash('sha256').update(bytes).digest('hex') !== pkg.sha256.toLowerCase()) throw new Error('安装包 SHA-256 校验失败')
      let expanded = 0, count = 0
      const names = new Set<string>()
      const files = unzipSync(bytes, { filter: file => {
        const path = file.name.endsWith('/') ? file.name.slice(0, -1) : file.name
        appRelativePath(path)
        if (path.split('/').some(part => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('安装包包含不兼容的文件名')
        const key = path.toLowerCase()
        if (names.has(key)) throw new Error('安装包包含重复路径')
        names.add(key)
        expanded += file.originalSize
        if (++count > 10000 || expanded > 256 * 1024 * 1024) throw new Error('安装包解压后过大')
        return !file.name.endsWith('/')
      } })
      temporary = mkdtempSync(join(realpathSync(this.paths.apps), '.install-'))
      for (const [path, content] of Object.entries(files)) {
        const target = join(temporary, path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content, { flag: 'wx' })
      }
      const file = packageFile(temporary, 'app-manifest.json')
      if (statSync(file).size > 65536) throw new Error('应用清单不能超过 64 KB')
      const manifest = parseLocalAppManifest(JSON.parse(readFileSync(file, 'utf8')))
      if (manifest.id !== id || manifest.version !== release.version || manifest.test) throw new Error('安装包清单与发布目录不一致')
      const error = appCompatibilityError(manifest, this.shellVersion)
      if (error) throw new Error(error)
      if (manifest.requiredCapabilities.length) throw new Error('此安装通道暂不支持宿主能力授权')
      packageFile(temporary, manifest.entry)
      if (manifest.icon) packageFile(temporary, manifest.icon)
      if (lstatSync(destination, { throwIfNoEntry: false })) throw new Error('应用目录已存在，请先卸载后重新安装')
      renameSync(temporary, destination)
      temporary = undefined
      this.pendingRestart.set(id, 'install')
      this.scan()
      return this.setEnabled(id, true)
    } catch (error) {
      if (controller.signal.aborted) throw new Error('安装包下载超时，请重试')
      throw error
    } finally {
      clearTimeout(timeout)
      this.installing = false
      if (temporary) rmSync(temporary, { recursive: true, force: true })
    }
  }

  uninstall(id: string): AppsState {
    if (this.installing) throw new Error('正在安装应用，请稍后重试')
    if (this.pendingRestart.has(id)) throw new Error('请先重启 Mira 以完成应用更改')
    this.scan()
    const directory = this.applicationDirectory(id)
    if (!this.installed.some(app => app.id === id)) throw new Error('未找到已安装的应用')
    const stat = lstatSync(directory)
    if (stat.isSymbolicLink()) unlinkSync(directory)
    else rmSync(directory, { recursive: true, force: true })
    const enabled = { ...this.database.getSnapshot().preferences[ENABLED_KEY] as Record<string, boolean> | undefined }
    delete enabled[id]
    this.database.savePreference(ENABLED_KEY, enabled)
    this.pendingRestart.set(id, 'uninstall')
    return this.scan()
  }

  debugDirectory(id: string) {
    this.scan()
    const directory = this.applicationDirectory(id)
    if (!this.installed.some(item => item.id === id && item.test) || lstatSync(directory).isSymbolicLink()) throw new Error('未找到调试应用目录')
    return directory
  }

  refreshCatalog(url = this.state().catalogUrl): Promise<AppsState> {
    if (this.refreshing) return this.refreshing
    const normalized = validateCatalogUrl(url)
    this.database.savePreference(URL_KEY, normalized)
    this.refreshing = this.fetchCatalog(normalized).finally(() => { this.refreshing = undefined })
    return this.refreshing
  }

  private async fetchCatalog(url: string): Promise<AppsState> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    try {
      const response = await this.fetcher(url, { signal: controller.signal, headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } })
      if (!response.ok) throw new Error(`应用目录请求失败（HTTP ${response.status}）`)
      if (+response.headers.get('content-length')! > MAX_CATALOG_BYTES) throw new Error('应用目录不能超过 1 MB')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('应用目录响应为空')
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          length += chunk.value.length
          if (length > MAX_CATALOG_BYTES) { await reader.cancel(); throw new Error('应用目录不能超过 1 MB') }
          chunks.push(chunk.value)
        }
      } finally { reader.releaseLock() }
      let parsed: unknown
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('应用目录不是有效 JSON，请使用 Release 资源下载地址') }
      const catalog = parseAppsCatalog(parsed)
      const checkedAt = new Date().toISOString()
      const cache = join(this.paths.config, 'apps-catalog-cache.json')
      const temporary = `${cache}.tmp`
      writeFileSync(temporary, JSON.stringify({ url, checkedAt, catalog }), { mode: 0o600 })
      renameSync(temporary, cache)
      this.catalog = catalog; this.cachedUrl = url; this.checkedAt = checkedAt; this.cached = false; this.catalogError = undefined
    } catch (error) {
      this.cached = this.cachedUrl === url && Boolean(this.catalog)
      this.catalogError = controller.signal.aborted ? '应用目录请求超时，请重试' : error instanceof Error ? error.message : '应用目录请求失败'
    } finally { clearTimeout(timeout) }
    return this.state()
  }
}

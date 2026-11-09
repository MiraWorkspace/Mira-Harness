import type { PlatformSnapshot } from '@/types'

export const DEFAULT_APPS_CATALOG_URL = 'https://github.com/tuyn53/Mira-Harness/releases/download/apps-catalog/apps-catalog.json'

export interface AppCompatibility { minShellVersion: string; platformApi: { major: number; minor: number } }
export interface LocalAppManifest {
  manifestVersion: 1
  id: string
  name: string
  version: string
  description?: string
  icon?: string
  entry: string
  runtime?: 'platform'
  test?: boolean
  minShellVersion: string
  platformApi: { major: number; minor: number }
  requiredCapabilities: string[]
}
export interface AppRelease {
  version: string
  channel: 'stable' | 'preview'
  publishedAt: string
  releaseNotes: string
  compatibility: AppCompatibility
  package: { url: string; sizeBytes: number | null; sha256: string }
}
export interface CatalogApp { id: string; name: string; description: string; repository: string; icon?: string; releases: AppRelease[] }
export interface AppsCatalog { schemaVersion: 1; revision: number; publishedAt: string; example?: boolean; notice?: string; apps: CatalogApp[] }
export interface InstalledApp { id: string; name: string; version?: string; description?: string; iconUrl?: string; test: boolean; enabled: boolean; directory: string; error?: string; updateError?: string }
export interface AppsState { directory: string; installed: InstalledApp[]; blocked?: string[]; pendingRestart: { id: string; action: 'install' | 'uninstall' }[]; catalog?: AppsCatalog; catalogUrl: string; checkedAt?: string; cached: boolean; catalogError?: string; snapshot: PlatformSnapshot }

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
export function compareAppVersions(a: string, b: string): number {
  const left = VERSION.exec(a), right = VERSION.exec(b)
  if (!left || !right) throw new Error('版本必须是 SemVer 格式')
  for (let i = 1; i <= 3; i++) if (+left[i] !== +right[i]) return +left[i] > +right[i] ? 1 : -1
  if (left[4] === right[4]) return 0
  if (!left[4] || !right[4]) return left[4] ? -1 : 1
  const x = left[4].split('.'), y = right[4].split('.')
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i])
    if (nx !== ny) return nx ? -1 : 1
    return nx ? (+x[i] > +y[i] ? 1 : -1) : (x[i] > y[i] ? 1 : -1)
  }
  return 0
}
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('应用配置必须是 JSON 对象')
  return value as Record<string, any>
}
function string(value: unknown, field: string, max = 512): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${field} 无效`)
}
function identity(value: unknown) { string(value, '应用 ID', 64); if (!/^[a-z][a-z0-9-]*$/.test(value)) throw new Error('应用 ID 只能包含小写字母、数字和连字符') }
export function appRelativePath(value: unknown): asserts value is string {
  string(value, '包内路径')
  if (!/^[a-zA-Z0-9._/-]+$/.test(value) || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('入口和图标必须是包内相对路径')
}
function compatibility(value: unknown) {
  const item = record(value), api = record(item.platformApi)
  string(item.minShellVersion, '最低 Mira 版本'); compareAppVersions(item.minShellVersion, item.minShellVersion)
  if (!Number.isSafeInteger(api.major) || api.major < 1 || !Number.isSafeInteger(api.minor) || api.minor < 0) throw new Error('平台 API 版本无效')
}
export function appCompatibilityError(value: AppCompatibility, shellVersion: string): string | undefined {
  if (compareAppVersions(shellVersion, value.minShellVersion) < 0) return `需要 Mira ${value.minShellVersion} 或更新版本`
  if (value.platformApi.major !== 1 || value.platformApi.minor > 2) return '当前 Mira 不支持此应用要求的平台 API'
}
export function parseLocalAppManifest(value: unknown): LocalAppManifest {
  const item = record(value)
  if (item.manifestVersion !== 1) throw new Error('不支持的应用清单版本')
  identity(item.id); string(item.name, '应用名称', 80); string(item.version, '应用版本'); compareAppVersions(item.version, item.version)
  appRelativePath(item.entry)
  if (item.icon !== undefined) appRelativePath(item.icon)
  if (item.description !== undefined) string(item.description, '应用描述', 1000)
  if (item.test !== undefined && typeof item.test !== 'boolean') throw new Error('test 必须是布尔值')
  compatibility(item)
  if (item.runtime !== undefined && item.runtime !== 'platform') throw new Error('应用运行时无效')
  if (item.runtime === 'platform' && (item.platformApi.major !== 1 || item.platformApi.minor < 1)) throw new Error('平台运行时需要 API 1.1 或更新版本')
  if (!Array.isArray(item.requiredCapabilities) || item.requiredCapabilities.some((cap: unknown) => typeof cap !== 'string')) throw new Error('requiredCapabilities 必须是字符串数组')
  return { manifestVersion: 1, id: item.id, name: item.name, version: item.version, description: item.description, icon: item.icon, entry: item.entry, ...(item.runtime ? { runtime: item.runtime } : {}), test: item.test ?? false, minShellVersion: item.minShellVersion, platformApi: { major: item.platformApi.major, minor: item.platformApi.minor }, requiredCapabilities: [...item.requiredCapabilities] }
}
export function usesPlatformRuntime(manifest: LocalAppManifest) { return manifest.runtime === 'platform' || manifest.requiredCapabilities.length > 0 }
function https(value: unknown) {
  string(value, 'HTTPS 地址', 2048)
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('必须使用不包含账号密码的 HTTPS 地址')
}
export function validateCatalogUrl(value: string) {
  https(value)
  const url = new URL(value)
  if (url.hostname !== 'github.com' || url.port || url.search || url.hash || !/^\/[^/]+\/[^/]+\/releases\/(?:download\/[^/]+|latest\/download)\/[^/]+\.json$/.test(url.pathname)) throw new Error('请填写 GitHub Release 中 JSON 资源的直接下载地址')
  return url.href
}
export function parseAppsCatalog(value: unknown): AppsCatalog {
  const item = record(value)
  if (item.schemaVersion !== 1 || !Number.isSafeInteger(item.revision) || item.revision < 1) throw new Error('应用目录版本无效')
  if (typeof item.publishedAt !== 'string' || !Number.isFinite(Date.parse(item.publishedAt))) throw new Error('目录发布时间无效')
  if (item.example !== undefined && typeof item.example !== 'boolean') throw new Error('example 必须是布尔值')
  if (!Array.isArray(item.apps) || item.apps.length > 100) throw new Error('应用目录列表无效')
  const ids = new Set<string>()
  for (const appValue of item.apps) {
    const app = record(appValue)
    identity(app.id); string(app.name, '应用名称', 80); string(app.description, '应用描述', 1000); https(app.repository)
    if (app.icon !== undefined) https(app.icon)
    if (app.test !== undefined) throw new Error('线上目录不能声明测试应用')
    if (ids.has(app.id)) throw new Error('目录中有重复应用 ID')
    ids.add(app.id)
    if (!Array.isArray(app.releases) || app.releases.length > 100) throw new Error('应用版本列表无效')
    const versions = new Set<string>()
    for (const releaseValue of app.releases) {
      const release = record(releaseValue)
      string(release.version, '发布版本'); compareAppVersions(release.version, release.version)
      if (versions.has(release.version)) throw new Error('目录中有重复发布版本')
      versions.add(release.version)
      if (!['stable', 'preview'].includes(release.channel) || (release.channel === 'stable' && VERSION.exec(release.version)?.[4])) throw new Error('发布渠道与版本不匹配')
      if (typeof release.publishedAt !== 'string' || !Number.isFinite(Date.parse(release.publishedAt))) throw new Error('版本发布时间无效')
      if (typeof release.releaseNotes !== 'string' || release.releaseNotes.length > 10000) throw new Error('更新说明无效')
      compatibility(release.compatibility)
      const pkg = record(release.package); https(pkg.url)
      if (!item.example && (!Number.isSafeInteger(pkg.sizeBytes) || pkg.sizeBytes <= 0 || typeof pkg.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(pkg.sha256))) throw new Error('正式目录必须提供真实文件大小和 SHA-256')
    }
  }
  return item as unknown as AppsCatalog
}
export function compatibleAppRelease(app: CatalogApp, shellVersion: string, channel: 'stable' | 'preview' = 'stable') {
  return app.releases.filter(release => (channel === 'preview' || release.channel === 'stable') && !appCompatibilityError(release.compatibility, shellVersion))
    .sort((a, b) => compareAppVersions(b.version, a.version))[0]
}

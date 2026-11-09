import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareAppVersions, compatibleAppRelease, parseAppsCatalog, parseLocalAppManifest, validateCatalogUrl } from '../src/config/miraApps'
import { MiraPaths } from '../electron/storage/miraPaths'
import { LocalMicroAppServer } from '../electron/adapters/localMicroAppServer'
import { MiraApps } from '../electron/services/miraApps'
import { AppRuntime } from '../electron/services/appRuntime'
import { microApps } from '../src/config/microApps'
import { applications, applyPlatformSnapshot } from '../src/config/runtime'
import { resolveMicroAppEntryUrl } from '../src/config/navigation'
import type { PlatformSnapshot } from '../src/types'

const roots: string[] = []
const servers: LocalMicroAppServer[] = []
const services: MiraApps[] = []
afterEach(async () => { services.splice(0).forEach(apps => apps.stopWatching()); vi.unstubAllGlobals(); await Promise.all(servers.splice(0).map(server => server.stop())); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const manifest = { manifestVersion: 1, id: 'mira-workbench-test', name: 'Mira Workbench', version: '0.1.0', entry: 'index.html', icon: 'logo.png', test: true, minShellVersion: '0.1.0-beta.1', platformApi: { major: 1, minor: 0 }, requiredCapabilities: [] }
const url = 'https://github.com/tuyn53/Mira-Harness/releases/download/apps-catalog/apps-catalog.json'
function fixture(fetcher: typeof fetch = vi.fn()) {
  const root = mkdtempSync(join(tmpdir(), 'mira-apps-')); roots.push(root)
  const paths = new MiraPaths(root).ensure()
  const snapshot: PlatformSnapshot = { mainMenus: [], microApps: structuredClone(microApps), preferences: {} }
  const database = { getSnapshot: () => structuredClone(snapshot), savePreference: (key: string, value: unknown) => { snapshot.preferences[key] = value } }
  const server = new LocalMicroAppServer(); servers.push(server)
  const create = () => { const apps = new MiraApps(paths, database, server, '0.1.0-beta.1', fetcher); services.push(apps); return apps }
  const directory = join(paths.apps, manifest.id)
  mkdirSync(directory)
  writeFileSync(join(directory, 'app-manifest.json'), JSON.stringify(manifest)); writeFileSync(join(directory, 'index.html'), '<h1>Workbench test</h1>'); writeFileSync(join(directory, 'logo.png'), 'logo')
  return { root, paths, snapshot, server, directory, create, apps: create() }
}
function catalog() {
  const example = JSON.parse(readFileSync(new URL('../docs/examples/apps-catalog.example.json', import.meta.url), 'utf8'))
  delete example.example; delete example.notice
  for (const app of example.apps) for (const release of app.releases) { release.package.sizeBytes = 100; release.package.sha256 = 'a'.repeat(64) }
  return example
}

describe('application package and remote catalog contract', () => {
  it('parses the documented example while refusing its placeholder packages as production data', () => {
    const example = JSON.parse(readFileSync(new URL('../docs/examples/apps-catalog.example.json', import.meta.url), 'utf8'))
    expect(parseAppsCatalog(example).apps[0].id).toBe('mira-workbench')
    delete example.example
    expect(() => parseAppsCatalog(example)).toThrow('SHA-256')
    expect(parseAppsCatalog(catalog()).apps).toHaveLength(3)
  })
  it('compares prerelease versions and selects the newest compatible stable release instead of the first release', () => {
    expect(compareAppVersions('0.1.0-beta.2', '0.1.0-beta.10')).toBeLessThan(0)
    expect(compareAppVersions('0.1.0', '0.1.0-beta.10')).toBeGreaterThan(0)
    const app = parseAppsCatalog(catalog()).apps[0]
    app.releases.unshift({ ...app.releases[0], version: '1.0.0', compatibility: { minShellVersion: '9.0.0', platformApi: { major: 1, minor: 0 } } })
    expect(compatibleAppRelease(app, '0.1.0-beta.1')?.version).toBe('0.1.0')
  })
  it('rejects unsafe package paths, malformed test flags, and arbitrary catalog destinations', () => {
    for (const entry of ['../index.html', '/index.html', 'https://example.com/', 'assets\\index.html', '%2e%2e/index.html']) expect(() => parseLocalAppManifest({ ...manifest, entry })).toThrow()
    expect(() => parseLocalAppManifest({ ...manifest, test: 'true' })).toThrow('test')
    expect(() => parseLocalAppManifest({ ...manifest, runtime: 'unknown' })).toThrow('运行时')
    expect(() => parseLocalAppManifest({ ...manifest, runtime: 'platform' })).toThrow('1.1')
    expect(validateCatalogUrl(url)).toBe(url)
    expect(validateCatalogUrl('https://github.com/tuyn53/Mira-Harness/releases/latest/download/apps-catalog.json')).toContain('/latest/download/')
    for (const value of ['http://github.com/a/b/releases/download/v1/apps.json', 'https://example.com/apps.json', 'https://github.com/a/b/blob/main/apps.json', `${url}?token=secret`]) expect(() => validateCatalogUrl(value)).toThrow()
  })
})

describe('local applications discovery and lifecycle', () => {
  it('exports only bounded installed package icons as image data', () => {
    const f = fixture(); f.apps.scan()
    expect(f.apps.platformIcon(manifest.id)).toBe(`data:image/png;base64,${Buffer.from('logo').toString('base64')}`)
    writeFileSync(join(f.directory, 'logo.png'), Buffer.alloc(1024 * 1024 + 1))
    expect(f.apps.platformIcon(manifest.id)).toBeUndefined()
    rmSync(join(f.directory, 'logo.png'))
    symlinkSync('/etc/hosts', join(f.directory, 'logo.png'))
    expect(f.apps.platformIcon(manifest.id)).toBeUndefined()
    expect(f.apps.platformIcon('unknown')).toBeUndefined()
  })

  it('serves a script-free legacy migration document from the local origin', async () => {
    const f = fixture()
    await f.server.start([])
    const response = await fetch(`http://127.0.0.1:${f.server.port}/mira-internal/legacy-workbench`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('<!doctype html><title></title>')
  })

  it('invalidates application sessions on disable, package manifest change, and external removal', () => {
    const f = fixture(), invalidate = vi.fn()
    f.apps.onAppInvalidated(invalidate)
    f.apps.scan()
    f.apps.setEnabled(manifest.id, false)
    expect(invalidate).toHaveBeenCalledWith(manifest.id, 'disabled')
    invalidate.mockClear()
    f.apps.setEnabled(manifest.id, true)
    writeFileSync(join(f.directory, 'app-manifest.json'), JSON.stringify({ ...manifest, name: 'New name' }))
    f.apps.scan()
    expect(invalidate).toHaveBeenCalledWith(manifest.id, 'changed')
    invalidate.mockClear()
    rmSync(f.directory, { recursive: true })
    f.apps.scan()
    expect(invalidate).toHaveBeenCalledWith(manifest.id, 'removed')
  })

  it('resolves installed application identity from current package content and refuses stale or disabled packages', () => {
    const f = fixture()
    f.apps.scan()
    const first = f.apps.resolvePlatformApp(manifest.id)
    expect(first).toMatchObject({ id: manifest.id, enabled: true, requiredCapabilities: [] })
    expect(first?.installationId).toMatch(/^[a-f0-9]{64}$/)
    writeFileSync(join(f.directory, 'index.html'), '<h1>Changed</h1>')
    expect(f.apps.resolvePlatformApp(manifest.id)?.installationId).not.toBe(first?.installationId)
    writeFileSync(join(f.directory, 'app-manifest.json'), JSON.stringify({ ...manifest, name: 'Changed' }))
    expect(f.apps.resolvePlatformApp(manifest.id)).toBeUndefined()
    f.apps.scan()
    expect(f.apps.resolvePlatformApp(manifest.id)).toBeDefined()
    f.apps.setEnabled(manifest.id, false)
    expect(f.apps.resolvePlatformApp(manifest.id)).toBeUndefined()
  })

  it('detects Finder-style removal without manual scanning and invalidates its resource entry', async () => {
    const f = fixture()
    f.apps.scan(); await f.server.start(f.apps.snapshot().microApps); f.apps.scan()
    const changed = vi.fn()
    f.apps.startWatching(changed)
    rmSync(f.directory, { recursive: true })
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(changed.mock.calls[0][0].installed).toEqual([])
    expect(changed.mock.calls[0][0].snapshot.microApps.map((app: { code: string }) => app.code)).toEqual(['mira-harness'])
    expect(() => f.server.getEntryUrl(`micro-${manifest.id}`)).toThrow()
  })

  it('still publishes removal if a settings scan runs before the directory debounce', async () => {
    const f = fixture(); f.apps.scan()
    const changed = vi.fn(); f.apps.startWatching(changed)
    rmSync(f.directory, { recursive: true }); f.apps.scan()
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(changed.mock.calls[0][0].installed).toEqual([])
  })

  it('stops a queued directory scan when the app service shuts down', async () => {
    const f = fixture(); f.apps.scan()
    const changed = vi.fn(); f.apps.startWatching(changed)
    rmSync(f.directory, { recursive: true })
    await new Promise(resolve => setTimeout(resolve, 30))
    f.apps.stopWatching()
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(changed).not.toHaveBeenCalled()
  })

  it('serves a discovered test app and its logo, preserves disabled state across restart, and removes missing apps', async () => {
    const f = fixture()
    f.apps.scan(); await f.server.start(f.apps.snapshot().microApps)
    const state = f.apps.scan(), local = state.snapshot.microApps.find(app => app.code === manifest.id)!
    expect(state.installed[0]).toMatchObject({ name: manifest.name, test: true, enabled: true })
    expect(local).toMatchObject({ test: true, localApp: true, entryPath: 'index.html', integrationMode: 'iframe' })
    expect(await (await fetch(f.server.getEntryUrl(local.id))).text()).toContain('Workbench test')
    expect(await (await fetch(local.iconUrl!)).text()).toBe('logo')
    applyPlatformSnapshot(state.snapshot)
    expect(applications.value.find(app => app.code === manifest.id)).toMatchObject({ name: manifest.name, test: true, iconUrl: local.iconUrl })
    applyPlatformSnapshot(f.apps.setEnabled(manifest.id, false).snapshot)
    expect(applications.value.some(app => app.code === manifest.id)).toBe(false)
    const restarted = f.create(); expect(restarted.scan().installed[0].enabled).toBe(false)
    expect(() => f.server.getEntryUrl(local.id)).toThrow()
    applyPlatformSnapshot(restarted.setEnabled(manifest.id, true).snapshot)
    expect(applications.value.some(app => app.code === manifest.id)).toBe(true)
    rmSync(f.directory, { recursive: true })
    expect(restarted.scan().installed).toEqual([])
    expect(restarted.snapshot().microApps.map(app => app.code)).toEqual(['mira-harness'])
  })
  it('loads an explicitly configured nested entry under the package resource root', async () => {
    const f = fixture()
    mkdirSync(join(f.directory, 'pages'))
    writeFileSync(join(f.directory, 'pages/start.html'), '<h1>Custom entry</h1>')
    writeFileSync(join(f.directory, 'app-manifest.json'), JSON.stringify({ ...manifest, entry: 'pages/start.html' }))
    f.apps.scan(); await f.server.start(f.apps.snapshot().microApps)
    const local = f.apps.scan().snapshot.microApps.find(app => app.code === manifest.id)!
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
    const entry = resolveMicroAppEntryUrl(local, `/micro/${manifest.id}`, f.server.getEntryUrl(local.id))
    expect(entry).toContain('/pages/start.html')
    expect(await (await fetch(entry)).text()).toContain('Custom entry')
  })
  it('keeps invalid packages visible as errors and never grants capabilities or replaces Harness', () => {
    const f = fixture()
    writeFileSync(join(f.directory, 'app-manifest.json'), JSON.stringify({ ...manifest, requiredCapabilities: ['harness:workbench'] }))
    expect(f.apps.scan().installed[0].error).toContain('权限列表无效')
    expect(f.apps.snapshot().microApps).toHaveLength(1)
    for (const id of ['mira-harness', 'main']) {
      const spoof = join(f.paths.apps, id); mkdirSync(spoof)
      writeFileSync(join(spoof, 'app-manifest.json'), JSON.stringify({ ...manifest, id }))
      expect(f.apps.scan().installed.find(item => item.id === id)?.error).toContain('冲突')
    }
  })
  it('rejects package symlink escapes and malformed manifests without preventing other apps loading', () => {
    const f = fixture(); const invalid = join(f.paths.apps, 'invalid'); mkdirSync(invalid)
    writeFileSync(join(invalid, 'app-manifest.json'), '{bad json')
    expect(f.apps.scan().installed.find(item => item.id === manifest.id)?.error).toBeUndefined()
    writeFileSync(join(f.root, 'outside.html'), 'outside')
    rmSync(join(f.directory, 'index.html')); symlinkSync(join(f.root, 'outside.html'), join(f.directory, 'index.html'))
    expect(f.apps.scan().installed.find(item => item.id === manifest.id)?.error).toContain('超出应用目录')
    expect(f.apps.snapshot().microApps).toHaveLength(1)
  })
})

describe('GitHub Release catalog fetching', () => {
  it('uses the official Release catalog without requiring user configuration', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog())))
    const f = fixture(fetcher)
    expect(f.apps.state().catalogUrl).toBe(url)
    expect((await f.apps.refreshCatalog()).catalog?.apps).toHaveLength(3)
    expect(fetcher).toHaveBeenCalledWith(url, expect.anything())
  })
  it('validates and caches successful responses, retains matching cache on failure, and isolates a different source', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog())))
    const f = fixture(fetcher); f.apps.scan()
    let state = await f.apps.refreshCatalog(url)
    expect(state.catalog?.apps).toHaveLength(3); expect(state.cached).toBe(false); expect(state.checkedAt).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    fetcher.mockResolvedValue(new Response('not found', { status: 404 }))
    state = await f.apps.refreshCatalog(url)
    expect(state.cached).toBe(true); expect(state.catalogError).toContain('404'); expect(state.catalog?.apps).toHaveLength(3)
    expect(f.create().state().catalog?.apps).toHaveLength(3)
    state = await f.apps.refreshCatalog(url.replace('apps-catalog.json', 'other.json'))
    expect(state.catalog).toBeUndefined(); expect(state.cached).toBe(false)
  })
  it('does not replace a valid cache with HTML, invalid JSON, or oversized content', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog())))
    const f = fixture(fetcher); await f.apps.refreshCatalog(url)
    for (const response of [new Response('<html>login</html>'), new Response('{"schemaVersion":99}'), new Response('x'.repeat(1024 * 1024 + 1))]) {
      fetcher.mockResolvedValue(response)
      const state = await f.apps.refreshCatalog(url)
      expect(state.cached).toBe(true); expect(state.catalog?.apps).toHaveLength(3); expect(state.catalogError).toBeTruthy()
    }
  })

  it('persists blocked application IDs and rejects IDs absent from the catalog and local applications', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog())))
    const f = fixture(fetcher)
    await f.apps.refreshCatalog()
    expect(f.apps.setBlocked('mira-workbench', true).blocked).toEqual(['mira-workbench'])
    expect(f.create().state().blocked).toEqual(['mira-workbench'])
    expect(f.apps.setBlocked('mira-workbench', false).blocked).toEqual([])
    expect(() => f.apps.setBlocked('unknown-app', true)).toThrow('未找到应用')
  })
})

const productionManifest = { ...manifest, id: 'mira-workbench', test: false }
const miniappManifest = { ...productionManifest, id: 'example-miniapp', runtime: 'platform', platformApi: { major: 1, minor: 1 } }
const miniappBytes = () => zipSync({ 'app-manifest.json': strToU8(JSON.stringify(miniappManifest)), 'index.html': strToU8('app'), 'logo.png': strToU8('logo') })
function installationFixture(entries: Record<string, Uint8Array> = {}) {
  const bytes = zipSync({ 'app-manifest.json': strToU8(JSON.stringify(productionManifest)), 'index.html': strToU8('<h1>Installed Workbench</h1>'), 'logo.png': strToU8('logo'), ...entries })
  const remote = catalog(); remote.apps = [remote.apps[0]]
  const pkg = remote.apps[0].releases[0].package
  pkg.sizeBytes = bytes.length; pkg.sha256 = createHash('sha256').update(bytes).digest('hex')
  const fetcher = vi.fn(async (input: string | URL | Request) => String(input) === url ? new Response(JSON.stringify(remote)) : new Response(bytes))
  return { ...fixture(fetcher as typeof fetch), bytes, remote, fetcher }
}

async function installCatalogPackage(f: ReturnType<typeof installationFixture>, apps: MiraApps, bytes: Uint8Array) {
  const release = f.remote.apps[0].releases[0]
  release.version = JSON.parse(new TextDecoder().decode(unzipSync(bytes)['app-manifest.json'])).version
  release.package.sizeBytes = bytes.length
  release.package.sha256 = createHash('sha256').update(bytes).digest('hex')
  f.fetcher.mockImplementation(async input => String(input) === url ? new Response(JSON.stringify(f.remote)) : new Response(bytes))
  await apps.refreshCatalog()
  return apps.install('mira-workbench')
}

describe('official application installation and uninstallation', () => {

  it('stages a catalog update, keeps the old package until restart and preserves app data', async () => {
    const f = installationFixture()
    await installCatalogPackage(f, f.apps, f.bytes)
    const running = f.create(); running.scan()
    const oldIdentity = running.resolvePlatformApp('mira-workbench')?.installationId
    const invalidated = vi.fn(); running.onAppInvalidated(invalidated)
    const records = new Map<string, unknown>()
    const runtime = new AppRuntime(join(f.paths.root, 'test-app-data'), { get: id => records.get(id), set: (id, value) => { records.set(id, value) }, delete: id => records.delete(id) }, id => running.resolvePlatformApp(id))
    const session = runtime.open('mira-workbench', 1)
    const dataDir = join(f.paths.root, 'app-data'); mkdirSync(dataDir, { recursive: true }); writeFileSync(join(dataDir, 'mira-workbench.sqlite'), 'saved')
    const update = zipSync({ 'app-manifest.json': strToU8(JSON.stringify({ ...productionManifest, version: '0.2.0' })), 'index.html': strToU8('new version'), 'logo.png': strToU8('logo') })
    const state = await installCatalogPackage(f, running, update)
    expect(state.pendingRestart).toEqual([{ id: 'mira-workbench', action: 'install' }])
    expect(state.snapshot.microApps.find(item => item.code === 'mira-workbench')).toMatchObject({ enabled: true, version: '0.1.0' })
    expect(running.resolvePlatformApp('mira-workbench')?.installationId).toBe(oldIdentity)
    expect(invalidated).not.toHaveBeenCalled()
    expect(runtime.authorize(session, 1).appId).toBe('mira-workbench')
    expect(readFileSync(join(f.paths.apps, 'mira-workbench', 'index.html'), 'utf8')).toContain('Installed Workbench')
    const restarted = f.create(); expect(restarted.scan().installed.find(item => item.id === 'mira-workbench')?.version).toBe('0.2.0')
    expect(readFileSync(join(f.paths.apps, 'mira-workbench', 'index.html'), 'utf8')).toBe('new version')
    expect(readFileSync(join(dataDir, 'mira-workbench.sqlite'), 'utf8')).toBe('saved')
    await expect(installCatalogPackage(f, restarted, update)).rejects.toThrow('高于')
    runtime.close()
  })

  it('recovers an interrupted update after the old directory was backed up', async () => {
    const f = installationFixture(); await installCatalogPackage(f, f.apps, f.bytes)
    const running = f.create(); running.scan()
    const update = zipSync({ 'app-manifest.json': strToU8(JSON.stringify({ ...productionManifest, version: '0.2.0' })), 'index.html': strToU8('new'), 'logo.png': strToU8('logo') })
    await installCatalogPackage(f, running, update)
    const target = join(f.paths.apps, 'mira-workbench'), backup = join(f.paths.apps, '.backup-mira-workbench')
    renameSync(target, backup)
    expect(f.create().scan().installed.find(item => item.id === 'mira-workbench')?.version).toBe('0.2.0')
    expect(existsSync(backup)).toBe(false)
  })

  it('does not activate a staged update whose content changed before restart', async () => {
    const f = installationFixture(); await installCatalogPackage(f, f.apps, f.bytes)
    const running = f.create(); running.scan()
    const update = zipSync({ 'app-manifest.json': strToU8(JSON.stringify({ ...productionManifest, version: '0.2.0' })), 'index.html': strToU8('new'), 'logo.png': strToU8('logo') })
    await installCatalogPackage(f, running, update)
    writeFileSync(join(f.paths.apps, '.update-mira-workbench', 'index.html'), 'modified')
    const retry = f.create()
    expect(retry.scan().installed.find(item => item.id === 'mira-workbench')).toMatchObject({ version: '0.1.0', updateError: expect.any(String) })
    expect(readFileSync(join(f.paths.apps, '.update-mira-workbench', 'index.html'), 'utf8')).toBe('modified')
    expect(readFileSync(join(f.paths.apps, 'mira-workbench', 'index.html'), 'utf8')).toContain('Installed Workbench')
    await installCatalogPackage(f, retry, update)
    expect(f.create().scan().installed.find(item => item.id === 'mira-workbench')?.version).toBe('0.2.0')
    expect(readdirSync(f.paths.apps).some(name => name.startsWith('.rejected-mira-workbench-'))).toBe(true)
  })

  it('restores the backup when an interrupted update left a damaged target', async () => {
    const f = installationFixture(); await installCatalogPackage(f, f.apps, f.bytes)
    const running = f.create(); running.scan()
    const target = join(f.paths.apps, 'mira-workbench'), backup = join(f.paths.apps, '.backup-mira-workbench')
    renameSync(target, backup); mkdirSync(target); writeFileSync(join(target, 'app-manifest.json'), '{broken')
    const restored = f.create().scan().installed.find(item => item.id === 'mira-workbench')
    expect(restored).toMatchObject({ version: '0.1.0', enabled: true })
    expect(readFileSync(join(target, 'index.html'), 'utf8')).toContain('Installed Workbench')
    expect(readFileSync(join(f.paths.apps, '.failed-mira-workbench', 'app-manifest.json'), 'utf8')).toBe('{broken')
    expect(existsSync(backup)).toBe(false)
  })

  it('does not restore a changed backup when an interrupted update left a damaged target', async () => {
    const f = installationFixture(); await installCatalogPackage(f, f.apps, f.bytes)
    const running = f.create(); running.scan()
    const update = zipSync({ 'app-manifest.json': strToU8(JSON.stringify({ ...productionManifest, version: '0.2.0' })), 'index.html': strToU8('new'), 'logo.png': strToU8('logo') })
    await installCatalogPackage(f, running, update)
    const target = join(f.paths.apps, 'mira-workbench'), backup = join(f.paths.apps, '.backup-mira-workbench')
    renameSync(target, backup); writeFileSync(join(backup, 'index.html'), 'changed backup')
    mkdirSync(target); writeFileSync(join(target, 'app-manifest.json'), '{broken')
    const state = f.create().scan()
    expect(state.installed.find(item => item.id === 'mira-workbench')?.error).toBeTruthy()
    expect(readFileSync(join(backup, 'index.html'), 'utf8')).toBe('changed backup')
    expect(readFileSync(join(target, 'app-manifest.json'), 'utf8')).toBe('{broken')
  })

  it('updates a disabled app without changing its enabled state', async () => {
    const f = installationFixture(); await installCatalogPackage(f, f.apps, f.bytes)
    const running = f.create(); running.scan(); running.setEnabled('mira-workbench', false)
    const update = zipSync({ 'app-manifest.json': strToU8(JSON.stringify({ ...productionManifest, version: '0.2.0' })), 'index.html': strToU8('new'), 'logo.png': strToU8('logo') })
    await installCatalogPackage(f, running, update)
    const restored = f.create().scan().installed.find(item => item.id === 'mira-workbench')
    expect(restored).toMatchObject({ version: '0.2.0', enabled: false })
  })

  it('stages an update downloaded from the catalog', async () => {
    const f = installationFixture(); await installCatalogPackage(f, f.apps, f.bytes)
    const running = f.create(); running.scan()
    const update = zipSync({ 'app-manifest.json': strToU8(JSON.stringify({ ...productionManifest, version: '0.2.0' })), 'index.html': strToU8('remote update'), 'logo.png': strToU8('logo') })
    const release = f.remote.apps[0].releases[0]; release.version = '0.2.0'; release.package.sizeBytes = update.length; release.package.sha256 = createHash('sha256').update(update).digest('hex')
    f.fetcher.mockImplementation(async input => String(input) === url ? new Response(JSON.stringify(f.remote)) : new Response(update))
    await running.refreshCatalog()
    await running.install('mira-workbench')
    expect(readFileSync(join(f.paths.apps, 'mira-workbench', 'index.html'), 'utf8')).toContain('Installed Workbench')
    expect(f.create().scan().installed.find(item => item.id === 'mira-workbench')?.version).toBe('0.2.0')
  })

  it('leaves Workbench legacy miniapps outside Mira installation and runtime registries', () => {
    const f = fixture(), directory = join(f.paths.apps, '.miniapps', 'example-miniapp')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'app-manifest.json'), JSON.stringify(miniappManifest))
    writeFileSync(join(directory, 'index.html'), 'legacy')
    const state = f.apps.scan()
    expect(state.installed.some(item => item.id === 'example-miniapp')).toBe(false)
    expect(state.snapshot.microApps.some(item => item.code === 'example-miniapp')).toBe(false)
    expect(f.apps.resolvePlatformApp('example-miniapp')).toBeUndefined()
    expect(readFileSync(join(directory, 'index.html'), 'utf8')).toBe('legacy')
  })

  it('marks packages requesting supported capabilities for the isolated platform runtime', () => {
    const f = fixture()
    writeFileSync(join(f.directory, 'app-manifest.json'), JSON.stringify({ ...manifest, requiredCapabilities: ['storage:app', 'appearance:read'] }))
    const state = f.apps.scan()
    expect(state.installed[0].error).toBeUndefined()
    expect(state.snapshot.microApps.find(app => app.code === manifest.id)).toMatchObject({ platformApp: true })
    expect(f.apps.resolvePlatformApp(manifest.id)?.requiredCapabilities).toEqual(['appearance:read', 'storage:app'])
  })

  it('loads an explicitly declared platform application without capabilities and retains legacy behavior', () => {
    const f = fixture()
    const legacy = f.apps.scan().snapshot.microApps.find(app => app.code === manifest.id)
    expect(legacy?.platformApp).toBe(false)
    writeFileSync(join(f.directory, 'app-manifest.json'), JSON.stringify({ ...manifest, runtime: 'platform', platformApi: { major: 1, minor: 1 } }))
    const updated = f.apps.scan().snapshot.microApps.find(app => app.code === manifest.id)
    expect(updated?.platformApp).toBe(true)
    expect(f.apps.resolvePlatformApp(manifest.id)?.requiredCapabilities).toEqual([])
    writeFileSync(join(f.directory, 'app-manifest.json'), JSON.stringify({ ...manifest, runtime: 'platform', platformApi: { major: 1, minor: 3 } }))
    expect(f.apps.scan().installed[0].error).toContain('不支持')
  })

  it('waits for restart before loading an install, then deletes files and retains restart state after uninstall', async () => {
    const f = installationFixture()
    await f.apps.refreshCatalog()
    await f.server.start(f.apps.scan().snapshot.microApps)
    let state = await f.apps.install('mira-workbench')
    expect(state.installed).toHaveLength(2)
    expect(state.installed.find(app => app.id === 'mira-workbench')).toMatchObject({ version: '0.1.0', test: false, enabled: false })
    expect(state.pendingRestart).toEqual([{ id: 'mira-workbench', action: 'install' }])
    expect(f.apps.scan().pendingRestart).toEqual(state.pendingRestart)
    applyPlatformSnapshot(state.snapshot)
    expect(applications.value.some(app => app.code === 'mira-workbench')).toBe(false)
    expect(() => f.server.getEntryUrl('micro-mira-workbench')).toThrow()
    const restarted = f.create()
    state = restarted.scan()
    expect(state.pendingRestart).toEqual([])
    applyPlatformSnapshot(state.snapshot)
    expect(applications.value.some(app => app.code === 'mira-workbench')).toBe(true)
    const resource = f.server.getEntryUrl('micro-mira-workbench')
    expect(await (await fetch(resource)).text()).toContain('Installed Workbench')
    expect(f.create().scan().installed).toHaveLength(2)
    restarted.setEnabled('mira-workbench', false)
    state = restarted.uninstall('mira-workbench')
    expect(state.pendingRestart).toEqual([{ id: 'mira-workbench', action: 'uninstall' }])
    expect(restarted.scan().pendingRestart).toEqual(state.pendingRestart)
    expect(existsSync(join(f.paths.apps, 'mira-workbench'))).toBe(false)
    expect(existsSync(f.directory)).toBe(true)
    expect(state.snapshot.preferences.localAppsEnabled).not.toHaveProperty('mira-workbench')
    applyPlatformSnapshot(state.snapshot)
    expect(applications.value.some(app => app.code === 'mira-workbench')).toBe(false)
    expect((await fetch(resource)).status).toBe(404)
    expect(state.catalog?.apps[0].id).toBe('mira-workbench')
    await expect(restarted.install('mira-workbench')).rejects.toThrow('重启')
    f.snapshot.preferences.localAppsEnabled = { 'mira-workbench': false }
    const fresh = f.create()
    await fresh.install('mira-workbench')
    expect(f.create().scan().installed.find(app => app.id === 'mira-workbench')?.enabled).toBe(true)
  })

  it('refuses existing directories, incompatible releases, example catalogs and mismatched hashes without changing installed apps', async () => {
    const f = installationFixture()
    await f.apps.refreshCatalog()
    await expect(f.apps.install('../outside')).rejects.toThrow('ID')
    await expect(f.apps.install('mira-harness')).rejects.toThrow('内置应用')
    await expect(f.apps.install(manifest.id)).rejects.toThrow('已存在')
    f.remote.apps[0].releases[0].package.sha256 = 'a'.repeat(64)
    await f.apps.refreshCatalog()
    await expect(f.apps.install('mira-workbench')).rejects.toThrow('SHA-256')
    f.remote.apps[0].releases[0].compatibility.minShellVersion = '9.0.0'
    await f.apps.refreshCatalog()
    await expect(f.apps.install('mira-workbench')).rejects.toThrow('兼容版本')
    f.remote.apps[0].releases[0].compatibility.minShellVersion = '0.1.0-beta.1'
    f.remote.example = true
    await f.apps.refreshCatalog()
    await expect(f.apps.install('mira-workbench')).rejects.toThrow('兼容版本')
    expect(readdirSync(f.paths.apps)).toEqual([manifest.id])
  })

  it.each([
    ['../escape.html', 'outside'], ['/escape.html', 'outside'], ['assets\\escape.html', 'outside'], ['CON.txt', 'outside'], ['INDEX.html', 'duplicate'],
    ['app-manifest.json', JSON.stringify({ ...productionManifest, test: true })],
    ['app-manifest.json', JSON.stringify({ ...productionManifest, id: 'other-app' })],
    ['app-manifest.json', JSON.stringify({ ...productionManifest, version: '9.0.0' })],
    ['app-manifest.json', JSON.stringify({ ...productionManifest, entry: 'missing.html' })],
    ['app-manifest.json', JSON.stringify({ ...productionManifest, requiredCapabilities: ['harness:workbench'] })],
  ])('rejects invalid archive entry %s and cleans up staging files', async (name, content) => {
    const f = installationFixture({ [name]: strToU8(content) })
    await f.apps.refreshCatalog()
    await expect(f.apps.install('mira-workbench')).rejects.toThrow()
    expect(readdirSync(f.paths.apps)).toEqual([manifest.id])
    expect(existsSync(join(f.paths.root, 'escape.html'))).toBe(false)
  })

  it('rejects truncated or oversized responses and archive expansion before allocating the expanded content', async () => {
    const f = installationFixture()
    await f.apps.refreshCatalog()
    for (const length of [f.bytes.length - 1, f.bytes.length + 1]) {
      f.fetcher.mockImplementation(async () => new Response(new Uint8Array(length)))
      await expect(f.apps.install('mira-workbench')).rejects.toThrow('大小')
    }
    const malicious = Buffer.from(f.bytes)
    const central = malicious.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    malicious.writeUInt32LE(256 * 1024 * 1024 + 1, central + 24)
    const pkg = f.remote.apps[0].releases[0].package
    pkg.sha256 = createHash('sha256').update(malicious).digest('hex')
    f.fetcher.mockImplementation(async input => String(input) === url ? new Response(JSON.stringify(f.remote)) : new Response(malicious))
    await f.apps.refreshCatalog()
    await expect(f.apps.install('mira-workbench')).rejects.toThrow('解压后过大')
    expect(readdirSync(f.paths.apps)).toEqual([manifest.id])
  })

  it('serializes package mutations while a download is pending', async () => {
    const f = installationFixture()
    await f.apps.refreshCatalog()
    let finish!: (response: Response) => void
    f.fetcher.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const installing = f.apps.install('mira-workbench')
    await expect(f.apps.install('mira-workbench')).rejects.toThrow('正在安装')
    expect(() => f.apps.uninstall(manifest.id)).toThrow('正在安装')
    finish(new Response(f.bytes))
    await installing
    await expect(f.apps.install('mira-workbench')).rejects.toThrow('重启')
  })

  it('opens only a scanned DEV application directory by ID', async () => {
    const f = installationFixture()
    expect(f.apps.debugDirectory(manifest.id)).toBe(realpathSync(f.directory))
    expect(() => f.apps.debugDirectory('../outside')).toThrow('ID')
    await f.apps.refreshCatalog(); await f.apps.install('mira-workbench')
    expect(() => f.apps.debugDirectory('mira-workbench')).toThrow('调试应用目录')
  })

  it('uninstalls invalid or DEV packages but never removes Harness, parent directories or symlink targets', () => {
    const f = fixture()
    f.apps.scan()
    for (const id of ['mira-harness', 'main', '..', '../other']) expect(() => f.apps.uninstall(id)).toThrow()
    writeFileSync(join(f.directory, 'app-manifest.json'), 'invalid')
    expect(f.apps.uninstall(manifest.id).installed).toEqual([])
    expect(existsSync(f.directory)).toBe(false)
    const target = join(f.root, 'outside'); mkdirSync(target); writeFileSync(join(target, 'keep.txt'), 'keep')
    symlinkSync(target, join(f.paths.apps, 'linked-app'))
    f.apps.uninstall('linked-app')
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep')
    expect(readdirSync(f.paths.apps)).toEqual([])
  })
})

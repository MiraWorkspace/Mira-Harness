import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('hosts miniapps in Workbench over generic file/view SDKs with independent storage and revocable permissions', async () => {
  const root = resolve('.'), workbench = resolve('../Mira-Workbench'), temp = await mkdtemp(join(tmpdir(), 'workbench-owned-e2e-'))
  try {
    await promisify(execFile)(process.execPath, [resolve(workbench, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: workbench, timeout: 30000 })
    await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, outfile: join(temp, 'platform.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], plugins: [{ name: 'native-sqlite', setup: builder => builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: createRequire(import.meta.url).resolve('better-sqlite3'), external: true })) }] })
    await build({ stdin: { contents: childApp, resolveDir: workbench, loader: 'ts' }, outfile: join(temp, 'child.js'), bundle: true, format: 'esm' })
    await writeFile(join(temp, 'main.cjs'), main)
    const env = { ...process.env, NODE_PATH: join(root, 'node_modules'), WORKBENCH_DIST: join(workbench, 'dist'), APP_PRELOAD: join(root, 'electron/preload/appHost.cjs') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(temp, 'main.cjs')], { env, timeout: 45000 })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ migrated: true, ownedByWorkbench: true, storage: true, model: true, filePermissions: true, revoked: true, updated: true, uninstalled: true })
  } finally { await rm(temp, { recursive: true, force: true }) }
}, 70000)

const entry = `
export { AppRuntime } from './electron/services/appRuntime'
export { AppSdkDispatcher } from './electron/services/appSdkDispatcher'
export { AppViewManager } from './electron/services/appViewManager'
export { createMiraMainWindow } from './electron/bootstrap/miraMainWindow'
export { LocalMicroAppServer } from './electron/adapters/localMicroAppServer'
export { MiraApps } from './electron/services/miraApps'
export { MiraPaths } from './electron/storage/miraPaths'
export { AppDatabase } from './electron/storage/appDatabase'
export { AppFiles } from './electron/services/appFiles'
export { LegacyWorkbenchMiniapps } from './electron/services/legacyWorkbenchMiniapps'
export { zipSync, strToU8 } from 'fflate'
`
const childApp = `
import { connectMiraApp } from '@mira/app-sdk'
const sdk = await connectMiraApp()
window.testSdk = sdk
const context = await sdk.context.get()
document.querySelector('#identity').textContent = context.host + ':' + context.appId
await sdk.storage.migrate([{ version: 1, tables: [{ name: 'drafts', columns: [{ name: 'id', type: 'TEXT', primaryKey: true }, { name: 'text', type: 'TEXT' }] }] }])
const [rows] = await sdk.storage.transaction([{ type: 'select', table: 'drafts' }])
document.querySelector('#draft').value = rows[0]?.text || ''
window.saveDraft = async () => {
 await sdk.storage.transaction([{ type: 'delete', table: 'drafts', where: { id: 'draft' } }, { type: 'insert', table: 'drafts', values: { id: 'draft', text: document.querySelector('#draft').value } }])
 document.querySelector('#result').textContent = (await sdk.models.generate({ prompt: 'hello' })).text
}
document.querySelector('#ready').textContent = 'ready'
`
const main = `
const { app, ipcMain, webContents } = require('electron')
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const { AppRuntime, AppSdkDispatcher, AppViewManager, createMiraMainWindow, LocalMicroAppServer, MiraApps, MiraPaths, AppDatabase, AppFiles, LegacyWorkbenchMiniapps, zipSync, strToU8 } = require('./platform.cjs')
app.setPath('userData', path.join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let owner, server, runtime, views
 try {
  const root = path.join(__dirname, 'data'), paths = new MiraPaths(root).ensure(), dataRoot = path.join(root, 'app-data')
  fs.cpSync(process.env.WORKBENCH_DIST, path.join(paths.apps, 'mira-workbench'), { recursive: true })
  const legacyDir = path.join(paths.apps, '.miniapps', 'sdk-test'); fs.mkdirSync(legacyDir, { recursive: true })
  const manifest = { manifestVersion: 1, id: 'sdk-test', name: '独立小程序', version: '1.0.0', entry: 'index.html', requiredCapabilities: ['storage:app', 'models:generate', 'files:read', 'files:write'] }
  const html = '<!doctype html><p id="identity"></p><input id="draft"><p id="result"></p><p id="ready"></p><script type="module" src="child.js"></script>'
  fs.writeFileSync(path.join(legacyDir, 'app-manifest.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(legacyDir, 'index.html'), html); fs.copyFileSync(path.join(__dirname, 'child.js'), path.join(legacyDir, 'child.js'))
  const oldData = new AppDatabase(dataRoot, 'sdk-test')
  oldData.migrate([{ version: 1, tables: [{ name: 'drafts', columns: [{ name: 'id', type: 'TEXT', primaryKey: true }, { name: 'text', type: 'TEXT' }] }] }])
  oldData.transaction([{ type: 'insert', table: 'drafts', values: { id: 'draft', text: 'legacy-draft' } }]); oldData.close()
  const snapshot = { mainMenus: [], microApps: [], preferences: {} }, approvals = new Map()
  const database = { getSnapshot: () => structuredClone(snapshot), savePreference: (key, value) => { snapshot.preferences[key] = value } }
  server = new LocalMicroAppServer(); const apps = new MiraApps(paths, database, server, '0.1.0-beta.1', fetch)
  apps.scan(); await server.start(apps.snapshot().microApps); apps.scan()
  if (apps.resolvePlatformApp('sdk-test')) throw Error('Mira registered a Workbench miniapp')
  runtime = new AppRuntime(dataRoot, { get: id => approvals.get(id), set: (id, value) => approvals.set(id, value), delete: id => approvals.delete(id) }, id => apps.resolvePlatformApp(id))
  const files = new AppFiles(dataRoot), legacy = new LegacyWorkbenchMiniapps(paths.apps, dataRoot), methods = []
  const directory = path.join(root, 'selected'); fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'read.txt'), 'readable')
  const dispatcher = new AppSdkDispatcher(runtime, {
   getTheme: () => 'light', generate: async () => ({ text: 'model-result' }), notify: async () => {}, readLegacyWorkbenchSites: async () => null,
   workbenchBrowser: (id, input) => views.workbenchBrowser(id, input), legacyMiniapps: (id, input) => legacy.read(id, input),
   files: (appId, ownerId, method, input) => {
    methods.push(method)
    if (method === 'files.read') return files.read(appId, input)
    if (method === 'files.write') return files.write(appId, input)
    if (method === 'files.list') return files.list(appId, input)
    if (method === 'files.remove') return files.remove(appId, input)
    if (method === 'files.revoke') return files.revoke(appId, input.id)
    if (method === 'files.selectDirectory') return files.grant(appId, directory, input.access)
    throw Error('unknown file method')
   },
   views: (appId, id, input) => views.ownedView(id, input, { mount: (key, directory, entry) => server.mountResource(key, directory, entry), unmount: key => server.unmountResource(key) }, input.type === 'open' ? files.resolve(appId, input.directory) : undefined),
  })
  views = new AppViewManager(runtime, dispatcher, id => apps.resolvePlatformEntry(id), process.env.APP_PRELOAD)
  ipcMain.on('mira-app:ready', event => views.ready(event.sender, event.senderFrame))
  owner = createMiraMainWindow({ show: false, width: 1000, height: 700 }); await owner.loadURL('about:blank')
  const wait = async (fn, label = 'condition') => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)) } throw Error('timeout: ' + label) }
  const id = views.open(owner, 'mira-workbench'); views.setBounds(owner, id, { x: 0, y: 0, width: 900, height: 640 })
  const parent = webContents.fromId(id), inspect = async code => { try { return await parent.executeJavaScript(code, true) } catch (error) { console.error('FAILED SCRIPT:', code, await parent.executeJavaScript('document.body.innerText')); throw error } }
  parent.on('console-message', (_e, _level, message) => console.log('PARENT: ' + message))
  await wait(async () => (await inspect('document.body.innerText')).includes('独立小程序'), 'migration')
  if (!fs.existsSync(path.join(dataRoot, 'files/mira-workbench/miniapps/registry.json'))) throw Error('registry not owned by Workbench')
  const openChild = async () => {
   await inspect('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("独立小程序")).click()')
   if (await inspect('Boolean(document.querySelector(".review-dialog"))')) await inspect('document.querySelector(".review-dialog .add-button").click()')
   let child
   await wait(() => { child = webContents.getAllWebContents().find(contents => contents.getURL().includes('/apps/resource-')); return Boolean(child) }, 'child view')
   await wait(async () => await child.executeJavaScript('document.querySelector("#ready")?.textContent === "ready"'), 'child SDK')
   if (await child.executeJavaScript('document.querySelector("#identity").textContent') !== 'workbench:sdk-test') throw Error('wrong child SDK host')
   return child
  }
  let child = await openChild()
  if (await child.executeJavaScript('document.querySelector("#draft").value') !== 'legacy-draft') throw Error('legacy SQLite data not migrated')
  await child.executeJavaScript('document.querySelector("#draft").value = "retained"; window.saveDraft()')
  if (await child.executeJavaScript('document.querySelector("#result").textContent') !== 'model-result') throw Error('model not routed')
  const scope = 'scope-' + crypto.createHash('sha256').update('mira-workbench').digest('hex').slice(0, 24) + '-' + crypto.createHash('sha256').update('sdk-test').digest('hex').slice(0, 32)
  if (!fs.existsSync(path.join(dataRoot, scope + '.sqlite')) || !fs.existsSync(path.join(dataRoot, 'sdk-test.sqlite'))) throw Error('data identity wrong')
  await inspect('document.querySelector(".tab--home").click(); document.querySelector("[aria-label=设置]").click()')
  await inspect('[...document.querySelectorAll(".manage-item")].find(e => e.textContent.includes("独立小程序")).querySelector("button").click()')
  await inspect('[...document.querySelectorAll("button")].find(e => e.textContent === "添加只读目录").click()')
  await wait(async () => (await inspect('document.body.innerText')).includes('selected · 只读'), 'directory grant')
  const grants = await child.executeJavaScript('window.testSdk.files.directories()')
  const read = await child.executeJavaScript('window.testSdk.files.read({ path: "read.txt", grant: ' + JSON.stringify(grants[0].id) + ' }).then(b => new TextDecoder().decode(b))')
  if (read !== 'readable') throw Error('directory read denied')
  const denied = await child.executeJavaScript('window.testSdk.files.write({ path: "bad.txt", grant: ' + JSON.stringify(grants[0].id) + ', data: new Uint8Array([1]) }).then(() => false, () => true)')
  if (!denied || fs.existsSync(path.join(directory, 'bad.txt'))) throw Error('read-only bypass')
  await inspect('[...document.querySelectorAll("button")].find(e => e.textContent === "撤销全部权限").click()')
  await wait(() => child.isDestroyed(), 'revocation')
  await inspect('document.querySelector("[aria-label=关闭权限设置]").click(); document.querySelector(".manage-dialog [aria-label=关闭]").click()')
  child = await openChild()
  if (await child.executeJavaScript('document.querySelector("#draft").value') !== 'retained') throw Error('data lost')
  await inspect('document.querySelector(".tab--home").click(); document.querySelector("[aria-label=新增]").click()')
  await inspect('document.querySelector("#add-miniapp-tab").click()')
  const update = zipSync({ 'miniapp-manifest.json': strToU8(JSON.stringify({ ...manifest, version: '1.1.0' })), 'index.html': strToU8(html), 'child.js': new Uint8Array(fs.readFileSync(path.join(__dirname, 'child.js'))) })
  const base64 = Buffer.from(update).toString('base64')
  await inspect('(() => { const bytes = Uint8Array.from(atob(' + JSON.stringify(base64) + '), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], "update.miniapp")); const input = document.querySelector("input[aria-label=选择小程序安装包]"); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); })()')
  await wait(async () => Boolean(await inspect('document.querySelector(".review-dialog")')), 'update review')
  await inspect('document.querySelector(".review-dialog .add-button").click()')
  await wait(async () => (await inspect('document.body.innerText')).includes('可以立即打开'), 'update')
  if (!child.isDestroyed()) throw Error('update did not stop old child')
  await inspect('document.querySelector(".add-dialog [aria-label=关闭]").click(); document.querySelector("[aria-label=设置]").click()')
  await inspect('[...[...document.querySelectorAll(".manage-item")].find(e => e.textContent.includes("独立小程序")).querySelectorAll("button")].find(e => e.textContent === "卸载").click()')
  await wait(async () => Boolean(await inspect('document.querySelector(".review-dialog")')), 'uninstall review')
  await inspect('document.querySelector(".review-dialog .add-button").click()')
  await wait(async () => !(await inspect('document.querySelector(".manage-list").textContent')).includes('独立小程序'), 'uninstall')
  if (!fs.existsSync(path.join(dataRoot, scope + '.sqlite')) || !fs.existsSync(legacyDir)) throw Error('migration/uninstall lost source data')
  if (approvals.size) throw Error('Mira stored miniapp permissions')
  console.log('RESULT=' + JSON.stringify({ migrated: true, ownedByWorkbench: true, storage: true, model: true, filePermissions: true, revoked: true, updated: true, uninstalled: true }))
 } catch (error) { console.error(error); process.exitCode = 1 }
 finally { views?.closeAll(); runtime?.close(); owner?.destroy(); await server?.stop(); app.quit() }
})
`

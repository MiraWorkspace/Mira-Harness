import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('runs Workbench and a miniapp through the real Electron platform and isolated databases', async () => {
  const root = resolve('.'), workbench = resolve('../Mira-Workbench'), temp = await mkdtemp(join(tmpdir(), 'mira-platform-e2e-'))
  try {
    await promisify(execFile)('npm', ['run', 'build'], { cwd: workbench, timeout: 30000 })
    await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, outfile: join(temp, 'platform.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], plugins: [{ name: 'native-sqlite', setup: builder => builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: createRequire(import.meta.url).resolve('better-sqlite3'), external: true })) }] })
    await build({ stdin: { contents: identityApp, resolveDir: root, loader: 'ts' }, outfile: join(temp, 'identity.js'), bundle: true, format: 'esm' })
    await build({ stdin: { contents: sdkApp, resolveDir: root, loader: 'ts' }, outfile: join(temp, 'sdk-test.js'), bundle: true, format: 'esm' })
    await writeFile(join(temp, 'main.cjs'), main)
    const env = { ...process.env, NODE_PATH: join(root, 'node_modules'), WORKBENCH_DIST: join(workbench, 'dist'), APP_PRELOAD: join(root, 'electron/preload/appHost.cjs') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(temp, 'main.cjs')], { env, timeout: 30000 })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ workbench: true, miniapp: true, identityOnly: true, model: true, notification: true, restored: true, isolated: true, revoked: true })
  } finally { await rm(temp, { recursive: true, force: true }) }
}, 60000)

const entry = `
export { AppRuntime } from './electron/services/appRuntime'
export { AppSdkDispatcher } from './electron/services/appSdkDispatcher'
export { AppViewManager } from './electron/services/appViewManager'
export { createMiraMainWindow, miraShellView, miraWindows } from './electron/bootstrap/miraMainWindow'
export { LocalMicroAppServer } from './electron/adapters/localMicroAppServer'
export { MiraApps } from './electron/services/miraApps'
export { MiraPaths } from './electron/storage/miraPaths'
`

const identityApp = `
import { connectMiraApp } from './packages/mira-app-sdk/src/index'
const sdk = await connectMiraApp()
const context = await sdk.context.get()
try { await sdk.storage.transaction([{ type: 'select', table: 'items' }]); document.body.textContent = 'unexpected' }
catch (error) { document.body.textContent = context.appId + ':' + context.capabilities.length + ':' + error.code }
`

// A temporary page exercises the actual SDK channel without a distributable demo app.
const sdkApp = `
import { connectMiraApp } from './packages/mira-app-sdk/src/index'
const sdk = await connectMiraApp()
const prompt = document.querySelector('textarea')
const result = document.querySelector('#result')
document.documentElement.dataset.theme = await sdk.appearance.get()
const unsubscribe = sdk.appearance.subscribe(theme => { document.documentElement.dataset.theme = theme })
await sdk.storage.migrate([{ version: 1, tables: [{ name: 'drafts', columns: [{ name: 'id', type: 'TEXT', primaryKey: true }, { name: 'text', type: 'TEXT' }] }] }])
const [rows] = await sdk.storage.transaction([{ type: 'select', table: 'drafts' }])
prompt.value = rows[0]?.text ?? ''
document.querySelector('form').onsubmit = async event => {
 event.preventDefault()
 await sdk.storage.transaction([{ type: 'delete', table: 'drafts', where: { id: 'draft' } }, { type: 'insert', table: 'drafts', values: { id: 'draft', text: prompt.value } }])
 result.textContent = (await sdk.models.generate({ prompt: prompt.value })).text
}
document.querySelector('#notify').onclick = () => sdk.notifications.send({ title: 'SDK test' })
prompt.disabled = false
window.addEventListener('pagehide', () => { unsubscribe(); sdk.dispose() }, { once: true })
`

const main = `
const { app, BrowserWindow, ipcMain, webContents } = require('electron')
const fs = require('fs'), path = require('path')
const { AppRuntime, AppSdkDispatcher, AppViewManager, createMiraMainWindow, miraShellView, miraWindows, LocalMicroAppServer, MiraApps, MiraPaths } = require('./platform.cjs')
app.setPath('userData', path.join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let owner, server, runtime, views
 try {
  const root = path.join(__dirname, 'data'), paths = new MiraPaths(root).ensure()
  fs.cpSync(process.env.WORKBENCH_DIST, path.join(paths.apps, 'mira-workbench'), { recursive: true })
  fs.mkdirSync(path.join(paths.apps, '.miniapps'))
  const sdkDir = path.join(paths.apps, '.miniapps', 'sdk-test-app'); fs.mkdirSync(sdkDir)
  fs.writeFileSync(path.join(sdkDir, 'app-manifest.json'), JSON.stringify({ manifestVersion: 1, id: 'sdk-test-app', name: 'SDK 测试夹具', version: '1.0.0', entry: 'index.html', runtime: 'platform', minShellVersion: '0.1.0-beta.1', platformApi: { major: 1, minor: 1 }, requiredCapabilities: ['storage:app', 'appearance:read', 'models:generate', 'notifications:send'] }))
  fs.writeFileSync(path.join(sdkDir, 'index.html'), '<!doctype html><body><form><textarea id="prompt" disabled></textarea></form><button id="notify">Notify</button><p id="result"></p><script type="module" src="sdk-test.js"></script></body>')
  fs.copyFileSync(path.join(__dirname, 'sdk-test.js'), path.join(sdkDir, 'sdk-test.js'))
  const identityDir = path.join(paths.apps, 'identity-only'); fs.mkdirSync(identityDir)
  fs.writeFileSync(path.join(identityDir, 'app-manifest.json'), JSON.stringify({ manifestVersion: 1, id: 'identity-only', name: 'Identity', version: '1.0.0', entry: 'index.html', runtime: 'platform', minShellVersion: '0.1.0-beta.1', platformApi: { major: 1, minor: 1 }, requiredCapabilities: [] }))
  fs.writeFileSync(path.join(identityDir, 'index.html'), '<!doctype html><body><script type="module" src="identity.js"></script></body>')
  fs.copyFileSync(path.join(__dirname, 'identity.js'), path.join(identityDir, 'identity.js'))
  const snapshot = { mainMenus: [], microApps: [], preferences: {} }, approvals = new Map()
  const database = { getSnapshot: () => structuredClone(snapshot), savePreference: (key, value) => { snapshot.preferences[key] = value } }
  const persistence = { get: id => approvals.get(id), set: (id, value) => approvals.set(id, structuredClone(value)), delete: id => approvals.delete(id) }
  server = new LocalMicroAppServer()
  const apps = new MiraApps(paths, database, server, '0.1.0-beta.1', fetch)
  apps.scan(); await server.start(apps.snapshot(true).microApps); apps.scan()
  runtime = new AppRuntime(path.join(root, 'app-data'), persistence, id => apps.resolvePlatformApp(id))
  let notifications = 0
  const createDispatcher = () => new AppSdkDispatcher(runtime, {
   getTheme: () => 'dark', generate: async () => ({ text: '真实通道结果' }), notify: async () => { notifications++ },
   readLegacyWorkbenchSites: async () => null,
   workbenchBrowser: (id, input) => views.workbenchBrowser(id, input),
   workbenchApp: (id, input) => views.workbenchApp(id, input),
   workbenchApps: () => [{ id: 'sdk-test-app', name: 'SDK 测试夹具', enabled: true, approved: true }],
  })
  views = new AppViewManager(runtime, createDispatcher(), id => apps.resolvePlatformEntry(id), process.env.APP_PRELOAD)
  const thirdParty = apps.resolvePlatformApp('sdk-test-app')
  try { runtime.open('sdk-test-app', 999); throw Error('miniapp bypassed approval') } catch (error) { if (!String(error).includes('尚未批准')) throw error }
  runtime.approve(thirdParty.id, thirdParty.installationId, thirdParty.requiredCapabilities)
  if (approvals.has('mira-workbench') || approvals.has('identity-only')) throw Error('first-party consent was persisted')
  ipcMain.on('mira-app:ready', event => views.ready(event.sender, event.senderFrame))
  owner = createMiraMainWindow({ show: false, width: 1000, height: 700 }); await owner.loadURL('about:blank')
  const wait = async fn => { const deadline = Date.now() + 8000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)) } throw Error('timeout') }
  const identityId = views.open(owner, 'identity-only'), identity = webContents.fromId(identityId)
  await wait(async () => (await identity.executeJavaScript('document.body.textContent')).includes('identity-only:0:CAPABILITY_DENIED'))
  views.close(owner, identityId)
  const openWorkbench = async () => {
   const id = views.open(owner, 'mira-workbench'); views.setBounds(owner, id, { x: 0, y: 0, width: 900, height: 600 })
   const contents = webContents.fromId(id)
   await wait(async () => (await contents.executeJavaScript('document.body.innerText')).includes('SDK 测试夹具'))
   return { id, contents }
  }
  const shortcuts = [], send = owner.webContents.send.bind(owner.webContents)
  owner.webContents.send = (channel, ...args) => { if (channel === 'window:shortcut') shortcuts.push(args[0]); return send(channel, ...args) }
  const shortcut = async contents => {
   const count = shortcuts.length
   contents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] })
   await wait(() => shortcuts.length === count + 1)
  }
  let workbench = await openWorkbench()
  await shortcut(workbench.contents)

  const shell = miraShellView(owner), nativeApp = owner.contentView.children.find(view => view.webContents === workbench.contents)
  const boundsBefore = nativeApp.getBounds()
  views.setShellOverlay(owner, workbench.id, true)
  if (owner.contentView.children.at(-1) !== shell || JSON.stringify(boundsBefore) !== JSON.stringify(nativeApp.getBounds())) throw Error('overlay hid or failed to cover native app')
  views.setShellOverlay(owner, workbench.id, false)
  if (owner.contentView.children[0] !== shell || !miraWindows().includes(owner) || BrowserWindow.fromWebContents(owner.webContents) !== owner) throw Error('shell window ownership lost')

  await workbench.contents.executeJavaScript('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("SDK 测试夹具")).click()', true)
  let mini
  await wait(() => { mini = webContents.getAllWebContents().find(item => item.getURL().includes('/micro-sdk-test-app/')); return Boolean(mini) })
  await wait(async () => await mini.executeJavaScript('!document.querySelector("#prompt").disabled'))
  await shortcut(mini)
  await mini.executeJavaScript('document.querySelector("#prompt").value="测试数据"; document.querySelector("form").requestSubmit()', true)
  await wait(async () => (await mini.executeJavaScript('document.querySelector("#result").textContent')) === '真实通道结果')
  await mini.executeJavaScript('document.querySelector("#notify").click()', true)
  await wait(() => notifications === 1)
  if (await mini.executeJavaScript('document.documentElement.dataset.theme') !== 'dark') throw Error('SDK theme not applied')
  const other = path.join(root, 'app-data', 'mira-workbench.sqlite'), sdkDatabase = path.join(root, 'app-data', 'sdk-test-app.sqlite')
  const isolated = fs.existsSync(other) && fs.existsSync(sdkDatabase) && fs.realpathSync(other) !== fs.realpathSync(sdkDatabase)
  views.close(owner, workbench.id)
  await wait(() => mini.isDestroyed())
  runtime.close()
  runtime = new AppRuntime(path.join(root, 'app-data'), persistence, id => apps.resolvePlatformApp(id))
  views = new AppViewManager(runtime, createDispatcher(), id => apps.resolvePlatformEntry(id), process.env.APP_PRELOAD)
  workbench = await openWorkbench()
  await workbench.contents.executeJavaScript('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("SDK 测试夹具")).click()', true)
  await wait(() => { mini = webContents.getAllWebContents().find(item => item.getURL().includes('/micro-sdk-test-app/')); return Boolean(mini) })
  await wait(async () => await mini.executeJavaScript('document.querySelector("#prompt").value === "测试数据"'))
  runtime.revokeApproval('sdk-test-app'); views.closeApp('sdk-test-app')
  await wait(() => mini.isDestroyed())
  console.log('RESULT=' + JSON.stringify({ workbench: true, miniapp: true, identityOnly: true, model: true, notification: true, restored: true, isolated, revoked: true }))
 } catch (error) { console.error(error); process.exitCode = 1 }
 finally { views?.closeAll(); runtime?.close(); owner?.destroy(); await server?.stop(); app.quit() }
})
`

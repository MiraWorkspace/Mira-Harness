import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('closes detached miniapp tabs and preserves the live page only on explicit return', async () => {
  const root = resolve('.'), workbench = resolve('../Mira-Workbench'), temp = await mkdtemp(join(tmpdir(), 'workbench-detached-e2e-'))
  try {
    await promisify(execFile)(process.execPath, [resolve(workbench, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', join(temp, 'workbench')], { cwd: workbench, timeout: 30000 })
    await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, outfile: join(temp, 'platform.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], plugins: [{ name: 'native-sqlite', setup: builder => builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: createRequire(import.meta.url).resolve('better-sqlite3'), external: true })) }] })
    await build({ stdin: { contents: childApp, resolveDir: workbench, loader: 'ts' }, outfile: join(temp, 'child.js'), bundle: true, format: 'esm' })
    await writeFile(join(temp, 'main.cjs'), main)
    const env = { ...process.env, NODE_PATH: join(root, 'node_modules'), WORKBENCH_DIST: join(temp, 'workbench'), APP_PRELOAD: join(root, 'electron/preload/appHost.cjs') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(temp, 'main.cjs')], { env, timeout: 45000 })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ reattached: true, nativeClosed: true, toolbarClosed: true, freshPage: true })
  } finally { await rm(temp, { recursive: true, force: true }) }
}, 70000)

const entry = `
export { handleDetachedViewCommand } from './electron/services/detachedViewWindow'
export { AppRuntime } from './electron/services/appRuntime'
export { AppSdkDispatcher } from './electron/services/appSdkDispatcher'
export { AppViewManager } from './electron/services/appViewManager'
export { createMiraMainWindow } from './electron/bootstrap/miraMainWindow'
export { LocalMicroAppServer } from './electron/adapters/localMicroAppServer'
export { MiraApps } from './electron/services/miraApps'
export { MiraPaths } from './electron/storage/miraPaths'
export { AppFiles } from './electron/services/appFiles'
export { LegacyWorkbenchMiniapps } from './electron/services/legacyWorkbenchMiniapps'
`
const childApp = `
import { connectMiraApp } from '@mira/app-sdk'
const sdk = await connectMiraApp()
const context = await sdk.context.get()
document.querySelector('#identity').textContent = context.host + ':' + context.appId
document.querySelector('#ready').textContent = 'ready'
`
const main = `
const { app, ipcMain, webContents, BrowserWindow, screen } = require('electron')
const assert = require('node:assert/strict')
const fs = require('fs'), path = require('path')
const { handleDetachedViewCommand, AppRuntime, AppSdkDispatcher, AppViewManager, createMiraMainWindow, LocalMicroAppServer, MiraApps, MiraPaths, AppFiles, LegacyWorkbenchMiniapps } = require('./platform.cjs')
app.setPath('userData', path.join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let owner, server, runtime, views
 try {
  const root = path.join(__dirname, 'data'), paths = new MiraPaths(root).ensure(), dataRoot = path.join(root, 'app-data')
  fs.cpSync(process.env.WORKBENCH_DIST, path.join(paths.apps, 'mira-workbench'), { recursive: true })
  const legacyDir = path.join(paths.apps, '.miniapps', 'sdk-test'); fs.mkdirSync(legacyDir, { recursive: true })
  const manifest = { manifestVersion: 1, id: 'sdk-test', name: '独立小程序', version: '1.0.0', entry: 'index.html', icon: 'icon.svg', requiredCapabilities: [] }
  const html = '<!doctype html><p id="identity"></p><input id="draft"><p id="result"></p><p id="ready"></p><script type="module" src="child.js"></script>'
  fs.writeFileSync(path.join(legacyDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="8" fill="green"/></svg>')
  fs.writeFileSync(path.join(legacyDir, 'app-manifest.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(legacyDir, 'index.html'), html); fs.copyFileSync(path.join(__dirname, 'child.js'), path.join(legacyDir, 'child.js'))
  const snapshot = { mainMenus: [], microApps: [], preferences: {} }, approvals = new Map()
  const database = { getSnapshot: () => structuredClone(snapshot), savePreference: (key, value) => { snapshot.preferences[key] = value } }
  server = new LocalMicroAppServer(); const apps = new MiraApps(paths, database, server, '0.1.0-beta.1', fetch)
  apps.scan(); await server.start(apps.snapshot().microApps); apps.scan()
  if (apps.resolvePlatformApp('sdk-test')) throw Error('Mira registered a Workbench miniapp')
  runtime = new AppRuntime(dataRoot, { get: id => approvals.get(id), set: (id, value) => approvals.set(id, value), delete: id => approvals.delete(id) }, id => apps.resolvePlatformApp(id))
  const files = new AppFiles(dataRoot), legacy = new LegacyWorkbenchMiniapps(paths.apps, dataRoot)
  const resources = { mount: (key, directory, entry) => server.mountResource(key, directory, entry), unmount: key => server.unmountResource(key) }
  const dispatcher = new AppSdkDispatcher(runtime, {
   getTheme: () => 'light', generate: async () => ({ text: '' }), notify: async () => {}, readLegacyWorkbenchSites: async () => null,
   workbenchBrowser: (id, input) => views.workbenchBrowser(id, input), legacyMiniapps: (id, input) => legacy.read(id, input),
   files: (appId, _id, method, input) => files[method.split('.')[1]](appId, input),
   views: (appId, id, input) => views.ownedView(id, input, resources, input.type === 'open' ? files.resolve(appId, input.directory) : undefined),
  })
  views = new AppViewManager(runtime, dispatcher, id => apps.resolvePlatformEntry(id), process.env.APP_PRELOAD)
  ipcMain.on('mira:detached-command', (event, action) => handleDetachedViewCommand(event.sender, action))
  ipcMain.on('mira-app:ready', event => views.ready(event.sender, event.senderFrame))
  owner = createMiraMainWindow({ show: false, width: 1100, height: 700, minWidth: 1024, minHeight: 680 }); await owner.loadURL('about:blank')
  const wait = async (fn, label = 'condition') => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)) } throw Error('timeout: ' + label) }
  const id = views.open(owner, 'mira-workbench'); views.setBounds(owner, id, { x: 0, y: 0, width: 900, height: 640 })
  const parent = webContents.fromId(id); parent.setBackgroundThrottling(false); owner.show(); const inspect = async code => { try { return await parent.executeJavaScript(code, true) } catch (error) { console.error('FAILED SCRIPT:', code, await parent.executeJavaScript('document.body.innerText')); throw error } }
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
  const opened = () => inspect('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("独立小程序")).querySelector(".site-open-indicator") !== null')
  const detachedWindow = () => BrowserWindow.getAllWindows().find(window => window !== owner)
  const detach = async child => {
   views.ownedView(id, { type: 'detach', id: child.id }, resources)
   await wait(() => inspect('document.querySelectorAll(".tab--site").length === 0'), 'detached tab hidden')
   return detachedWindow()
  }
  let child = await openChild()
  const childId = child.id, childView = owner.contentView.children.find(view => view.webContents === child)
  await child.executeJavaScript('window.retainedValue = 42')
  const returning = await detach(child)
  await wait(() => returning.webContents.executeJavaScript('!!document.querySelector("[data-action=reattach]")'), 'return icon')
  await returning.webContents.executeJavaScript('document.querySelector("[data-action=reattach]").click()')
  await wait(() => returning.isDestroyed(), 'return window closed')
  await wait(() => inspect('document.querySelectorAll(".tab--site").length === 1'), 'tab returned')
  assert.ok(owner.contentView.children.includes(childView))
  assert.equal(await child.executeJavaScript('window.retainedValue'), 42)
  const closing = await detach(child)
  closing.close()
  await wait(() => closing.isDestroyed() && child.isDestroyed(), 'native close destroys page')
  assert.ok(!owner.contentView.children.includes(childView))
  await inspect('document.querySelector(".tab--home").click()')
  await wait(async () => !await opened(), 'native close clears opened marker')
  assert.equal(await inspect('document.querySelectorAll(".tab--site").length'), 0)
  child = await openChild()
  assert.notEqual(child.id, childId)
  assert.equal(await child.executeJavaScript('window.retainedValue'), undefined)
  const toolbarClosing = await detach(child)
  handleDetachedViewCommand(toolbarClosing.webContents, 'close')
  await wait(() => toolbarClosing.isDestroyed() && child.isDestroyed(), 'toolbar close destroys page')
  await inspect('document.querySelector(".tab--home").click()')
  await wait(async () => !await opened(), 'toolbar close clears opened marker')
  assert.equal(await inspect('document.querySelectorAll(".tab--site").length'), 0)
  console.log('RESULT=' + JSON.stringify({ reattached: true, nativeClosed: true, toolbarClosed: true, freshPage: true }))
 } catch (error) { console.error(error); process.exitCode = 1 }
 finally { views?.closeAll(); runtime?.close(); owner?.destroy(); await server?.stop(); app.quit() }
})
`

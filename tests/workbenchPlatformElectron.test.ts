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
    await promisify(execFile)(process.execPath, [resolve(workbench, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', join(temp, 'workbench')], { cwd: workbench, timeout: 30000 })
    await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, outfile: join(temp, 'platform.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], plugins: [{ name: 'native-sqlite', setup: builder => builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: createRequire(import.meta.url).resolve('better-sqlite3'), external: true })) }] })
    await build({ stdin: { contents: childApp, resolveDir: workbench, loader: 'ts' }, outfile: join(temp, 'child.js'), bundle: true, format: 'esm' })
    await writeFile(join(temp, 'main.cjs'), main)
    const env = { ...process.env, NODE_PATH: join(root, 'node_modules'), WORKBENCH_DIST: join(temp, 'workbench'), APP_PRELOAD: join(root, 'electron/preload/appHost.cjs') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(temp, 'main.cjs')], { env, timeout: 45000 })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ migrated: true, ownedByWorkbench: true, storage: true, model: true, filePermissions: true, revoked: true, updated: true, uninstalled: true })
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
const { app, ipcMain, webContents, BrowserWindow, screen } = require('electron')
const assert = require('node:assert/strict')
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const { handleDetachedViewCommand, AppRuntime, AppSdkDispatcher, AppViewManager, createMiraMainWindow, LocalMicroAppServer, MiraApps, MiraPaths, AppDatabase, AppFiles, LegacyWorkbenchMiniapps, zipSync, strToU8 } = require('./platform.cjs')
app.setPath('userData', path.join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let owner, server, runtime, views, websiteServer
 try {
  const root = path.join(__dirname, 'data'), paths = new MiraPaths(root).ensure(), dataRoot = path.join(root, 'app-data')
  fs.cpSync(process.env.WORKBENCH_DIST, path.join(paths.apps, 'mira-workbench'), { recursive: true })
  const legacyDir = path.join(paths.apps, '.miniapps', 'sdk-test'); fs.mkdirSync(legacyDir, { recursive: true })
  const manifest = { manifestVersion: 1, id: 'sdk-test', name: '独立小程序', version: '1.0.0', entry: 'index.html', icon: 'icon.svg', requiredCapabilities: ['storage:app', 'models:generate', 'files:read', 'files:write'] }
  const html = '<!doctype html><p id="identity"></p><input id="draft"><p id="result"></p><p id="ready"></p><script type="module" src="child.js"></script>'
  fs.writeFileSync(path.join(legacyDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="8" fill="green"/></svg>')
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
  let child = await openChild()
  if (await child.executeJavaScript('document.querySelector("#draft").value') !== 'legacy-draft') throw Error('legacy SQLite data not migrated')
  await child.executeJavaScript('document.querySelector("#draft").value = "retained"; window.saveDraft()')
  if (await child.executeJavaScript('document.querySelector("#result").textContent') !== 'model-result') throw Error('model not routed')
  const childMenu = async label => {
   await inspect('document.querySelector(".tab--site").dispatchEvent(new MouseEvent("contextmenu", { bubbles:true, clientX:140,clientY:25 }))')
   await wait(() => inspect('!!document.querySelector(".tab-context-menu")'))
   await inspect('[...document.querySelectorAll(".tab-context-menu button")].find(button => button.textContent === ' + JSON.stringify(label) + ').click()')
  }
  // Opening the menu must keep the live miniapp visible underneath the transparent Workbench root.
  const rootView = owner.contentView.children.find(view => view.webContents === parent)
  const childView = owner.contentView.children.find(view => view.webContents === child)
  const contentBounds = childView.getBounds()
  await inspect('document.querySelector(".tab--site").dispatchEvent(new MouseEvent("contextmenu", { bubbles:true,clientX:140,clientY:25 }))')
  await wait(() => inspect('!!document.querySelector(".tab-context-menu")'), 'menu visible')
  assert.deepEqual(childView.getBounds(), contentBounds)
  await wait(() => owner.contentView.children.indexOf(rootView) > owner.contentView.children.indexOf(childView), 'menu overlay')
  assert.equal(await inspect('getComputedStyle(document.documentElement).backgroundColor'), 'rgba(0, 0, 0, 0)')
  await inspect('document.dispatchEvent(new KeyboardEvent("keydown", { key:"Escape", bubbles:true }))')
  await wait(() => !views.workbenchOverlays.has(id), 'menu overlay restored')
  const checkDialogs = async (contents, nativeView, kind) => {
   const bounds = nativeView.getBounds()
   await contents.executeJavaScript('window.dialogRetainedValue = 73')
   await inspect('document.querySelector("[aria-label=在浏览器打开]")?.dispatchEvent(new PointerEvent("pointerover", { bubbles:true })) || document.querySelector("[aria-label=添加]").dispatchEvent(new PointerEvent("pointerover", { bubbles:true }))')
   assert.equal(await inspect('!!document.querySelector(".workbench-tooltip")'), false, 'Tooltip must wait before appearing')
   await wait(() => inspect('!!document.querySelector(".workbench-tooltip")'), kind + ' tooltip')
   await wait(() => views.workbenchOverlays.has(id), kind + ' tooltip native overlay')
   assert.deepEqual(nativeView.getBounds(), bounds)
   assert.ok(owner.contentView.children.indexOf(rootView) > owner.contentView.children.indexOf(nativeView))
   for (const theme of ['light','dark']) {
    await inspect('document.documentElement.dataset.theme = ' + JSON.stringify(theme))
    assert.equal(await inspect('getComputedStyle(document.querySelector(".workbench-tooltip")).backgroundColor'), theme === 'dark' ? 'rgb(43, 43, 43)' : 'rgb(255, 255, 255)')
    assert.equal(await inspect('getComputedStyle(document.querySelector(".workbench-tooltip")).borderRadius'), '6px')
   }
   await inspect('document.documentElement.dataset.theme = "light"; document.dispatchEvent(new KeyboardEvent("keydown", { key:"Escape", bubbles:true }))')
   await wait(() => !views.workbenchOverlays.has(id), kind + ' tooltip exit')
   const assertVisible = async selector => {
    await wait(() => inspect('!!document.querySelector(' + JSON.stringify(selector) + ')') , kind + ' dialog')
    await wait(() => views.workbenchOverlays.has(id), kind + ' overlay')
    assert.deepEqual(nativeView.getBounds(), bounds)
    assert.ok(owner.contentView.children.indexOf(rootView) > owner.contentView.children.indexOf(nativeView))
    assert.equal(await inspect('getComputedStyle(document.querySelector(".workbench")).backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.equal(await contents.executeJavaScript('window.dialogRetainedValue'), 73)
    for (const theme of ['light','dark']) {
     await inspect('document.documentElement.dataset.theme = ' + JSON.stringify(theme))
     assert.equal(await inspect('getComputedStyle(document.querySelector(' + JSON.stringify(selector) + ')).backgroundColor'), theme === 'dark' ? 'rgb(43, 43, 43)' : 'rgb(255, 255, 255)')
     assert.equal(await inspect('getComputedStyle(document.querySelector(' + JSON.stringify(selector) + ')).borderRadius'), '12px')
    }
    await inspect('document.documentElement.dataset.theme = "light"')
   }
   await inspect('document.querySelector("[aria-label=添加]").click()')
   await assertVisible('.add-dialog')
   await inspect('document.querySelector(".add-dialog [aria-label=关闭]").click()')
   assert.equal(await inspect('!!document.querySelector(".floating-dialog-leave-active") && document.documentElement.classList.contains("workbench-overlay-open")'), true, 'Keep native overlay throughout dialog exit')
   assert.equal(views.workbenchOverlays.has(id), true)
   await wait(() => !views.workbenchOverlays.has(id), kind + ' add closed')
   await inspect('document.querySelector("[aria-label=设置]").click()')
   await assertVisible('.manage-dialog')
   await inspect('document.querySelector(".manage-entry-action").click()')
   await assertVisible('.site-dialog')
   await wait(() => inspect('!document.querySelector(".manage-dialog")'), kind + ' manage exit')
   await inspect('document.querySelector(".site-dialog [aria-label=关闭]").click()')
   await wait(() => !views.workbenchOverlays.has(id), kind + ' edit closed')
   assert.deepEqual(nativeView.getBounds(), bounds)
   assert.ok(owner.contentView.children.indexOf(rootView) < owner.contentView.children.indexOf(nativeView))
   assert.equal(await contents.executeJavaScript('window.dialogRetainedValue'), 73)
  }
  await checkDialogs(child, childView, 'miniapp')
  websiteServer = require('http').createServer((_req, response) => response.end('<title>Dialog website</title><body style="background:#427659">Live website</body>'))
  await new Promise(resolve => websiteServer.listen(0, '127.0.0.1', resolve))
  const websiteUrl = 'http://127.0.0.1:' + websiteServer.address().port + '/'
  parent.send('mira-app:browser-event', { type:'open-tab', url:websiteUrl })
  let website
  await wait(() => { website = webContents.getAllWebContents().find(contents => contents.getURL() === websiteUrl); return Boolean(website) }, 'live website')
  await wait(() => !website.isLoading(), 'website loaded')
  const websiteView = owner.contentView.children.find(view => view.webContents === website)
  await wait(() => websiteView.getBounds().width > 0, 'website shown')
  await checkDialogs(website, websiteView, 'website')
  for (const theme of ['light', 'dark']) {
   await inspect('document.documentElement.dataset.theme = ' + JSON.stringify(theme))
   await inspect('document.querySelector("[aria-label=添加]").click()')
   await wait(() => views.workbenchOverlays.has(id), 'themed dialog overlay')
   assert.equal(await inspect('getComputedStyle(document.querySelector(".web-content")).backgroundColor'), 'rgba(0, 0, 0, 0)')
   await inspect('document.querySelector(".add-dialog [aria-label=关闭]").click()')
   await wait(() => !views.workbenchOverlays.has(id), 'themed dialog closed')
  }
  await inspect('document.documentElement.dataset.theme = "light"; document.querySelector(".tab--site.is-active .tab-close").click()')
  await wait(() => website.isDestroyed(), 'close website')
  await wait(() => inspect('document.querySelectorAll(".tab--site").length === 1'), 'website tab removed')
  await inspect('document.querySelector(".tab--site").click()')
  await wait(() => childView.getBounds().width > 0, 'miniapp restored')
  await childMenu('重新加载')
  await wait(async () => await child.executeJavaScript('document.querySelector("#draft")?.value === "retained"'), 'reload starts')
  await wait(async () => await child.executeJavaScript('document.querySelector("#ready")?.textContent === "ready"'), 'reload reconnects SDK')
  if (await child.executeJavaScript('document.querySelector("#draft").value') !== 'retained') throw Error('Reload lost stored draft')
  await childMenu('复制')
  await wait(() => inspect('document.querySelectorAll(".tab--site").length === 2'), 'duplicate tab')
  let clone
  await wait(() => { clone = webContents.getAllWebContents().find(contents => contents !== child && contents.getURL().includes('/apps/resource-')); return Boolean(clone) }, 'duplicate view')
  await wait(async () => await clone.executeJavaScript('document.querySelector("#ready")?.textContent === "ready"'), 'duplicate SDK')
  if (await clone.executeJavaScript('document.querySelector("#draft").value') !== 'retained') throw Error('Duplicate lost storage namespace')
  await childMenu('将网站静音')
  await wait(() => child.isAudioMuted() && clone.isAudioMuted(), 'miniapp mute')
  await childMenu('将这个网站取消静音')
  await wait(() => !child.isAudioMuted() && !clone.isAudioMuted(), 'miniapp unmute')
  await inspect('document.querySelectorAll(".tab--site")[1].querySelector(".tab-close").click()')
  await wait(() => clone.isDestroyed(), 'close duplicate')
  await wait(() => inspect('document.querySelectorAll(".tab--site").length === 1'), 'close duplicate tab animation')
  await childMenu('关闭其他')
  await wait(() => inspect('document.querySelectorAll(".tab--home").length === 0'), 'miniapp closes home as a normal tab')
  await child.executeJavaScript('window.retainedValue = 42')
  const start = await inspect('(() => { const r = document.querySelector(".tab--site").getBoundingClientRect(); return { x:Math.round(r.x + 70), y:Math.round(r.y + 16) } })()')
  let cursor = { x:650, y:300 }
  screen.getCursorScreenPoint = () => cursor
  parent.sendInputEvent({ type:'mouseDown', button:'left', clickCount:1, ...start })
  parent.sendInputEvent({ type:'mouseMove', x:start.x + 200, y:start.y + 110, modifiers:['leftButtonDown'] })
  await wait(() => BrowserWindow.getAllWindows().length === 1, 'detached while held')
  await wait(() => inspect('document.querySelectorAll(".tab--workspace").length === 1 && !!document.querySelector(".tab--home.is-active")'), 'detaching the final tab creates home')
  const detachedWindow = BrowserWindow.getAllWindows()[0]
  assert.equal(detachedWindow.isVisible(), true)
  assert.deepEqual(detachedWindow.getSize(), owner.getMinimumSize())
  const windowBounds = detachedWindow.getBounds(), contentBoundsAfterDetach = detachedWindow.getContentBounds()
  assert.ok(Math.abs(windowBounds.x + windowBounds.width / 2 - cursor.x) <= 1)
  assert.ok(Math.abs(windowBounds.y + (process.platform === 'darwin' ? 24 : (contentBoundsAfterDetach.y - windowBounds.y) / 2) - cursor.y) <= 1)
  const firstPosition = detachedWindow.getPosition()
  cursor = { x:950, y:500 }
  await wait(() => detachedWindow.getPosition()[0] === firstPosition[0] + 300 && detachedWindow.getPosition()[1] === firstPosition[1] + 200, 'held window follows cursor')
  parent.sendInputEvent({ type:'mouseUp', button:'left', clickCount:1, x:start.x + 200, y:start.y + 110 })
  await wait(() => !views.views.get(child.id).detached.dragTimer, 'pointer release ends native tracking')
  const released = detachedWindow.getPosition()
  cursor = { x:100, y:100 }
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.deepEqual(detachedWindow.getPosition(), released)
  await wait(() => detachedWindow.webContents.executeJavaScript('Boolean(window.miraDetached && document.querySelector("[data-action=reattach]"))'), 'window controls')
  assert.equal(await detachedWindow.webContents.executeJavaScript('document.querySelector(".title").textContent'), '独立小程序')
  await wait(() => detachedWindow.webContents.executeJavaScript('document.querySelector(".identity-icon img")?.naturalWidth > 0 && !document.querySelector(".identity-icon img").hidden'), 'miniapp logo in detached title')
  assert.equal(await detachedWindow.webContents.executeJavaScript('!!document.querySelector(".browser-toolbar")'), false)
  assert.equal(views.views.get(child.id).view.getBounds().y, 48)
  if (process.platform === 'darwin') {
   for (const fullScreen of [true, false]) {
    const finished = new Promise(resolve => detachedWindow.once(fullScreen ? 'enter-full-screen' : 'leave-full-screen', resolve))
    detachedWindow.setFullScreen(fullScreen)
    await finished
    await wait(async () => await detachedWindow.webContents.executeJavaScript('getComputedStyle(document.querySelector("header")).paddingLeft') === (fullScreen ? '16px' : '80px'), 'miniapp fullscreen title spacing')
   }
  }
  await child.executeJavaScript('window.saveDraft()')
  await detachedWindow.webContents.executeJavaScript('document.querySelector("[data-action=reattach]").click()')
  await wait(() => detachedWindow.isDestroyed(), 'reattach miniapp')
  await wait(() => inspect('document.querySelectorAll(".tab--site").length === 1'), 'restored miniapp tab')
  if (await child.executeJavaScript('window.retainedValue') !== 42) throw Error('Detached miniapp lost state')
  await childMenu('关闭其他')
  await wait(() => inspect('document.querySelectorAll(".tab--home").length === 0'), 'close fallback home')
  await childMenu('关闭')
  await wait(() => child.isDestroyed(), 'close final miniapp')
  await wait(() => inspect('document.querySelectorAll(".tab--workspace").length === 1 && !!document.querySelector(".tab--home.is-active")'), 'closing final miniapp creates home')
  child = await openChild()
  await inspect('document.querySelector("[aria-label=设置]").click()')
  await inspect('(() => { const select = document.querySelector("#tab-cache-count"); select.value = "0"; select.dispatchEvent(new Event("change", { bubbles:true })); document.querySelector(".manage-dialog .add-button").click(); })()')
  await inspect('document.querySelector(".tab--home").click()')
  await wait(() => child.isDestroyed(), 'zero cache destroys native MiniApp view')
  assert.equal(await inspect('document.querySelectorAll(".tab--site").length'), 1, 'MiniApp tab remains after release')
  await inspect('document.querySelector(".tab--site").click()')
  await wait(() => { child = webContents.getAllWebContents().find(contents => contents.getURL().includes('/apps/resource-')); return Boolean(child) }, 'MiniApp recreated')
  await wait(async () => await child.executeJavaScript('document.querySelector("#ready")?.textContent === "ready"'), 'resumed MiniApp SDK')
  assert.equal(await child.executeJavaScript('document.querySelector("#draft").value'), 'retained')
  await inspect('document.querySelector("[aria-label=设置]").click()')
  await inspect('(() => { const select = document.querySelector("#tab-cache-count"); select.value = "3"; select.dispatchEvent(new Event("change", { bubbles:true })); document.querySelector(".manage-dialog .add-button").click(); })()')
  const scope = 'scope-' + crypto.createHash('sha256').update('mira-workbench').digest('hex').slice(0, 24) + '-' + crypto.createHash('sha256').update('sdk-test').digest('hex').slice(0, 32)
  if (!fs.existsSync(path.join(dataRoot, scope + '.sqlite')) || !fs.existsSync(path.join(dataRoot, 'sdk-test.sqlite'))) throw Error('data identity wrong')
  await inspect('document.querySelector(".tab--home").click(); document.querySelector("[aria-label=设置]").click()')
  await inspect('[...document.querySelectorAll(".manage-transfer-item")].find(e => e.textContent.includes("独立小程序")).querySelector(".manage-miniapp-menu button").click()')
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
  await inspect('document.querySelector(".tab--home").click(); document.querySelector("[aria-label=添加]").click()')
  await inspect('document.querySelector("#add-miniapp-tab").click()')
  const update = zipSync({ 'icon.svg': new Uint8Array(fs.readFileSync(path.join(legacyDir, 'icon.svg'))), 'miniapp-manifest.json': strToU8(JSON.stringify({ ...manifest, version: '1.1.0' })), 'index.html': strToU8(html), 'child.js': new Uint8Array(fs.readFileSync(path.join(__dirname, 'child.js'))) })
  const base64 = Buffer.from(update).toString('base64')
  await inspect('(() => { const bytes = Uint8Array.from(atob(' + JSON.stringify(base64) + '), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], "update.miniapp")); const input = document.querySelector("input[aria-label=选择小程序安装包]"); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); })()')
  await wait(async () => Boolean(await inspect('document.querySelector(".review-dialog")')), 'update review')
  await inspect('document.querySelector(".review-dialog .add-button").click()')
  await wait(async () => (await inspect('document.body.innerText')).includes('可以立即打开'), 'update')
  if (!child.isDestroyed()) throw Error('update did not stop old child')
  await inspect('document.querySelector(".add-dialog [aria-label=关闭]").click(); document.querySelector("[aria-label=设置]").click()')
  await inspect('[...[...document.querySelectorAll(".manage-transfer-item")].find(e => e.textContent.includes("独立小程序")).querySelectorAll("button")].find(e => e.textContent === "卸载").click()')
  await wait(async () => Boolean(await inspect('document.querySelector(".review-dialog")')), 'uninstall review')
  await inspect('document.querySelector(".review-dialog .add-button").click()')
  await wait(async () => !(await inspect('document.querySelector(".manage-transfer").textContent')).includes('独立小程序'), 'uninstall')
  if (!fs.existsSync(path.join(dataRoot, scope + '.sqlite')) || !fs.existsSync(legacyDir)) throw Error('migration/uninstall lost source data')
  if (approvals.size) throw Error('Mira stored miniapp permissions')
  console.log('RESULT=' + JSON.stringify({ migrated: true, ownedByWorkbench: true, storage: true, model: true, filePermissions: true, revoked: true, updated: true, uninstalled: true }))
 } catch (error) { console.error(error); process.exitCode = 1 }
 finally { views?.closeAll(); runtime?.close(); owner?.destroy(); websiteServer?.close(); await server?.stop(); app.quit() }
})
`

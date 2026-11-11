import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('loads and controls real isolated Workbench browser views', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mira-workbench-views-'))
  try {
    await build({ stdin: { contents: "export { WorkbenchBrowserViews } from './electron/services/workbenchBrowserViews'; export { handleDetachedViewCommand } from './electron/services/detachedViewWindow'", resolveDir: process.cwd() }, outfile: join(directory, 'browser.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
    await writeFile(join(directory, 'main.cjs'), main)
    const env = { ...process.env, DETACHED_PRELOAD: resolve('electron/preload/detachedView.cjs') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, timeout: 20000 })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ title: 'Loaded page', partition: true, back: true, hidden: true, closed: true, detached: true, reattached: true, pinned: true })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)

const main = `
const { app, BrowserWindow, WebContentsView, session, webContents, ipcMain, screen, shell } = require('electron')
const http = require('http')
app.setPath('userData', require('path').join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let owner, server, browser
 try {
  let requests = 0, slowResponse, lateResponse, externalUrl
  shell.openExternal = async url => { externalUrl = url }
  server = http.createServer((req, res) => { requests++; if (req.url === '/late-icon-page') { lateResponse = res; return } if (req.url === '/late-icon.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="8" fill="green"/></svg>'); return } if (req.url === '/slow') { slowResponse = res; return } if (req.url === '/redirect') { res.writeHead(302, { Location:'/next' }); res.end(); return } res.setHeader('Content-Security-Policy', "frame-ancestors 'none'"); res.end('<title>Loaded page</title><a href="/next">Next</a>') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  owner = new BrowserWindow({ show: false, width: 1100, height: 700, minWidth: 1024, minHeight: 680 })
  await owner.loadURL('about:blank')
  const appView = new WebContentsView({ webPreferences: { sandbox: true } })
  owner.contentView.addChildView(appView); appView.setBounds({ x: 0, y: 0, width: 900, height: 600 })
  await appView.webContents.loadURL('about:blank')
  const { WorkbenchBrowserViews, handleDetachedViewCommand } = require('./browser.cjs')
  ipcMain.on('mira:detached-command', (event, action) => handleDetachedViewCommand(event.sender, action))
  browser = new WorkbenchBrowserViews(owner, appView.webContents, () => {}, process.env.DETACHED_PRELOAD)
  browser.setAppBounds({ x: 0, y: 0, width: 900, height: 600 })
  browser.open('one', 'http://127.0.0.1:' + server.address().port + '/')
  browser.setLayout('one', { x: 10, y: 20, width: 500, height: 400 }, true)
  const guest = webContents.getAllWebContents().find(value => value.session === session.fromPartition('persist:mira-workbench'))
  const wait = async fn => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)) } throw Error('timeout') }
  await wait(() => guest.getTitle() === 'Loaded page' && !guest.isLoading() && guest.navigationHistory.length() > 0)
  const title = guest.getTitle(), partition = guest.session === session.fromPartition('persist:mira-workbench')
  const guestId = guest.id
  browser.open('one', 'http://127.0.0.1:' + server.address().port + '/next')
  await wait(() => guest.getURL().endsWith('/next'))
  if (guest.id !== guestId || owner.contentView.children.filter(child => child.webContents?.session === session.fromPartition('persist:mira-workbench')).length !== 1) throw Error('Navigation replaced or duplicated the browser view')
  await wait(() => guest.navigationHistory.canGoBack())
  browser.control('one', 'back')
  await wait(() => guest.getURL().endsWith('/'))
  browser.setLayout('one', { x: 0, y: 0, width: 0, height: 0 }, false)
  const view = owner.contentView.children.find(child => child.webContents === guest)
  const hidden = view.getBounds().width === 0
  await guest.executeJavaScript('window.retainedValue = 42')
  let cursor = { x:650, y:250 }
  screen.getCursorScreenPoint = () => cursor
  const icon = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect width="18" height="18" rx="4" fill="#57906d"/></svg>').toString('base64')
  browser.control('one', 'detach', false, 90, { title:'Loaded & <page>', icon })
  const detachedWindow = BrowserWindow.getAllWindows().find(window => window !== owner)
  if (!detachedWindow) throw Error('No detached window')
  if (!detachedWindow.isVisible()) throw Error('Held drag must show window immediately')
  const bounds = detachedWindow.getBounds(), content = detachedWindow.getContentBounds()
  if (JSON.stringify(detachedWindow.getSize()) !== JSON.stringify(owner.getMinimumSize())) throw Error('Detached window did not use Mira minimum size')
  if (Math.abs(bounds.x + bounds.width / 2 - cursor.x) > 1 || Math.abs(bounds.y + (process.platform === 'darwin' ? 24 : content.y > bounds.y ? (content.y - bounds.y) / 2 : 24) - cursor.y) > 1) throw Error('Cursor is not centered on the title bar: ' + JSON.stringify({ bounds, content, cursor }))
  const position = detachedWindow.getPosition()
  cursor = { x:1000, y:450 }
  await wait(() => detachedWindow.getPosition()[0] === position[0] + 350 && detachedWindow.getPosition()[1] === position[1] + 200)
  browser.control('one', 'end-drag')
  const droppedPosition = detachedWindow.getPosition()
  cursor = { x:100, y:100 }
  await new Promise(resolve => setTimeout(resolve, 80))
  if (JSON.stringify(detachedWindow.getPosition()) !== JSON.stringify(droppedPosition)) throw Error('Released window kept following cursor')
  await wait(() => detachedWindow.webContents.executeJavaScript('Boolean(window.miraDetached && document.querySelector("[data-action=pin]"))'))
  const inspectToolbar = code => detachedWindow.webContents.executeJavaScript(code)
  if (await inspectToolbar('document.querySelector(".title").textContent') !== 'Loaded & <page>') throw Error('Detached name did not match tab')
  await wait(() => inspectToolbar('document.querySelector(".identity-icon img")?.naturalWidth > 0'))
  if (view.getBounds().y !== 96) throw Error('Guest does not start below title and browser toolbars')
  if (process.platform === 'win32') {
   if (detachedWindow.isMenuBarVisible()) throw Error('Native menu bar is visible')
   if (detachedWindow.getContentBounds().y - detachedWindow.getBounds().y > 10) throw Error('Native title bar still takes a separate row')
   const controls = await inspectToolbar('(() => { const actions = document.querySelector(".actions").getBoundingClientRect(), controls = document.querySelector(".window-controls").getBoundingClientRect(); return { actionsRight: actions.right, controlsLeft: controls.left, count: document.querySelectorAll(".window-controls button").length } })()')
   if (controls.count !== 3 || controls.actionsRight > controls.controlsLeft) throw Error('Window buttons overlap detached actions')
   await inspectToolbar('document.querySelector("[data-action=maximize]").click()')
   await wait(() => detachedWindow.isMaximized())
   await wait(() => inspectToolbar('document.querySelector("[data-action=maximize]").getAttribute("aria-label") === "还原"'))
   await inspectToolbar('document.querySelector("[data-action=maximize]").click()')
   await wait(() => !detachedWindow.isMaximized())
   await wait(() => inspectToolbar('document.querySelector("[data-action=maximize]").getAttribute("aria-label") === "最大化"'))
   await inspectToolbar('document.querySelector("[data-action=minimize]").click()')
   await wait(() => detachedWindow.isMinimized())
   detachedWindow.restore()
  }
  if (process.platform === 'darwin') {
   if (detachedWindow.getContentBounds().y !== detachedWindow.getBounds().y) throw Error('Native title bar still takes a separate row')
   if (JSON.stringify(detachedWindow.getWindowButtonPosition()) !== JSON.stringify({ x:12, y:17 })) throw Error('Traffic lights do not align with toolbar')
  }
  if (process.platform === 'darwin') {
   const padding = () => inspectToolbar('getComputedStyle(document.querySelector("header")).paddingLeft')
   if (await padding() !== '80px') throw Error('Windowed traffic light space missing')
   const transition = async fullScreen => {
    const finished = new Promise(resolve => detachedWindow.once(fullScreen ? 'enter-full-screen' : 'leave-full-screen', resolve))
    detachedWindow.setFullScreen(fullScreen)
    await finished
    await wait(async () => await padding() === (fullScreen ? '16px' : '80px'))
   }
   await transition(true)
   if (view.getBounds().y !== 96 || view.getBounds().width !== detachedWindow.getContentSize()[0]) throw Error('Fullscreen changed browser toolbar or page layout')
   if (process.env.DETACHED_SCREENSHOTS) {
    const fs = require('fs'), path = require('path')
    fs.mkdirSync(process.env.DETACHED_SCREENSHOTS, { recursive:true })
    fs.writeFileSync(path.join(process.env.DETACHED_SCREENSHOTS, 'fullscreen.png'), (await detachedWindow.webContents.capturePage({ x:0,y:0,width:1024,height:96 })).toPNG())
   }
   await transition(false)
  }
  for (const action of ['pin', 'reattach']) {
   const point = await inspectToolbar('(() => { const r = document.querySelector("[data-action=' + action + ']").getBoundingClientRect(); return { x:Math.round(r.x + r.width/2), y:Math.round(r.y + r.height/2) } })()')
   detachedWindow.webContents.sendInputEvent({ type:'mouseMove', ...point })
   await wait(() => inspectToolbar('getComputedStyle(document.querySelector("#' + action + '-tooltip")).visibility === "visible"'))
  }
  if (process.env.DETACHED_SCREENSHOTS) {
   const fs = require('fs'), path = require('path')
   fs.mkdirSync(process.env.DETACHED_SCREENSHOTS, { recursive:true })
   for (const theme of ['light', 'dark']) {
    require('electron').nativeTheme.themeSource = theme
    await new Promise(resolve => setTimeout(resolve, 100))
    fs.writeFileSync(path.join(process.env.DETACHED_SCREENSHOTS, theme + '.png'), (await detachedWindow.webContents.capturePage({ x:0, y:0, width:1024, height:96 })).toPNG())
   }
  }
  const addressValue = () => inspectToolbar('document.querySelector(".address-bar input").value')
  const click = action => inspectToolbar('document.querySelector("[data-action=' + action + ']").click()')
  const navigate = value => inspectToolbar('(() => { const input = document.querySelector(".address-bar input"); input.value = ' + JSON.stringify(value) + '; input.dispatchEvent(new Event("input", { bubbles:true })); input.form.requestSubmit(); })()')
  await wait(async () => await addressValue() === guest.getURL())
  const original = guest.getURL()
  await click('forward')
  await wait(async () => guest.getURL().endsWith('/next') && await addressValue() === guest.getURL())
  await click('back')
  await wait(async () => guest.getURL() === original && await addressValue() === original)
  await navigate(original + 'redirect')
  await wait(async () => guest.getURL().endsWith('/next') && await addressValue() === guest.getURL() && !guest.isLoading())
  const previousRequests = requests
  await click('reload')
  await wait(() => requests > previousRequests && !guest.isLoading())
  await navigate(original + 'slow')
  await wait(() => Boolean(slowResponse))
  await wait(() => inspectToolbar('!!document.querySelector("[data-action=stop]")'))
  await click('stop')
  await wait(() => !guest.isLoading())
  slowResponse.end('stopped')
  await wait(() => inspectToolbar('!!document.querySelector("[data-action=reload]")'))
  const beforeInvalid = guest.getURL()
  await navigate('file:///etc/passwd')
  if (await inspectToolbar('document.querySelector(".address-bar input").validity.valid')) throw Error('Unsafe address accepted')
  handleDetachedViewCommand(detachedWindow.webContents, { type:'navigate', url:'javascript:alert(1)' })
  await wait(() => inspectToolbar('!!document.querySelector(".address-bar input").validationMessage'))
  if (guest.getURL() !== beforeInvalid) throw Error('Unsafe navigation reached guest')
  await navigate(original)
  await wait(async () => guest.getURL() === original && await addressValue() === original && !guest.isLoading())
  await click('external')
  await wait(() => externalUrl === original)
  await inspectToolbar('document.querySelector("[data-action=pin]").click()')
  await wait(() => detachedWindow.isAlwaysOnTop())
  handleDetachedViewCommand(detachedWindow.webContents, { type:'navigate', url:'file:///blocked' })
  await wait(() => inspectToolbar('!!document.querySelector(".address-bar input").validationMessage'))
  if (await inspectToolbar('document.querySelector("[data-action=pin]").getAttribute("aria-pressed")') !== 'true') throw Error('Browser error reset pin UI')
  await inspectToolbar('document.querySelector("[data-action=pin]").click()')
  await wait(() => !detachedWindow.isAlwaysOnTop())
  await inspectToolbar('document.querySelector(".address-bar input").setCustomValidity("")')

  await guest.executeJavaScript('window.retainedValue = 42')
  if (guest.id !== guestId || !detachedWindow.contentView.children.some(child => child.webContents === guest)) throw Error('Detached view was replaced')
  browser.setAppBounds({ x:0, y:0, width:0, height:0 })
  if (view.getBounds().width === 0) throw Error('Main window hid the detached page')
  browser.control('one', 'mute', true)
  if (!guest.isAudioMuted()) throw Error('Mute failed')
  await detachedWindow.webContents.executeJavaScript('document.querySelector("[data-action=pin]").click()')
  await wait(() => detachedWindow.isAlwaysOnTop())
  await wait(() => inspectToolbar('document.querySelector("#pin-tooltip").textContent === "取消固定窗口"'))
  handleDetachedViewCommand(guest, 'reattach')
  if (detachedWindow.isDestroyed()) throw Error('Guest forged a toolbar command')
  await detachedWindow.webContents.executeJavaScript('document.querySelector("[data-action=reattach]").click()')
  await wait(() => detachedWindow.isDestroyed())
  if (!owner.contentView.children.includes(view) || await guest.executeJavaScript('window.retainedValue') !== 42) throw Error('Reattach lost live page state')
  browser.open('one', original + 'late-icon-page')
  await wait(() => Boolean(lateResponse) && guest.isLoading())
  browser.control('one', 'detach', false, undefined, { title:'Still loading' })
  const lateWindow = BrowserWindow.getAllWindows().find(window => window !== owner)
  const lateToolbar = code => lateWindow.webContents.executeJavaScript(code)
  await wait(() => lateToolbar('!!document.querySelector(".identity-icon img")'))
  if (await lateToolbar('!!document.querySelector(".identity-icon img").getAttribute("src")')) throw Error('Loading window unexpectedly has an icon')
  lateResponse.end('<title>Finished loading</title><link rel="icon" href="/late-icon.svg">')
  await wait(() => lateToolbar('document.querySelector(".identity-icon img")?.naturalWidth > 0 && !document.querySelector(".identity-icon img").hidden'))
  if (!await lateToolbar('document.querySelector(".identity-icon img").src.endsWith("/late-icon.svg")')) throw Error('Late favicon was not synchronized')
  browser.control('one', 'presentation', false, undefined, { icon:'data:image/png;base64,broken' })
  await wait(() => lateToolbar('document.querySelector(".identity-icon img").hidden && document.querySelector(".identity-icon img").complete && !document.querySelector(".identity-icon img").naturalWidth'))
  browser.control('one', 'presentation', false, undefined, { icon })
  await wait(() => lateToolbar('document.querySelector(".identity-icon img").naturalWidth > 0 && !document.querySelector(".identity-icon img").hidden'))
  browser.control('one', 'mute', false)
  if (await lateToolbar('document.querySelector(".identity-icon img").src') !== icon) throw Error('Favicon replaced preferred icon')
  browser.control('one', 'reattach')
  await wait(() => lateWindow.isDestroyed())
  browser.control('one', 'detach')
  const closedWindow = BrowserWindow.getAllWindows().find(window => window !== owner)
  if (process.platform === 'win32') {
   await wait(() => closedWindow.webContents.executeJavaScript('!!document.querySelector("[data-action=close]")'))
   await closedWindow.webContents.executeJavaScript('document.querySelector("[data-action=close]").click()')
  } else closedWindow.close()
  await wait(() => closedWindow.isDestroyed())
  await wait(() => guest.isDestroyed())
  if (owner.contentView.children.includes(view)) throw Error('Closing detached window reattached page')
  browser.open('one', 'http://127.0.0.1:' + server.address().port + '/')
  const freshGuest = webContents.getAllWebContents().find(value => value.session === session.fromPartition('persist:mira-workbench'))
  if (!freshGuest || freshGuest.id === guestId) throw Error('Closed page was reused')
  browser.control('one', 'detach')
  const disposingWindow = BrowserWindow.getAllWindows().find(window => window !== owner)
  browser.dispose()
  await wait(() => freshGuest.isDestroyed() && disposingWindow.isDestroyed())
  console.log('RESULT=' + JSON.stringify({ title, partition, back: true, hidden, closed: true, detached: true, reattached: true, pinned: true }))
 } catch (error) { console.error(error); process.exitCode = 1 }
 finally { browser?.dispose(); owner?.destroy(); server?.close(); app.quit() }
})
`

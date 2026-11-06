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
    await build({ entryPoints: [resolve('electron/services/workbenchBrowserViews.ts')], outfile: join(directory, 'browser.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
    await writeFile(join(directory, 'main.cjs'), main)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, timeout: 20000 })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ title: 'Loaded page', partition: true, back: true, hidden: true, closed: true })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)

const main = `
const { app, BrowserWindow, WebContentsView, session, webContents } = require('electron')
const http = require('http')
app.setPath('userData', require('path').join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let owner, server, browser
 try {
  server = http.createServer((req, res) => { res.setHeader('Content-Security-Policy', "frame-ancestors 'none'"); res.end('<title>Loaded page</title><a href="/next">Next</a>') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  owner = new BrowserWindow({ show: false, width: 1000, height: 700 })
  await owner.loadURL('about:blank')
  const appView = new WebContentsView({ webPreferences: { sandbox: true } })
  owner.contentView.addChildView(appView); appView.setBounds({ x: 0, y: 0, width: 900, height: 600 })
  await appView.webContents.loadURL('about:blank')
  const { WorkbenchBrowserViews } = require('./browser.cjs')
  browser = new WorkbenchBrowserViews(owner, appView.webContents)
  browser.setAppBounds({ x: 0, y: 0, width: 900, height: 600 })
  browser.open('one', 'http://127.0.0.1:' + server.address().port + '/')
  browser.setLayout('one', { x: 10, y: 20, width: 500, height: 400 }, true)
  const guest = webContents.getAllWebContents().find(value => value.session === session.fromPartition('persist:mira-workbench'))
  const wait = async fn => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)) } throw Error('timeout') }
  await wait(() => guest.getTitle() === 'Loaded page' && !guest.isLoading() && guest.navigationHistory.length() > 0)
  const title = guest.getTitle(), partition = guest.session === session.fromPartition('persist:mira-workbench')
  await guest.executeJavaScript('document.querySelector("a").click()', true)
  await wait(() => guest.getURL().endsWith('/next'))
  await wait(() => guest.navigationHistory.canGoBack())
  browser.control('one', 'back')
  await wait(() => guest.getURL().endsWith('/'))
  browser.setLayout('one', { x: 0, y: 0, width: 0, height: 0 }, false)
  const view = owner.contentView.children.find(child => child.webContents === guest)
  const hidden = view.getBounds().width === 0
  browser.dispose()
  await wait(() => guest.isDestroyed())
  console.log('RESULT=' + JSON.stringify({ title, partition, back: true, hidden, closed: true }))
 } catch (error) { console.error(error); process.exitCode = 1 }
 finally { browser?.dispose(); owner?.destroy(); server?.close(); app.quit() }
})
`

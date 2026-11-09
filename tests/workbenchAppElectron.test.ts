import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('connects the Workbench interface to SDK storage and browser requests', async () => {
  const workbench = resolve('../Mira-Workbench'), directory = await mkdtemp(join(tmpdir(), 'mira-workbench-app-'))
  try {
    await promisify(execFile)('npm', ['run', 'build'], { cwd: workbench, timeout: 30000 })
    await writeFile(join(directory, 'main.cjs'), main)
    const env = { ...process.env, WORKBENCH_DIST: join(workbench, 'dist'), APP_PRELOAD: resolve('electron/preload/appHost.cjs') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, timeout: 20000 })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ imported: true, saved: true, restored: true, browser: true, legacyReads: 1 })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60000)

const main = `
const { app, BrowserWindow, ipcMain, MessageChannelMain } = require('electron')
const http = require('http'), fs = require('fs'), path = require('path')
app.setPath('userData', path.join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let server, win
 try {
  const tables = { entries: [], settings: [] }, requests = []; let legacyReads = 0
  ipcMain.on('mira-app:ready', event => {
   const channel = new MessageChannelMain()
   channel.port1.on('message', ({ data }) => {
    if (data.type !== 'mira:request') return
    try {
     let value = null
     if (data.method === 'context.get') value = { appId: 'mira-workbench', apiVersion: { major: 1, minor: 0 }, capabilities: ['storage:app', 'appearance:read'] }
     else if (data.method === 'appearance.get') value = 'light'
     else if (data.method === 'storage.migrate') value = 1
     else if (data.method === 'storage.importLegacyWorkbenchSites') { legacyReads++; value = JSON.stringify([{ id: 'old', name: '旧网站', url: 'https://example.com/', category: 'assistant', builtin: false, visible: true }]) }
     else if (data.method === 'workbench.browser') { requests.push(data.params); value = null }
     else if (data.method === 'files.list' || data.method === 'storage.legacyWorkbenchMiniapps') value = []
     else if (data.method === 'files.write') value = null
     else if (data.method === 'storage.transaction') value = data.params.operations.map(op => {
      const table = tables[op.table], matches = row => Object.entries(op.where || {}).every(([k,v]) => row[k] === v)
      if (op.type === 'select') return table.filter(matches).sort((a,b) => (a.position || 0) - (b.position || 0)).slice(op.offset || 0, (op.offset || 0) + (op.limit || 100))
      if (op.type === 'insert') { table.push({ ...op.values }); return 1 }
      if (op.type === 'update') { table.filter(matches).forEach(row => Object.assign(row, op.values)); return 1 }
      if (op.type === 'delete') { tables[op.table] = table.filter(row => !matches(row)); return 1 }
     })
     channel.port1.postMessage({ type: 'mira:response', id: data.id, ok: true, value })
    } catch (error) { channel.port1.postMessage({ type: 'mira:response', id: data.id, ok: false, error: { message: String(error) } }) }
   }); channel.port1.start(); event.sender.postMessage('mira-app:connect', null, [channel.port2])
  })
  server = http.createServer((req,res) => {
   const file = path.join(process.env.WORKBENCH_DIST, decodeURIComponent(req.url === '/' ? '/index.html' : req.url))
   const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' }
   res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
   fs.createReadStream(file).on('error', () => { res.statusCode = 404; res.end() }).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  win = new BrowserWindow({ show: false, webPreferences: { preload: process.env.APP_PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false } })
  const url = 'http://127.0.0.1:' + server.address().port + '/', inspect = code => win.webContents.executeJavaScript(code)
  const wait = async fn => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)) } throw Error('timeout') }
  await win.loadURL(url)
  await wait(() => inspect('document.body.innerText.includes("旧网站")'))
  const imported = true
  await inspect('document.querySelector("[aria-label=设置]").click()')
  await inspect('[...document.querySelectorAll(".manage-item")].find(e => e.textContent.includes("旧网站")).querySelector("button").click()')
  await inspect('const input = document.querySelector(".site-dialog input[placeholder=请输入名称]"); input.value = "已修改"; input.dispatchEvent(new Event("input", { bubbles:true })); document.querySelector(".site-dialog form").requestSubmit()')
  await wait(() => tables.entries.some(row => row.id === 'old' && row.name === '已修改'))
  await wait(() => inspect('document.body.innerText.includes("已修改")'))
  await inspect('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("已修改")).click()')
  await wait(() => requests.some(item => item.type === 'open' && item.url === 'https://example.com/'))
  await inspect('document.querySelector(".tab--home").click()')
  await win.loadURL(url)
  await wait(() => inspect('document.body.innerText.includes("已修改")'))
  console.log('RESULT=' + JSON.stringify({ imported, saved: true, restored: true, browser: true, legacyReads }))
 } catch (error) { console.error(error); process.exitCode = 1 }
 finally { win?.destroy(); server?.close(); app.quit() }
})
`

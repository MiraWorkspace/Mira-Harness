import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('requires confirmation for custom website deletion from the menu and editor', async () => {
  const workbench = resolve('../Mira-Workbench'), directory = await mkdtemp(join(tmpdir(), 'mira-workbench-app-'))
  try {
    await promisify(execFile)(process.execPath, [resolve(workbench, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', join(directory, 'workbench')], { cwd: workbench, timeout: 30000 })
    await writeFile(join(directory, 'main.cjs'), main)
    const env = { ...process.env, WORKBENCH_DIST: join(directory, 'workbench'), APP_PRELOAD: resolve('electron/preload/appHost.cjs') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, timeout: 20000 })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ cancelled: true, escaped: true, editorDraftPreserved: true, deleted: true, persisted: true })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60000)

const main = `
const { app, BrowserWindow, ipcMain, MessageChannelMain } = require('electron')
const assert = require('node:assert/strict')
const http = require('http'), fs = require('fs'), path = require('path')
app.setPath('userData', path.join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let server, win
 try {
  const tables = { entries: [], settings: [] }
  ipcMain.on('mira-app:ready', event => {
   const channel = new MessageChannelMain()
   channel.port1.on('message', async ({ data }) => {
    if (data.type !== 'mira:request') return
    try {
     let value = null
     if (data.method === 'context.get') value = { appId: 'mira-workbench', apiVersion: { major: 1, minor: 0 }, capabilities: ['storage:app', 'appearance:read'] }
     else if (data.method === 'appearance.get') value = 'light'
     else if (data.method === 'storage.migrate') value = 1
     else if (data.method === 'files.list' || data.method === 'storage.legacyWorkbenchMiniapps') value = []
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
  win = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: { preload: process.env.APP_PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false } })
  const url = 'http://127.0.0.1:' + server.address().port + '/'
  const inspect = async code => { try { return await win.webContents.executeJavaScript(code) } catch (error) { console.error('FAILED SCRIPT', code); throw error } }
  const wait = async fn => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)) } throw Error('timeout') }
  tables.entries.push({ id:'old', name:'已修改', type:'website', address:'https://example.com/', icon:null, builtin:0, visible:1, position:0 }, { id:'second', name:'No logo required', type:'website', address:'https://example.org/', icon:null, builtin:0, visible:1, position:1 })
  await win.loadURL(url)
  await wait(() => inspect('document.body.innerText.includes("已修改")'))
  // Both custom-site deletion entries must require an explicit confirmation.
  const customRow = () => tables.entries.find(row => row.id === 'old')
  const requestDeletion = async () => {
   await inspect('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("已修改")).dispatchEvent(new MouseEvent("contextmenu", { bubbles:true, clientX:180, clientY:180 }))')
   await inspect('document.querySelector(".entry-menu__delete").click()')
   await wait(() => inspect('!!document.querySelector(".delete-site-dialog")'))
  }
  await requestDeletion()
  assert.ok(customRow(), 'Requesting deletion keeps the persisted website')
  assert.equal(await inspect('document.querySelector("#delete-site-description").textContent.includes("已修改")'), true)
  assert.equal(await inspect('document.activeElement.classList.contains("cancel-button")'), true, 'Cancel is the initial focused action')
  await inspect('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key:"Tab", shiftKey:true, bubbles:true }))')
  assert.equal(await inspect('document.activeElement.classList.contains("delete-site-confirm")'), true)
  await inspect('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key:"Tab", bubbles:true }))')
  assert.equal(await inspect('document.activeElement.classList.contains("cancel-button")'), true)
  await inspect('document.querySelector(".delete-site-dialog .cancel-button").click()')
  await wait(() => inspect('!document.querySelector(".delete-site-dialog")'))
  assert.ok(customRow(), 'Cancel preserves the website')
  await requestDeletion()
  await inspect('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key:"Escape", bubbles:true }))')
  await wait(() => inspect('!document.querySelector(".delete-site-dialog")'))
  assert.ok(customRow(), 'Escape preserves the website')
  await inspect('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("已修改")).dispatchEvent(new MouseEvent("contextmenu", { bubbles:true, clientX:180, clientY:180 }))')
  await inspect('[...document.querySelectorAll(".entry-menu button")].find(e => e.textContent === "编辑").click()')
  await inspect('(() => { const input = document.querySelector("input[placeholder=请输入名称]"); input.value = "尚未保存的名称"; input.dispatchEvent(new Event("input", { bubbles:true })); document.querySelector(".site-dialog .delete-button").click(); })()')
  await wait(() => inspect('!!document.querySelector(".delete-site-dialog")'))
  assert.equal(await inspect('document.activeElement === document.querySelector(".delete-site-dialog .cancel-button")'), true, 'Editor deletion initially focuses Cancel')
  assert.equal(await inspect('document.querySelector(".add-dialog").closest("[inert]") !== null'), true, 'Underlying editor is inactive during confirmation')
  await inspect('document.querySelector(".delete-site-dialog .cancel-button").click()')
  await wait(() => inspect('!document.querySelector(".delete-site-dialog")'))
  assert.equal(await inspect('document.querySelector("input[placeholder=请输入名称]").value'), '尚未保存的名称', 'Cancel retains unsaved editor changes')
  assert.ok(customRow())
  await inspect('document.querySelector(".add-dialog .delete-button").click()')
  await wait(() => inspect('!!document.querySelector(".delete-site-dialog")'))
  assert.equal(await inspect('document.activeElement === document.querySelector(".delete-site-dialog .cancel-button")'), true, 'Reopened confirmation initially focuses Cancel')
  if (process.env.WORKBENCH_SCREENSHOTS) {
   fs.mkdirSync(process.env.WORKBENCH_SCREENSHOTS, { recursive:true })
   for (const theme of ['light', 'dark']) {
    await inspect('document.documentElement.dataset.theme = ' + JSON.stringify(theme))
    await inspect('new Promise(resolve => setTimeout(resolve, 220))')
    fs.writeFileSync(path.join(process.env.WORKBENCH_SCREENSHOTS, 'delete-site-' + theme + '.png'), (await win.webContents.capturePage()).toPNG())
   }
  }
  await inspect('document.querySelector(".delete-site-confirm").click()')
  await wait(() => !customRow())
  await wait(() => inspect('!document.querySelector(".delete-site-dialog") && !document.querySelector(".add-dialog")'))
  // The context-menu confirmation deletes through the same persistence path.
  await inspect('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("No logo required")).dispatchEvent(new MouseEvent("contextmenu", { bubbles:true, clientX:180, clientY:180 }))')
  await inspect('document.querySelector(".entry-menu__delete").click()')
  await wait(() => inspect('!!document.querySelector(".delete-site-dialog")'))
  assert.ok(tables.entries.some(row => row.name === 'No logo required'))
  await inspect('document.querySelector(".delete-site-confirm").click()')
  await wait(() => !tables.entries.some(row => row.name === 'No logo required'))
  await win.loadURL(url)
  await wait(() => inspect('!!document.querySelector(".site-card")'))
  assert.equal(await inspect('[...document.querySelectorAll(".site-card")].some(e => e.textContent.includes("已修改") || e.textContent.includes("No logo required"))'), false, 'Confirmed deletions survive reload')
  console.log('RESULT=' + JSON.stringify({ cancelled:true, escaped:true, editorDraftPreserved:true, deleted:true, persisted:true }))
 } catch (error) { console.error(error); process.exitCode = 1 }
 finally { win?.destroy(); server?.close(); app.quit() }
})
`

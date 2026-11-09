import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('connects the Workbench interface to SDK storage and browser requests', async () => {
  const workbench = resolve('../Mira-Workbench'), directory = await mkdtemp(join(tmpdir(), 'mira-workbench-app-'))
  try {
    await promisify(execFile)('npm', ['run', 'build'], { cwd: workbench, timeout: 30000 })
    await build({ entryPoints: [resolve('electron/services/workbenchSiteIcon.ts')], outfile: join(directory, 'icons.cjs'), bundle: true, platform: 'node', format: 'cjs' })
    await writeFile(join(directory, 'main.cjs'), main)
    const env = { ...process.env, WORKBENCH_DIST: join(workbench, 'dist'), APP_PRELOAD: resolve('electron/preload/appHost.cjs') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, timeout: 20000 })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ imported: true, saved: true, restored: true, browser: true, legacyReads: 1, iconsCached: true, uploadedFirst: true, fallback: true })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60000)

const main = `
const { app, BrowserWindow, ipcMain, MessageChannelMain, net } = require('electron')
const { fetchWorkbenchSiteIcon } = require('./icons.cjs')
const assert = require('node:assert/strict')
const http = require('http'), fs = require('fs'), path = require('path')
app.setPath('userData', path.join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let server, win
 try {
  const tables = { entries: [], settings: [] }, requests = [], iconRequests = []; let legacyReads = 0, iconDownloads = 0, finishSlowIcon
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64')
  const uploadedLogo = 'data:image/png;base64,' + png.toString('base64')
  ipcMain.on('mira-app:ready', event => {
   const channel = new MessageChannelMain()
   channel.port1.on('message', async ({ data }) => {
    if (data.type !== 'mira:request') return
    try {
     let value = null
     if (data.method === 'context.get') value = { appId: 'mira-workbench', apiVersion: { major: 1, minor: 0 }, capabilities: ['storage:app', 'appearance:read'] }
     else if (data.method === 'appearance.get') value = 'light'
     else if (data.method === 'storage.migrate') value = 1
     else if (data.method === 'storage.importLegacyWorkbenchSites') { legacyReads++; value = JSON.stringify([{ id: 'old', name: '旧网站', url: url + 'old-site', category: 'assistant', builtin: false, visible: true }]) }
     else if (data.method === 'workbench.browser') { requests.push(data.params); value = null }
     else if (data.method === 'workbench.fetchSiteIcon') {
      iconRequests.push(data.params.url)
      if (data.params.url.endsWith('/preview-slow')) value = await new Promise(resolve => { finishSlowIcon = resolve })
      else if (data.params.url.endsWith('/preview-missing')) value = null
      else value = await fetchWorkbenchSiteIcon(data.params.url, (input, init) => net.fetch(input, init))
     }
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
   if (req.url === '/favicon.ico') { iconDownloads++; res.setHeader('Content-Type', 'image/png'); res.end(png); return }
   const file = path.join(process.env.WORKBENCH_DIST, decodeURIComponent(req.url === '/' ? '/index.html' : req.url))
   const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' }
   res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
   fs.createReadStream(file).on('error', () => { res.statusCode = 404; res.end() }).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  win = new BrowserWindow({ show: false, webPreferences: { preload: process.env.APP_PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false } })
  const url = 'http://127.0.0.1:' + server.address().port + '/', inspect = code => win.webContents.executeJavaScript(code)
  const wait = async fn => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)) } throw Error('timeout') }
  tables.entries.push({ id: 'uploaded', name: 'Uploaded logo', type: 'website', address: url, icon: uploadedLogo, cached_icon: 'data:image/png;base64,broken', builtin: 0, visible: 1, position: 1 })
  tables.entries.push({ id: 'missing', name: 'Missing icon', type: 'website', address: 'http://127.0.0.1:1/', icon: null, builtin: 0, visible: 1, position: 2 })
  // Use a local server without CORS headers to exercise host acquisition.
  await win.loadURL(url)
  await wait(() => inspect('document.body.innerText.includes("旧网站")'))
  const imported = true
  await wait(() => tables.entries.find(row => row.id === 'old')?.cached_icon?.startsWith('data:image/png;base64,'))
  await wait(() => inspect('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("旧网站")).querySelector("img")?.naturalWidth > 0'))
  assert.equal(await inspect('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("Uploaded logo")).querySelector("img").src'), uploadedLogo)
  assert.equal(await inspect('!![...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("Missing icon")).querySelector(".brand-mark__default")'), true)
  assert.equal(iconRequests.includes(url), false)
  await inspect('document.querySelector("[aria-label=设置]").click()')
  await inspect('[...document.querySelectorAll(".manage-item")].find(e => e.textContent.includes("旧网站")).querySelector("button").click()')
  await inspect('const input = document.querySelector(".site-dialog input[placeholder=请输入名称]"); input.value = "已修改"; input.dispatchEvent(new Event("input", { bubbles:true })); document.querySelector(".site-dialog form").requestSubmit()')
  await wait(() => tables.entries.some(row => row.id === 'old' && row.name === '已修改'))
  await wait(() => inspect('document.body.innerText.includes("已修改")'))
  await inspect('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("已修改")).click()')
  await wait(() => requests.some(item => item.type === 'open' && item.url === url + 'old-site'))
  await inspect('document.querySelector(".tab--home").click()')
  await win.loadURL(url)
  await wait(() => inspect('document.body.innerText.includes("已修改")'))
  await wait(() => inspect('[...document.querySelectorAll(".site-card")].find(e => e.textContent.includes("已修改")).querySelector("img")?.naturalWidth > 0'))
  assert.equal(iconRequests.filter(value => value.endsWith('/old-site')).length, 1)
  assert.equal(iconDownloads, 1)
  const setField = (placeholder, value) => inspect('(() => { const input = [...document.querySelectorAll("input")].find(input => input.placeholder === '+JSON.stringify(placeholder)+'); input.value = '+JSON.stringify(value)+'; input.dispatchEvent(new Event("input", { bubbles: true })); })()')
  const upload = () => inspect('(() => { const bytes = Uint8Array.from(atob('+JSON.stringify(png.toString('base64'))+'), c => c.charCodeAt(0)), files = new DataTransfer(); files.items.add(new File([bytes], "logo.png", { type: "image/png" })); const input = document.querySelector(".logo-file-input"); input.files = files.files; input.dispatchEvent(new Event("change", { bubbles: true })); })()')
  const previewLoaded = () => inspect('document.querySelector(".logo-preview img")?.naturalWidth > 0')
  const cancel = () => inspect('document.querySelector(".add-dialog [aria-label=关闭]").click()')
  await inspect('document.querySelector("[aria-label=新增]").click()')
  assert.equal(await inspect('document.querySelector(".logo-hint")'), null)
  await inspect('window.pickerCount = 0; document.querySelector("input[type=file]").click = () => { window.pickerCount++ }; document.querySelector(".logo-preview").click(); document.querySelector(".logo-upload-actions .cancel-button").click()')
  assert.equal(await inspect('window.pickerCount'), 2)
  await upload(); await wait(previewLoaded)
  const beforeUpload = iconRequests.length
  await setField('请输入网站地址', url + 'uploaded-preview')
  await inspect('new Promise(resolve => setTimeout(resolve, 650))')
  assert.equal(iconRequests.length, beforeUpload)
  assert.equal(await inspect('document.querySelector(".logo-preview").getAttribute("aria-busy")'), 'false')
  await cancel()
  await inspect('document.querySelector("[aria-label=新增]").click()')
  await setField('请输入名称', 'Preview website')
  await setField('请输入网站地址', url + 'preview-slow')
  await wait(() => inspect('!!document.querySelector(".logo-preview [role=status]")'))
  await wait(() => Boolean(finishSlowIcon))
  assert.equal(await inspect('document.querySelector(".dialog-actions button[type=submit]").disabled'), true)
  finishSlowIcon(uploadedLogo); finishSlowIcon = undefined
  await wait(previewLoaded)
  await inspect('document.querySelector(".site-dialog form").requestSubmit()')
  await wait(() => tables.entries.some(row => row.name === 'Preview website' && row.cached_icon?.startsWith('data:image/png;base64,')))
  assert.equal(iconRequests.filter(value => value.endsWith('/preview-slow')).length, 1)
  await inspect('document.querySelector("[aria-label=新增]").click()')
  await setField('请输入网站地址', url + 'preview-slow')
  await wait(() => Boolean(finishSlowIcon))
  await setField('请输入网站地址', url + 'preview-missing')
  await wait(() => iconRequests.some(value => value.endsWith('/preview-missing')))
  await wait(() => inspect('document.querySelector(".logo-preview").getAttribute("aria-busy")==="false"'))
  finishSlowIcon(uploadedLogo); finishSlowIcon = undefined
  await inspect('new Promise(resolve => setTimeout(resolve, 80))')
  assert.equal(await inspect('!!document.querySelector(".logo-preview .brand-mark__default")'), true)
  await setField('请输入网站地址', url + 'preview-slow')
  await wait(() => Boolean(finishSlowIcon))
  await upload(); await wait(previewLoaded)
  const manualPreview = await inspect('document.querySelector(".logo-preview img").src')
  finishSlowIcon(null); finishSlowIcon = undefined
  await inspect('new Promise(resolve => setTimeout(resolve, 80))')
  assert.equal(await inspect('document.querySelector(".logo-preview img").src'), manualPreview)
  await cancel()
  await inspect('document.querySelector("[aria-label=新增]").click()')
  await setField('请输入名称', 'No logo required')
  await setField('请输入网站地址', url + 'preview-missing')
  await wait(() => inspect('document.querySelector(".logo-preview").getAttribute("aria-busy")==="false"'))
  assert.equal(await inspect('!!document.querySelector(".logo-preview .brand-mark__default")'), true)
  assert.equal(await inspect('document.querySelector(".add-dialog .form-error")?.textContent || ""'), '')
  assert.equal(await inspect('document.querySelector(".dialog-actions button[type=submit]").disabled'), false)
  await inspect('document.querySelector(".site-dialog form").requestSubmit()')
  await wait(() => tables.entries.some(row => row.name === 'No logo required' && !row.icon && !row.cached_icon))
  console.log('RESULT=' + JSON.stringify({ imported, saved: true, restored: true, browser: true, legacyReads, iconsCached: true, uploadedFirst: true, fallback: true }))
 } catch (error) { console.error(error); process.exitCode = 1 }
 finally { win?.destroy(); server?.close(); app.quit() }
})
`

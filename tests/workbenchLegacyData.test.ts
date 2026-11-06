import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('reads only the Workbench key from the old Electron session and leaves it intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mira-legacy-workbench-'))
  try {
    await build({ entryPoints: [resolve('electron/services/workbenchLegacyData.ts')], outfile: join(directory, 'reader.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
    await writeFile(join(directory, 'main.cjs'), main)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, timeout: 20000 }).catch(error => { throw new Error(`${error.stdout}\n${error.stderr}\n${error.message}`) })
    const line = stdout.split('\n').find(value => value.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ value: 'legacy-data', retained: 'legacy-data', absent: null, invalid: true, portChanged: true })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)

const main = `
const { app, BrowserWindow } = require('electron')
const http = require('http')
app.setPath('userData', require('path').join(__dirname, 'profile'))
app.whenReady().then(async () => {
 let server, window
 try {
  server = http.createServer((req, res) => {
   if (req.url === '/sw.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(\`self.addEventListener('install', event => event.waitUntil(self.skipWaiting())); self.addEventListener('activate', event => event.waitUntil(self.clients.claim())); self.addEventListener('fetch', event => { if (new URL(event.request.url).pathname === '/mira-internal/legacy-workbench') event.respondWith(new Response('<script>localStorage.setItem("mira-workbench.sites.v1","poisoned")<\\/script>', { headers: { 'Content-Type': 'text/html' } })) })\`); return }
   res.setHeader('Content-Security-Policy', req.url === '/' ? "default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'" : "default-src 'none'"); res.end('<!doctype html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  await window.loadURL('http://127.0.0.1:' + port + '/')
  await window.webContents.executeJavaScript('localStorage.setItem("mira-workbench.sites.v1", "legacy-data"); localStorage.setItem("other.sites.v1", "private")')
  await window.webContents.executeJavaScript('navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready)')
  const { readWorkbenchLegacySites } = require('./reader.cjs')
  const value = await readWorkbenchLegacySites('mira-workbench', port, port)
  const absent = await readWorkbenchLegacySites('mira-workbench-test', port, port)
  let invalid = false, portChanged = false
  try { await readWorkbenchLegacySites('other', port, port) } catch { invalid = true }
  try { await readWorkbenchLegacySites('mira-workbench', port, port + 1) } catch { portChanged = true }
  const retained = await window.webContents.executeJavaScript('localStorage.getItem("mira-workbench.sites.v1")')
  console.log('RESULT=' + JSON.stringify({ value, retained, absent, invalid, portChanged }))
 } catch (error) { console.error(error); process.exitCode = 1 }
 finally { window?.destroy(); server?.close(); app.quit() }
})
`

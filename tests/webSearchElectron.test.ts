import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('sends anonymous JSON through Chromium and cancels a stalled response body', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mira-search-transport-'))
  try {
    await build({ stdin: { resolveDir: process.cwd(), contents: `
      import { app } from 'electron'
      import { createServer } from 'node:http'
      import { electronWebRequest } from './electron/adapters/electronWebRequest'
      app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
      app.whenReady().then(async () => {
        app.dock?.hide()
        let stage = 'starting'
        const watchdog = setTimeout(() => { console.error('Timed out: ' + stage); app.exit(1) }, 8000)
        let method, posted, cookie, close
        const closed = new Promise(resolve => { close = resolve })
        const server = createServer(async (request, response) => {
          if (request.url === '/slow') {
            response.on('close', close)
            response.writeHead(200, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' })
            response.write('partial'.repeat(512))
            return
          }
          method = request.method; cookie = request.headers.cookie || ''
          let body = ''; for await (const chunk of request) body += chunk
          posted = JSON.parse(body)
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ results: [{ title: '文档', url: 'https://example.com/' }] }))
        })
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        const url = 'http://127.0.0.1:' + server.address().port
        stage = 'POST'
        const response = await electronWebRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '中文 TypeScript', limit: 3 }) })
        const result = await response.json()
        stage = 'slow headers'
        const controller = new AbortController()
        const slow = await electronWebRequest(url + '/slow', { signal: controller.signal })
        const reading = slow.text().then(() => false, () => true)
        controller.abort()
        stage = 'cancel body'
        const cancelled = await reading
        stage = 'server connection closed'
        await closed
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
        clearTimeout(watchdog)
        console.log('RESULT=' + JSON.stringify({ method, posted, cookie, result, cancelled }))
        app.quit()
      }).catch(error => { console.error(error); app.exit(1) })
    ` }, outfile: join(directory, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'warning' })
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, timeout: 15000 }).catch(error => { throw new Error([error.message, error.stdout, error.stderr].join('\n')) })
    const line = stdout.split('\n').find(line => line.startsWith('RESULT='))
    if (!line) throw new Error(stdout + stderr)
    expect(JSON.parse(line.slice(7))).toEqual({ method: 'POST', posted: { query: '中文 TypeScript', limit: 3 }, cookie: '', result: { results: [{ title: '文档', url: 'https://example.com/' }] }, cancelled: true })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 20000)

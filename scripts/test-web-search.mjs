// Manual network check through the same Electron transport used by Mira.
// node scripts/test-web-search.mjs [query] [output.json] [engine...]
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'mira-search-check-'))
const output = resolve(process.argv[3] || join(directory, 'results.json'))
const query = process.argv[2] || 'TypeScript 官方文档'
try {
  await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { app, powerSaveBlocker } from 'electron'
      import { writeFileSync } from 'node:fs'
      import { createWebSearchTool } from './electron/adapters/webTools'
      import { WEB_SEARCH_ENGINES } from './electron/adapters/webSearch'
      import { electronWebRequest } from './electron/adapters/electronWebRequest'
      app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
      app.whenReady().then(async () => {
        app.dock?.hide()
        powerSaveBlocker.start('prevent-app-suspension')
        const query = ${JSON.stringify(query)}, results = []
        const tool = createWebSearchTool(undefined, electronWebRequest)
        const check = async engine => {
          const started = Date.now()
          try {
            const result = await tool.execute('live-' + engine, { query, limit: 3, engine })
            const row = { requestedEngine: engine, status: result.details.results.length ? 'ok' : 'empty', durationMs: Date.now() - started, ...result.details }
            results.push(row)
            console.log(JSON.stringify(row))
          } catch (error) {
            const row = { engine, status: 'failed', durationMs: Date.now() - started, error: error.message }
            results.push(row)
            console.log(JSON.stringify(row))
          }
        }
        // Keep the test modest: at most two source checks at a time.
        const selected = ${JSON.stringify(process.argv.slice(4))}
        const engines = selected.length ? selected : WEB_SEARCH_ENGINES.map(source => source.id)
        for (let i = 0; i < engines.length; i += 2) await Promise.all(engines.slice(i, i + 2).map(check))
        await check('auto')
        writeFileSync(${JSON.stringify(output)}, JSON.stringify({ checkedAt: new Date().toISOString(), query, transport: 'electron.net.request', results }, null, 2))
        app.quit()
      }).catch(error => { console.error(error); app.exit(1) })
    ` },
    outfile: join(directory, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'warning',
  })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
  const child = execFile(createRequire(import.meta.url)('electron'), [join(directory, 'main.cjs')], { env, timeout: 180000, maxBuffer: 1024 * 1024 })
  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Electron exited: ${code}`))) })
  // Keep a default report outside the temporary profile that is cleaned below.
  if (!process.argv[3]) await writeFile(resolve('web-search-results.local.json'), await readFile(output))
  console.log(`Report: ${process.argv[3] ? output : resolve('web-search-results.local.json')}`)
} finally { await rm(directory, { recursive: true, force: true }) }

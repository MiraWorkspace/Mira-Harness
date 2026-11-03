import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalMicroAppServer } from '../electron/adapters/localMicroAppServer'
import type { MicroApp } from '../src/types'

const servers: LocalMicroAppServer[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.stop())) })

describe('built-in React Harness resources', () => {
  it('rejects write requests and only advertises static resource methods to local origins', async () => {
    const server = new LocalMicroAppServer()
    servers.push(server)
    await server.start([])
    const url = `http://127.0.0.1:${server.port}/apps/sample/generate`
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await fetch(url, { method, headers: { Authorization: 'Bearer unused' } })).status).toBe(405)
    }
    for (const origin of ['null', 'http://localhost:4173']) {
      const response = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin } })
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
      expect(response.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')
      expect(response.headers.get('access-control-allow-headers')).toBeNull()
    }
    expect((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://external.example' } })).status).toBe(403)
  })

  it('serves the package root through the loopback micro-app server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mira-harness-app-'))
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'index.html'), '<!doctype html><script src="assets/app.js"></script>')
    await writeFile(join(root, 'assets/app.js'), 'window.__MIRA_HARNESS__ = true')
    const server = new LocalMicroAppServer({ builtinRoots: { 'harness-react-app': root } })
    servers.push(server)
    const app: MicroApp = { id: 'micro-mira-harness', name: 'Mira Harness', code: 'mira-harness', entry: { type: 'builtin', package: 'harness-react-app' }, sort: 0, enabled: true, integrationMode: 'iframe', runtimeConfig: { kind: 'iframe', iframe: { profile: 'strict' } } }
    await server.start([app])
    const response = await fetch(`${server.getEntryUrl(app.id)}assets/app.js`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('__MIRA_HARNESS__')
  })
})

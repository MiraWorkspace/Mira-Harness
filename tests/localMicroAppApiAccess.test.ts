import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalMicroAppServer } from '../electron/adapters/localMicroAppServer'

const handle = vi.fn((_subpath, _request, response) => response.writeHead(200).end('ok'))
const server = new LocalMicroAppServer({
  apiHandlers: new Map([
    ['sample', { capability: 'sample:generate', handle }],
    ['other', { capability: 'sample:generate', handle }],
  ]),
})

afterEach(async () => {
  await server.stop()
  vi.clearAllMocks()
})

describe('local micro-app API grants', () => {
  it('rejects unauthenticated, wrong-app, and insufficient-capability calls', async () => {
    await server.start([])
    const appUrl = `${server.getApiBaseUrl('sample')}generate`
    const call = (token?: string) => fetch(appUrl, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })

    expect((await call()).status).toBe(403)
    const otherToken = server.issueApiToken('other', ['sample:generate'])
    expect((await call(otherToken)).status).toBe(403)
    const weakToken = server.issueApiToken('sample', ['sample:read'])
    expect((await call(weakToken)).status).toBe(403)
    expect(handle).not.toHaveBeenCalled()
  })

  it('passes only a matching grant to the handler and revokes it', async () => {
    await server.start([])
    const token = server.issueApiToken('sample', ['sample:generate'])
    const url = `${server.getApiBaseUrl('sample')}generate`
    const call = () => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

    const response = await call()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(handle).toHaveBeenCalledOnce()
    expect(handle.mock.calls[0][0]).toBe('generate')

    server.revokeApiToken(token)
    expect((await call()).status).toBe(403)
    expect(handle).toHaveBeenCalledOnce()
  })

  it('allows Authorization in approved preflight without using CORS as authentication', async () => {
    await server.start([])
    const url = `${server.getApiBaseUrl('sample')}generate`
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'http://localhost:4173' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization')
    expect((await fetch(url, { method: 'POST', headers: { Origin: 'http://localhost:4173' } })).status).toBe(403)
    expect(handle).not.toHaveBeenCalled()
  })
})

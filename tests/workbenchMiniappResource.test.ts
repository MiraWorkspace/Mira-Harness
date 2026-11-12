import { describe, expect, it, vi } from 'vitest'
import { fetchWorkbenchMiniappResource } from '../electron/services/workbenchMiniappResource'

describe('Workbench miniapp download transport', () => {
  it('returns binary bytes using HTTPS without cookies or redirects', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([0, 128, 255])))
    expect(await fetchWorkbenchMiniappResource('https://example.com/app.miniapp', 'package', fetcher)).toEqual(new Uint8Array([0, 128, 255]))
    expect(fetcher).toHaveBeenCalledWith('https://example.com/app.miniapp', expect.objectContaining({ redirect: 'manual', credentials: 'omit', signal: expect.any(AbortSignal) }))
  })
  it('rejects redirects, errors, empty and oversized streams including dishonest content lengths', async () => {
    for (const response of [new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/file' } }), new Response(null, { status: 404 }), new Response(''), new Response('x', { headers: { 'content-length': '65537' } }), new Response(new Uint8Array(65537), { headers: { 'content-length': '1' } })]) {
      await expect(fetchWorkbenchMiniappResource('https://example.com/manifest.json', 'manifest', vi.fn(async () => response))).rejects.toThrow()
    }
  })
  it('rejects local, private, credential and non-HTTPS URLs before requesting', async () => {
    const fetcher = vi.fn()
    for (const url of ['http://example.com', 'file:///private', 'https://localhost', 'https://127.0.0.1', 'https://192.168.1.1', 'https://user:secret@example.com/', 'https://example.com/#secret']) await expect(fetchWorkbenchMiniappResource(url, 'manifest', fetcher)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})

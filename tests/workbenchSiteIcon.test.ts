import { describe, expect, it, vi } from 'vitest'
import { fetchWorkbenchSiteIcon } from '../electron/services/workbenchSiteIcon'

describe('Workbench website icons', () => {
  it('downloads image bytes without renderer CORS and returns a local data URL', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/x-icon' } }))
    expect(await fetchWorkbenchSiteIcon('https://example.com/path', fetcher)).toBe('data:image/x-icon;base64,AQID')
    expect(fetcher).toHaveBeenCalledWith('https://example.com/favicon.ico', expect.objectContaining({ redirect: 'manual', credentials: 'omit', signal: expect.any(AbortSignal) }))
  })

  it('follows safe redirects and rejects redirects to local files', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/icon.png' } }))
      .mockResolvedValueOnce(new Response('png', { headers: { 'content-type': 'image/png' } }))
    expect(await fetchWorkbenchSiteIcon('https://example.com/', fetcher)).toBe('data:image/png;base64,cG5n')
    expect(fetcher.mock.calls[1][0]).toBe('https://cdn.example.com/icon.png')
    fetcher.mockReset().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'file:///private' } }))
    expect(await fetchWorkbenchSiteIcon('https://example.com/', fetcher)).toBeNull()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('uses the default for missing, non-image, oversized and unavailable responses', async () => {
    for (const response of [new Response(null, { status: 404 }), new Response('<html>', { headers: { 'content-type': 'text/html' } }), new Response(new Uint8Array(512 * 1024 + 1), { headers: { 'content-type': 'image/png' } })]) {
      expect(await fetchWorkbenchSiteIcon('https://example.com/', vi.fn(async () => response))).toBeNull()
    }
    expect(await fetchWorkbenchSiteIcon('https://example.com/', vi.fn(async () => { throw new Error('offline') }))).toBeNull()
  })

  it('rejects non-HTTP and credential URLs without making a request', async () => {
    const fetcher = vi.fn()
    for (const url of ['file:///private', 'javascript:alert(1)', 'https://user:secret@example.com/']) await expect(fetchWorkbenchSiteIcon(url, fetcher)).rejects.toThrow('地址')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

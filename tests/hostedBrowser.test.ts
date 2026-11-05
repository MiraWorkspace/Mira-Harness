import { describe, expect, it, vi } from 'vitest'
import { HOSTED_BROWSER_PARTITION, WORKBENCH_BROWSER_PARTITION, browserCompatibleUserAgent, configureMiraBrowserSession, isAllowedHostedBrowserUrl, isMiraBrowserPartition, isWorkbenchPopupDisposition } from '../electron/security/hostedBrowser'

describe('hosted browser guest boundary', () => {
  it('uses a dedicated partition and accepts only unauthenticated web URLs', () => {
    expect(HOSTED_BROWSER_PARTITION).toBe('persist:mira-harness-browser')
    expect(WORKBENCH_BROWSER_PARTITION).toBe('persist:mira-workbench')
    expect(isMiraBrowserPartition(HOSTED_BROWSER_PARTITION)).toBe(true)
    expect(isMiraBrowserPartition(WORKBENCH_BROWSER_PARTITION)).toBe(true)
    expect(isMiraBrowserPartition('persist:untrusted')).toBe(false)
    expect(isWorkbenchPopupDisposition('new-window')).toBe(true)
    expect(isWorkbenchPopupDisposition('foreground-tab')).toBe(false)
    expect(isAllowedHostedBrowserUrl('https://example.com/path')).toBe(true)
    expect(isAllowedHostedBrowserUrl('http://localhost:3000/')).toBe(true)
    expect(isAllowedHostedBrowserUrl('https://user:secret@example.com')).toBe(false)
    expect(isAllowedHostedBrowserUrl('file:///tmp/secret')).toBe(false)
    expect(isAllowedHostedBrowserUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedHostedBrowserUrl('about:blank')).toBe(false)
    expect(isAllowedHostedBrowserUrl('not a URL')).toBe(false)
  })

  it('uses the current Chromium UA without the Electron product token for every request', () => {
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Electron/39.1.0'
    const onBeforeSendHeaders = vi.fn()
    const browserSession = { getUserAgent: () => userAgent, setUserAgent: vi.fn(), webRequest: { onBeforeSendHeaders } }
    expect(browserCompatibleUserAgent(userAgent)).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36')
    configureMiraBrowserSession(browserSession as any)
    expect(browserSession.setUserAgent).toHaveBeenCalledWith(browserCompatibleUserAgent(userAgent))
    const handler = onBeforeSendHeaders.mock.calls[0][0]
    const callback = vi.fn()
    handler({ requestHeaders: { Accept: 'text/html', 'User-Agent': userAgent } }, callback)
    expect(callback).toHaveBeenCalledWith({ requestHeaders: { Accept: 'text/html', 'User-Agent': browserCompatibleUserAgent(userAgent) } })
  })
})

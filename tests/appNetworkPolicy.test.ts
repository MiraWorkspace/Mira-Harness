import { describe, expect, it } from 'vitest'
import { appNetworkPolicy } from '../electron/security/appNetworkPolicy'

describe('application package network isolation', () => {
  const policy = appNetworkPolicy('http://127.0.0.1:8123/apps/micro-example/index.html')
  it('allows only this package on the local resource server', () => {
    expect(policy.allows('http://127.0.0.1:8123/apps/micro-example/assets/main.js')).toBe(true)
    expect(policy.allows('http://127.0.0.1:8123/apps/micro-other/index.html')).toBe(false)
    expect(policy.allows('http://127.0.0.1:8123/apps/micro-example/%2f..%2fmicro-other/index.html')).toBe(false)
    expect(policy.allows('http://localhost:8123/apps/micro-example/index.html')).toBe(false)
    expect(policy.allows('https://example.com/api')).toBe(true)
    expect(policy.allows('file:///tmp/secret')).toBe(false)
  })
  it('adds a restrictive policy without weakening a policy supplied by the app', () => {
    const headers = policy.headers({ 'content-security-policy': ["default-src 'none'"] })
    expect(headers['content-security-policy']).toHaveLength(2)
    expect(headers['content-security-policy'][1]).toContain("script-src 'self'")
    expect(headers['content-security-policy'][1]).toContain("frame-src 'none'")
    expect(headers['content-security-policy'][1]).toContain("worker-src 'none'")
    expect(headers['content-security-policy'][1]).toContain('img-src \'self\' data: blob: https:')
  })
})

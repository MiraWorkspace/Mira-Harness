import { describe, expect, it, vi } from 'vitest'
import { AppWebService } from '../electron/services/appWebService'
import { WEB_SEARCH_ENGINES } from '../electron/adapters/webSearch'
import type { WebSearchEngine } from '@mira/app-sdk'

const hit = { title: 'TypeScript 官方文档', url: 'https://www.typescriptlang.org/docs/', snippet: '官方文档' }
const bing = `<li class="b_algo"><h2><a href="${hit.url}">${hit.title}</a></h2><p>${hit.snippet}</p></li>`

describe('application web search service', () => {
  it('uses the built-in source adapter and returns public results without agent citation IDs or raw diagnostics', async () => {
    const request = vi.fn(async () => new Response(bing))
    const result = await new AppWebService(request).search({ query: ' TypeScript 官方文档 ', engine: 'bing', limit: 1 })
    expect(result).toEqual({ query: 'TypeScript 官方文档', engine: 'bing', results: [hit], attempts: [{ engine: 'bing', status: 'ok', durationMs: expect.any(Number) }] })
    expect(request.mock.calls).toHaveLength(1)
    const [, init] = request.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.credentials).toBe('omit')
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })

  it('keeps auto fallback and cooldowns while removing raw upstream errors from attempts', async () => {
    const request = vi.fn(async (url: string) => {
      if (url.includes('bing.com')) throw new Error('private upstream details')
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: `Title: ${hit.title}\nURL: ${hit.url}\nHighlights:\n${hit.snippet}` }] } }))
    })
    const service = new AppWebService(request)
    const result = await service.search({ query: 'TypeScript' })
    expect(result.engine).toBe('exa')
    expect(result.results).toEqual([hit])
    expect(result.attempts[0]).toEqual({ engine: 'bing', status: 'network', durationMs: expect.any(Number) })
    expect(JSON.stringify(result)).not.toContain('private upstream')
    const next = await service.search({ query: 'TypeScript' })
    expect(next.attempts).toContainEqual({ engine: 'bing', status: 'cooldown', durationMs: 0 })
  })

  it('validates SDK request limits and supported engines before any network request', async () => {
    const request = vi.fn(), service = new AppWebService(request)
    for (const input of [{ query: '' }, { query: ' ' }, { query: 'x'.repeat(2001) }, { query: 'x', limit: 0 }, { query: 'x', limit: 11 }, { query: 'x', limit: 1.5 }, { query: 'x', limit: '2' }, { query: 'x', engine: 'https://private.test' }]) {
      await expect(service.search(input as never)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('returns a safe failure when a source produces no usable results', async () => {
    const service = new AppWebService(async () => { throw new Error('sensitive upstream error') })
    await expect(service.search({ query: 'TypeScript', engine: 'bing' })).rejects.toMatchObject({ code: 'WEB_SEARCH_FAILED', message: '联网搜索失败，搜索源可能超时、限流或暂不可用，请稍后重试或更换搜索源' })
  })

  it('keeps the SDK engine union aligned with the host adapter', () => {
    const engines: WebSearchEngine[] = ['bing', 'so360', 'sogou', 'baidu-html', 'ddg', 'ddg-lite', 'toutiao', 'wechat', 'anysearch', 'tavily', 'firecrawl', 'exa', 'keenable', 'parallel', 'you', 'searxng']
    expect(engines.sort()).toEqual(WEB_SEARCH_ENGINES.map(source => source.id).sort())
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebCitationContext, createWebFetchTool, createWebSearchTool } from '../electron/adapters/webTools'
import { createWebSearchState, relevantBingResults, SEARCH_BUDGET_MS, SEARCH_SOURCE_TIMEOUT_MS, WEB_SEARCH_ENGINES } from '../electron/adapters/webSearch'

const hit = { title: 'TypeScript 官方文档', url: 'https://www.typescriptlang.org/docs/', snippet: '文档摘要' }
const bing = `<li class="b_algo"><h2><a href="${hit.url}">${hit.title}</a></h2><p>${hit.snippet}</p></li>`
const mcp = (text: string) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } })
const fixtures = {
  bing,
  so360: `<li class="res-list"><h3><a href="${hit.url}">${hit.title}</a></h3><p>${hit.snippet}</p></li>`,
  sogou: `<div class="vrwrap"><h3><a href="${hit.url}">${hit.title}</a></h3></div>`,
  'baidu-html': `<div class="result c-container" mu="${hit.url}"><h3><a href="https://www.baidu.com/link?url=signed">${hit.title}</a></h3></div>`,
  ddg: `<div class="result"><a href="//duckduckgo.com/l/?uddg=${encodeURIComponent(hit.url)}" class="result__a">${hit.title}</a><a class="result__snippet">${hit.snippet}</a></div>`,
  'ddg-lite': `<a class='result-link' href='${hit.url}'>${hit.title}</a><td class='result-snippet'>${hit.snippet}</td>`,
  toutiao: JSON.stringify({ title: hit.title, article_url: hit.url }),
  wechat: `<li id="sogou_vr_11002601_box_0"><h3><a href="${hit.url}">${hit.title}</a></h3></li>`,
  anysearch: JSON.stringify({ code: 0, data: { results: [hit] } }),
  tavily: JSON.stringify({ results: [{ ...hit, content: hit.snippet }] }),
  firecrawl: JSON.stringify({ data: { web: [{ ...hit, description: hit.snippet }] } }),
  exa: `event: message\ndata: ${JSON.stringify(mcp(`Title: ${hit.title}\nURL: ${hit.url}\nHighlights:\n${hit.snippet}`))}\n\n`,
  keenable: JSON.stringify(mcp(`Title: ${hit.title}\nURL: ${hit.url}\nSnippets:\n${hit.snippet}`)),
  parallel: `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })}\n\ndata: ${JSON.stringify(mcp(JSON.stringify({ results: [{ ...hit, excerpts: [hit.snippet] }] })))}\n\n`,
  you: JSON.stringify({ results: { web: [{ ...hit, snippets: [hit.snippet] }] } }),
  searxng: JSON.stringify({ results: [{ ...hit, content: hit.snippet }] }),
}

afterEach(() => vi.useRealTimers())

describe('anonymous web search sources', () => {
  it.each(WEB_SEARCH_ENGINES.map(source => [source.id] as const))('parses %s without sending credentials or API keys', async engine => {
    const body = fixtures[engine]
    const request = vi.fn(async () => new Response(body))
    const result = await createWebSearchTool(undefined, request).execute('single', { query: 'TypeScript', engine })
    expect(result.details.engine).toBe(engine)
    expect(result.details.results).toEqual([expect.objectContaining({ title: hit.title, url: hit.url, index: 1 })])
    for (const [, init] of request.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init.credentials).toBe('omit')
      expect(JSON.stringify(init.headers)).not.toMatch(/authorization|api[-_]key/i)
      expect(new Headers(init.headers).get('user-agent')).not.toContain('Mira-WebFetch')
    }
  })

  it('uses the domestic Bing endpoint and unpacks tracking URLs before deduplication', async () => {
    const target = `${hit.url}?utm_source=bing`
    const wrapped = `https://www.bing.com/ck/a?u=a1${Buffer.from(target).toString('base64url')}`
    const request = vi.fn(async (_url: string) => new Response(bing.replace(hit.url, wrapped) + bing))
    const result = await createWebSearchTool(undefined, request).execute('bing', { query: 'TypeScript 文档', engine: 'bing' })
    expect(request.mock.calls[0]?.[0]).toBe('https://cn.bing.com/search?q=TypeScript%20%E6%96%87%E6%A1%A3')
    expect(result.details.results).toHaveLength(1)
    expect(result.details.results[0]?.url).toBe(hit.url)
  })

  it('rejects private and credential URLs from API results', async () => {
    const results = [{ ...hit, url: 'http://127.0.0.1/private' }, { ...hit, url: 'https://user:secret@example.com/' }, hit]
    const request = vi.fn(async () => new Response(JSON.stringify({ results })))
    const result = await createWebSearchTool(undefined, request).execute('safe', { query: 'test', engine: 'tavily' })
    expect(result.details.results.map(item => item.url)).toEqual([hit.url])
  })

  it('rejects unrelated substituted Bing results and falls back to a relevant source', async () => {
    const unrelated = '<li class="b_algo"><h2><a href="https://www.feishu.cn/">下载飞书</a></h2><p>企业协作平台</p></li>'
    const request = vi.fn(async (url: string) => new Response(url.includes('bing.com') ? unrelated : fixtures.exa))
    const result = await createWebSearchTool(undefined, request).execute('relevance', { query: 'TypeScript 文档' })
    expect(result.details.engine).toBe('exa')
    expect(result.details.attempts[0]).toEqual(expect.objectContaining({ engine: 'bing', status: 'invalid', error: expect.stringContaining('无关') }))
    expect(relevantBingResults('2026年10月LPR 一年期 五年期 报价', [{ title: '2026年日历', url: 'https://example.com/' }])).toBe(false)
    expect(relevantBingResults('猫', [hit])).toBe(true)
  })

  it('filters explicitly marked advertisements and ad redirect URLs without dropping articles about advertising', async () => {
    const organic = '<li class="b_algo"><h2><a href="https://example.com/advertising">广告行业分析 TypeScript</a></h2><p>正常文章</p></li>'
    const adClass = '<li class="b_algo b_ad"><h2><a href="https://ad.example.com/">TypeScript 培训</a></h2></li>'
    const adLabel = '<li class="b_algo"><h2><a href="https://promoted.example.com/">TypeScript 培训</a></h2><span>广告</span></li>'
    const adUrl = '<li class="b_algo"><h2><a href="https://www.baidu.com/baidu.php?url=paid">TypeScript 培训</a></h2></li>'
    const request = vi.fn(async () => new Response(adClass + adLabel + adUrl + organic))
    const result = await createWebSearchTool(undefined, request).execute('ads', { query: 'TypeScript', engine: 'bing' })
    expect(result.details.results).toEqual([expect.objectContaining({ title: '广告行业分析 TypeScript', url: 'https://example.com/advertising' })])
  })

  it('falls back if the search page contains only promoted results', async () => {
    const advertisement = '<li class="b_algo"><h2><a href="https://ad.example.com/">TypeScript 培训</a></h2><label>推广</label></li>'
    const request = vi.fn(async (url: string) => new Response(url.includes('bing.com') ? advertisement : fixtures.exa))
    const result = await createWebSearchTool(undefined, request).execute('ad-fallback', { query: 'TypeScript' })
    expect(result.details.engine).toBe('exa')
    expect(result.details.results[0]?.url).toBe(hit.url)
  })

  it('filters sponsored API entries as well as paid click endpoints', async () => {
    const results = [{ ...hit, sponsored: true }, { ...hit, url: 'https://www.bing.com/aclick?ld=paid' }, { ...hit, url: 'https://organic.example.com/' }]
    const request = vi.fn(async () => new Response(JSON.stringify({ results })))
    const result = await createWebSearchTool(undefined, request).execute('api-ads', { query: 'TypeScript', engine: 'tavily' })
    expect(result.details.results.map(item => item.url)).toEqual(['https://organic.example.com/'])
  })

  it('falls back immediately after an anti-bot page and preserves citation indexes', async () => {
    const request = vi.fn(async (url: string) => new Response(url.includes('bing.com') ? '<title>安全验证</title>' : fixtures.exa))
    const citations = createWebCitationContext()
    const result = await createWebSearchTool(citations, request).execute('fallback', { query: 'TypeScript' })
    expect(result.details.engine).toBe('exa')
    expect(result.details.attempts).toEqual([expect.objectContaining({ engine: 'bing', status: 'blocked' }), expect.objectContaining({ engine: 'exa', status: 'ok' })])
    expect(result.details.results[0]?.index).toBe(1)
    const page = await createWebFetchTool(citations, async () => new Response('正文')).execute('page', { url: hit.url })
    expect(page.details.index).toBe(2)
  })

  it('hedges a slow primary and cancels its request after a fallback succeeds', async () => {
    vi.useFakeTimers()
    let primarySignal: AbortSignal | undefined
    const request = vi.fn(async (url: string, init: RequestInit) => {
      if (!url.includes('bing.com')) return new Response(fixtures.exa)
      primarySignal = init.signal!
      return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }))
    })
    const pending = createWebSearchTool(undefined, request).execute('hedge', { query: 'TypeScript' })
    await vi.advanceTimersByTimeAsync(1200)
    expect((await pending).details.engine).toBe('exa')
    expect(primarySignal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('times out a stalled POST response body and cancels its stream', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const request = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    const pending = createWebSearchTool(undefined, request).execute('slow', { query: 'TypeScript', engine: 'exa' })
    const outcome = expect(pending).rejects.toThrow('exa=timeout')
    await vi.advanceTimersByTimeAsync(SEARCH_SOURCE_TIMEOUT_MS)
    await outcome
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('honors the total budget and cancels remaining sources', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal!)
      return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }))
    })
    const pending = createWebSearchTool(undefined, request).execute('budget', { query: 'TypeScript' })
    const outcome = expect(pending).rejects.toThrow('25 秒总预算')
    await vi.advanceTimersByTimeAsync(SEARCH_BUDGET_MS)
    await outcome
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })

  it('cancels search without marking the source unhealthy or starting fallbacks', async () => {
    const controller = new AbortController(), cancel = vi.fn(), state = createWebSearchState()
    const request = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    const pending = createWebSearchTool(undefined, request, state).execute('cancel', { query: 'TypeScript' }, controller.signal)
    const outcome = expect(pending).rejects.toThrow('请求已取消')
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    controller.abort()
    await outcome
    expect(cancel).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce()
    expect(state.cooldowns.size).toBe(0)
  })

  it('shares cooldowns between tool instances and allows explicit retesting', async () => {
    const state = createWebSearchState()
    const request = vi.fn(async (url: string) => url.includes('bing.com') ? new Response('', { status: 429 }) : new Response(fixtures.exa))
    await createWebSearchTool(undefined, request, state).execute('first', { query: 'TypeScript' })
    request.mockClear()
    const next = await createWebSearchTool(undefined, request, state).execute('next', { query: 'TypeScript' })
    expect(next.details.attempts[0]).toEqual(expect.objectContaining({ engine: 'bing', status: 'cooldown' }))
    expect(request).toHaveBeenCalledOnce()
    await expect(createWebSearchTool(undefined, request, state).execute('retry', { query: 'TypeScript', engine: 'bing' })).rejects.toThrow('bing=blocked')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['RPC error', { jsonrpc: '2.0', id: 1, error: { message: 'quota exhausted' } }],
    ['tool error', { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'quota exhausted' }] } }],
  ])('does not turn an MCP %s into an empty success', async (_label, payload) => {
    const request = vi.fn(async () => new Response(JSON.stringify(payload)))
    await expect(createWebSearchTool(undefined, request).execute('mcp', { query: 'TypeScript', engine: 'exa' })).rejects.toThrow('quota exhausted')
  })

  it('tries other public SearXNG instances after failures', async () => {
    const request = vi.fn(async (url: string) => url.startsWith('https://opnxng.com') || url.startsWith('https://priv.au')
      ? new Response('', { status: 403 }) : new Response(fixtures.searxng))
    const result = await createWebSearchTool(undefined, request).execute('instances', { query: 'TypeScript', engine: 'searxng' })
    expect(result.details.results[0]?.url).toBe(hit.url)
    expect(request.mock.calls.some(([url]) => url.startsWith('https://searx.be'))).toBe(true)
  })

  it('does not forward POST bodies to redirect destinations', async () => {
    const request = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://other.example.com/' } }))
    await expect(createWebSearchTool(undefined, request).execute('redirect', { query: 'TypeScript', engine: 'tavily' })).rejects.toThrow('重定向')
    expect(request).toHaveBeenCalledOnce()
  })

  it('rejects blank queries and unknown sources before network access', async () => {
    const request = vi.fn()
    const tool = createWebSearchTool(undefined, request)
    await expect(tool.execute('blank', { query: '  ' })).rejects.toThrow('关键词不能为空')
    await expect(tool.execute('unknown', { query: 'test', engine: 'unknown' as 'bing' })).rejects.toThrow('未知搜索源')
    expect(request).not.toHaveBeenCalled()
  })
})

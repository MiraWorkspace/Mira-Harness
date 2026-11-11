/*! @license
 * Portions adapted from dsh-free-search 0.9.42:
 * https://github.com/dddmuc/dsh-free-search/tree/ff0a7009d6ccd3a69605f14781110060e747252c
 *
 * MIT License
 *
 * Copyright (c) 2026 dsh-free-search contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { HarnessSource } from '../../src/config/harness'
import { assertSafeHttpUrl } from './webUrl'

// Endpoints and HTML/MCP formats reference dsh-free-search 0.9.42 (MIT).
// Attribution and license: docs/licenses/dsh-free-search.txt.
type SearchResult = Omit<HarnessSource, 'index'>
type SearchRequest = (url: string, init: RequestInit, signal: AbortSignal) => Promise<string>
type Json = Record<string, any>
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const headers = { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }
const SEARXNG_INSTANCES = ['https://opnxng.com', 'https://priv.au', 'https://searx.be', 'https://searx.tiekoetter.com', 'https://search.inetol.net', 'https://paulgo.io']
export const SEARCH_SOURCE_TIMEOUT_MS = 8000
export const SEARCH_BUDGET_MS = 25000

function deadline(ms: number) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]+>/gi, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|ensp|emsp|ldquo|rdquo|lsquo|rsquo|middot|#39);/gi, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·', '#39': "'" })[entity.toLowerCase()]!)
    .replace(/&#(x[\da-f]+|\d+);/gi, (entity, code: string) => {
      const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity
    }).replace(/\s+/g, ' ').trim()
}

function unwrapUrl(raw: string, base?: string): string {
  const url = new URL(raw.replace(/&amp;/g, '&'), base)
  if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname === '/ck/a') {
    const encoded = url.searchParams.get('u')
    if (encoded?.startsWith('a1')) return Buffer.from(encoded.slice(2), 'base64url').toString('utf8')
  }
  if (/(^|\.)duckduckgo\.com$/.test(url.hostname) && url.searchParams.has('uddg')) return url.searchParams.get('uddg')!
  if (url.hostname === 'article.zlink.toutiao.com' && url.searchParams.has('h5_url')) return url.searchParams.get('h5_url')!
  return url.toString()
}

// Bing sometimes substitutes a normal-looking SERP for a different query.
// Use CJK bigrams rather than single characters such as 年/月, which match almost anything.
export function relevantBingResults(query: string, sources: SearchResult[]): boolean {
  const tokens = new Set(query.toLowerCase().match(/[a-z0-9]{2,}/g) || [])
  for (const run of query.match(/[\u4e00-\u9fff]+/g) || []) for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2))
  const strong = [...tokens].filter(token => !/^\d+$/.test(token))
  const usable = strong.length ? strong : [...tokens]
  if (!usable.length) return true
  const matched = new Set<string>()
  let relevant = 0
  for (const source of sources) {
    const text = `${source.title} ${source.snippet || ''} ${source.url}`.toLowerCase()
    const hits = usable.filter(token => text.includes(token))
    if (hits.length) relevant++
    hits.forEach(token => matched.add(token))
  }
  return relevant >= Math.max(1, Math.ceil(sources.length / 3)) && (matched.size >= Math.min(2, usable.length) || matched.size / usable.length >= 0.5)
}

function normalizeResults(items: Json[], limit: number, base?: string): SearchResult[] {
  const results: SearchResult[] = [], seen = new Set<string>()
  for (const item of items) {
    if (!item || typeof item.url !== 'string') continue
    try {
      const url = assertSafeHttpUrl(unwrapUrl(item.url, base))
      if (url.username || url.password) continue
      if (isAdUrl(url) || item.isAd === true || item.is_ad === true || item.sponsored === true) continue
      // Preserve signed links and resource parameters; only drop known tracking fields.
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|msclkid$)/i.test(key)) url.searchParams.delete(key)
      const href = url.toString()
      if (seen.has(href)) continue
      seen.add(href)
      const title = [...cleanText(item.title || href)].slice(0, 240).join('')
      const snippet = [...cleanText(item.snippet)].slice(0, 600).join('')
      results.push({ title, url: href, ...(snippet ? { snippet } : {}) })
      if (results.length >= limit) break
    } catch { /* Ignore unsafe or malformed result URLs. */ }
  }
  return results
}

function isAdUrl(url: URL): boolean {
  return /(^|\.)(baidu\.com|baidustatic\.com)$/.test(url.hostname) && /^\/(?:baidu\.php|cpro\/|adrc\/)/i.test(url.pathname)
    || /(^|\.)(pos\.baidu\.com|cpro\.baidu\.com|e\.sogou\.com|p4psearch\.1688\.com|click\.simba\.taobao\.com|googleadservices\.com|doubleclick\.net)$/.test(url.hostname)
    || /(^|\.)bing\.com$/.test(url.hostname) && /^\/aclick/i.test(url.pathname)
    || /(^|\.)so\.com$/.test(url.hostname) && /^\/adclick/i.test(url.pathname)
}

function isAdBlock(html: string): boolean {
  // Inspect each result, not the whole page: legitimate articles may discuss ads.
  return /(?:class|id)=["'][^"']*\b(?:b_ad|ec-tuiguang|ec_tuiguang|commercial|sponsored|ad-result)\b|data-(?:tuiguang|ad(?:vertisement)?|sponsored)(?:=|\s)/i.test(html)
    || /<(?:span|label|i|em)\b[^>]*>\s*(?:广告|推广|赞助|Sponsored|Advertisement|Ad)\s*<\//i.test(html)
}

function parseJson(text: string): Json {
  try {
    const data = JSON.parse(text)
    if (data && typeof data === 'object' && !Array.isArray(data)) return data
  } catch { /* Report a protocol error below. */ }
  throw new Error('搜索响应解析失败：预期 JSON 对象')
}

function rows(value: unknown): Json[] {
  if (!Array.isArray(value)) throw new Error('搜索响应结构异常：缺少结果列表')
  return value
}

function mcpText(raw: string): string {
  const payloads = [raw, ...raw.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))]
  // Some endpoints send one envelope per data line without blank separators.
  payloads.push(...raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()))
  for (const payload of payloads) {
    let data: Json
    try { data = parseJson(payload) } catch { continue }
    if (data.error) throw new Error(`搜索 MCP 错误：${data.error.message || '未知错误'}`)
    if (!data.result) continue // Ignore SSE notifications.
    const content = rows(data.result.content).filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n')
    if (data.result.isError) throw new Error(`搜索 MCP 调用失败：${cleanText(content).slice(0, 180)}`)
    return content
  }
  throw new Error('搜索 MCP 响应解析失败')
}

function parseMcpSources(text: string): Json[] {
  return text.split(/\n(?=Title:)/).flatMap(block => {
    const url = block.match(/^URL:\s*(\S+)/m)?.[1]
    if (!url) return []
    const title = block.match(/^Title:\s*(.+)/m)?.[1]
    const snippet = block.split(/^(?:Highlights|Snippets|Text):\s*$/m)[1]?.trim()
    return [{ url, title, snippet }]
  })
}

const resultLink = /<h[23]\b[^>]*>[\s\S]*?<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
function parseHtml(engine: string, html: string): Json[] {
  const pageTitle = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
  if (/验证码|安全验证|访问异常|人机验证|captcha|robot check|just a moment|access denied/i.test(pageTitle)
    || /id=["'](?:captcha|challenge-form|seccodeForm)|\/anti-?captcha\/|anomaly\.js|cf-chl-|unusual traffic|verify you are human/i.test(html.slice(0, 20000))) throw new Error('搜索源返回验证码或反爬验证页面')
  let items: Json[] = []
  if (engine === 'ddg' || engine === 'ddg-lite') {
    const links = [...html.matchAll(/<a\b[^>]*class=["'][^"']*\b(?:result__a|result-link)\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)]
    const snippets = [...html.matchAll(/<(?:a|td)\b[^>]*class=["'][^"']*\b(?:result__snippet|result-snippet)\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|td)>/gi)]
    items = links.flatMap((match, index) => isAdBlock(match[0]) ? [] : [{ url: match[0].match(/href=["']([^"']+)["']/i)?.[1], title: match[0], snippet: snippets[index]?.[1] }])
  } else if (engine === 'toutiao') {
    const pattern = /"title":"((?:[^"\\]|\\.)*)"[\s\S]{0,4000}?"article_url":"(https?:[^"\s]+)"/g
    items = [...html.matchAll(pattern)].flatMap(match => {
      try { return [{ title: JSON.parse(`"${match[1]}"`), url: JSON.parse(`"${match[2]}"`) }] } catch { return [] }
    })
  } else {
    const block = engine === 'bing' ? /(?=<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'])/i
      : engine === 'baidu-html' ? /(?=<div\b[^>]*class=["']result(?:\s|["']))/i
        : engine === 'so360' ? /(?=<li\b[^>]*class=["']res-list)/i
          : engine === 'wechat' ? /(?=<li\b[^>]*id=["']sogou_vr_11002601_box)/i : /(?=<div\b[^>]*class=["']vrwrap(?:\s|["']))/i
    items = html.split(block).filter(part => block.test(part)).flatMap(raw => {
      const part = ['bing', 'so360', 'wechat'].includes(engine) ? raw.split(/<\/li>/i)[0]! : raw
      if (isAdBlock(part)) return []
      const link = part.match(resultLink)
      if (!link) return []
      return [{ url: engine === 'baidu-html' ? part.match(/\bmu=["']([^"']+)["']/i)?.[1] || link[1] : link[1], title: link[2], snippet: part.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] }]
    })
  }
  if (!items.length && !/没有找到|未找到|暂无.*结果|no results|did not match any/i.test(cleanText(html))) throw new Error('搜索响应解析失败：未找到有效结果区块，可能是广告、页面改版或拦截')
  return items
}

const htmlSources = [
  { id: 'bing', label: '国内 Bing', url: (q: string) => `https://cn.bing.com/search?q=${encodeURIComponent(q)}` },
  { id: 'so360', label: '360 搜索', url: (q: string) => `https://www.so.com/s?q=${encodeURIComponent(q)}` },
  { id: 'sogou', label: '搜狗', url: (q: string) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}` },
  { id: 'baidu-html', label: '百度网页', url: (q: string) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}&rn=20` },
  { id: 'ddg', label: 'DuckDuckGo', url: (q: string) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}` },
  { id: 'ddg-lite', label: 'DuckDuckGo Lite', url: (q: string) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}` },
  { id: 'toutiao', label: '头条', url: (q: string) => `https://so.toutiao.com/search?keyword=${encodeURIComponent(q)}` },
  { id: 'wechat', label: '微信文章', url: (q: string) => `https://wx.sogou.com/weixin?type=2&query=${encodeURIComponent(q)}` },
] as const

type SearchEngine = { id: string, label: string, search: (request: SearchRequest, query: string, limit: number, signal: AbortSignal) => Promise<SearchResult[]> }
const post = (body: unknown, extra: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers: { ...headers, Accept: 'application/json', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) })
const jsonSources = [
  { id: 'anysearch', label: 'AnySearch', url: 'https://api.anysearch.com/v1/search', init: (q: string, n: number) => post({ query: q, max_results: n }), parse: (data: Json) => {
    if (data.code !== 0) throw new Error(`AnySearch 拒绝匿名搜索：${cleanText(data.message || data.code).slice(0, 180)}`)
    return rows(data.data?.results)
  } },
  { id: 'tavily', label: 'Tavily', url: 'https://api.tavily.com/search', init: (q: string, n: number) => post({ query: q, max_results: n, search_depth: 'basic' }, { 'x-tavily-access-mode': 'keyless' }), parse: (data: Json) => rows(data.results).map(item => ({ ...item, snippet: item.content })) },
  { id: 'firecrawl', label: 'Firecrawl', url: 'https://api.firecrawl.dev/v2/search', init: (q: string, n: number) => post({ query: q, limit: n }), parse: (data: Json) => rows(data.data?.web).map(item => ({ ...item, snippet: item.description })) },
] as const

const mcpSources = [
  { id: 'exa', label: 'Exa', url: 'https://mcp.exa.ai/mcp', tool: 'web_search_exa', args: (q: string, n: number) => ({ query: q, numResults: n }) },
  { id: 'keenable', label: 'Keenable', url: 'https://api.keenable.ai/mcp', tool: 'search_web_pages', args: (q: string, _n: number) => ({ query: q }) },
  { id: 'parallel', label: 'Parallel', url: 'https://search.parallel.ai/mcp', tool: 'web_search', args: (q: string, _n: number) => ({ objective: q, search_queries: [q], session_id: crypto.randomUUID().replace(/-/g, '') }) },
] as const

export const WEB_SEARCH_ENGINES = [
  ...htmlSources.map(source => ({ ...source, search: async (request, query, limit, signal) => {
    const url = source.url(query)
    const results = normalizeResults(parseHtml(source.id, await request(url, { headers }, signal)), limit, url)
    if (source.id === 'bing' && results.length && !relevantBingResults(query, results)) throw new Error('搜索响应异常：Bing 返回了与关键词无关的替代结果')
    return results
  } } satisfies SearchEngine)),
  ...jsonSources.map(source => ({ ...source, search: async (request, query, limit, signal) => normalizeResults(source.parse(parseJson(await request(source.url, source.init(query, limit), signal))), limit) } satisfies SearchEngine)),
  ...mcpSources.map(source => ({ ...source, search: async (request, query, limit, signal) => {
    const text = mcpText(await request(source.url, post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: source.tool, arguments: source.args(query, limit) } }, { Accept: 'application/json, text/event-stream' }), signal))
    if (source.id !== 'parallel') return normalizeResults(parseMcpSources(text), limit)
    const data = parseJson(text)
    return normalizeResults(rows(data.results).map(item => ({ ...item, snippet: rowsOrStrings(item.excerpts).join(' ') })), limit)
  } } satisfies SearchEngine)),
  { id: 'you' as const, label: 'You.com', search: async (request, query, limit, signal) => {
    const data = parseJson(await request(`https://api.you.com/v1/agents/search?${new URLSearchParams({ query, count: String(limit) })}`, { headers: { ...headers, Accept: 'application/json' } }, signal))
    return normalizeResults(rows(data.results?.web).map(item => ({ ...item, snippet: rowsOrStrings(item.snippets).join(' ') || item.description })), limit)
  } } satisfies SearchEngine,
  { id: 'searxng' as const, label: '公开 SearXNG', search: async (request, query, limit, signal) => {
    const errors: string[] = []
    // Two instances at a time, each with a short budget; stop and cancel on success.
    for (let i = 0; i < SEARXNG_INSTANCES.length; i += 2) {
      signal.throwIfAborted()
      const controller = new AbortController(), timeout = deadline(2200)
      try {
        return await Promise.any(SEARXNG_INSTANCES.slice(i, i + 2).map(async base => {
          const body = await request(`${base}/search?${new URLSearchParams({ q: query, format: 'json' })}`, { headers: { ...headers, Accept: 'application/json' } }, AbortSignal.any([signal, controller.signal, timeout.signal]))
          const result = normalizeResults(rows(parseJson(body).results).map(item => ({ ...item, snippet: item.content })), limit)
          if (!result.length) throw new Error(`${base}：无结果`)
          return result
        }))
      } catch (error) { errors.push(error instanceof AggregateError ? error.errors.map(String).join('；') : String(error)) }
      finally { controller.abort(); timeout.dispose() }
    }
    throw new Error(`公开 SearXNG 实例不可用：${errors.join('；').slice(0, 300)}`)
  } } satisfies SearchEngine,
]

function rowsOrStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
export type WebSearchEngine = typeof WEB_SEARCH_ENGINES[number]['id']
export type SearchAttempt = { engine: WebSearchEngine, status: 'ok' | 'empty' | 'timeout' | 'blocked' | 'unavailable' | 'invalid' | 'network' | 'cooldown', durationMs: number, error?: string }
export function createWebSearchState() { return { cooldowns: new Map<WebSearchEngine, number>() } }
export type WebSearchState = ReturnType<typeof createWebSearchState>

function failureStatus(message: string): SearchAttempt['status'] {
  if (/HTTP (401|402)|拒绝匿名|quota|credits|billing/i.test(message)) return 'unavailable'
  if (/HTTP (403|412|429)|验证码|反爬/i.test(message)) return 'blocked'
  if (/解析|结构|MCP|JSON|响应异常|重定向/i.test(message)) return 'invalid'
  return 'network'
}

export async function searchWeb(query: string, limit: number, engine: WebSearchEngine | 'auto', request: SearchRequest, state = createWebSearchState(), signal?: AbortSignal) {
  query = query.trim()
  if (!query) throw new Error('搜索关键词不能为空')
  signal?.throwIfAborted()
  const explicit = engine !== 'auto'
  const order: WebSearchEngine[] = ['bing', 'exa', 'anysearch', 'keenable', 'firecrawl', 'parallel', 'you', 'sogou', 'so360', 'baidu-html', 'tavily', 'ddg', 'ddg-lite', 'searxng', 'toutiao']
  if (explicit && !WEB_SEARCH_ENGINES.some(source => source.id === engine)) throw new Error(`未知搜索源：${engine}`)
  const attempts: SearchAttempt[] = []
  const queue = (explicit ? [engine] : order).filter(id => {
    if (explicit || (state.cooldowns.get(id) || 0) <= Date.now()) return true
    attempts.push({ engine: id, status: 'cooldown', durationMs: 0 })
    return false
  })
  if (!queue.length) throw new Error('搜索源暂时均处于冷却中；请稍后重试，或用 engine 指定来源重新测试')
  const winner = new AbortController(), budget = deadline(SEARCH_BUDGET_MS)
  const runSignal = AbortSignal.any([winner.signal, budget.signal, ...(signal ? [signal] : [])])
  let next = 0
  const worker = async (delay: number) => {
    if (delay) await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); runSignal.removeEventListener('abort', done); resolve() }
      const timer = setTimeout(done, delay)
      runSignal.addEventListener('abort', done, { once: true })
      if (runSignal.aborted) done()
    })
    while (next < queue.length && !runSignal.aborted) {
      const id = queue[next++]!, source = WEB_SEARCH_ENGINES.find(source => source.id === id)!
      const started = Date.now(), timeout = deadline(SEARCH_SOURCE_TIMEOUT_MS)
      try {
        const attemptSignal = AbortSignal.any([runSignal, timeout.signal])
        const results = await source.search(request, query, limit, attemptSignal)
        attemptSignal.throwIfAborted()
        attempts.push({ engine: id, status: results.length ? 'ok' : 'empty', durationMs: Date.now() - started })
        if (results.length) { state.cooldowns.delete(id); return { engine: id, results } }
      } catch (error) {
        if (runSignal.aborted) throw error
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 300)
        const status = timeout.signal.aborted ? 'timeout' : failureStatus(message)
        attempts.push({ engine: id, status, durationMs: Date.now() - started, error: message })
        state.cooldowns.set(id, Date.now() + (status === 'blocked' ? 5 * 60000 : status === 'unavailable' ? 15 * 60000 : 30000))
      } finally { timeout.dispose() }
    }
    throw new Error('没有可用的搜索结果')
  }
  try {
    // Prefer the domestic entry; hedge slow requests without waiting for a timeout.
    const result = await Promise.any(explicit ? [worker(0)] : [worker(0), worker(1200), worker(2400)])
    return { ...result, attempts: attempts.slice() }
  } catch {
    if (signal?.aborted) throw new Error('请求已取消')
    const reason = budget.signal.aborted ? '搜索超过 25 秒总预算' : '所有搜索源均未返回可用结果'
    throw new Error(`${reason}：${attempts.map(item => `${item.engine}=${item.status}${item.error ? `（${item.error}）` : ''}`).join('；')}`)
  } finally { winner.abort(); budget.dispose() }
}

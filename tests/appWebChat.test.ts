import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { AppModelService } from '../electron/services/appModelService'
import { AppWebService } from '../electron/services/appWebService'

describe('application chat with autonomous web tools', () => {
  it('limits page reads to three at once and executes no further network calls after revocation', async () => {
    let active = 0, maximum = 0
    const request = vi.fn(async () => {
      active++; maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 5)); active--
      return new Response('Public page text')
    })
    const toolReply = { role: 'assistant', stopReason: 'toolUse', content: Array.from({ length: 4 }, (_, i) => ({ type: 'toolCall', id: String(i), name: 'web_fetch', arguments: { url: `https://example.com/${i}` } })) }
    const completeSimple = vi.fn().mockResolvedValueOnce(toolReply).mockResolvedValue({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Answer' }] })
    const configured = { model: {}, models: { completeSimple } } as never
    await new AppWebService(request).chat(configured, { messages: [] }, 2048, () => {}, new AbortController().signal)
    expect(maximum).toBe(3); expect(request).toHaveBeenCalledTimes(4)
    let approved = true
    const revokedRequest = vi.fn(async () => { approved = false; return new Response('Page') })
    completeSimple.mockResolvedValueOnce(toolReply)
    await expect(new AppWebService(revokedRequest).chat(configured, { messages: [] }, 2048, () => { if (!approved) throw new Error('revoked') }, new AbortController().signal)).rejects.toThrow('revoked')
    expect(revokedRequest).toHaveBeenCalledTimes(1)
  })

  it('bounds tool loops and rejects excess tool batches without making network requests', async () => {
    const request = vi.fn(), completeSimple = vi.fn().mockResolvedValue({ role: 'assistant', stopReason: 'toolUse', content: Array.from({ length: 9 }, (_, i) => ({ type: 'toolCall', id: String(i), name: 'web_search', arguments: { query: 'TypeScript' } })) })
    const service = new AppWebService(request), configured = { model: {}, models: { completeSimple } } as never
    await expect(service.chat(configured, { messages: [] }, 2048, () => {}, new AbortController().signal)).rejects.toThrow('budget')
    expect(request).not.toHaveBeenCalled()
    completeSimple.mockClear(); completeSimple.mockResolvedValue({ role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call', name: 'unsupported', arguments: {} }] })
    await expect(service.chat(configured, { messages: [] }, 2048, () => {}, new AbortController().signal)).rejects.toThrow('budget')
    expect(completeSimple).toHaveBeenCalledTimes(6)
    expect(request).not.toHaveBeenCalled()
  })

  it('lets the model choose parallel searches and page reads, then returns an answer and real sources', async () => {
    const bodies: any[] = [], urls: string[] = []
    let active = 0, maximum = 0
    const web = new AppWebService(async url => {
      urls.push(url); active++; maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return url.includes('bing.com')
        ? new Response('<li class="b_algo"><h2><a href="https://www.typescriptlang.org/docs/">TypeScript 官方文档</a></h2><p>Official docs</p></li>')
        : new Response('<html><head><title>TypeScript 文档</title></head><body>TypeScript is JavaScript with types.</body></html>', { headers: { 'Content-Type': 'text/html' } })
    })
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
      bodies.push(JSON.parse(Buffer.concat(chunks).toString()))
      const calls = bodies.length === 1
        ? [{ name: 'web_search', arguments: { query: 'TypeScript 官方文档' } }, { name: 'web_search', arguments: { query: 'TypeScript' } }]
        : bodies.length === 2 ? [{ name: 'web_fetch', arguments: { url: 'https://www.typescriptlang.org/docs/' } }, { name: 'web_fetch', arguments: { url: 'https://www.typescriptlang.org/' } }] : []
      const delta = calls.length ? { role: 'assistant', tool_calls: calls.map((call, index) => ({ index, id: `turn-${bodies.length}-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) }
        : { role: 'assistant', content: 'TypeScript 为 JavaScript 增加类型。[[source:3]]' }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: 'web-chat', choices: [{ index: 0, delta, finish_reason: calls.length ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const model = { id: 'model', enabled: true, reasoning: false, contextWindow: 8000, maxTokens: 2048 }
      const provider = { id: 'provider', providerKey: 'custom', name: 'Provider', endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, authMode: 'api-key', models: [model], enabled: true, hasApiKey: true }
      const store = { list: () => [provider], get: () => provider, getSecret: () => 'test-key', bindings: () => ({}) }
      const service = new AppModelService(store as never, undefined, web)
      let checks = 0
      const result = await service.chat({ appId: 'sample', providerId: 'provider', modelId: 'model', webSearch: true, messages: [{ role: 'user', content: '搜索 TypeScript 并阅读文档后解释。' }] }, () => { checks++ })
      expect(result.text).toContain('[[source:3]]')
      expect(result.sources).toHaveLength(4)
      expect(result.sources?.[2]).toEqual({ index: 3, title: 'TypeScript 文档', url: 'https://www.typescriptlang.org/docs/' })
      expect(maximum).toBe(2)
      expect(urls.filter(url => url.includes('bing.com'))).toHaveLength(2)
      expect(bodies).toHaveLength(3)
      expect(bodies[0].tools.map((tool: any) => tool.function.name)).toEqual(['web_search', 'web_fetch'])
      expect(bodies[0].tools[0].function.parameters.properties).not.toHaveProperty('engine')
      expect(bodies[2].messages.filter((message: any) => message.role === 'tool')).toHaveLength(4)
      expect(checks).toBeGreaterThanOrEqual(11)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})

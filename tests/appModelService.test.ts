import { describe, expect, it, vi } from 'vitest'
import { AppModelService } from '../electron/services/appModelService'
import { createServer } from 'node:http'

function fixture() {
  const model = { id: 'model', enabled: true, reasoning: false, contextWindow: 8000, maxTokens: 4000 }
  const provider = { id: 'provider', providerKey: 'custom' as const, name: 'Provider', endpoint: 'https://example.test', authMode: 'api-key' as const, models: [model], enabled: true, hasApiKey: true, createdAt: 1, updatedAt: 1 }
  const store = { get: vi.fn(() => provider), getSecret: vi.fn(() => 'secret-key'), bindings: vi.fn(() => ({ agentDefault: { providerId: 'provider', modelId: 'model' } })) }
  const completeSimple = vi.fn(async () => ({ stopReason: 'stop', content: [{ type: 'text', text: 'hello secret-key' }, { type: 'thinking', thinking: 'private' }] }))
  const factory = vi.fn(() => ({ model: {}, models: { completeSimple } }))
  return { service: new AppModelService(store as never, factory as never), store, provider, model, completeSimple, factory }
}

describe('application model service', () => {
  it('calls a real OpenAI-compatible endpoint through the model adapter without exposing credentials', async () => {
    let authorization = '', body: any
    const server = createServer(async (request, response) => {
      authorization = String(request.headers.authorization || '')
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const chunk = { id: 'local-test', object: 'chat.completion.chunk', created: 0, model: 'model', choices: [{ index: 0, delta: { role: 'assistant', content: 'reply secret-key' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } }
      response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const { store, provider } = fixture()
      provider.endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
      const result = await new AppModelService(store as never).generate({ appId: 'sample', prompt: 'hello' })
      expect(authorization).toBe('Bearer secret-key')
      expect(body.model).toBe('model')
      expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])
      expect(result).toEqual({ text: 'reply [REDACTED]' })
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('uses the configured default and returns text without host credentials or private reasoning', async () => {
    const { service, factory, completeSimple } = fixture()
    await expect(service.generate({ appId: 'sample', prompt: 'hello' })).resolves.toEqual({ text: 'hello [REDACTED]' })
    expect(factory.mock.calls[0][2]).toBe('secret-key')
    expect(completeSimple.mock.calls[0][2]).toMatchObject({ maxTokens: 2048, signal: expect.any(AbortSignal) })
  })

  it('rejects unavailable or incomplete selections before invoking a provider', async () => {
    const { service, provider, model, factory } = fixture()
    await expect(service.generate({ appId: 'sample', prompt: 'hello', providerId: 'provider' })).rejects.toThrow('同时指定')
    model.enabled = false
    await expect(service.generate({ appId: 'sample', prompt: 'hello' })).rejects.toThrow('不可用')
    model.enabled = true; provider.enabled = false
    await expect(service.generate({ appId: 'sample', prompt: 'hello' })).rejects.toThrow('不可用')
    expect(factory).not.toHaveBeenCalled()
  })

  it('does not leak provider errors or credentials', async () => {
    const { service, completeSimple } = fixture()
    completeSimple.mockRejectedValueOnce(new Error('secret-key provider details'))
    await expect(service.generate({ appId: 'sample', prompt: 'hello' })).rejects.toThrow('模型请求失败，请检查模型配置后重试')
  })
})

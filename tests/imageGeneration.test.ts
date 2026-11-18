import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateImage } from '../electron/services/imageGeneration'

const provider = { id: 'p', name: 'OpenAI', endpoint: 'https://example.test/v1', protocol: 'openai-responses', providerKey: 'custom', models: [], enabled: true, authMode: 'api-key' } as any
const model = { id: 'image-model', enabled: true, modelType: 'image', reasoning: false, contextWindow: 1000 } as any
afterEach(() => vi.restoreAllMocks())

describe('image generation', () => {
  it('sends an OpenAI-compatible request and saves base64 output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mira-image-'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'req-1', data: [{ b64_json: Buffer.from('png').toString('base64') }] }), { status: 200 })))
    const result = await generateImage(provider, model, 'secret', root, 'blue background', { size: '1024x1024' })
    expect(fetch).toHaveBeenCalledWith('https://example.test/v1/images/generations', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }))
    expect(await readFile(join(root, result.path), 'utf8')).toBe('png')
    expect(result.requestId).toBe('req-1')
  })

  it('maps provider failures to actionable messages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mira-image-'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))
    await expect(generateImage(provider, model, 'secret', root, 'test', {})).rejects.toThrow('额度或频率限制')
  })

  it('uses the image endpoint even when the provider text protocol is Anthropic Messages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mira-image-'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }), { status: 200 })))
    await generateImage({ ...provider, protocol: 'anthropic-messages', endpoint: 'https://example.test/v1/messages' }, model, 'secret', root, 'test', {})
    expect(fetch).toHaveBeenCalledWith('https://example.test/v1/images/generations', expect.anything())
  })
})

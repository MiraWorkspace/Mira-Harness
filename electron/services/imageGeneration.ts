import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { modelApiBaseUrl } from '../../src/config/modelProtocol'
import type { ModelProviderSummary, ProviderModelConfig } from '../../src/config/harness'

export type ImageGenerationResult = { path: string, mediaType: string, content: string, requestId?: string }

function errorFor(status: number) {
  if (status === 401 || status === 403) return '图片生成服务认证失败或没有权限，请检查 API Key。'
  if (status === 429) return '图片生成额度或频率限制已用完，请稍后重试或更换模型。'
  if (status >= 500) return '图片生成服务暂时不可用，请稍后重试。'
  return '图片生成请求无效，请检查提示词和参数。'
}

export async function generateImage(provider: ModelProviderSummary, model: ProviderModelConfig, apiKey: string, cwd: string, prompt: string, options: { size?: string, signal?: AbortSignal }): Promise<ImageGenerationResult> {
  if (!prompt.trim()) throw new Error('图片提示词不能为空。')
  const endpoint = provider.endpoint.trim().replace(/\/(?:chat\/completions|responses|messages)\/?$/, '')
  const url = `${modelApiBaseUrl(endpoint, 'openai-completions', provider)}/images/generations`
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.id, prompt: prompt.trim(), n: 1, ...(options.size ? { size: options.size } : {}) }), signal: options.signal })
  if (!response.ok) throw new Error(errorFor(response.status))
  const payload = await response.json() as { id?: string, data?: Array<{ b64_json?: string, url?: string }> }
  const item = payload.data?.[0]
  if (!item?.b64_json && !item?.url) throw new Error('图片生成服务返回了无效结果。')
  let bytes: Buffer
  let mediaType = 'image/png'
  if (item.b64_json) bytes = Buffer.from(item.b64_json, 'base64')
  else {
    const downloaded = await fetch(item.url!, { signal: options.signal })
    if (!downloaded.ok) throw new Error('图片已生成，但下载结果失败，请重试。')
    mediaType = downloaded.headers.get('content-type')?.split(';')[0] || mediaType
    bytes = Buffer.from(await downloaded.arrayBuffer())
  }
  const extension = mediaType === 'image/jpeg' ? '.jpg' : mediaType === 'image/webp' ? '.webp' : '.png'
  const directory = join(cwd, '.mira', 'generated-images')
  const file = join(directory, `image-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`)
  await mkdir(directory, { recursive: true })
  await writeFile(file, bytes, { flag: 'wx' })
  return { path: relative(cwd, file), mediaType, content: bytes.toString('base64'), ...(payload.id ? { requestId: payload.id } : {}) }
}

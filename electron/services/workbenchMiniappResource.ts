import { assertSafeHttpUrl } from '../adapters/webUrl'
import type { WebRequest } from '../adapters/webTools'

/** Restricted transport only; Workbench owns manifest policy, integrity and installation. */
export async function fetchWorkbenchMiniappResource(value: string, kind: 'manifest' | 'package', fetcher: WebRequest): Promise<Uint8Array> {
  const url = assertSafeHttpUrl(value)
  if (value.length > 8192 || url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('安装地址必须使用不含账号密码和片段的 HTTPS 网址')
  const limit = kind === 'manifest' ? 65536 : 64 * 1024 * 1024
  try {
    const response = await fetcher(url.href, { signal: AbortSignal.timeout(kind === 'manifest' ? 15000 : 60000), redirect: 'manual', credentials: 'omit', headers: { Accept: kind === 'manifest' ? 'application/json' : 'application/octet-stream' } })
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('安装来源不能重定向，请使用直接返回文件的 HTTPS 地址') }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`下载失败（HTTP ${response.status}），请检查发布地址`) }
    if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('下载文件超过大小限制') }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      size += chunk.byteLength
      if (size > limit) { await reader.cancel(); throw new Error('下载文件超过大小限制') }
      chunks.push(chunk)
    }
    if (!size) throw new Error('下载文件为空')
    return new Uint8Array(Buffer.concat(chunks))
  } catch (error) {
    if (error instanceof Error && /Timeout|Abort/.test(error.name)) throw new Error('下载超时，请稍后重试')
    if (error instanceof TypeError) throw new Error('无法连接安装来源，请检查网络后重试')
    throw error
  }
}

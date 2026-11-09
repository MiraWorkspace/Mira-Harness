import { isAllowedHostedBrowserUrl } from '../security/hostedBrowser'

/** Downloads an icon through the host so website CORS policies do not block it. */
export async function fetchWorkbenchSiteIcon(value: string, fetcher: typeof fetch): Promise<string | null> {
  if (!isAllowedHostedBrowserUrl(value) || value.length > 8192) throw new Error('网站地址无效')
  let url = new URL('/favicon.ico', value).href
  const signal = AbortSignal.timeout(8000)
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetcher(url, { signal, redirect: 'manual', credentials: 'omit' })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) return null
        url = new URL(location, url).href
        if (!isAllowedHostedBrowserUrl(url)) return null
        continue
      }
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (!response.ok || !mime?.startsWith('image/') || !response.body) { await response.body?.cancel(); return null }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        size += chunk.byteLength
        if (size > 512 * 1024) { await reader.cancel(); return null }
        chunks.push(chunk)
      }
      return size ? `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}` : null
    }
  } catch { /* Missing icons and unavailable websites use the default icon. */ }
  return null
}

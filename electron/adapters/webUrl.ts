export function assertSafeHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('无效的 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 http/https 链接')
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname === '::1' || hostname === '0.0.0.0' || hostname.endsWith('.local')) {
    throw new Error('不允许访问本机地址')
  }
  if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) {
    throw new Error('不允许访问内网地址')
  }
  if (/^172\./.test(hostname)) {
    const second = Number(hostname.split('.')[1])
    if (second >= 16 && second <= 31) throw new Error('不允许访问内网地址')
  }
  return url
}

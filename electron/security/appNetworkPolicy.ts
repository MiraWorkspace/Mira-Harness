const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"

/** Restricts same-origin package access; remote scripts are blocked by CSP. */
export function appNetworkPolicy(entry: string) {
  const root = new URL(entry)
  const match = root.pathname.match(/^\/apps\/([^/]+)\//)
  if (root.protocol !== 'http:' || root.hostname !== '127.0.0.1' || !match) throw new Error('应用入口无效')
  const prefix = `/apps/${match[1]}/`
  return {
    allows(value: string) {
      try {
        const url = new URL(value)
        if (url.protocol === 'data:' || url.protocol === 'blob:') return true
        if (url.username || url.password) return false
        if (url.origin === root.origin) return url.pathname.startsWith(prefix) && !/%2f|%5c/i.test(url.pathname)
        return url.protocol === 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '[::1]'
      } catch { return false }
    },
    headers(headers: Record<string, string[]> | undefined) {
      const next = { ...headers }
      const key = Object.keys(next).find(name => name.toLowerCase() === 'content-security-policy')
      if (key) next[key] = [...next[key], contentSecurityPolicy]
      else next['Content-Security-Policy'] = [contentSecurityPolicy]
      return next
    },
  }
}

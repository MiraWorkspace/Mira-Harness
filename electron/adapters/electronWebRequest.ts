import { net } from 'electron'
import { Readable } from 'node:stream'
import type { WebRequest } from './webTools'

// net.fetch 的 manual 重定向会拒绝 Promise，使用 request 将重定向交给网页工具逐跳检查。
export const electronWebRequest: WebRequest = (url, init) => new Promise((resolve, reject) => {
  const signal = init.signal
  if (signal?.aborted) { reject(signal.reason); return }
  const request = net.request({ url, ...(init.method ? { method: init.method } : {}), redirect: 'manual', credentials: 'omit', headers: Object.fromEntries(new Headers(init.headers)) })
  let incoming: Readable | undefined, aborted = false
  const cleanup = () => signal?.removeEventListener('abort', abort)
  const abortRequest = () => { if (!aborted) { aborted = true; request.abort() } }
  const abort = () => {
    cleanup()
    incoming?.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException('请求已取消', 'AbortError'))
    abortRequest()
    reject(signal?.reason)
  }
  signal?.addEventListener('abort', abort, { once: true })
  // ClientRequest can close before response headers arrive; keep cancellation
  // attached until the response body closes, not just until upload finishes.
  request.on('error', error => { cleanup(); incoming?.destroy(error); reject(error) })
  request.on('redirect', (status, _method, location) => {
    cleanup()
    resolve(new Response(null, { status, headers: { location } }))
    abortRequest()
  })
  request.on('response', message => {
    const headers = new Headers()
    for (const [name, values] of Object.entries(message.headers)) {
      for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value)
    }
    incoming = message as unknown as Readable
    message.on('aborted', () => incoming?.destroy(new Error('网页响应在读取完成前中断')))
    incoming.on('close', () => { cleanup(); abortRequest() })
    const body = [204, 205, 304].includes(message.statusCode) ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>
    resolve(new Response(body, { status: message.statusCode, headers }))
  })
  if (typeof init.body === 'string') request.write(init.body)
  request.end()
})

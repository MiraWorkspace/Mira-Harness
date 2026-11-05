import type { Session } from 'electron'

export const HOSTED_BROWSER_PARTITION = 'persist:mira-harness-browser'
export const WORKBENCH_BROWSER_PARTITION = 'persist:mira-workbench'

const browserPartitions = new Set([HOSTED_BROWSER_PARTITION, WORKBENCH_BROWSER_PARTITION])

export function isMiraBrowserPartition(value: string) {
  return browserPartitions.has(value)
}

export function isWorkbenchPopupDisposition(value: string) {
  return value === 'new-window'
}

export function browserCompatibleUserAgent(value: string) {
  return value.replace(/\sElectron\/\S+/g, '')
}

// Browser guests retain Chromium's real platform and version while omitting the
// Electron product token that many challenge providers reject outright.
export function configureMiraBrowserSession(browserSession: Session) {
  const userAgent = browserCompatibleUserAgent(browserSession.getUserAgent())
  browserSession.setUserAgent(userAgent)
  browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': userAgent } })
  })
}

export function isAllowedHostedBrowserUrl(value: string) {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

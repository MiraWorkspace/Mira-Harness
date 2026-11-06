import type { WebContents } from 'electron'

function sameEntry(actual: string, expected: string) {
  try {
    const url = new URL(actual), entry = new URL(expected)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password
      && url.origin === entry.origin && url.pathname === entry.pathname && url.search === entry.search
  } catch { return false }
}

/** Install before loading the entry. A revoked frame must be destroyed, not reauthorized. */
export class AppFrameGuard {
  private state: 'initial' | 'loading' | 'ready' | 'revoked' = 'initial'

  constructor(private readonly contents: WebContents, private readonly entry: string, private readonly invalidate: () => void) {
    if (!sameEntry(entry, entry)) throw new Error('应用入口无效')
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', this.preventNavigation)
    contents.on('will-redirect', this.preventNavigation)
    contents.on('did-start-navigation', this.startedNavigation)
    contents.on('did-finish-load', this.finishedLoad)
    contents.on('render-process-gone', this.revoke)
    contents.on('destroyed', this.revoke)
  }

  private readonly preventNavigation = (event: Electron.Event) => {
    event.preventDefault()
    this.revoke()
  }

  private readonly startedNavigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (!event.isMainFrame || event.isSameDocument) return
    if (this.state === 'initial' && sameEntry(event.url, this.entry)) { this.state = 'loading'; return }
    this.revoke()
  }

  private readonly finishedLoad = () => {
    if (this.state !== 'loading' || !sameEntry(this.contents.getURL(), this.entry)) { this.revoke(); return }
    this.state = 'ready'
  }

  isReady() { return this.state === 'ready' && !this.contents.isDestroyed() && sameEntry(this.contents.getURL(), this.entry) }

  readonly revoke = () => {
    if (this.state === 'revoked') return
    this.state = 'revoked'
    this.invalidate()
  }

  dispose() {
    this.revoke()
    this.contents.removeListener('will-navigate', this.preventNavigation)
    this.contents.removeListener('will-redirect', this.preventNavigation)
    this.contents.removeListener('did-start-navigation', this.startedNavigation)
    this.contents.removeListener('did-finish-load', this.finishedLoad)
    this.contents.removeListener('render-process-gone', this.revoke)
    this.contents.removeListener('destroyed', this.revoke)
  }
}

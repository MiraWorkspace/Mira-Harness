import { join } from 'node:path'
import { BrowserWindow, screen, type WebContents, type WebContentsView } from 'electron'

type BrowserAction = 'back' | 'forward' | 'reload' | 'stop' | 'external' | 'navigate'
type DetachedAction = 'pin' | 'reattach' | 'minimize' | 'maximize' | 'close' | BrowserAction | { type: 'navigate'; url: string }
type BrowserState = { url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error?: string; faviconUrl?: string | null }
type DetachedOptions = { owner: BrowserWindow; view: WebContentsView; title: string; presentation?: unknown; kind?: 'website' | 'miniapp'; preloadPath?: string; dragOffset?: number; dragSource?: WebContents; browserCommand?: (action: BrowserAction, url?: string) => void | Promise<void>; onReattach: () => void; onClose: () => void }

const windows = new Map<number, DetachedViewWindow>()

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function validIcon(value: unknown): string {
  return typeof value === 'string' && value.length <= 2 * 1024 * 1024 && /^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp|svg\+xml|x-icon|vnd.microsoft.icon);)/i.test(value) ? value : ''
}

function browserToolbar() {
  const svg = (paths: string, size = 17) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
  return `<div class="browser-toolbar" aria-label="浏览器工具栏"><div class="browser-controls"><button type="button" data-action="back" aria-label="后退" title="后退" disabled>${svg('<path d="m12 19-7-7 7-7M5 12h14"/>')}</button><button type="button" data-action="forward" aria-label="前进" title="前进" disabled>${svg('<path d="m12 5 7 7-7 7M5 12h14"/>')}</button><button type="button" data-action="reload" aria-label="刷新页面" title="刷新页面"><span class="reload-icon">${svg('<path d="M3 11a9 9 0 1 1 2.7 6.4M3 4v7h7"/>', 15)}</span><span class="stop-icon" hidden>${svg('<path d="m6 6 12 12M6 18 18 6"/>', 18)}</span></button></div><form class="address-bar">${svg('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>', 13)}<input aria-label="网站地址" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="8192"></form><button type="button" data-action="external" aria-label="在浏览器打开" title="在浏览器打开">${svg('<path d="M15 3h6v6m0-6L10 14M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/>')}</button></div>`
}

function page(title: string, icon: string, kind: 'website' | 'miniapp') {
  const fallback = kind === 'miniapp' ? '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9"/>' : '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'

  return `<!doctype html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
  :root{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#27302a;background:#f7f8f9;color-scheme:light}
  *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:var(--bg)}
  header{height:48px;display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid #e5e7ea;background:#fff;-webkit-app-region:drag}
  body.mac header{padding-left:80px}
  body.mac.fullscreen header{padding-left:16px}
  .window-controls{display:flex;gap:2px;margin-left:-8px;-webkit-app-region:no-drag}
  .window-controls button{display:grid;width:30px;height:30px;padding:0;place-items:center;border:0;border-radius:4px;background:transparent;color:#6c756e;cursor:pointer}
  .window-controls button:hover,.window-controls button:focus-visible{background:#f0f2f3;color:#27302a;outline:none}
  .window-controls button[data-action=close]:hover,.window-controls button[data-action=close]:focus-visible{background:#c42b1c;color:#fff}
  .window-controls [hidden]{display:none}
  body.windows.fullscreen .window-controls{display:none}
  .identity-icon{width:18px;height:18px;flex:none;display:grid;place-items:center;color:#6c756e}.identity-icon img,.identity-icon svg{width:18px;height:18px;object-fit:contain}.identity-icon img[hidden]{display:none}.identity-icon img:not([hidden])+svg{display:none}
  .title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550}
  .actions{position:relative;display:flex;gap:4px;-webkit-app-region:no-drag}.actions button{width:30px;height:30px;border:0;border-radius:7px;background:transparent;color:#6c756e;cursor:pointer;font-size:17px;line-height:1;display:grid;place-items:center}
  body.windows .actions{gap:2px}body.windows .actions button svg{width:14px;height:14px}
  .tooltip{position:absolute;right:calc(100% + 8px);top:50%;transform:translateY(-50%);padding:5px 8px;border-radius:5px;background:#27302a;color:#fff;font-size:12px;white-space:nowrap;pointer-events:none;visibility:hidden;opacity:0;transition:opacity .12s ease;z-index:1}
  .action:hover .tooltip,.action:focus-within .tooltip{visibility:visible;opacity:1}
  .actions button:focus-visible{outline:2px solid #678a78;outline-offset:1px}
  .actions button:hover{background:#f0f2f3;color:#27302a}.actions button[aria-pressed=true]{color:#476b5b;background:#e9f0ec}
  .browser-toolbar{display:flex;height:48px;align-items:center;gap:10px;padding:0 18px;border-bottom:1px solid #e5e7ea;background:#fff;-webkit-app-region:no-drag}
  .browser-controls{display:flex;gap:3px}.browser-toolbar button{display:grid;width:29px;height:29px;flex:none;place-items:center;border:0;border-radius:6px;background:transparent;color:#7d858c;cursor:pointer}
  .browser-toolbar button:hover{background:#f1f3f4;color:#37413a}.browser-toolbar button:disabled{color:#c1c6ca;background:transparent;cursor:default}.browser-toolbar button:focus-visible{outline:2px solid #678a78;outline-offset:1px}
  .browser-toolbar button span{display:grid}.browser-toolbar [hidden]{display:none}
  .address-bar{display:flex;height:30px;min-width:0;flex:1;align-items:center;gap:8px;padding:0 12px;border:1px solid #eceef0;border-radius:6px;background:#f8f9fa;color:#858d94}
  .address-bar:focus-within{border-color:#678a78}.address-bar>svg{flex:none}.address-bar input{width:100%;min-width:0;padding:0;border:0;outline:0;background:transparent;color:#27302a;caret-color:#678a78;font:inherit}
  @media(prefers-color-scheme:dark){.browser-toolbar{border-color:#47484f;background:#303030}.address-bar{border-color:#47484f;background:#292a2e}.address-bar input{color:#f2f3f4}.browser-toolbar button{color:#b7b7bf}.browser-toolbar button:hover{background:#38393f;color:#fff}.browser-toolbar button:disabled{color:#666870;background:transparent}}
  @media(prefers-color-scheme:dark){:root{color:#f2f3f4;background:#292a2e;color-scheme:dark}header{border-color:#47484f;background:#303030}.actions button,.window-controls button{color:#b7b7bf}.actions button:hover,.window-controls button:hover{background:#38393f;color:#fff}.actions button[aria-pressed=true]{color:#a8ccb8;background:#263b31}.window-controls button[data-action=close]:hover,.window-controls button[data-action=close]:focus-visible{background:#c42b1c;color:#fff}}
  </style></head><body class="${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : ''}"><header><span class="identity-icon"><img${icon ? ` src="${escapeHtml(icon)}"` : ''} hidden alt="" referrerpolicy="no-referrer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${fallback}</svg></span><span class="title">${escapeHtml(title || '网页')}</span><div class="actions"><span class="action"><button type="button" data-action="pin" aria-label="固定窗口" aria-pressed="false" aria-describedby="pin-tooltip"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5a4 4 0 0 1-2 3l-1 1v2h14v-2l-1-1a4 4 0 0 1-2-3Z"/><path d="M12 15v7"/></svg></button><span id="pin-tooltip" class="tooltip" role="tooltip">固定窗口</span></span><span class="action"><button type="button" data-action="reattach" aria-label="回到主窗口" aria-describedby="reattach-tooltip"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9m8 5-3 3m0-3v3h3"/></svg></button><span id="reattach-tooltip" class="tooltip" role="tooltip">回到主窗口</span></span></div></header>${kind === 'website' ? browserToolbar() : ''}<script>
  const identityIcon = document.querySelector('.identity-icon img');
  identityIcon.addEventListener('load', () => { identityIcon.hidden = false });
  identityIcon.addEventListener('error', () => { identityIcon.hidden = true });
  if (identityIcon.complete && identityIcon.naturalWidth) identityIcon.hidden = false;

  for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', () => window.miraDetached.command(button.dataset.action));
  const address = document.querySelector('.address-bar input'), form = document.querySelector('.address-bar');
  let currentUrl = '';
  address?.addEventListener('input', () => address.setCustomValidity(''));
  address?.addEventListener('blur', () => { address.value = currentUrl; address.setCustomValidity(''); });
  address?.addEventListener('keydown', event => { if (event.key === 'Escape') { address.value = currentUrl; address.setCustomValidity(''); address.blur(); } });
  form?.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const draft = address.value.trim(), url = new URL(draft.includes('://') ? draft : 'https://' + draft);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error();
      currentUrl = url.href; address.value = currentUrl; address.blur();
      window.miraDetached.command({ type:'navigate', url:currentUrl });
    } catch { address.setCustomValidity('请输入有效的 HTTP 或 HTTPS 网站地址，且不能包含账号密码。'); address.reportValidity(); }
  });
  window.miraDetached.onState(state => {
    if (typeof state.icon === 'string' && state.icon !== (identityIcon.getAttribute('src') || '')) {
      identityIcon.hidden = true;
      if (state.icon) identityIcon.src = state.icon; else identityIcon.removeAttribute('src');
    }
    if (typeof state.fullScreen === 'boolean') document.body.classList.toggle('fullscreen', state.fullScreen);
    const maximize = document.querySelector('[data-action=maximize]');
    if (maximize && typeof state.maximized === 'boolean') { maximize.title = state.maximized ? '还原' : '最大化'; maximize.setAttribute('aria-label', maximize.title); maximize.querySelector('.maximize-icon').hidden = state.maximized; maximize.querySelector('.restore-icon').hidden = !state.maximized; }
    if (address && state.browser) {
      const browser = state.browser; currentUrl = browser.url;
      if (document.activeElement !== address) address.value = currentUrl;
      document.querySelector('[data-action=back]').disabled = !browser.canGoBack;
      document.querySelector('[data-action=forward]').disabled = !browser.canGoForward;
      const refresh = document.querySelector('[data-action=reload], [data-action=stop]');
      refresh.dataset.action = browser.loading ? 'stop' : 'reload'; refresh.title = browser.loading ? '停止加载' : '刷新页面'; refresh.setAttribute('aria-label', refresh.title);
      refresh.querySelector('.reload-icon').hidden = browser.loading; refresh.querySelector('.stop-icon').hidden = !browser.loading;
      address.title = browser.error || browser.url;
    }
    if (address && state.error) { address.setCustomValidity(state.error); address.reportValidity(); }
    const button = document.querySelector('[data-action=pin]'); if (button && typeof state.pinned === 'boolean') { button.setAttribute('aria-pressed', String(Boolean(state.pinned))); button.setAttribute('aria-label', state.pinned ? '取消固定窗口' : '固定窗口'); document.querySelector('#pin-tooltip').textContent = button.getAttribute('aria-label'); } });
  </script></body></html>`.replace('</header>', `${process.platform === 'win32' ? `<div class="window-controls" aria-label="窗口控制"><button type="button" data-action="minimize" title="最小化" aria-label="最小化"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button><button type="button" data-action="maximize" title="最大化" aria-label="最大化"><svg class="maximize-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg><svg class="restore-icon" hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button><button type="button" data-action="close" title="关闭" aria-label="关闭"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>` : ''}</header>`)
}

export class DetachedViewWindow {
  private readonly window: BrowserWindow
  private released = false
  private pinned = false
  private browserState?: BrowserState
  private icon: string
  private dragTimer?: ReturnType<typeof setInterval>
  private releaseSource?: () => void

  constructor(private readonly options: DetachedOptions) {
    const presentation = options.presentation && typeof options.presentation === 'object' ? options.presentation as Record<string, unknown> : {}
    const title = typeof presentation.title === 'string' && presentation.title.trim() ? presentation.title.slice(0, 512) : options.title || '网页'
    const icon = this.icon = validIcon(presentation.icon)
    const [ownerMinWidth, ownerMinHeight] = options.owner.getMinimumSize()
    const width = Math.max(480, ownerMinWidth), height = Math.max(320, ownerMinHeight)
    this.window = new BrowserWindow({
      width,
      height,
      minWidth: width,
      minHeight: height,
      title,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 17 } } : {}),
      ...(process.platform === 'win32' ? { frame: false, titleBarStyle: 'hidden' as const, autoHideMenuBar: true } : {}),
      show: false,
      opacity: options.dragOffset === undefined ? 0 : 1,
      webPreferences: { preload: options.preloadPath || join(__dirname, '../preload/detachedView.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    })
    if (process.platform === 'win32') {
      this.window.setMenuBarVisibility(false)
    }
    windows.set(this.window.webContents.id, this)
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.window.webContents.on('will-navigate', event => event.preventDefault())
    this.window.webContents.on('did-finish-load', () => this.sendState())
    this.window.on('resize', () => this.layout())
    this.window.on('maximize', () => this.sendState())
    this.window.on('unmaximize', () => this.sendState())
    this.window.on('enter-full-screen', () => { this.sendState(); this.layout() })
    this.window.on('leave-full-screen', () => { this.sendState(); this.layout() })
    this.window.on('close', () => {
      if (this.released) return
      this.released = true
      this.endDrag(false)
      this.window.contentView.removeChildView(options.view)
      options.onClose()
    })
    const windowId = this.window.webContents.id
    const ownerClosed = () => { if (!this.window.isDestroyed()) this.window.close() }
    this.window.on('closed', () => { this.endDrag(false); windows.delete(windowId); options.owner.removeListener('closed', ownerClosed) })
    options.owner.once('closed', ownerClosed)
    options.owner.contentView.removeChildView(options.view)
    this.window.contentView.addChildView(options.view)
    void this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(title, icon, options.kind || 'website'))}`)
    this.layout()
    if (options.dragOffset === undefined) this.window.once('ready-to-show', () => this.fadeIn())
    else this.beginDrag()
  }

  private beginDrag() {
    // The source keeps pointer capture; showing without activation preserves the held gesture.
    // Poll Electron's DIP cursor coordinates so tracking also works outside the source window.
    const frameTop = this.window.getContentBounds().y - this.window.getBounds().y
    const offsetY = process.platform === 'darwin' ? 24 : frameTop > 0 ? frameTop / 2 : 24
    const move = () => {
      const point = screen.getCursorScreenPoint()
      this.window.setPosition(Math.round(point.x - this.window.getBounds().width / 2), Math.round(point.y - offsetY), false)
    }
    move()
    this.window.showInactive()
    this.dragTimer = setInterval(move, 16)
    const source = this.options.dragSource
    if (source) {
      const end = () => this.endDrag(false)
      source.once('destroyed', end)
      source.once('render-process-gone', end)
      source.once('will-navigate', end)
      this.releaseSource = () => {
        source.removeListener('destroyed', end)
        source.removeListener('render-process-gone', end)
        source.removeListener('will-navigate', end)
      }
    }
  }

  endDrag(focus = true) {
    if (!this.dragTimer) return
    clearInterval(this.dragTimer); this.dragTimer = undefined
    this.releaseSource?.(); this.releaseSource = undefined
    if (focus && !this.window.isDestroyed()) this.window.focus()
  }

  private fadeIn() {
    if (this.window.isDestroyed()) return
    this.window.show()
    let frame = 0
    const timer = setInterval(() => {
      if (this.window.isDestroyed()) { clearInterval(timer); return }
      frame = Math.min(9, frame + 1)
      const progress = frame / 9, opacity = 1 - (1 - progress) ** 3
      this.window.setOpacity(opacity)
      if (frame === 9) clearInterval(timer)
    }, 16)
  }

  private layout() {
    if (this.window.isDestroyed()) return
    const [width, height] = this.window.getContentSize()
    const top = this.options.browserCommand ? 96 : 48
    this.options.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) })
  }

  command(action: DetachedAction) {
    if (action === 'pin') {
      this.pinned = !this.pinned
      this.window.setAlwaysOnTop(this.pinned)
      this.sendState()
    } else if (action === 'reattach') this.reattach()
    else if (action === 'minimize') this.window.minimize()
    else if (action === 'maximize') this.window.isMaximized() ? this.window.unmaximize() : this.window.maximize()
    else if (action === 'close') this.window.close()
    else if (this.options.browserCommand) {
      const command = typeof action === 'string' ? action : action.type
      const url = typeof action === 'object' ? action.url : undefined
      void Promise.resolve().then(() => this.options.browserCommand!(command as BrowserAction, url)).catch(error => {
        if (!this.window.isDestroyed()) this.window.webContents.send('mira:detached-state', { error: error instanceof Error ? error.message : String(error) })
      })
    }
  }

  updateBrowserState(state: BrowserState) { this.browserState = state; this.sendState() }

  updatePresentation(value: unknown) {
    if (!value || typeof value !== 'object') return
    this.icon = validIcon((value as Record<string, unknown>).icon)
    this.sendState()
  }

  private sendState() {
    if (!this.window.isDestroyed()) this.window.webContents.send('mira:detached-state', { pinned: this.pinned, browser: this.browserState, icon: this.icon || validIcon(this.browserState?.faviconUrl), fullScreen: this.window.isFullScreen(), maximized: this.window.isMaximized() })
  }

  dispose() {
    if (this.released || this.window.isDestroyed()) return
    this.released = true
    this.endDrag(false)
    this.window.contentView.removeChildView(this.options.view)
    this.window.close()
  }

  reattach() {
    if (this.released || this.window.isDestroyed()) return
    this.released = true
    this.endDrag(false)
    this.window.contentView.removeChildView(this.options.view)
    if (!this.options.owner.isDestroyed()) this.options.owner.contentView.addChildView(this.options.view)
    this.options.onReattach()
    this.window.close()
    if (!this.options.owner.isDestroyed()) { this.options.owner.show(); this.options.owner.focus() }
  }
}

export function handleDetachedViewCommand(sender: WebContents, action: unknown) {
  const window = windows.get(sender.id)
  if (!window) return
  if (typeof action === 'string' && ['pin', 'reattach', 'minimize', 'maximize', 'close', 'back', 'forward', 'reload', 'stop', 'external'].includes(action)) window.command(action as DetachedAction)
  else if (action && typeof action === 'object' && (action as Record<string, unknown>).type === 'navigate' && typeof (action as Record<string, unknown>).url === 'string') window.command(action as { type: 'navigate'; url: string })
}

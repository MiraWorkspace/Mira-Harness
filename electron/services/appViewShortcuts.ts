import type { BrowserWindow, WebContents } from 'electron'

/** Native app and browser views do not bubble keyboard events to the shell. */
export function bindAppViewShortcuts(owner: BrowserWindow, contents: WebContents) {
  const relay = (event: Electron.Event, input: Electron.Input) => {
    const primary = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
    const key = input.key.toLowerCase()
    if (!primary || input.alt || input.isComposing || !(input.shift ? ['p', 'l'].includes(key) : ['k', ',', 'i'].includes(key))) return
    event.preventDefault()
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    const send = () => {
      if (!owner.isDestroyed() && !contents.isDestroyed()) owner.webContents.send('window:shortcut', { key: input.key, code: input.code, metaKey: input.meta, ctrlKey: input.control, shiftKey: input.shift, altKey: input.alt })
    }
    if (key === 'l') {
      // Keep the existing theme shortcut's text-editing and modal exclusions.
      void contents.executeJavaScript(`Boolean(document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .xterm')) || [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], .el-dialog, .el-drawer')].some(element => element.getClientRects().length > 0)`).then(blocked => { if (!blocked) send() }).catch(() => undefined)
    } else send()
  }
  contents.on('before-input-event', relay)
  return () => contents.removeListener('before-input-event', relay)
}

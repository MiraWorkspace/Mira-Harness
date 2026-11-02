// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageMarkdown } from '../apps/harness-react/src/components/conversation/markdown'

let root: Root, container: HTMLDivElement
const sources = [
  { index: 1, title: '平台防骗提醒', snippet: '请通过官方渠道办理。', url: 'https://example.com/scam-alert' },
  { index: 2, title: '广告运营规范', url: 'https://example.com/ads' },
]
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); container.id = 'root'; document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const marker = (index = 0) => container.querySelectorAll<HTMLButtonElement>('.citation-marker button')[index]
const preview = () => container.querySelector<HTMLElement>('.pilot-citation')
const pause = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 180)) })
const pointer = (element: Element, type: string, relatedTarget: EventTarget | null = null) => act(async () => { element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse', relatedTarget })) })
async function render(content = '正文[1]，另一处[1]，其他来源[2]。', onOpenLink = vi.fn()) {
  await act(async () => root.render(<MessageMarkdown content={content} sources={sources} onOpenLink={onOpenLink} />))
  return onOpenLink
}

describe('conversation citation hover previews', () => {
  it('opens beside the hovered marker in a portal and stays open while the pointer enters the card', async () => {
    await render()
    expect(preview()).toBeNull()
    await pointer(marker(), 'pointerover')
    await pause()
    expect(preview()?.textContent).toContain('平台防骗提醒')
    expect(preview()?.textContent).toContain('请通过官方渠道办理。')
    expect(preview()?.closest('[data-radix-popper-content-wrapper]')).not.toBeNull()
    expect(container.querySelector('.message-markdown .pilot-citation')).toBeNull()
    expect(marker().getAttribute('aria-controls')).toBe(preview()?.id)
    expect(document.activeElement).not.toBe(preview()?.querySelector('a'))
    await pointer(marker(), 'pointerout', preview())
    await pointer(preview()!, 'pointerover', marker())
    await pause()
    expect(preview()).not.toBeNull()
    await pointer(preview()!, 'pointerout', document.body)
    await pause()
    expect(preview()).toBeNull()
  })

  it('reanchors repeated and different citations and cancels a preview when the pointer leaves early', async () => {
    await render()
    await pointer(marker(), 'pointerover')
    await pointer(marker(), 'pointerout', document.body)
    await pause()
    expect(preview()).toBeNull()
    await act(async () => marker().focus())
    expect(preview()?.textContent).toContain('平台防骗提醒')
    await act(async () => marker(1).focus())
    expect(marker().hasAttribute('aria-controls')).toBe(false)
    expect(marker(1).getAttribute('aria-controls')).toBe(preview()?.id)
    await act(async () => marker(2).focus())
    expect(preview()?.textContent).toContain('广告运营规范')
    expect(preview()?.textContent).not.toContain('请通过官方渠道办理。')
  })

  it('supports keyboard focus, entering the source link, returning to the marker and Escape', async () => {
    await render()
    await act(async () => marker().focus())
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    await act(async () => marker().dispatchEvent(tab))
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(preview()?.querySelector('a'))
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(marker())
    expect(preview()).not.toBeNull()
    await act(async () => marker().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(preview()).toBeNull()
    expect(document.activeElement).toBe(marker())
  })

  it('routes links from the portaled preview through the existing callback, including modified and middle clicks', async () => {
    const openLink = await render()
    await act(async () => marker().click())
    const link = preview()?.querySelector('a')
    expect(link).toBeTruthy()
    for (const [type, options] of [['click', { metaKey: true }], ['auxclick', { button: 1 }]] as const) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...options })
      await act(async () => link!.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(true)
    }
    expect(openLink.mock.calls).toEqual([[sources[0].url], [sources[0].url]])
  })

  it('dismisses on outside focus without moving focus back and clears previews when the message changes', async () => {
    await render()
    await act(async () => marker().focus())
    const outside = document.createElement('button'); container.append(outside)
    await act(async () => outside.focus())
    await pause()
    expect(preview()).toBeNull()
    expect(document.activeElement).toBe(outside)
    await act(async () => marker().focus())
    await render('更新后的正文[2]')
    expect(preview()).toBeNull()
    await pointer(marker(), 'pointerover')
    await act(async () => root.render(<MessageMarkdown content="没有引用" />))
    await pause()
    expect(preview()).toBeNull()
  })
})

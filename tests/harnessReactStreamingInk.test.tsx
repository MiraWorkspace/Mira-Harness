// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageMarkdown } from '../apps/harness-react/src/components/conversation/markdown'
import { miraCodeHighlighter } from '../apps/harness-react/src/lib/code-highlighter'

let root: Root, container: HTMLDivElement
let now: number, frameId: number, frames: Map<number, FrameRequestCallback>
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  now = 0; frameId = 0; frames = new Map()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.spyOn(miraCodeHighlighter, 'highlight').mockImplementation(async ({ code }) => ({ tokens: code.split('\n').map(content => [{ content, offset: 0 }]) }))
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); expect(frames.size).toBe(0); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const render = (content: string, streaming = true) => act(async () => root.render(<MessageMarkdown content={content} streaming={streaming} sources={[{ index: 1, title: '来源', url: 'https://example.com' }]} />))
const characters = () => [...container.querySelectorAll<HTMLElement>('span[data-sd-animate]')]
const advance = async (milliseconds: number) => {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 16) {
    now += 16
    const callbacks = [...frames.values()]; frames.clear()
    await act(async () => callbacks.forEach(callback => callback(now)))
  }
}

describe('streaming ink reveal', () => {
  it('reveals individual Chinese and Latin characters in order while preserving spaces and Markdown semantics', async () => {
    await render('水墨 **渐显**，A🙂 [来源](https://example.com)')
    expect(characters().slice(0, 8).map(node => node.textContent)).toEqual(['水', '墨 ', '渐', '显', '，', 'A', '🙂 ', '来'])
    expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe('渐显')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/')
    expect(container.textContent).toBe('水墨 渐显，A🙂 来源')
    const delays = characters().map(node => Number.parseFloat(node.style.getPropertyValue('--sd-delay')) || 0)
    expect(delays[0]).toBe(0)
    expect(delays[1]).toBeGreaterThan(delays[0])
    expect(delays.every((delay, index) => index === 0 || delay > delays[index - 1])).toBe(true)
  })

  it('lets existing characters finish their reveal when the next batch arrives', async () => {
    await render('水墨')
    const original = characters()
    const styles = original.map(node => node.getAttribute('style'))
    await render('水墨晕染')
    await advance(64)
    expect(characters().slice(0, 2)).toEqual(original)
    expect(original.map(node => node.getAttribute('style'))).toEqual(styles)
    expect(characters().slice(2).map(node => node.textContent)).toEqual(['晕', '染'])
    expect(characters().slice(2).every(node => Number.parseFloat(node.style.getPropertyValue('--sd-duration')) > 0)).toBe(true)
    await render('水墨晕染')
    expect(characters().slice(0, 2)).toEqual(original)
  })

  it('paces a burst in small steps without starving under frequent incoming updates', async () => {
    await render('开')
    const content = '开始' + '连续平稳输出'.repeat(8)
    await render(content)
    expect(container.textContent).toBe('开')
    await advance(64)
    expect(container.textContent!.length).toBeGreaterThan(1)
    expect(container.textContent!.length).toBeLessThan(12)
    for (let index = 1; index <= 10; index++) {
      await render(content + '字'.repeat(index))
      await advance(16)
    }
    expect(container.textContent!.length).toBeGreaterThan(8)
    await advance(1200)
    expect(container.textContent).toBe(content + '字'.repeat(10))
    expect(frames.size).toBe(0)
  })

  it('does not cut surrogate pairs and flushes buffered text on completion or replacement', async () => {
    await render('水')
    await render('水🙂墨')
    await advance(32)
    expect(container.textContent).toBe('水🙂')
    await render('水🙂墨', false)
    expect(container.querySelector('.pilot-markdown')?.textContent).toBe('水🙂墨\n')
    expect(frames.size).toBe(0)
    await render('替换后的内容')
    expect(container.textContent).toBe('替换后的内容')
  })

  it('catches up on a large burst instead of playing a long typewriter queue', async () => {
    await render('开')
    const content = '开' + '字'.repeat(1000)
    await render(content)
    await advance(64)
    expect(container.textContent!.length).toBeGreaterThan(100)
    expect(container.textContent!.length).toBeLessThan(400)
    await advance(1600)
    expect(container.textContent).toBe(content)
  })

  it('flushes pending text when reduced motion is enabled', async () => {
    const motion = Object.assign(new EventTarget(), { matches: false })
    vi.spyOn(window, 'matchMedia').mockReturnValue(motion as MediaQueryList)
    await render('开')
    await render('开始平稳输出这段文字')
    await act(async () => { motion.matches = true; motion.dispatchEvent(new Event('change')) })
    expect(container.textContent).toBe('开始平稳输出这段文字')
    expect(frames.size).toBe(0)
    await render('开始平稳输出这段文字，无动画等待')
    expect(container.textContent).toBe('开始平稳输出这段文字，无动画等待')
  })

  it('flushes pending text when the document is hidden', async () => {
    await render('开')
    await render('开始平稳输出这段文字')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(container.textContent).toBe('开始平稳输出这段文字')
    expect(frames.size).toBe(0)
  })

  it('does not split fenced code into animated characters and keeps its exact copy payload', async () => {
    const code = '  const answer = "<safe>";\n\n'
    await render(`说明文字\n\n\`\`\`javascript\n${code}\`\`\``)
    expect(characters().some(node => node.textContent === '说')).toBe(true)
    expect(container.querySelector('[data-streamdown="code-block-body"] [data-sd-animate]')).toBeNull()
    expect(container.querySelector('[data-streamdown="code-block-body"]')?.textContent).toBe(code)
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-streamdown="code-block-copy-button"]')!.click())
    expect(copy).toHaveBeenCalledExactlyOnceWith(code)
  })

  it('settles all text and restores citation controls when streaming completes', async () => {
    await render('逐字输出[1]')
    expect(characters().length).toBeGreaterThan(0)
    await render('逐字输出[1]', false)
    expect(characters()).toHaveLength(0)
    expect(container.querySelector('.citation-marker button')?.textContent).toBe('[1]')
    expect(container.querySelector('.pilot-markdown')?.textContent).toBe('逐字输出[1]\n')
  })
})

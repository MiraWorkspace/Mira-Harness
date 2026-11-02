import { cloneElement, isValidElement, useContext, useEffect, useId, useMemo, useRef, useState, type ComponentProps, type MouseEvent, type ReactElement } from 'react'
import * as Popover from '@radix-ui/react-popover'
import MarkdownIt from 'markdown-it'
import { MiraConversationContext } from './MiraConversationMessages'
import { miraFileTreeIcon } from '../../lib/mira-file-tree-icon'
import { miraMessageLink } from '../../lib/mira-message-links'
import { cjk } from '@streamdown/cjk'
import { Streamdown, defaultRehypePlugins, type AnimateOptions, type Components, type ExtraProps } from 'streamdown'
import { RotateCw } from 'lucide-react'
import type { HarnessSource } from '../../../../../src/config/harness'
import { installHarnessCitations } from '../../../../../src/utils/harnessCitations'
import { miraCodeHighlighter, miraCodeThemes, renderMiraHighlightedCode } from '../../lib/code-highlighter'
import type { MiraHighlightResult } from '../../lib/code-highlight-protocol'
import { MiraMarkdownCode } from './MiraStreamingCode'

// 流式管线：streamdown（CJK 断行 + shiki 代码高亮）。
// 两种状态共用 Worker 高亮缓存；完成态继续保留引用角标与代码复制按钮。
const staticMarkdown = new MarkdownIt({ html: false, breaks: true, linkify: true })
staticMarkdown.renderer.rules.table_open = () => '<div class="markdown-table-scroll" tabindex="0" role="region" aria-label="表格"><table>\n'
staticMarkdown.renderer.rules.table_close = () => '</table></div>\n'
const validateMarkdownLink = staticMarkdown.validateLink.bind(staticMarkdown)
staticMarkdown.validateLink = href => /^file:/i.test(href) ? Boolean(miraMessageLink(href)) : validateMarkdownLink(href)
const blockKey = (language: string, code: string) => JSON.stringify([language, code])
staticMarkdown.renderer.rules.fence = (tokens, index, _options, environment) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/)[0] || 'text'
  const className = token.info ? ` class="${staticMarkdown.utils.escapeHtml('language-' + token.info.trim())}"` : ''
  const highlighted = (environment?.highlights as Map<string, MiraHighlightResult> | undefined)?.get(blockKey(language, token.content)) || miraCodeHighlighter.getCached({ code: token.content, language, themes: miraCodeThemes })
  const code = highlighted ? renderMiraHighlightedCode(highlighted, language) : `<pre><code${className}>${staticMarkdown.utils.escapeHtml(token.content)}</code></pre>`
  return `<div class="markdown-code-block"><button type="button" class="markdown-code-copy" data-code="${encodeURIComponent(token.content)}" aria-label="复制代码" title="复制代码"><svg class="markdown-code-copy__icon" aria-hidden="true" viewBox="0 0 1024 1024"><path fill="currentColor" d="M768 832a128 128 0 0 1-128 128H192A128 128 0 0 1 64 832V384a128 128 0 0 1 128-128v64a64 64 0 0 0-64 64v448a64 64 0 0 0 64 64h448a64 64 0 0 0 64-64z"/><path fill="currentColor" d="M384 128a64 64 0 0 0-64 64v448a64 64 0 0 0 64 64h448a64 64 0 0 0 64-64V192a64 64 0 0 0-64-64zm0-64h448a128 128 0 0 1 128 128v448a128 128 0 0 1-128 128H384a128 128 0 0 1-128-128V192A128 128 0 0 1 384 64"/></svg></button>${code}</div>\n`
}
installHarnessCitations(staticMarkdown)
const defaultLinkOpen = staticMarkdown.renderer.rules.link_open ?? ((tokens, index, options, _env, renderer) => renderer.renderToken(tokens, index, options))
staticMarkdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const link = miraMessageLink(String(tokens[index].attrGet('href') || ''), typeof env?.directory === 'string' ? env.directory : undefined)
  if (link?.kind !== 'file') return defaultLinkOpen(tokens, index, options, env, renderer)
  tokens[index].attrJoin('class', 'mira-message-file-link')
  return defaultLinkOpen(tokens, index, options, env, renderer) + `<img src="${staticMarkdown.utils.escapeHtml(miraFileTreeIcon(link.target))}" width="16" height="16" alt="" aria-hidden="true" />`
}
function MessageLink({ href, children }: { href?: string; children?: import('react').ReactNode }) {
  const conversation = useContext(MiraConversationContext)
  const link = miraMessageLink(href || '', conversation.session?.workingDirectory)
  return <a href={href} className={link?.kind === 'file' ? 'mira-message-file-link' : undefined}>{link?.kind === 'file' && <img src={miraFileTreeIcon(link.target)} width={16} height={16} alt="" aria-hidden="true" />}{children}</a>
}


// Rewrite local targets before Streamdown hardening, while keeping its sanitizers.
function rewriteMessageFileLinks(options: { directory?: string }) {
  type LinkNode = { tagName?: string; properties?: { href?: unknown }; children?: LinkNode[] }
  return (tree: LinkNode) => {
    const visit = (node: LinkNode) => {
      const href = node.properties?.href
      if (node.tagName === 'a' && typeof href === 'string') {
        const link = miraMessageLink(href, options.directory)
        if (link?.kind === 'file') node.properties!.href = /^[a-z]:/i.test(link.target) ? '/' + link.target : link.target
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
const streamdownPlugins = { cjk }
const streamingInk: AnimateOptions = { animation: 'mira-ink', sep: 'char', duration: 280, stagger: 18, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', maxBacklogMs: 160 }
function InkSpan({ node: _node, style, ...props }: ComponentProps<'span'> & ExtraProps) {
  // Streamdown settles old spans on every update; let each mounted character finish instead.
  const entrance = useRef(style)
  return <span {...props} style={'data-sd-animate' in props ? entrance.current : style} />
}
const streamdownComponents: Components = {
  code: MiraMarkdownCode,
  span: InkSpan,
  a: ({ href, children }) => <MessageLink href={href}>{children}</MessageLink>,
  // 保留 Streamdown 的块级标记，无语言代码围栏也不能被当成 inline code。
  pre: ({ children }) => isValidElement(children) ? cloneElement(children as ReactElement<{ 'data-block'?: string }>, { 'data-block': 'true' }) : <>{children}</>,
}

function useInkText(content: string, streaming?: boolean) {
  const [shown, setShown] = useState(content)
  const cursor = useRef({ text: content, time: undefined as number | undefined, credit: 0 })
  useEffect(() => {
    const state = cursor.current
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const settle = () => {
      cancelAnimationFrame(frame)
      state.text = content; state.time = undefined; state.credit = 0; setShown(content)
    }
    if (!streaming || document.hidden || motion.matches || !content.startsWith(state.text)) { settle(); return }
    if (state.text === content) return
    state.time ??= performance.now()
    const step = (now: number) => {
      // ~55 characters/second normally; large bursts catch up rather than build a long queue.
      state.credit += Math.max(0, now - state.time!) * Math.max(.055, (content.length - state.text.length) / 320)
      state.time = now
      const count = Math.floor(state.credit)
      if (count > 0) {
        state.credit -= count
        let end = Math.min(content.length, state.text.length + count)
        if (end < content.length && /[\uDC00-\uDFFF]/.test(content[end])) end++
        state.text = content.slice(0, end); setShown(state.text)
      }
      if (state.text.length < content.length) frame = requestAnimationFrame(step)
      else { state.time = undefined; state.credit = 0 }
    }
    const skipMotion = () => { if (document.hidden || motion.matches) settle() }
    frame = requestAnimationFrame(step)
    document.addEventListener('visibilitychange', skipMotion)
    motion.addEventListener('change', skipMotion)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', skipMotion); motion.removeEventListener('change', skipMotion) }
  }, [content, streaming])
  return streaming && content.startsWith(shown) ? shown : content
}

export const renderCompletedMarkdown = (content: string, sources?: HarnessSource[], highlights?: Map<string, MiraHighlightResult>, directory?: string) => staticMarkdown.render(content, { sources, highlights, directory })
export async function prepareMarkdownHighlights(content: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const fences = staticMarkdown.parse(content, {}).filter(token => token.type === 'fence')
  const blocks = new Array<readonly [string, MiraHighlightResult]>(fences.length)
  let next = 0
  let failed = false
  // 长历史消息可能含数百代码块；限制提交量而非丢掉围栏或压缩源码。
  await Promise.all(Array.from({ length: Math.min(4, fences.length) }, async () => {
    while (!failed && next < fences.length) {
      signal?.throwIfAborted()
      const index = next++
      const token = fences[index]
      const language = token.info.trim().split(/\s+/)[0] || 'text'
      try {
        blocks[index] = [blockKey(language, token.content), await miraCodeHighlighter.highlight({ code: token.content, language, themes: miraCodeThemes }, signal)]
      } catch (error) { failed = true; throw error }
    }
  }))
  signal?.throwIfAborted()
  return new Map(blocks)
}

export function MessageMarkdown({ content, sources, streaming, directory, onOpenLink }: { content: string; sources?: HarnessSource[]; streaming?: boolean; directory?: string; onOpenLink?: (url: string) => void }) {
  const conversation = useContext(MiraConversationContext)
  const inkText = useInkText(content, streaming)
  const linkDirectory = directory ?? conversation.session?.workingDirectory
  const messageRehypePlugins = useMemo(() => [[rewriteMessageFileLinks, { directory: linkDirectory }] as [typeof rewriteMessageFileLinks, { directory?: string }], ...Object.values(defaultRehypePlugins)], [linkDirectory])
  const handleLink = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null
    const anchor = target?.closest('a[href]')
    // Citation previews use a portal but keep this message's controlled link routing.
    if (!anchor) return
    // Cancel synchronously, including modifier/middle clicks, before any renderer handler.
    event.preventDefault(); event.stopPropagation()
    if (event.type === 'auxclick' && event.button !== 1) return
    const link = miraMessageLink(anchor.getAttribute('href') || '', directory ?? conversation.session?.workingDirectory)
    if (!link) return
    try {
      if (link.kind === 'anchor') {
        const id = decodeURIComponent(link.target.slice(1))
        const destination = [...event.currentTarget.querySelectorAll('[id]')].find(element => element.id === id)
        destination?.scrollIntoView?.({ block: 'nearest' })
      } else if (link.kind === 'web') {
        if (onOpenLink) onOpenLink(link.target)
        else if (conversation.active) conversation.openLink?.(link.target)
      } else if (conversation.active) {
        const root = conversation.session?.workingDirectory?.replace(/\\/g, '/').replace(/\/$/, '')
        const inside = root && (/^[a-z]:/i.test(root) ? link.target.toLowerCase().startsWith(root.toLowerCase() + '/') : link.target.startsWith(root + '/'))
        if (!inside) { conversation.controller?.reportError('文件链接不在当前任务工作目录中'); return }
        conversation.openFile(link.target.slice(root.length + 1))
      }
    } catch (error) { conversation.controller?.reportError(error) }
  }
  return <div className="min-w-0" onClickCapture={handleLink} onAuxClickCapture={handleLink}>
    {streaming ? <div className="message-markdown mira-streaming-ink size-full text-ui-base leading-[1.75] tracking-wide [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <Streamdown mode="streaming" parseIncompleteMarkdown components={streamdownComponents} rehypePlugins={messageRehypePlugins} urlTransform={href => miraMessageLink(href, directory ?? conversation.session?.workingDirectory) ? href : ''} plugins={streamdownPlugins} shikiTheme={miraCodeThemes} animated={streamingInk} isAnimating>{inkText}</Streamdown>
    </div> : <StaticMarkdown content={content} sources={sources} directory={linkDirectory} />}
  </div>
}

function StaticMarkdown({ content, sources, directory }: { content: string; sources?: HarnessSource[]; directory?: string }) {
  const [highlighted, setHighlighted] = useState<{ content: string; blocks: Map<string, MiraHighlightResult> }>()
  const [highlightFailure, setHighlightFailure] = useState<string>()
  const [retry, setRetry] = useState(0)
  const highlightVersion = useRef(0)
  const html = useMemo(() => renderCompletedMarkdown(content, sources, highlighted?.content === content ? highlighted.blocks : undefined, directory), [content, sources, highlighted, directory])
  useEffect(() => {
    const cancellation = new AbortController()
    const version = ++highlightVersion.current
    setHighlightFailure(undefined)
    void prepareMarkdownHighlights(content, cancellation.signal).then(blocks => {
      if (!cancellation.signal.aborted && version === highlightVersion.current && blocks.size) setHighlighted({ content, blocks })
    }).catch(error => {
      if (cancellation.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return
      // 着色失败仍保留已转义的完整正文、引用和复制入口，不把异常抛到 React。
      if (version === highlightVersion.current) setHighlightFailure(content)
    })
    return () => cancellation.abort()
  }, [content, retry])
  const [citation, setCitation] = useState<{ source: HarnessSource; marker: HTMLButtonElement }>()
  const citationAnchor = useRef<HTMLButtonElement | null>(null)
  const citationContent = useRef<HTMLDivElement>(null)
  const citationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const citationId = useId()
  const cancelCitationTimer = () => clearTimeout(citationTimer.current)
  const closeCitation = () => { cancelCitationTimer(); setCitation(undefined) }
  const citationMarker = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLButtonElement>('.citation-marker button') : null
  function showCitation(marker: HTMLButtonElement, delay = 0) {
    cancelCitationTimer()
    const source = sources?.find(item => item.index === Number(marker.dataset.citationIndex))
    if (!source) return
    const open = () => { citationAnchor.current = marker; setCitation(current => current?.marker === marker && current.source === source ? current : { source, marker }) }
    if (delay) citationTimer.current = setTimeout(open, delay)
    else open()
  }
  function scheduleCitationClose() {
    cancelCitationTimer()
    citationTimer.current = setTimeout(() => { if (!citationContent.current?.contains(document.activeElement)) setCitation(undefined) }, 120)
  }
  useEffect(() => { closeCitation(); return cancelCitationTimer }, [html, sources])
  useEffect(() => {
    if (!citation) return
    const marker = citation.marker
    marker.setAttribute('aria-expanded', 'true'); marker.setAttribute('aria-controls', citationId)
    return () => { marker.removeAttribute('aria-expanded'); marker.removeAttribute('aria-controls') }
  }, [citation, citationId])
  async function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const marker = citationMarker(target)
    if (marker) {
      showCitation(marker)
      return
    }
    const copyButton = target.closest<HTMLButtonElement>('.markdown-code-copy')
    if (!copyButton?.dataset.code) return
    try {
      await navigator.clipboard.writeText(decodeURIComponent(copyButton.dataset.code))
      copyButton.dataset.copied = 'true'
      copyButton.setAttribute('aria-label', '已复制代码')
      window.setTimeout(() => { delete copyButton.dataset.copied; copyButton.setAttribute('aria-label', '复制代码') }, 1600)
    } catch { /* 剪贴板不可用时保持按钮原状 */ }
  }
  return <div className="message-markdown size-full text-ui-base leading-[1.75] tracking-wide [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
    <div className="pilot-markdown [&_.citation-marker_button]:leading-normal!" onClick={event => void handleClick(event)} onPointerOver={event => {
      const marker = citationMarker(event.target)
      if (marker && !marker.contains(event.relatedTarget as Node | null)) showCitation(marker, 120)
    }} onPointerOut={event => {
      const marker = citationMarker(event.target)
      if (marker && !marker.contains(event.relatedTarget as Node | null)) scheduleCitationClose()
    }} onFocusCapture={event => { const marker = citationMarker(event.target); if (marker) showCitation(marker) }} onBlurCapture={event => {
      if (citationMarker(event.target) && !citationContent.current?.contains(event.relatedTarget)) scheduleCitationClose()
    }} onKeyDown={event => {
      if (!citationMarker(event.target) || !citation || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCitation() }
      else if (event.key === 'Tab' && !event.shiftKey && citationContent.current?.querySelector('a')) {
        event.preventDefault(); event.stopPropagation(); citationContent.current.querySelector('a')!.focus({ preventScroll: true })
      }
    }} dangerouslySetInnerHTML={{ __html: html }} />
    {highlightFailure === content && <div data-mira-find-ignore className="flex items-center gap-2 text-xs text-foreground-subtle" role="alert"><span>代码高亮失败</span><button type="button" title="重试代码高亮" aria-label="重试代码高亮" className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" onClick={() => setRetry(value => value + 1)}><RotateCw size={14} /></button></div>}
    <Popover.Root open={Boolean(citation)} onOpenChange={open => { if (!open) closeCitation() }}>
      <Popover.Anchor virtualRef={citationAnchor} />
      {citation && <Popover.Portal container={document.getElementById('root')}><Popover.Content ref={citationContent} id={citationId} className="pilot-citation" aria-label={`来源 ${citation.source.index}`} data-mira-find-ignore side="top" align="start" sideOffset={6} collisionPadding={12} hideWhenDetached onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()} onInteractOutside={event => {
        if (citationMarker(event.target)) event.preventDefault()
      }} onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); citationAnchor.current?.focus({ preventScroll: true }); closeCitation() }} onPointerEnter={cancelCitationTimer} onPointerLeave={scheduleCitationClose} onFocusCapture={cancelCitationTimer} onBlurCapture={scheduleCitationClose} onKeyDownCapture={event => {
        if (event.key !== 'Tab' || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
        event.stopPropagation(); citationAnchor.current?.focus({ preventScroll: true })
        if (event.shiftKey) event.preventDefault()
        else closeCitation()
      }}>
        <strong>{citation.source.title || citation.source.url}</strong>
        {citation.source.snippet && <p>{citation.source.snippet}</p>}
        {citation.source.url && <a href={citation.source.url} target="_blank" rel="noreferrer">{citation.source.url}</a>}
      </Popover.Content></Popover.Portal>}
    </Popover.Root>
  </div>
}

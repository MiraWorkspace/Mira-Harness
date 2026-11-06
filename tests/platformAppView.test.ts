// @vitest-environment happy-dom
import { createApp, h, nextTick, provide, ref, type App } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import View from '../src/pages/frontend/microAppHost/PlatformAppView.vue'
import type { PlatformApi } from '../src/types'

let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren() })

it('opens a first-party child application directly without a permission API', async () => {
  const close = vi.fn(async () => undefined)
  const api = { appView: { open: vi.fn(async () => 42), close, setShellOverlay: vi.fn(async () => undefined), setBounds: vi.fn(async () => undefined), onFailed: vi.fn(() => () => undefined) } }
  const element = document.createElement('div'); document.body.append(element)
  app = createApp({ render: () => h(View, { appId: 'mira-workbench-test', api: api as unknown as PlatformApi }) })
  app.component('ElButton', { render: () => h('button') })
  app.component('ElResult', { render: () => h('div') })
  app.mount(element)
  await nextTick(); await nextTick()
  expect(api.appView.open).toHaveBeenCalledExactlyOnceWith('mira-workbench-test')
  expect(element.textContent).not.toContain('应用无法加载')
  app.unmount(); app = undefined
  expect(close).toHaveBeenCalledExactlyOnceWith(42)
})

it('raises shell overlays without hiding or resizing the live native view', async () => {
  const overlay = ref(false), setBounds = vi.fn(async () => undefined), setShellOverlay = vi.fn(async () => undefined)
  const api = { appView: { open: vi.fn(async () => 42), close: vi.fn(async () => undefined), setShellOverlay, setBounds, onFailed: vi.fn(() => () => undefined) } }
  const element = document.createElement('div'); document.body.append(element)
  app = createApp({ setup() { provide('mira-shell-overlay-open', overlay); return () => h(View, { appId: 'mira-workbench-test', api: api as unknown as PlatformApi }) } })
  app.component('ElButton', { render: () => h('button') })
  app.component('ElResult', { render: () => h('div') })
  app.mount(element)
  await nextTick(); await nextTick()
  const stage = element.querySelector('.platform-app-stage') as HTMLElement
  stage.getBoundingClientRect = () => ({ x: 10, y: 40, width: 800, height: 600 } as DOMRect)
  const calls = setBounds.mock.calls.length
  overlay.value = true
  expect(setShellOverlay).toHaveBeenLastCalledWith(42, true)
  expect(document.documentElement.classList.contains('mira-native-overlay')).toBe(true)
  overlay.value = false
  expect(setShellOverlay).toHaveBeenLastCalledWith(42, false)
  expect(setBounds).toHaveBeenCalledTimes(calls)
  expect(document.documentElement.classList.contains('mira-native-overlay')).toBe(false)
})

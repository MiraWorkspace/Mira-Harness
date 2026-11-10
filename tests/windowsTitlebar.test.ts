// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import WindowsTitlebar from '../src/layouts/components/WindowsTitlebar.vue'

afterEach(() => vi.unstubAllGlobals())

it('renders window controls and updates the restore icon on maximize', async () => {
  const command = vi.fn(), unsubscribe = vi.fn()
  let onMaximized = (_value: boolean) => {}
  vi.stubGlobal('platform', { windowCommand: command, isWindowMaximized: async () => false, onWindowMaximizedChanged: (callback: typeof onMaximized) => { onMaximized = callback; return unsubscribe } })
  const container = document.createElement('div'), app = createApp(WindowsTitlebar)
  app.mount(container); await nextTick()
  container.querySelector<HTMLButtonElement>('[aria-label="最小化"]')!.click()
  container.querySelector<HTMLButtonElement>('[aria-label="最大化"]')!.click()
  onMaximized(true); await nextTick()
  container.querySelector<HTMLButtonElement>('[aria-label="还原"]')!.click()
  container.querySelector<HTMLButtonElement>('[aria-label="关闭窗口"]')!.click()
  expect(command.mock.calls.map(call => call[0])).toEqual(['minimize', 'maximize', 'maximize', 'close'])
  app.unmount(); expect(unsubscribe).toHaveBeenCalledOnce()
})

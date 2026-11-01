// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileString } from 'sass'
import { createApp } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsSiderMenu from '../src/pages/backend/settings/components/SettingsSiderMenu.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/settings/general', query: {} }),
  useRouter: () => ({ replace: vi.fn() }),
}))

const source = readFileSync(resolve('src/pages/backend/settings/components/SettingsSiderMenu.vue'), 'utf8')
const sidebarScss = source.match(/<style scoped lang="scss">([\s\S]*?)<\/style>/)![1]
const sidebarCss = compileString(sidebarScss).css
const mounted: Array<() => void> = []
afterEach(() => { mounted.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals() })

describe('settings sidebar window-control spacing', () => {
  it.each([
    ['windows-overlay', '12px'],
    ['macos-overlay', '48px'],
    ['standard', '12px'],
    [undefined, '12px'],
  ])('reserves traffic-light spacing only for macOS (%s)', (windowChrome, paddingTop) => {
    vi.stubGlobal('platform', windowChrome ? { windowChrome } : undefined)
    const style = document.createElement('style'); style.textContent = sidebarCss; document.head.append(style)
    const container = document.createElement('div'); document.body.append(container)
    const app = createApp(SettingsSiderMenu); app.mount(container)
    mounted.push(() => { app.unmount(); container.remove(); style.remove() })

    const sidebar = container.querySelector('aside')!
    expect(getComputedStyle(sidebar).paddingTop).toBe(paddingTop)
    expect(getComputedStyle(sidebar).paddingBottom).toBe('12px')
    expect(container.querySelector('button')?.textContent).toContain('返回应用')
  })
})

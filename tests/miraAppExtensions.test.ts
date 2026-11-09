// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Page from '../src/pages/backend/appExtensions/index.vue'
import type { AppsState } from '../src/config/miraApps'

const host = vi.hoisted(() => ({ api: undefined as any, confirm: vi.fn(), notify: vi.fn(), dropdownCommand: undefined as undefined | ((event: 'command', value: string) => void) }))
vi.mock('@/platform', () => ({ getPlatformApi: () => ({ apps: host.api }) }))
vi.mock('element-plus', () => ({ ElMessageBox: { confirm: host.confirm }, ElNotification: { error: host.notify } }))
vi.mock('../src/pages/backend/settings/components/SettingsPageShell.vue', () => ({ default: { setup: (_: unknown, { slots }: any) => () => h('main', slots.default?.()) } }))
const mounted: Array<{ unmount(): void }> = []
let state: AppsState
async function drain() { for (let i = 0; i < 15; i++) { await Promise.resolve(); await nextTick() } }
function mount() {
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp(Page)
  app.component('ElEmpty', defineComponent({ props: ['description'], setup: props => () => h('div', { role: 'status' }, props.description) }))
  app.component('AppIcon', defineComponent({ setup: () => () => h('i') }))
  app.component('ElDropdown', defineComponent({ emits: ['command'], setup: (_props, { emit, slots }) => { host.dropdownCommand = emit; return () => h('div', slots.default?.().concat(slots.dropdown?.() || [])) } }))
  app.component('ElDropdownMenu', defineComponent({ setup: (_props, { slots }) => () => h('div', slots.default?.()) }))
  app.component('ElDropdownItem', defineComponent({ props: ['command', 'disabled'], setup: (props, { slots }) => () => h('button', { type: 'button', disabled: props.disabled, 'aria-label': `菜单 ${props.command}`, onClick: () => host.dropdownCommand?.('command', props.command) }, slots.default?.()) }))
  app.mount(element)
  mounted.push(app)
  const button = (label: string) => [...element.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)!
  return { element, text: () => element.textContent || '', button, click: async (label: string) => { button(label).click(); await drain() } }
}
beforeEach(() => {
  host.confirm.mockReset().mockResolvedValue(undefined); host.notify.mockReset(); host.dropdownCommand = undefined
  state = { directory: '/test/apps', installed: [], blocked: [], pendingRestart: [], catalogUrl: 'https://github.com/a/b/releases/download/catalog/apps.json', cached: false,
    snapshot: { mainMenus: [], microApps: [], preferences: {} },
    catalog: { schemaVersion: 1, revision: 1, publishedAt: '2026-11-04T00:00:00Z', apps: [
      { id: 'mira-workbench', name: 'Mira Workbench', description: '网站合集', repository: 'https://github.com/MiraWorkspace/Mira-Workbench', releases: [{ version: '0.1.0', channel: 'stable', publishedAt: '2026-11-04T00:00:00Z', releaseNotes: '', compatibility: { minShellVersion: '0.1.0-beta.1', platformApi: { major: 1, minor: 0 } }, package: { url: 'https://example.com/app.zip', sizeBytes: 2048, sha256: 'a'.repeat(64) } }] },
      { id: 'mira-notes', name: 'Mira Notes', description: '本地笔记', repository: 'https://github.com/tuyn53/Mira-Notes', releases: [{ version: '0.2.0', channel: 'stable', publishedAt: '2026-11-04T00:00:00Z', releaseNotes: '', compatibility: { minShellVersion: '0.1.0-beta.1', platformApi: { major: 1, minor: 0 } }, package: { url: 'https://example.com/notes.zip', sizeBytes: 1024, sha256: 'b'.repeat(64) } }] },
    ] } }
  host.api = {
    scan: vi.fn(async () => structuredClone(state)), refreshCatalog: vi.fn(async () => structuredClone(state)), install: vi.fn(), uninstall: vi.fn(async () => structuredClone(state)), restart: vi.fn(), openDirectory: vi.fn(), onChanged: vi.fn(() => () => undefined),
    setBlocked: vi.fn(async (id: string, blocked: boolean) => { state.blocked = blocked ? [...new Set([...(state.blocked || []), id])] : (state.blocked || []).filter(item => item !== id); return structuredClone(state) }),
  }
})
afterEach(() => { mounted.splice(0).forEach(app => app.unmount()); document.body.replaceChildren() })
function installed(version = '0.1.0') { state.installed = [{ id: 'mira-workbench', name: 'Mira Workbench', directory: '/test/apps/mira-workbench', test: false, enabled: true, version }] }

it('shows discovery, installed and blocked tabs, and adds the debug tab only for DEV apps', async () => {
  let view = mount(); await drain()
  expect(view.text()).toContain('发现')
  expect(view.text()).toContain('已安装')
  expect(view.text()).toContain('已屏蔽')
  expect(view.text()).not.toContain('调试')
  mounted.splice(0).forEach(app => app.unmount()); document.body.replaceChildren()
  state.installed = [{ id: 'workbench-dev', name: 'Workbench DEV', directory: '/test/apps/workbench-dev', test: true, enabled: true, version: '0.1.0' }]
  view = mount(); await drain()
  expect(view.button('调试')).toBeTruthy()
  await view.click('调试')
  expect(view.text()).toContain('Workbench DEV')
  expect(view.text()).toContain('打开目录')
  expect(view.element.querySelector('.app-card__header')?.textContent).not.toContain('已安装')
  const debugMenu = view.element.querySelector<HTMLButtonElement>('[aria-label="菜单 workbench-dev"]')!
  expect(debugMenu.closest('.app-card__header')).toBeTruthy()
  debugMenu.click(); await drain()
  expect(host.api.openDirectory).toHaveBeenCalledWith('workbench-dev')
  expect(host.api.setBlocked).not.toHaveBeenCalled()
})

it('keeps first-party debug scanning and Discover installation without a local-package action', async () => {
  const view = mount(); await drain()
  expect(view.element.querySelector('[aria-label="安装本地应用"]')).toBeNull()
  expect(view.element.querySelector('[aria-label="检查更新"]')).not.toBeNull()
  expect(host.api.scan).toHaveBeenCalledOnce()
  host.api.install.mockResolvedValueOnce(structuredClone(state))
  await view.click('安装 Mira Workbench')
  expect(host.api.install).toHaveBeenCalledExactlyOnceWith('mira-workbench')
  expect(host.confirm).not.toHaveBeenCalled()
})

it('renders installed app actions in the header and its update state in the footer', async () => {
  state.catalog!.apps = [state.catalog!.apps[0]]
  installed('0.0.1')
  const view = mount(); await drain()
  expect(view.element.querySelectorAll('.app-card')).toHaveLength(1)
  expect(view.text()).toContain('v0.0.1')
  expect(view.text()).toContain('2.0 KB')
  expect(view.element.querySelector<HTMLButtonElement>('#apps-tab-installed')).toBeTruthy()
  expect(view.element.querySelector('.app-extensions__tab-update')).toBeTruthy()
  view.element.querySelector<HTMLButtonElement>('#apps-tab-installed')!.click(); await drain()
  const card = view.element.querySelector('.app-card')!
  expect(card.querySelector('.app-card__header [aria-label="Mira Workbench 更多操作"]')).toBeTruthy()
  expect(card.querySelector('.app-card__footer [aria-label="更新 Mira Workbench"]')).toBeTruthy()
  expect(view.text()).toContain('在 GitHub 查看')
  expect(view.text()).toContain('屏蔽')
  expect(view.text()).toContain('卸载')
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  view.element.querySelector<HTMLButtonElement>('[aria-label="菜单 github"]')!.click(); await drain()
  expect(open).toHaveBeenCalledWith('https://github.com/MiraWorkspace/Mira-Workbench', '_blank', 'noopener,noreferrer')
  view.element.querySelector<HTMLButtonElement>('[aria-label="菜单 uninstall"]')!.click(); await drain()
  expect(host.confirm).toHaveBeenCalled()
  expect(host.api.uninstall).toHaveBeenCalledWith('mira-workbench')
})

it('shows the latest and restart-required states for installed applications', async () => {
  installed()
  const view = mount(); await drain()
  view.element.querySelector<HTMLButtonElement>('#apps-tab-installed')!.click(); await drain()
  expect(view.text()).toContain('已是最新')
  state.pendingRestart = [{ id: 'mira-workbench', action: 'install' }]
  await view.click('检查更新')
  expect(view.text()).toContain('已更新，重启后生效')
  expect(view.text()).toContain('1个应用需要重启 Mira 才能生效。')
  await view.click('立即重启')
  expect(host.api.restart).toHaveBeenCalledOnce()
})

it('keeps an uninstalled application visible until restart and disables its uninstall action', async () => {
  state.catalog!.apps = [state.catalog!.apps[0]]
  installed()
  host.api.uninstall.mockImplementationOnce(async () => {
    state.installed = []
    state.pendingRestart = [{ id: 'mira-workbench', action: 'uninstall' }]
    return structuredClone(state)
  })
  const view = mount(); await drain()
  view.element.querySelector<HTMLButtonElement>('#apps-tab-installed')!.click(); await drain()
  view.element.querySelector<HTMLButtonElement>('[aria-label="菜单 uninstall"]')!.click(); await drain()
  expect(view.element.querySelectorAll('.app-card')).toHaveLength(1)
  expect(view.text()).toContain('等待重启')
  expect(view.text()).toContain('1个应用需要重启 Mira 才能生效。')
  expect(view.element.querySelector<HTMLButtonElement>('[aria-label="菜单 uninstall"]')?.disabled).toBe(true)
})

it('keeps installed applications in discovery and installed tabs when blocked', async () => {
  state.catalog!.apps = [state.catalog!.apps[0]]
  installed()
  const view = mount(); await drain()
  expect(view.text()).toContain('Mira Workbench')
  view.element.querySelector<HTMLButtonElement>('#apps-tab-installed')!.click(); await drain()
  expect(view.text()).toContain('Mira Workbench')
  view.element.querySelector<HTMLButtonElement>('[aria-label="菜单 block"]')!.click(); await drain()
  expect(host.api.setBlocked).toHaveBeenCalledWith('mira-workbench', true)
  expect(view.element.querySelector<HTMLButtonElement>('#apps-tab-blocked')?.textContent).toContain('1')
  expect(view.text()).toContain('Mira Workbench')
  view.element.querySelector<HTMLButtonElement>('#apps-tab-discover')!.click(); await drain()
  expect(view.text()).not.toContain('Mira Workbench')
  view.element.querySelector<HTMLButtonElement>('#apps-tab-blocked')!.click(); await drain()
  expect(view.text()).toContain('Mira Workbench')
  expect(view.text()).toContain('取消屏蔽')
  view.element.querySelector<HTMLButtonElement>('[aria-label="菜单 unblock"]')!.click(); await drain()
  expect(host.api.setBlocked).toHaveBeenLastCalledWith('mira-workbench', false)
  view.element.querySelector<HTMLButtonElement>('#apps-tab-installed')!.click(); await drain()
  expect(view.text()).toContain('Mira Workbench')
})

it('keeps an installation button available while the request is in progress', async () => {
  let finish!: (value: AppsState) => void
  host.api.install.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = mount(); await drain()
  await view.click('安装 Mira Workbench')
  expect(view.text()).toContain('安装中…')
  expect(view.button('安装 Mira Workbench').disabled).toBe(false)
  installed(); state.pendingRestart = [{ id: 'mira-workbench', action: 'install' }]
  finish(structuredClone(state)); await drain()
  expect(view.text()).toContain('已更新，重启后生效')
})

it('does not show an installation failure notification when a restart is required', async () => {
  state.pendingRestart = [{ id: 'mira-workbench', action: 'install' }]
  host.api.install.mockRejectedValueOnce(new Error('请先重启 Mira 以完成应用更改'))
  const view = mount(); await drain()
  await view.click('安装 Mira Notes')
  expect(host.notify).not.toHaveBeenCalled()
  expect(view.text()).toContain('1个应用需要重启 Mira 才能生效。')
})

// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Page from '../src/pages/backend/appExtensions/index.vue'
import type { AppsState } from '../src/config/miraApps'

const host = vi.hoisted(() => ({ api: undefined as any, confirm: vi.fn(), notify: vi.fn(), replace: vi.fn(), push: vi.fn(), query: {} as Record<string, string> }))
vi.mock('@/platform', () => ({ getPlatformApi: () => ({ apps: host.api }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/settings/app-extensions', query: host.query }), useRouter: () => ({ push: host.push, replace: host.replace }) }))
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
  app.mount(element)
  mounted.push(app)
  const button = (label: string) => [...element.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)!
  return { text: () => element.textContent || '', button, click: async (label: string) => { button(label).click(); await drain() } }
}
beforeEach(() => {
  host.query = { from: '/micro/mira-workbench' }
  host.confirm.mockReset().mockResolvedValue(undefined); host.notify.mockReset(); host.replace.mockReset(); host.push.mockReset()
  state = { directory: '/test/apps', installed: [], pendingRestart: [], catalogUrl: 'https://github.com/a/b/releases/download/catalog/apps.json', cached: false,
    snapshot: { mainMenus: [], microApps: [], preferences: {} },
    catalog: { schemaVersion: 1, revision: 1, publishedAt: '2026-11-04T00:00:00Z', apps: [{ id: 'mira-workbench', name: 'Mira Workbench', description: '网站合集', repository: 'https://github.com/tuyn53/Mira-Workbench', releases: [{ version: '0.1.0', channel: 'stable', publishedAt: '2026-11-04T00:00:00Z', releaseNotes: '', compatibility: { minShellVersion: '0.1.0-beta.1', platformApi: { major: 1, minor: 0 } }, package: { url: 'https://example.com/app.zip', sizeBytes: 10, sha256: 'a'.repeat(64) } }] }] } }
  host.api = { scan: vi.fn(async () => structuredClone(state)), refreshCatalog: vi.fn(async () => structuredClone(state)), install: vi.fn(), uninstall: vi.fn(), openDirectory: vi.fn(), restart: vi.fn() }
})
afterEach(() => { mounted.splice(0).forEach(app => app.unmount()); document.body.replaceChildren() })
function installed() { state.installed = [{ id: 'mira-workbench', name: 'Mira Workbench', directory: '/test/apps/mira-workbench', test: false, enabled: true, version: '0.1.0' }] }

it('uses the same empty state for an unavailable, failed or empty catalog without showing errors or page descriptions', async () => {
  state.catalogError = '应用目录请求超时'; state.cached = true
  let view = mount(); await drain()
  expect(host.api.refreshCatalog).toHaveBeenCalledOnce()
  expect(view.text()).toContain('暂无应用')
  for (const text of ['应用目录请求超时', '为 Mira 添加', '已安装应用', '调试列表']) expect(view.text()).not.toContain(text)
  expect(view.button('安装 Mira Workbench')).toBeUndefined()
  await view.click('检查更新')
  expect(host.api.refreshCatalog).toHaveBeenCalledTimes(2)
  mounted.splice(0).forEach(app => app.unmount()); document.body.replaceChildren()
  state.catalogError = undefined; state.catalog = undefined
  view = mount(); await drain()
  expect(view.text()).toContain('暂无应用')
  expect(host.notify).not.toHaveBeenCalled()
})

it('shows only DEV applications in the debug list and only offers their directory action', async () => {
  installed()
  state.installed.push({ id: 'workbench-dev', name: 'Workbench DEV', directory: '/test/apps/workbench-dev', test: true, enabled: true })
  const view = mount(); await drain()
  expect(view.text()).toContain('调试列表')
  expect(document.querySelectorAll('article')).toHaveLength(2)
  expect(view.button('打开 Workbench DEV 目录')).toBeTruthy()
  for (const action of ['打开', '停用 Mira Workbench', '卸载 Workbench DEV', '打开 Mira Workbench 目录']) expect(view.button(action)).toBeUndefined()
  await view.click('打开 Workbench DEV 目录')
  expect(host.api.openDirectory).toHaveBeenCalledWith('workbench-dev')
  expect(view.button('卸载 Mira Workbench')).toBeTruthy()
})

it('replaces install with restart, keeps it when postponed and restarts only after confirmation', async () => {
  let finish!: (value: AppsState) => void
  host.api.install.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = mount(); await drain()
  await view.click('安装 Mira Workbench')
  expect(view.text()).toContain('安装中…')
  expect(view.button('安装 Mira Workbench').disabled).toBe(true)
  installed(); state.pendingRestart = [{ id: 'mira-workbench', action: 'install' }]
  finish(structuredClone(state)); await drain()
  expect(view.button('重启 Mira · Mira Workbench')).toBeTruthy()
  expect(view.button('安装 Mira Workbench')).toBeUndefined()
  expect(view.button('卸载 Mira Workbench')).toBeUndefined()
  expect(host.confirm).not.toHaveBeenCalled()
  host.confirm.mockRejectedValueOnce('cancel')
  await view.click('重启 Mira · Mira Workbench')
  expect(host.confirm).toHaveBeenCalledWith('安装已完成。重启 Mira 后即可使用「Mira Workbench」。', '重启 Mira', expect.objectContaining({ confirmButtonText: '立即重启', cancelButtonText: '稍后' }))
  expect(host.api.restart).not.toHaveBeenCalled()
  expect(view.button('重启 Mira · Mira Workbench')).toBeTruthy()
  await view.click('重启 Mira · Mira Workbench')
  expect(host.api.restart).toHaveBeenCalledOnce()
})

it('keeps uninstall on cancel or failure and replaces it with restart after successful file removal', async () => {
  installed()
  const view = mount(); await drain()
  host.confirm.mockRejectedValueOnce('cancel')
  await view.click('卸载 Mira Workbench')
  expect(host.api.uninstall).not.toHaveBeenCalled()
  host.api.uninstall.mockRejectedValueOnce(new Error('internal path error'))
  await view.click('卸载 Mira Workbench')
  expect(host.notify).toHaveBeenCalledWith({ title: '卸载失败', message: '请稍后重试。' })
  expect(view.text()).not.toContain('internal path error')
  expect(view.button('卸载 Mira Workbench')).toBeTruthy()
  let finish!: (value: AppsState) => void
  host.api.uninstall.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await view.click('卸载 Mira Workbench')
  expect(view.text()).toContain('卸载中…')
  state.installed = []; state.pendingRestart = [{ id: 'mira-workbench', action: 'uninstall' }]
  finish(structuredClone(state)); await drain()
  expect(view.button('重启 Mira · Mira Workbench')).toBeTruthy()
  expect(view.button('安装 Mira Workbench')).toBeUndefined()
  expect(host.replace).toHaveBeenCalledWith({ path: '/settings/app-extensions', query: { from: '/workspace/harness-react' } })
  await view.click('重启 Mira · Mira Workbench')
  expect(host.confirm).toHaveBeenLastCalledWith('卸载已完成。建议重启 Mira，完成应用资源清理。', '重启 Mira', expect.anything())
  expect(host.api.restart).toHaveBeenCalledOnce()
})

it('restores a pending restart when revisiting settings', async () => {
  state.pendingRestart = [{ id: 'mira-workbench', action: 'uninstall' }]
  const view = mount(); await drain()
  expect(view.button('重启 Mira · Mira Workbench')).toBeTruthy()
  expect(view.button('安装 Mira Workbench')).toBeUndefined()
})

it('shows a generic installation failure notification and permits retry without inline errors', async () => {
  host.api.install.mockRejectedValue(new Error('安装包 SHA-256 校验失败'))
  const view = mount(); await drain()
  await view.click('安装 Mira Workbench')
  expect(host.notify).toHaveBeenCalledWith({ title: '安装失败', message: '请检查网络连接后重试。' })
  expect(view.text()).not.toContain('失败')
  expect(view.text()).not.toContain('SHA-256')
  expect(view.button('安装 Mira Workbench').disabled).toBe(false)
  await view.click('安装 Mira Workbench')
  expect(host.api.install).toHaveBeenCalledTimes(2)
})

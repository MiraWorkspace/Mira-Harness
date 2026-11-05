// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { observeLocalApps } from '../src/platform/localApps'
import { applications, applyPlatformSnapshot } from '../src/config/runtime'
import { microApps } from '../src/config/microApps'
import type { AppsState } from '../src/config/miraApps'

const host = vi.hoisted(() => ({ apps: undefined as any }))
vi.mock('@/platform', () => ({ getPlatformApi: () => ({ apps: host.apps }) }))
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); applyPlatformSnapshot({ mainMenus: [], microApps: structuredClone(microApps), preferences: {} }) })
async function fixture(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/micro/:code/:child(.*)*', component: {} },
    { path: '/workspace/harness-react', component: {} },
    { path: '/settings/:section', component: {} },
  ] })
  await router.push(path)
  const local = { ...structuredClone(microApps[0]), id: 'micro-workbench', code: 'workbench', name: 'Workbench', localApp: true }
  const state = { installed: [], pendingRestart: [], directory: '/test/apps', cached: false, catalogUrl: '', snapshot: { mainMenus: [], microApps: [...structuredClone(microApps), local], preferences: {} } } as AppsState
  let receive!: (value: AppsState) => void
  const unsubscribe = vi.fn()
  host.apps = { scan: vi.fn(async () => state), onChanged: vi.fn(listener => { receive = listener; return unsubscribe }) }
  const stop = observeLocalApps(router); cleanups.push(stop)
  await Promise.resolve()
  return { router, state, stop, unsubscribe, emit: (apps = structuredClone(microApps)) => { receive({ ...state, snapshot: { ...state.snapshot, microApps: apps } }) } }
}

it('returns a deleted current app to Harness and removes its selector entry', async () => {
  const f = await fixture('/micro/workbench/pages/chat?source=home')
  expect(applications.value.some(app => app.code === 'workbench')).toBe(true)
  f.emit()
  await vi.waitFor(() => expect(f.router.currentRoute.value.path).toBe('/workspace/harness-react'))
  expect(applications.value.some(app => app.code === 'workbench')).toBe(false)
})

it('keeps another active app open when an unrelated app is deleted', async () => {
  const f = await fixture('/micro/workbench')
  const other = { ...f.state.snapshot.microApps[1], id: 'micro-other', code: 'other' }
  f.emit([...f.state.snapshot.microApps, other])
  f.emit(f.state.snapshot.microApps)
  await Promise.resolve()
  expect(f.router.currentRoute.value.path).toBe('/micro/workbench')
})

it('repairs a settings return path without closing settings', async () => {
  const f = await fixture('/settings/app-extensions?from=/micro/workbench&tab=official')
  f.emit()
  await vi.waitFor(() => expect(f.router.currentRoute.value.query.from).toBe('/workspace/harness-react'))
  expect(f.router.currentRoute.value.path).toBe('/settings/app-extensions')
  expect(f.router.currentRoute.value.query.tab).toBe('official')
})

it('checks for an app removed during renderer startup', async () => {
  const f = await fixture('/micro/already-deleted')
  await vi.waitFor(() => expect(f.router.currentRoute.value.path).toBe('/workspace/harness-react'))
})

it('unsubscribes and ignores late events after the shell unmounts', async () => {
  const f = await fixture('/micro/workbench')
  f.stop(); f.emit()
  expect(f.unsubscribe).toHaveBeenCalledOnce()
  expect(f.router.currentRoute.value.path).toBe('/micro/workbench')
  expect(applications.value.some(app => app.code === 'workbench')).toBe(true)
})

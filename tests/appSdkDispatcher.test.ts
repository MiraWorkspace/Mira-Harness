import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRuntime, type InstalledPlatformApp } from '../electron/services/appRuntime'
import { AppSdkDispatcher } from '../electron/services/appSdkDispatcher'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mira-sdk-dispatch-')); roots.push(root)
  const records = new Map<string, unknown>()
  const persistence = { get: (id: string) => records.get(id), set: (id: string, value: unknown) => { records.set(id, structuredClone(value)) }, delete: (id: string) => records.delete(id) }
  const app: InstalledPlatformApp = { id: 'sample', enabled: true, installationId: 'a'.repeat(64), requiredCapabilities: ['storage:app', 'appearance:read', 'models:generate', 'notifications:send'] }
  const runtime = new AppRuntime(root, persistence, id => id === app.id ? app : undefined)
  runtime.approve(app.id, app.installationId, app.requiredCapabilities)
  const session = runtime.open(app.id, 1)
  const services = { getTheme: vi.fn(() => 'dark' as const), generate: vi.fn(async () => ({ text: 'result' })), notify: vi.fn(async () => undefined) }
  return { runtime, app, session, services, dispatcher: new AppSdkDispatcher(runtime, services) }
}

describe('application SDK dispatch', () => {
  it('uses session identity for storage and approved capabilities', async () => {
    const { runtime, dispatcher, session, services } = fixture()
    expect(await dispatcher.invoke(session, 1, 'context.get')).toMatchObject({ appId: 'sample', apiVersion: { major: 1, minor: 2 } })
    await dispatcher.invoke(session, 1, 'storage.migrate', { migrations: [{ version: 1, tables: [{ name: 'items', columns: [{ name: 'id', type: 'TEXT' }] }] }] })
    await dispatcher.invoke(session, 1, 'storage.transaction', { operations: [{ type: 'insert', table: 'items', values: { id: 'saved' } }] })
    expect(await dispatcher.invoke(session, 1, 'appearance.get')).toBe('dark')
    await dispatcher.invoke(session, 1, 'notifications.send', { appId: 'other', title: 'Hello' })
    expect(services.notify).toHaveBeenCalledWith({ appId: 'sample', title: 'Hello', body: undefined })
    await expect(dispatcher.invoke(session, 2, 'appearance.get')).rejects.toThrow('授权无效')
    await expect(dispatcher.invoke(session, 1, 'unsupported')).rejects.toThrow('不支持')
    runtime.close()
  })

  it('does not return a delayed model result after approval is revoked', async () => {
    const { runtime, dispatcher, session, services, app } = fixture()
    let finish!: (value: { text: string }) => void
    services.generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const request = dispatcher.invoke(session, 1, 'models.generate', { prompt: 'hello' })
    runtime.revokeApproval(app.id)
    finish({ text: 'secret result' })
    await expect(request).rejects.toThrow('授权无效')
    runtime.close()
  })

  it('rejects legacy Workbench data access by other applications', async () => {
    const { runtime, dispatcher, session } = fixture()
    await expect(dispatcher.invoke(session, 1, 'storage.importLegacyWorkbenchSites')).rejects.toThrow('权限')
    await expect(dispatcher.invoke(session, 1, 'workbench.browser', { type: 'open' })).rejects.toThrow('授权')
    runtime.close()
  })

  it('requires explicit Workbench management approval even for the Workbench ID', async () => {
    const { runtime, app, services } = fixture()
    app.id = 'mira-workbench'
    runtime.approve(app.id, app.installationId, app.requiredCapabilities)
    const session = runtime.open(app.id, 1)
    const reader = vi.fn(async () => 'legacy')
    const dispatcher = new AppSdkDispatcher(runtime, { ...services, readLegacyWorkbenchSites: reader })
    await expect(dispatcher.invoke(session, 1, 'storage.importLegacyWorkbenchSites')).rejects.toThrow('权限')
    expect(reader).not.toHaveBeenCalled()
    runtime.close()
  })

  it('rechecks Workbench authorization before returning legacy data', async () => {
    const { runtime, app, services } = fixture()
    app.id = 'mira-workbench'; app.requiredCapabilities = [...app.requiredCapabilities, 'workbench:manage']
    runtime.approve(app.id, app.installationId, app.requiredCapabilities)
    const session = runtime.open(app.id, 1)
    let finish!: (value: string) => void
    const dispatcher = new AppSdkDispatcher(runtime, { ...services, readLegacyWorkbenchSites: () => new Promise(resolve => { finish = resolve }) })
    const request = dispatcher.invoke(session, 1, 'storage.importLegacyWorkbenchSites')
    runtime.revokeApproval(app.id)
    finish('legacy')
    await expect(request).rejects.toThrow('授权无效')
    runtime.close()
  })

  it('only passes the authenticated Workbench identity to the legacy reader', async () => {
    const { runtime, app, services } = fixture()
    app.id = 'mira-workbench'; app.requiredCapabilities = [...app.requiredCapabilities, 'workbench:manage']
    runtime.approve(app.id, app.installationId, app.requiredCapabilities)
    const session = runtime.open(app.id, 1)
    const reader = vi.fn(async () => 'legacy')
    const dispatcher = new AppSdkDispatcher(runtime, { ...services, readLegacyWorkbenchSites: reader })
    expect(await dispatcher.invoke(session, 1, 'storage.importLegacyWorkbenchSites', { appId: 'other' })).toBe('legacy')
    expect(reader).toHaveBeenCalledExactlyOnceWith('mira-workbench')
    runtime.close()
  })

  it('rejects removed Workbench lifecycle methods and exposes generic services only with capabilities', async () => {
    const { runtime, dispatcher, session } = fixture()
    await expect(dispatcher.invoke(session, 1, 'workbench.install')).rejects.toThrow('不支持')
    await expect(dispatcher.invoke(session, 1, 'files.read', { path: 'test' })).rejects.toThrow('权限')
    runtime.close()
  })

  it('fetches icons only for an approved Workbench and rechecks authorization on completion', async () => {
    const { runtime, app, services, session: otherSession } = fixture()
    const reader = vi.fn(async () => 'data:image/png;base64,AQID')
    const dispatcher = new AppSdkDispatcher(runtime, { ...services, workbenchSiteIcon: reader })
    await expect(dispatcher.invoke(otherSession, 1, 'workbench.fetchSiteIcon', { url: 'https://example.com/' })).rejects.toThrow('权限')
    expect(reader).not.toHaveBeenCalled()
    app.id = 'mira-workbench'; app.requiredCapabilities = [...app.requiredCapabilities, 'workbench:manage']
    runtime.approve(app.id, app.installationId, app.requiredCapabilities)
    const session = runtime.open(app.id, 1)
    expect(await dispatcher.invoke(session, 1, 'workbench.fetchSiteIcon', { url: 'https://example.com/' })).toBe('data:image/png;base64,AQID')
    let finish!: (value: string) => void
    reader.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const request = dispatcher.invoke(session, 1, 'workbench.fetchSiteIcon', { url: 'https://example.com/' })
    runtime.revokeApproval(app.id); finish('data:image/png;base64,AQID')
    await expect(request).rejects.toThrow('授权无效')
    runtime.close()
  })
})

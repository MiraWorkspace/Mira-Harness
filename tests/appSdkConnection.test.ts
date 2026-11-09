import { MessageChannel } from 'node:worker_threads'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRuntime, type InstalledPlatformApp } from '../electron/services/appRuntime'
import { AppSdkDispatcher } from '../electron/services/appSdkDispatcher'
import { AppSdkConnection } from '../electron/services/appSdkConnection'
import { MiraAppSdk } from '@mira/app-sdk'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(capabilities = ['storage:app', 'appearance:read', 'models:generate']) {
  const root = mkdtempSync(join(tmpdir(), 'mira-sdk-connection-')); roots.push(root)
  const records = new Map<string, unknown>()
  const persistence = { get: (id: string) => records.get(id), set: (id: string, value: unknown) => { records.set(id, structuredClone(value)) }, delete: (id: string) => records.delete(id) }
  const app: InstalledPlatformApp = { id: 'sample', enabled: true, installationId: 'a'.repeat(64), requiredCapabilities: capabilities }
  const runtime = new AppRuntime(root, persistence, id => id === app.id ? app : undefined)
  runtime.approve(app.id, app.installationId, app.requiredCapabilities)
  const session = runtime.open(app.id, 1)
  const services = { getTheme: () => 'dark' as const, generate: vi.fn(async () => ({ text: 'result' })), notify: vi.fn(async () => undefined) }
  const dispatcher = new AppSdkDispatcher(runtime, services), channel = new MessageChannel()
  const connection = new AppSdkConnection(channel.port1 as unknown as MessagePort, dispatcher, runtime, session, 1)
  const sdk = new MiraAppSdk(channel.port2 as unknown as MessagePort, 1000)
  return { runtime, session, connection, sdk, services }
}

describe('application SDK connection', () => {
  it('connects a client to its approved storage and revokes on closure', async () => {
    const { runtime, session, connection, sdk } = fixture()
    expect(await sdk.context.get()).toMatchObject({ appId: 'sample' })
    await sdk.storage.migrate([{ version: 1, tables: [{ name: 'items', columns: [{ name: 'id', type: 'TEXT' }] }] }])
    await sdk.storage.transaction([{ type: 'insert', table: 'items', values: { id: 'one' } }])
    expect(await sdk.storage.transaction([{ type: 'select', table: 'items' }])).toEqual([[{ id: 'one' }]])
    const listener = vi.fn(); sdk.appearance.subscribe(listener)
    connection.themeChanged('light')
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('light'))
    connection.close()
    await vi.waitFor(() => expect(() => runtime.authorize(session, 1)).toThrow('授权无效'))
    await expect(sdk.context.get()).rejects.toMatchObject({ code: 'DISCONNECTED' })
    sdk.dispose(); runtime.close()
  })

  it('does not deliver in-flight results after the host closes the frame', async () => {
    const { runtime, connection, sdk, services } = fixture()
    let finish!: (result: { text: string }) => void
    services.generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const request = sdk.models.generate({ prompt: 'hello' })
    await vi.waitFor(() => expect(services.generate).toHaveBeenCalledOnce())
    connection.close()
    finish({ text: 'late' })
    await expect(request).rejects.toMatchObject({ code: 'DISCONNECTED' })
    sdk.dispose(); runtime.close()
  })

  it('does not disconnect apps that have not requested theme access', async () => {
    const { runtime, connection, sdk } = fixture(['storage:app'])
    connection.themeChanged('dark')
    expect(await sdk.context.get()).toMatchObject({ appId: 'sample', capabilities: ['storage:app'] })
    connection.close(); sdk.dispose(); runtime.close()
  })
})

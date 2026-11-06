import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRuntime, type InstalledPlatformApp } from '../electron/services/appRuntime'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mira-app-runtime-')); roots.push(root)
  const records = new Map<string, unknown>()
  const persistence = { get: (id: string) => records.get(id), set: (id: string, value: unknown) => { records.set(id, structuredClone(value)) }, delete: (id: string) => records.delete(id) }
  const app: InstalledPlatformApp = { id: 'sample', enabled: true, installationId: 'a'.repeat(64), requiredCapabilities: ['storage:app'] }
  const apps = new Map([[app.id, app]])
  const runtime = new AppRuntime(root, persistence, id => apps.get(id))
  return { runtime, app, apps, records }
}

describe('application runtime authorization and storage', () => {
  it('opens first-party child applications without consent or persisted approvals', () => {
    const { runtime, app, records } = fixture()
    app.firstParty = true
    const session = runtime.open(app.id, 1)
    expect(runtime.authorize(session, 1, 'storage:app').capabilities).toEqual(['storage:app'])
    runtime.migrate(session, 1, [{ version: 1, tables: [{ name: 'items', columns: [{ name: 'id', type: 'TEXT' }] }] }])
    runtime.transaction(session, 1, [{ type: 'insert', table: 'items', values: { id: 'saved' } }])
    expect(runtime.transaction(session, 1, [{ type: 'select', table: 'items' }])).toEqual([[{ id: 'saved' }]])
    expect(records.size).toBe(0)
    expect(() => runtime.authorize(session, 1, 'models:generate')).toThrow('没有所需权限')
    const reopened = runtime.open(app.id, 2)
    app.installationId = 'b'.repeat(64)
    expect(() => runtime.authorize(reopened, 2)).toThrow('已失效')
    expect(runtime.authorize(runtime.open(app.id, 3), 3).appId).toBe(app.id)
    app.enabled = false
    expect(() => runtime.open(app.id, 4)).toThrow('停用')
    expect(records.size).toBe(0)
    runtime.close()
  })

  it('requires explicit approval and persists application data through revocation', () => {
    const { runtime, app } = fixture()
    expect(() => runtime.open(app.id, 1)).toThrow('尚未批准')
    runtime.approve(app.id, app.installationId, ['storage:app'])
    const session = runtime.open(app.id, 1)
    runtime.migrate(session, 1, [{ version: 1, tables: [{ name: 'items', columns: [{ name: 'id', type: 'TEXT' }] }] }])
    runtime.transaction(session, 1, [{ type: 'insert', table: 'items', values: { id: 'saved' } }])
    runtime.revokeApproval(app.id)
    expect(() => runtime.transaction(session, 1, [{ type: 'select', table: 'items' }])).toThrow('授权无效')
    expect(() => runtime.open(app.id, 1)).toThrow('尚未批准')
    runtime.approve(app.id, app.installationId, ['storage:app'])
    expect(runtime.transaction(runtime.open(app.id, 1), 1, [{ type: 'select', table: 'items' }])).toEqual([[{ id: 'saved' }]])
    runtime.close()
  })

  it('rejects consent for stale packages and closes access after updates or disabling', () => {
    const { runtime, app } = fixture()
    runtime.approve(app.id, app.installationId, ['storage:app'])
    const session = runtime.open(app.id, 1), oldId = app.installationId
    app.installationId = 'b'.repeat(64)
    expect(() => runtime.approve(app.id, oldId, ['storage:app'])).toThrow('重新审阅')
    expect(() => runtime.transaction(session, 1, [{ type: 'select', table: 'items' }])).toThrow('已失效')
    expect(() => runtime.open(app.id, 1)).toThrow('尚未批准')
    app.installationId = oldId
    expect(() => runtime.open(app.id, 1)).toThrow('尚未批准')
    app.installationId = 'b'.repeat(64)
    runtime.approve(app.id, app.installationId, ['storage:app'])
    const updated = runtime.open(app.id, 1)
    app.enabled = false
    expect(() => runtime.migrate(updated, 1, [])).toThrow('已失效')
    runtime.close()
  })
})

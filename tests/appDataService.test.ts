import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDataService, type InstalledAppAuthority } from '../electron/services/appDataService'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mira-app-data-')); roots.push(root)
  const apps = new Map<string, InstalledAppAuthority>([
    ['first', { id: 'first', enabled: true, installationId: 'version-1', approvedCapabilities: ['storage:app'] }],
    ['second', { id: 'second', enabled: true, installationId: 'version-1', approvedCapabilities: ['storage:app'] }],
  ])
  return { apps, service: new AppDataService(root, id => apps.get(id)) }
}

describe('app data sessions', () => {
  it('binds data access to the installed application and owner', () => {
    const { service } = fixture()
    const first = service.issue('first', 10), second = service.issue('second', 10)
    const migration = [{ version: 1, tables: [{ name: 'items', columns: [{ name: 'id', type: 'TEXT' as const, primaryKey: true }] }] }]
    service.migrate(first, 10, migration); service.migrate(second, 10, migration)
    service.transaction(first, 10, [{ type: 'insert', table: 'items', values: { id: 'private' } }])
    expect(service.transaction(second, 10, [{ type: 'select', table: 'items' }])).toEqual([[]])
    expect(() => service.transaction(first, 11, [{ type: 'select', table: 'items' }])).toThrow('授权无效')
    expect(() => service.transaction('forged', 10, [{ type: 'select', table: 'items' }])).toThrow('授权无效')
    service.close()
  })

  it('checks permissions and installation state on every request', () => {
    const { service, apps } = fixture()
    const session = service.issue('first', 10)
    apps.get('first')!.approvedCapabilities = []
    expect(() => service.migrate(session, 10, [])).toThrow('没有所需权限')
    apps.get('first')!.approvedCapabilities = ['storage:app']
    expect(() => service.migrate(session, 10, [])).toThrow('授权无效')
    const updatedSession = service.issue('first', 10)
    apps.get('first')!.installationId = 'version-2'
    expect(() => service.migrate(updatedSession, 10, [])).toThrow('已失效')
    apps.get('first')!.installationId = 'version-1'
    expect(() => service.migrate(updatedSession, 10, [])).toThrow('授权无效')
    apps.get('first')!.enabled = false
    expect(() => service.issue('first', 10)).toThrow('已停用')
    service.close()
  })

  it('revokes application and owner sessions without deleting data', () => {
    const { service } = fixture()
    const first = service.issue('first', 10), second = service.issue('second', 11)
    service.migrate(first, 10, [{ version: 1, tables: [{ name: 'items', columns: [{ name: 'id', type: 'TEXT' }] }] }])
    service.transaction(first, 10, [{ type: 'insert', table: 'items', values: { id: 'retained' } }])
    service.revokeOwner(11)
    expect(() => service.migrate(second, 11, [])).toThrow('授权无效')
    service.revokeApp('first')
    expect(() => service.migrate(first, 10, [])).toThrow('授权无效')
    const reopened = service.issue('first', 10)
    expect(service.transaction(reopened, 10, [{ type: 'select', table: 'items' }])).toEqual([[{ id: 'retained' }]])
    service.close()
  })

  it('clears only the selected database and revokes its sessions', () => {
    const { service } = fixture(), first = service.issue('first', 10), second = service.issue('second', 11)
    const migration = [{ version: 1, tables: [{ name: 'items', columns: [{ name: 'id', type: 'TEXT' as const }] }] }]
    service.migrate(first, 10, migration); service.migrate(second, 11, migration)
    service.transaction(first, 10, [{ type: 'insert', table: 'items', values: { id: 'one' } }])
    service.transaction(second, 11, [{ type: 'insert', table: 'items', values: { id: 'two' } }])
    service.clearApp('first')
    expect(() => service.transaction(first, 10, [{ type: 'select', table: 'items' }])).toThrow('授权无效')
    expect(service.transaction(second, 11, [{ type: 'select', table: 'items' }])).toEqual([[{ id: 'two' }]])
    const reopened = service.issue('first', 10)
    service.migrate(reopened, 10, migration)
    expect(service.transaction(reopened, 10, [{ type: 'select', table: 'items' }])).toEqual([[]])
    expect(() => service.clearApp('../second')).toThrow('ID')
    service.close()
  })
})

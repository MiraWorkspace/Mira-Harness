import { describe, expect, it } from 'vitest'
import { AppPermissions } from '../electron/security/appPermissions'
import { resolveAppTheme } from '../src/config/appCapabilities'

function fixture() {
  const records = new Map<string, unknown>()
  const persistence = { get: (id: string) => records.get(id), set: (id: string, value: unknown) => { records.set(id, structuredClone(value)) }, delete: (id: string) => records.delete(id) }
  const request = { id: 'example', installationId: 'a'.repeat(64), requiredCapabilities: ['storage:app', 'models:generate'] }
  return { records, persistence, request, permissions: new AppPermissions(persistence) }
}

describe('application permission approvals', () => {
  it('resolves app appearance from the user preference and system theme', () => {
    expect(resolveAppTheme('light', true)).toBe('light')
    expect(resolveAppTheme('dark', false)).toBe('dark')
    expect(resolveAppTheme('system', true)).toBe('dark')
    expect(resolveAppTheme('system', false)).toBe('light')
    expect(resolveAppTheme(undefined, true)).toBe('light')
  })
  it('binds approvals to the exact installation and persists them across service instances', () => {
    const { permissions, request, persistence } = fixture()
    expect(permissions.approved(request)).toEqual([])
    expect(permissions.isApproved(request)).toBe(false)
    permissions.approve(request, ['models:generate', 'storage:app'])
    expect(permissions.isApproved(request)).toBe(true)
    expect(new AppPermissions(persistence).approved(request)).toEqual(['models:generate', 'storage:app'])
    expect(permissions.approved({ ...request, installationId: 'b'.repeat(64) })).toEqual([])
    expect(permissions.isApproved({ ...request, requiredCapabilities: [...request.requiredCapabilities, 'notifications:send'] })).toBe(false)
    expect(permissions.approved({ ...request, requiredCapabilities: [...request.requiredCapabilities, 'notifications:send'] })).toEqual([])
  })

  it('rejects undeclared or unsupported capabilities and permits explicit revocation', () => {
    const { permissions, request } = fixture()
    expect(() => permissions.approve(request, ['storage:app'])).toThrow('不一致')
    expect(() => permissions.approve(request, [...request.requiredCapabilities, 'notifications:send'])).toThrow('不一致')
    expect(() => permissions.approve({ ...request, requiredCapabilities: ['harness:workbench'] }, ['harness:workbench'])).toThrow('无效')
    permissions.approve(request, request.requiredCapabilities)
    expect(permissions.revoke(request.id)).toBe(true)
    expect(permissions.approved(request)).toEqual([])
    expect(permissions.revoke(request.id)).toBe(false)
  })

  it('fails closed on malformed persisted records without replacing them', () => {
    const { permissions, records, request } = fixture()
    records.set('example', { installationId: 'bad', capabilities: ['storage:app'] })
    expect(() => permissions.approved(request)).toThrow('授权记录损坏')
    expect(() => permissions.approve(request, request.requiredCapabilities)).toThrow('授权记录损坏')
    expect(records.get('example')).toEqual({ installationId: 'bad', capabilities: ['storage:app'] })
    expect(permissions.revoke('example')).toBe(true)
    expect(permissions.isApproved(request)).toBe(false)
  })
})

import { parseAppCapabilities, type AppCapability } from '../../src/config/appCapabilities'

export interface PermissionPersistence {
  get(id: string): unknown
  set(id: string, value: unknown): void
  delete(id: string): boolean
}
export interface AppPermissionRequest { id: string; installationId: string; requiredCapabilities: readonly string[] }
interface Approval { installationId: string; capabilities: AppCapability[] }
const appIdPattern = /^[a-z][a-z0-9-]{0,63}$/
const installationIdPattern = /^[a-f0-9]{64}$/

function validateRequest(request: AppPermissionRequest) {
  if (!request || !appIdPattern.test(request.id) || !installationIdPattern.test(request.installationId)) throw new Error('应用安装身份无效')
  return parseAppCapabilities(request.requiredCapabilities)
}

/** Approval must only be called by a host-controlled user-consent action. */
export class AppPermissions {
  constructor(private readonly persistence: PermissionPersistence) {}

  private read(id: string): Approval | undefined {
    const raw = this.persistence.get(id)
    if (raw === undefined) return undefined
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('应用授权记录损坏')
    const approval = raw as Record<string, unknown>
    if (typeof approval.installationId !== 'string' || !installationIdPattern.test(approval.installationId)) throw new Error('应用授权记录损坏')
    return { installationId: approval.installationId, capabilities: parseAppCapabilities(approval.capabilities) }
  }

  approved(request: AppPermissionRequest): AppCapability[] {
    const required = validateRequest(request)
    const saved = this.read(request.id)
    if (!saved || saved.installationId !== request.installationId) return []
    if (required.some(capability => !saved.capabilities.includes(capability))) return []
    return required
  }

  isApproved(request: AppPermissionRequest): boolean {
    const required = validateRequest(request)
    const saved = this.read(request.id)
    return Boolean(saved && saved.installationId === request.installationId && required.every(capability => saved.capabilities.includes(capability)))
  }

  approve(request: AppPermissionRequest, confirmed: readonly string[]) {
    const required = validateRequest(request), capabilities = parseAppCapabilities(confirmed)
    if (capabilities.length !== required.length || capabilities.some((item, index) => item !== required[index])) throw new Error('确认的权限与应用申请不一致')
    this.read(request.id)
    this.persistence.set(request.id, { installationId: request.installationId, capabilities })
  }

  revoke(appId: string) {
    if (!appIdPattern.test(appId)) throw new Error('应用 ID 无效')
    return this.persistence.delete(appId)
  }
}

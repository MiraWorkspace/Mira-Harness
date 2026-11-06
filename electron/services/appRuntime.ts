import { AppPermissions, type AppPermissionRequest, type PermissionPersistence } from '../security/appPermissions'
import { AppDataService, type InstalledAppAuthority } from './appDataService'
import type { AppDataOperation, AppMigration } from '../storage/appDatabase'

export interface InstalledPlatformApp extends AppPermissionRequest { enabled: boolean; firstParty?: boolean }

/** All methods must be called by an authenticated host, never directly by an app frame. */
export class AppRuntime {
  private readonly permissions: AppPermissions
  private readonly data: AppDataService

  constructor(dataRoot: string, persistence: PermissionPersistence, private readonly resolveInstalled: (id: string) => InstalledPlatformApp | undefined) {
    this.permissions = new AppPermissions(persistence)
    this.data = new AppDataService(dataRoot, id => this.authority(id))
  }

  private installed(id: string) {
    const app = this.resolveInstalled(id)
    if (!app || app.id !== id || !app.enabled) throw new Error('应用未安装或已停用')
    return app
  }

  private authority(id: string): InstalledAppAuthority | undefined {
    const app = this.resolveInstalled(id)
    if (!app || app.id !== id || !app.enabled) return undefined
    if (!app.firstParty && !this.permissions.isApproved(app)) { this.permissions.revoke(id); return undefined }
    return { id, enabled: true, installationId: app.installationId, approvedCapabilities: app.firstParty ? app.requiredCapabilities : this.permissions.approved(app) }
  }

  approve(id: string, installationId: string, confirmed: readonly string[]) {
    const app = this.installed(id)
    if (app.installationId !== installationId) throw new Error('应用已变化，请重新审阅权限')
    this.permissions.approve(app, confirmed)
    this.data.revokeApp(id)
  }

  requireApproval(id: string) {
    const app = this.installed(id)
    if (!app.firstParty && !this.permissions.isApproved(app)) { this.permissions.revoke(id); throw new Error('应用权限尚未批准') }
    return app
  }

  isApproved(id: string) {
    const app = this.installed(id)
    return app.firstParty === true || this.permissions.isApproved(app)
  }

  open(id: string, ownerId: number) {
    this.requireApproval(id)
    return this.data.issue(id, ownerId)
  }

  migrate(sessionId: string, ownerId: number, migrations: AppMigration[]) { return this.data.migrate(sessionId, ownerId, migrations) }
  transaction(sessionId: string, ownerId: number, operations: AppDataOperation[]) { return this.data.transaction(sessionId, ownerId, operations) }
  authorize(sessionId: string, ownerId: number, capability?: string) { return this.data.authorize(sessionId, ownerId, capability) }
  revokeSession(sessionId: string, ownerId: number) { return this.data.revoke(sessionId, ownerId) }
  revokeOwner(ownerId: number) { this.data.revokeOwner(ownerId) }
  invalidateApp(id: string) { this.data.revokeApp(id) }
  clearAppData(id: string) { this.data.clearApp(id) }
  revokeApproval(id: string) { this.data.revokeApp(id); return this.permissions.revoke(id) }
  close() { this.data.close() }
}

import { APP_CAPABILITY_DESCRIPTIONS, parseAppCapabilities } from '../../src/config/appCapabilities'
import type { AppRuntime, InstalledPlatformApp } from './appRuntime'

interface ReviewApp extends InstalledPlatformApp { name: string }
interface PermissionPrompt { id: string; name: string; descriptions: string[] }

/** The prompt is shown by the host; applications cannot approve their own permissions. */
export class AppAuthorizationService {
  constructor(
    private readonly runtime: AppRuntime,
    private readonly resolveApp: (id: string) => ReviewApp | undefined,
    private readonly prompt: (request: PermissionPrompt) => Promise<boolean>,
    private readonly closeAppViews: (id: string) => void,
  ) {}

  async review(id: string) {
    const app = this.resolveApp(id)
    if (!app || app.id !== id || !app.enabled || app.firstParty || typeof app.name !== 'string' || !app.name.trim() || app.name.length > 80) throw new Error('应用未安装或已停用')
    const capabilities = parseAppCapabilities(app.requiredCapabilities)
    const installationId = app.installationId
    const name = app.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()
    if (!name) throw new Error('应用名称无效')
    const approved = await this.prompt({ id, name, descriptions: capabilities.map(capability => APP_CAPABILITY_DESCRIPTIONS[capability]) })
    if (!approved) return false
    this.runtime.approve(id, installationId, capabilities)
    this.closeAppViews(id)
    return true
  }

  revoke(id: string) {
    const revoked = this.runtime.revokeApproval(id)
    this.closeAppViews(id)
    return revoked
  }
}

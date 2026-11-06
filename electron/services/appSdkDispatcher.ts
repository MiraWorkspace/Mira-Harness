import type { AppRuntime } from './appRuntime'
import type { AppDataOperation, AppMigration } from '../storage/appDatabase'

interface AppSdkServices {
  getTheme(): 'light' | 'dark'
  generate(input: { appId: string; prompt: string; providerId?: string; modelId?: string }): Promise<{ text: string }>
  notify(input: { appId: string; title: string; body?: string }): Promise<void>
  readLegacyWorkbenchSites?(appId: string): Promise<string | null>
  workbenchBrowser?(ownerId: number, input: Record<string, unknown>): void
  workbenchApp?(ownerId: number, input: Record<string, unknown>): unknown
  workbenchApps?(ownerId: number): unknown
  reviewWorkbenchApp?(ownerId: number, appId: string, authorize: () => void): Promise<boolean>
  manageWorkbenchApp?(ownerId: number, action: 'install' | 'uninstall' | 'revoke', appId: string | undefined, authorize: () => void): Promise<boolean>
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求参数无效')
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, optional = false): string | undefined {
  if (optional && value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('请求参数无效')
  return value
}

/** Called only after the host has authenticated and bound a particular app frame. */
export class AppSdkDispatcher {
  constructor(private readonly runtime: AppRuntime, private readonly services: AppSdkServices) {}

  async invoke(sessionId: string, ownerId: number, method: unknown, params?: unknown): Promise<unknown> {
    if (typeof method !== 'string' || method.length > 128) throw new Error('请求方法无效')
    if (method === 'context.get') {
      const context = this.runtime.authorize(sessionId, ownerId)
      return { ...context, apiVersion: { major: 1, minor: 1 } }
    }
    if (method === 'storage.migrate') return this.runtime.migrate(sessionId, ownerId, record(params).migrations as AppMigration[])
    if (method === 'storage.transaction') return this.runtime.transaction(sessionId, ownerId, record(params).operations as AppDataOperation[])
    if (method === 'storage.importLegacyWorkbenchSites') {
      const appId = this.runtime.authorize(sessionId, ownerId, 'workbench:manage').appId
      this.runtime.authorize(sessionId, ownerId, 'storage:app')
      if (!['mira-workbench', 'mira-workbench-test'].includes(appId) || !this.services.readLegacyWorkbenchSites) throw new Error('应用没有所需权限')
      const value = await this.services.readLegacyWorkbenchSites(appId)
      this.runtime.authorize(sessionId, ownerId, 'workbench:manage')
      this.runtime.authorize(sessionId, ownerId, 'storage:app')
      return value
    }
    if (method === 'workbench.browser') {
      const appId = this.runtime.authorize(sessionId, ownerId, 'workbench:manage').appId
      if (!['mira-workbench', 'mira-workbench-test'].includes(appId) || !this.services.workbenchBrowser) throw new Error('应用没有所需权限')
      return this.services.workbenchBrowser(ownerId, record(params))
    }
    if (method === 'workbench.app') {
      const appId = this.runtime.authorize(sessionId, ownerId, 'workbench:manage').appId
      if (!['mira-workbench', 'mira-workbench-test'].includes(appId) || !this.services.workbenchApp) throw new Error('应用没有所需权限')
      return this.services.workbenchApp(ownerId, record(params))
    }
    if (['workbench.apps', 'workbench.review', 'workbench.install', 'workbench.uninstall', 'workbench.revoke'].includes(method)) {
      const appId = this.runtime.authorize(sessionId, ownerId, 'workbench:manage').appId
      if (!['mira-workbench', 'mira-workbench-test'].includes(appId)) throw new Error('应用没有所需权限')
      if (method === 'workbench.apps') {
        if (!this.services.workbenchApps) throw new Error('应用服务不可用')
        return this.services.workbenchApps(ownerId)
      }
      const authorize = () => { this.runtime.authorize(sessionId, ownerId, 'workbench:manage') }
      if (method !== 'workbench.review') {
        if (!this.services.manageWorkbenchApp) throw new Error('应用服务不可用')
        const action = method.slice('workbench.'.length) as 'install' | 'uninstall' | 'revoke'
        const target = action === 'install' ? undefined : text(record(params).appId, 64)!
        const changed = await this.services.manageWorkbenchApp(ownerId, action, target, authorize)
        authorize()
        return changed
      }
      if (!this.services.reviewWorkbenchApp) throw new Error('应用服务不可用')
      const target = text(record(params).appId, 64)!
      const approved = await this.services.reviewWorkbenchApp(ownerId, target, authorize)
      this.runtime.authorize(sessionId, ownerId, 'workbench:manage')
      return approved
    }
    if (method === 'appearance.get') {
      this.runtime.authorize(sessionId, ownerId, 'appearance:read')
      return this.services.getTheme()
    }
    if (method === 'models.generate') {
      const input = record(params)
      const appId = this.runtime.authorize(sessionId, ownerId, 'models:generate').appId
      const result = await this.services.generate({ appId, prompt: text(input.prompt, 100000)!, providerId: text(input.providerId, 128, true), modelId: text(input.modelId, 256, true) })
      this.runtime.authorize(sessionId, ownerId, 'models:generate')
      return result
    }
    if (method === 'notifications.send') {
      const input = record(params)
      const appId = this.runtime.authorize(sessionId, ownerId, 'notifications:send').appId
      await this.services.notify({ appId, title: text(input.title, 120)!, body: text(input.body, 1000, true) })
      this.runtime.authorize(sessionId, ownerId, 'notifications:send')
      return
    }
    throw new Error('不支持的应用方法')
  }
}

import type { AppRuntime } from './appRuntime'
import type { AppDataOperation, AppMigration } from '../storage/appDatabase'

interface AppSdkServices {
  getTheme(): 'light' | 'dark'
  generate(input: { appId: string; prompt: string; providerId?: string; modelId?: string }): Promise<{ text: string }>
  notify(input: { appId: string; title: string; body?: string }): Promise<void>
  readLegacyWorkbenchSites?(appId: string): Promise<string | null>
  workbenchBrowser?(ownerId: number, input: Record<string, unknown>): void | Promise<void>
  workbenchSiteIcon?(url: string): Promise<string | null>
  files?(appId: string, ownerId: number, method: string, input: Record<string, unknown>, authorize: () => void): Promise<unknown> | unknown
  views?(appId: string, ownerId: number, input: Record<string, unknown>): unknown
  legacyMiniapps?(appId: string, input: Record<string, unknown>): Promise<unknown> | unknown

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
      return { ...context, apiVersion: { major: 1, minor: 2 } }
    }
    if (method === 'storage.migrate') return this.runtime.migrate(sessionId, ownerId, record(params).migrations as AppMigration[], record(params).namespace as string | undefined)
    if (method === 'storage.transaction') return this.runtime.transaction(sessionId, ownerId, record(params).operations as AppDataOperation[], record(params).namespace as string | undefined)
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
    if (method === 'workbench.fetchSiteIcon') {
      const appId = this.runtime.authorize(sessionId, ownerId, 'workbench:manage').appId
      if (!['mira-workbench', 'mira-workbench-test'].includes(appId) || !this.services.workbenchSiteIcon) throw new Error('应用没有所需权限')
      const value = await this.services.workbenchSiteIcon(text(record(params).url, 8192)!)
      this.runtime.authorize(sessionId, ownerId, 'workbench:manage')
      return value
    }
    if (method.startsWith('files.')) {
      const context = this.runtime.authorize(sessionId, ownerId, 'files:app')
      if (!this.services.files) throw new Error('文件服务不可用')
      const value = await this.services.files(context.appId, ownerId, method, record(params ?? {}), () => { this.runtime.authorize(sessionId, ownerId, 'files:app') })
      this.runtime.authorize(sessionId, ownerId, 'files:app'); return value
    }
    if (method === 'views.control') {
      const context = this.runtime.authorize(sessionId, ownerId, 'views:create')
      if (!this.services.views) throw new Error('视图服务不可用')
      return this.services.views(context.appId, ownerId, record(params))
    }
    if (method === 'storage.legacyWorkbenchMiniapps') {
      const context = this.runtime.authorize(sessionId, ownerId, 'storage:app')
      if (!['mira-workbench', 'mira-workbench-test'].includes(context.appId) || !this.services.legacyMiniapps) throw new Error('应用没有所需权限')
      return this.services.legacyMiniapps(context.appId, record(params ?? {}))
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

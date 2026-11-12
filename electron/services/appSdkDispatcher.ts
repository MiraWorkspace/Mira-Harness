import type { AppRuntime } from './appRuntime'
import type { AppDataOperation, AppMigration } from '../storage/appDatabase'
import type { ChatRequest, ChatModel, ModelProvider, ModelResult, WebSearchRequest, WebSearchResult } from '@mira/app-sdk'

interface AppSdkServices {
  getTheme(): 'light' | 'dark'
  generate(input: { appId: string; prompt: string; providerId?: string; modelId?: string }): Promise<{ text: string }>
  listProviders?(): ModelProvider[]
  listModels?(providerId: string): ChatModel[]
  chat?(input: ChatRequest & { appId: string }, authorizeWeb?: () => void): Promise<ModelResult>
  search?(input: WebSearchRequest): Promise<WebSearchResult>
  notify(input: { appId: string; title: string; body?: string }): Promise<void>
  readLegacyWorkbenchSites?(appId: string): Promise<string | null>
  workbenchBrowser?(ownerId: number, input: Record<string, unknown>): void | Promise<void>
  workbenchSiteIcon?(url: string): Promise<string | null>
  workbenchMiniappResource?(url: string, kind: 'manifest' | 'package'): Promise<Uint8Array>
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
      return { ...context, apiVersion: { major: 1, minor: 4 } }
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
    if (method === 'workbench.fetchMiniappResource') {
      const appId = this.runtime.authorize(sessionId, ownerId, 'workbench:manage').appId
      if (!['mira-workbench', 'mira-workbench-test'].includes(appId) || !this.services.workbenchMiniappResource) throw new Error('应用没有所需权限')
      const input = record(params)
      if (input.kind !== 'manifest' && input.kind !== 'package') throw new Error('下载类型无效')
      const value = await this.services.workbenchMiniappResource(text(input.url, 8192)!, input.kind)
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
    if (method === 'web.search') {
      this.runtime.authorize(sessionId, ownerId, 'web:search')
      const input = record(params)
      if (!this.services.search) throw new Error('不支持的应用方法')
      const result = await this.services.search({ query: text(input.query, 2000)!, limit: input.limit as number | undefined, engine: input.engine as WebSearchRequest['engine'] })
      this.runtime.authorize(sessionId, ownerId, 'web:search')
      return result
    }
    if (method === 'models.listProviders' || method === 'models.listModels') {
      this.runtime.authorize(sessionId, ownerId, 'models:generate')
      if (method === 'models.listProviders' && this.services.listProviders) return this.services.listProviders()
      if (method === 'models.listModels' && this.services.listModels) return this.services.listModels(text(record(params).providerId, 128)!)
      throw new Error('不支持的应用方法')
    }
    if (method === 'models.chat') {
      const input = record(params)
      const appId = this.runtime.authorize(sessionId, ownerId, 'models:generate').appId
      if (!this.services.chat) throw new Error('不支持的应用方法')
      if (input.webSearch !== undefined && typeof input.webSearch !== 'boolean') throw new Error('请求参数无效')
      const authorizeWeb = () => { this.runtime.authorize(sessionId, ownerId, 'models:generate'); this.runtime.authorize(sessionId, ownerId, 'web:search') }
      if (input.webSearch) authorizeWeb()
      const result = await this.services.chat({ appId, providerId: text(input.providerId, 128)!, modelId: text(input.modelId, 256)!, messages: input.messages as ChatRequest['messages'], system: text(input.system, 100000, true), ...(input.webSearch !== undefined ? { webSearch: input.webSearch } : {}) }, authorizeWeb)
      this.runtime.authorize(sessionId, ownerId, 'models:generate')
      if (input.webSearch) authorizeWeb()
      return result
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

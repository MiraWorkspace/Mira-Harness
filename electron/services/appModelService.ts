import { isModelProviderAvailable, providerModel } from '../../src/config/harness'
import type { ModelConfigStore } from '../storage/modelConfigStore'
import { createHarnessModelProvider } from './harnessModelProvider'
import type { ChatRequest } from '@mira/app-sdk'
import { AppModelError } from './appModelError'
import type { AppWebService } from './appWebService'

type ModelStore = Pick<ModelConfigStore, 'list' | 'get' | 'getSecret' | 'bindings'>

/** Uses host-owned credentials; no provider configuration is returned to the app. */
export class AppModelService {
  constructor(private readonly store: ModelStore, private readonly createProvider = createHarnessModelProvider, private readonly web?: AppWebService) {}

  listProviders() {
    return this.store.list().filter(provider => isModelProviderAvailable(provider) && provider.models.some(model => model.enabled && (!model.modelType || model.modelType === 'chat')))
      .map(provider => ({ id: provider.id, name: provider.name }))
  }

  listModels(providerId: string) {
    const provider = this.store.get(providerId)
    if (!provider || !isModelProviderAvailable(provider)) throw new AppModelError('MODEL_UNAVAILABLE', '所选供应商不可用，请刷新列表或检查 Mira 模型配置')
    return provider.models.filter(model => model.enabled && (!model.modelType || model.modelType === 'chat')).map(model => ({ id: model.id, name: model.name || model.id }))
  }

  async generate(input: { appId: string; prompt: string; providerId?: string; modelId?: string }) {
    if (Boolean(input.providerId) !== Boolean(input.modelId)) throw new AppModelError('INVALID_REQUEST', '必须同时指定模型和供应商')
    const selection = input.providerId && input.modelId ? { providerId: input.providerId, modelId: input.modelId } : this.store.bindings().agentDefault
    if (!selection) throw new AppModelError('MODEL_NOT_CONFIGURED', '请先选择供应商和模型，或在 Mira 设置默认模型')
    return this.chat({ appId: input.appId, ...selection, messages: [{ role: 'user', content: input.prompt }] })
  }

  async chat(input: ChatRequest & { appId: string }, authorizeWeb: () => void = () => {}) {
    if (input.webSearch !== undefined && typeof input.webSearch !== 'boolean') throw new AppModelError('INVALID_REQUEST', '联网选项必须是布尔值')
    if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 100 || input.messages[0]?.role !== 'user' || input.messages.at(-1)?.role !== 'user') throw new AppModelError('INVALID_REQUEST', '对话应为 1–100 条消息，首条和最后一条必须是用户消息')
    let length = 0
    for (const message of input.messages) {
      if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim()) throw new AppModelError('INVALID_REQUEST', '对话消息只支持非空的用户或助手文本')
      length += message.content.length
    }
    if (input.system !== undefined && (typeof input.system !== 'string' || !input.system.trim())) throw new AppModelError('INVALID_REQUEST', '系统提示词必须是非空文本')
    if (length + (input.system?.length ?? 0) > 100000) throw new AppModelError('INVALID_REQUEST', '对话文本合计不能超过 100000 字符，请新建对话')
    const provider = this.store.get(input.providerId)
    const model = provider && providerModel(provider, input.modelId)
    if (!provider || !isModelProviderAvailable(provider) || !model?.enabled || (model.modelType && model.modelType !== 'chat')) throw new AppModelError('MODEL_UNAVAILABLE', '所选模型不可用，请重新选择或检查 Mira 模型配置')
    const secret = this.store.getSecret(provider.id)
    if (provider.authMode !== 'none' && !secret) throw new AppModelError('MODEL_UNAVAILABLE', '所选模型不可用，请检查 Mira 供应商凭据')
    try {
      const configured = this.createProvider(provider, model, secret)
      const messages = input.messages.map(message => message.role === 'user'
        ? { role: 'user' as const, content: message.content, timestamp: Date.now() }
        : { role: 'assistant' as const, content: [{ type: 'text' as const, text: message.content }], api: configured.model.api, provider: configured.model.provider, model: configured.model.id, stopReason: 'stop' as const, timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } })
      const context = { ...(input.system ? { systemPrompt: input.system } : {}), messages }, maxTokens = Math.min(model.maxTokens ?? 2048, 2048), signal = AbortSignal.timeout(60000)
      if (input.webSearch && !this.web) throw new Error('web service unavailable')
      const web = input.webSearch ? await this.web!.chat(configured, context, maxTokens, authorizeWeb, signal) : undefined
      const response = web?.response ?? await configured.models.completeSimple(configured.model, context, { maxTokens, signal })
      if (response.stopReason === 'error' || response.stopReason === 'aborted' || response.stopReason === 'deferred') throw new Error('model failed')
      let result = response.content.filter(part => part.type === 'text').map(part => part.text).join('')
      if (!result.trim()) throw new Error('empty response')
      if (secret) result = result.split(secret).join('[REDACTED]')
      return { text: result, ...(web ? { sources: web.sources } : {}) }
    } catch { throw new AppModelError('MODEL_REQUEST_FAILED', '模型请求失败，请检查所选供应商的连接、凭据或额度后重试') }
  }
}

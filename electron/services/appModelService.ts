import { isModelProviderAvailable, providerModel } from '../../src/config/harness'
import type { ModelConfigStore } from '../storage/modelConfigStore'
import { createHarnessModelProvider } from './harnessModelProvider'

type ModelStore = Pick<ModelConfigStore, 'get' | 'getSecret' | 'bindings'>

/** Uses host-owned credentials; no provider configuration is returned to the app. */
export class AppModelService {
  constructor(private readonly store: ModelStore, private readonly createProvider = createHarnessModelProvider) {}

  async generate(input: { appId: string; prompt: string; providerId?: string; modelId?: string }) {
    if (Boolean(input.providerId) !== Boolean(input.modelId)) throw new Error('必须同时指定模型和供应商')
    const selection = input.providerId && input.modelId ? { providerId: input.providerId, modelId: input.modelId } : this.store.bindings().agentDefault
    if (!selection) throw new Error('请先在 Mira 设置默认模型')
    const provider = this.store.get(selection.providerId)
    const model = provider && providerModel(provider, selection.modelId)
    if (!provider || !isModelProviderAvailable(provider) || !model?.enabled || (model.modelType && model.modelType !== 'chat')) throw new Error('所选模型不可用')
    const secret = this.store.getSecret(provider.id)
    if (provider.authMode !== 'none' && !secret) throw new Error('所选模型不可用')
    try {
      const configured = this.createProvider(provider, model, secret)
      const response = await configured.models.completeSimple(configured.model, { messages: [{ role: 'user', content: input.prompt, timestamp: Date.now() }] }, { maxTokens: Math.min(model.maxTokens ?? 2048, 2048), signal: AbortSignal.timeout(60000) })
      if (response.stopReason === 'error' || response.stopReason === 'aborted' || response.stopReason === 'deferred') throw new Error('model failed')
      let result = response.content.filter(part => part.type === 'text').map(part => part.text).join('')
      if (secret) result = result.split(secret).join('[REDACTED]')
      return { text: result }
    } catch { throw new Error('模型请求失败，请检查模型配置后重试') }
  }
}

import { describe, expect, it, vi } from 'vitest'
import { AppAuthorizationService } from '../electron/services/appAuthorizationService'

function fixture() {
  const app = { id: 'sample', name: 'Sample', enabled: true, installationId: 'a'.repeat(64), requiredCapabilities: ['models:generate', 'storage:app'] }
  const runtime = { approve: vi.fn(), revokeApproval: vi.fn(() => true) }
  const resolve = vi.fn(() => app), prompt = vi.fn(async () => true), close = vi.fn()
  return { app, runtime, resolve, prompt, close, service: new AppAuthorizationService(runtime as never, resolve, prompt, close) }
}

describe('application permission review', () => {
  it('does not show third-party consent for a first-party child application', async () => {
    const { service, resolve, app, prompt, runtime } = fixture()
    resolve.mockReturnValue({ ...app, firstParty: true } as typeof app)
    await expect(service.review(app.id)).rejects.toThrow('未安装或已停用')
    expect(prompt).not.toHaveBeenCalled()
    expect(runtime.approve).not.toHaveBeenCalled()
  })

  it('shows host-defined descriptions and approves only the reviewed package', async () => {
    const { service, prompt, runtime, close, app } = fixture()
    expect(await service.review('sample')).toBe(true)
    expect(prompt).toHaveBeenCalledWith({ id: 'sample', name: 'Sample', descriptions: ['使用你配置的模型生成内容，可能产生费用', '读取和修改此应用自己的本地数据'] })
    expect(runtime.approve).toHaveBeenCalledWith('sample', app.installationId, ['models:generate', 'storage:app'])
    expect(close).toHaveBeenCalledWith('sample')
  })

  it('binds confirmation to the identity shown before the dialog opened', async () => {
    const { service, prompt, runtime, app } = fixture()
    let finish!: (approved: boolean) => void
    prompt.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = service.review('sample')
    const original = app.installationId
    app.installationId = 'b'.repeat(64)
    finish(true)
    await pending
    expect(runtime.approve).toHaveBeenCalledWith('sample', original, ['models:generate', 'storage:app'])
  })

  it('does not change permissions when the user cancels or the package changes during review', async () => {
    const { service, prompt, runtime, close } = fixture()
    prompt.mockResolvedValueOnce(false)
    expect(await service.review('sample')).toBe(false)
    expect(runtime.approve).not.toHaveBeenCalled()
    runtime.approve.mockImplementationOnce(() => { throw new Error('应用已变化，请重新审阅权限') })
    await expect(service.review('sample')).rejects.toThrow('重新审阅')
    expect(close).not.toHaveBeenCalled()
  })

  it('revokes application approval and closes its running views', () => {
    const { service, runtime, close } = fixture()
    expect(service.revoke('sample')).toBe(true)
    expect(runtime.revokeApproval).toHaveBeenCalledWith('sample')
    expect(close).toHaveBeenCalledWith('sample')
  })
})

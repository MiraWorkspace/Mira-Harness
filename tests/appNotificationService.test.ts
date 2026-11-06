import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ Notification: class {} }))
import { AppNotificationService } from '../electron/services/appNotificationService'

function fixture() {
  let now = 1000
  const handles: Array<EventEmitter & { show: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = []
  const create = vi.fn(() => {
    const handle = Object.assign(new EventEmitter(), { show: vi.fn(), close: vi.fn(() => handle.emit('close')) })
    handles.push(handle); return handle
  })
  const service = new AppNotificationService(id => id === 'sample' ? 'Sample' : undefined, create, () => true, () => now)
  return { service, create, handles, advance: (amount: number) => { now += amount } }
}

describe('application notifications', () => {
  it('labels the sender using the installed application identity', async () => {
    const { service, create, handles } = fixture()
    const result = service.notify({ appId: 'sample', title: 'Ready', body: 'Completed' })
    expect(create).toHaveBeenCalledWith({ title: 'Mira · Sample', body: 'Ready\nCompleted' })
    handles[0].emit('show')
    await expect(result).resolves.toBeUndefined()
    service.dispose()
  })

  it('limits repeated notifications per application and rejects unknown senders', async () => {
    const { service, handles, advance } = fixture()
    await expect(service.notify({ appId: 'other', title: 'Hello' })).rejects.toThrow('未安装')
    for (let i = 0; i < 10; i++) { const result = service.notify({ appId: 'sample', title: 'Hello' }); handles[i].emit('show'); await result }
    await expect(service.notify({ appId: 'sample', title: 'Hello' })).rejects.toThrow('频繁')
    advance(60000)
    const result = service.notify({ appId: 'sample', title: 'Hello' }); handles[10].emit('show'); await result
    service.dispose()
  })

  it('reports delivery failures and rejects pending notifications when disposed', async () => {
    const { service, handles } = fixture()
    const failed = service.notify({ appId: 'sample', title: 'Hello' }); handles[0].emit('failed')
    await expect(failed).rejects.toThrow('未能送达')
    const pending = service.notify({ appId: 'sample', title: 'Hello' })
    handles[1].close.mockImplementation(() => undefined)
    service.dispose()
    await expect(pending).rejects.toThrow('已关闭')
    await expect(service.notify({ appId: 'sample', title: 'Hello' })).rejects.toThrow('不可用')
  })
})

import { randomBytes } from 'node:crypto'
import { lstatSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { AppDatabase, type AppDataOperation, type AppMigration } from '../storage/appDatabase'

export interface InstalledAppAuthority {
  id: string
  enabled: boolean
  installationId: string
  approvedCapabilities: readonly string[]
}

interface AppSession {
  appId: string
  installationId: string
  ownerId: number
  capabilities: ReadonlySet<string>
}

/** The caller must authenticate the host frame before issuing or using a session. */
export class AppDataService {
  private readonly sessions = new Map<string, AppSession>()
  private readonly databases = new Map<string, AppDatabase>()

  constructor(private readonly root: string, private readonly resolveApp: (appId: string) => InstalledAppAuthority | undefined) {}

  issue(appId: string, ownerId: number) {
    if (!Number.isSafeInteger(ownerId) || ownerId < 1) throw new Error('应用会话所有者无效')
    const app = this.resolveApp(appId)
    if (!app || app.id !== appId || !app.enabled || !app.installationId) throw new Error('应用未安装或已停用')
    const id = randomBytes(32).toString('hex')
    this.sessions.set(id, { appId, ownerId, installationId: app.installationId, capabilities: new Set(app.approvedCapabilities) })
    return id
  }

  authorize(sessionId: string, ownerId: number, capability?: string) {
    const session = this.sessions.get(sessionId)
    if (!session || session.ownerId !== ownerId) throw new Error('应用授权无效')
    const app = this.resolveApp(session.appId)
    if (!app || app.id !== session.appId || !app.enabled || app.installationId !== session.installationId) {
      this.sessions.delete(sessionId)
      throw new Error('应用授权已失效')
    }
    if (capability && (!session.capabilities.has(capability) || !app.approvedCapabilities.includes(capability))) {
      this.sessions.delete(sessionId)
      throw new Error('应用没有所需权限')
    }
    return { appId: session.appId, capabilities: [...session.capabilities].filter(item => app.approvedCapabilities.includes(item)) }
  }

  private database(appId: string) {
    let database = this.databases.get(appId)
    if (!database) { database = new AppDatabase(this.root, appId); this.databases.set(appId, database) }
    return database
  }

  migrate(sessionId: string, ownerId: number, migrations: AppMigration[]) {
    return this.database(this.authorize(sessionId, ownerId, 'storage:app').appId).migrate(migrations)
  }

  transaction(sessionId: string, ownerId: number, operations: AppDataOperation[]) {
    return this.database(this.authorize(sessionId, ownerId, 'storage:app').appId).transaction(operations)
  }

  revoke(sessionId: string, ownerId: number) {
    if (this.sessions.get(sessionId)?.ownerId !== ownerId) return false
    return this.sessions.delete(sessionId)
  }

  revokeApp(appId: string) {
    for (const [id, session] of this.sessions) if (session.appId === appId) this.sessions.delete(id)
    this.databases.get(appId)?.close()
    this.databases.delete(appId)
  }

  clearApp(appId: string) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(appId)) throw new Error('应用 ID 无效')
    this.revokeApp(appId)
    const root = lstatSync(this.root, { throwIfNoEntry: false })
    if (!root) return
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('应用数据目录无效')
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const file = join(this.root, `${appId}.sqlite${suffix}`), info = lstatSync(file, { throwIfNoEntry: false })
      if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error('应用数据库路径无效')
    }
    for (const suffix of ['-wal', '-shm', '-journal', '']) rmSync(join(this.root, `${appId}.sqlite${suffix}`), { force: true })
  }

  revokeOwner(ownerId: number) {
    for (const [id, session] of this.sessions) if (session.ownerId === ownerId) this.sessions.delete(id)
  }

  close() {
    this.sessions.clear()
    for (const database of this.databases.values()) database.close()
    this.databases.clear()
  }
}

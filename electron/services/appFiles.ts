import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
export type FileAccess = 'read' | 'readwrite'
export interface DirectoryGrant { id: string; name: string; access: FileAccess }
export function relativeFilePath(value: unknown, empty = false): string {
  if (typeof value !== 'string' || value.length > 1024 || (!empty && !value) || /[\\\x00-\x1f:]/.test(value) || value.startsWith('/') || (value && value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) throw new Error('文件相对路径无效')
  return value
}
/** App-owned files and explicit user-selected directory handles; no package/lifecycle policy. */
export class AppFiles {
  constructor(private readonly root: string) {}
  private check(path: string) { if (lstatSync(path).isSymbolicLink()) throw new Error('文件路径不能包含符号链接') }
  private appRoot(appId: string) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(appId)) throw new Error('应用 ID 无效')
    for (const directory of [this.root, join(this.root, 'files'), join(this.root, 'files', appId)]) {
      if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
      this.check(directory)
    }
    return join(this.root, 'files', appId)
  }
  private grantFile(appId: string) { this.appRoot(appId); const root = join(this.root, 'file-grants'); mkdirSync(root, { recursive: true }); this.check(root); return join(root, `${appId}.json`) }
  private grants(appId: string): Record<string, { path: string; access: FileAccess }> {
    const file = this.grantFile(appId); if (!existsSync(file)) return {}; this.check(file); return JSON.parse(readFileSync(file, 'utf8'))
  }
  grant(appId: string, path: string, access: FileAccess): DirectoryGrant {
    this.check(path)
    if (!lstatSync(path).isDirectory() || !['read', 'readwrite'].includes(access)) throw new Error('目录授权无效')
    const grants = this.grants(appId), id = randomUUID(); grants[id] = { path, access }
    this.atomic(this.grantFile(appId), Buffer.from(JSON.stringify(grants)))
    return { id, name: path.split(/[\\/]/).pop() || path, access }
  }
  directories(appId: string): DirectoryGrant[] { return Object.entries(this.grants(appId)).map(([id, item]) => ({ id, name: item.path.split(/[\\/]/).pop() || item.path, access: item.access })) }
  revoke(appId: string, id: string) { const grants = this.grants(appId); delete grants[id]; this.atomic(this.grantFile(appId), Buffer.from(JSON.stringify(grants))) }
  resolve(appId: string, path: unknown, grant?: unknown, write = false, empty = false) {
    const relative = relativeFilePath(path, empty); let root = this.appRoot(appId)
    if (grant !== undefined) {
      if (typeof grant !== 'string') throw new Error('目录授权无效')
      const item = this.grants(appId)[grant]
      if (!item || (write && item.access !== 'readwrite')) throw new Error('目录没有所需读写权限')
      root = item.path; this.check(root)
    }
    let current = root
    for (const part of relative.split('/').filter(Boolean)) { current = join(current, part); if (lstatSync(current, { throwIfNoEntry: false })) this.check(current) }
    return current
  }
  read(appId: string, input: { path: unknown; grant?: unknown }) {
    const path = this.resolve(appId, input.path, input.grant), info = lstatSync(path)
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('文件不存在或超过 64 MB')
    return new Uint8Array(readFileSync(path))
  }
  write(appId: string, input: { path: unknown; grant?: unknown; data: unknown }) {
    if (!(input.data instanceof Uint8Array) || input.data.byteLength > 64 * 1024 * 1024) throw new Error('文件内容无效或过大')
    const path = this.resolve(appId, input.path, input.grant, true); mkdirSync(dirname(path), { recursive: true }); this.atomic(path, input.data)
  }
  private atomic(path: string, data: Uint8Array) {
    const temporary = join(dirname(path), `.write-${randomUUID()}`)
    try { writeFileSync(temporary, data, { flag: 'wx' }); renameSync(temporary, path) } finally { rmSync(temporary, { force: true }) }
  }
  list(appId: string, input: { path?: unknown; grant?: unknown }) {
    const path = this.resolve(appId, input.path ?? '', input.grant, false, true)
    if (!existsSync(path)) return []
    return readdirSync(path, { withFileTypes: true }).filter(item => !item.isSymbolicLink()).map(item => ({ name: item.name, directory: item.isDirectory() }))
  }
  remove(appId: string, input: { path: unknown; grant?: unknown }) { rmSync(this.resolve(appId, input.path, input.grant, true), { recursive: true, force: true }) }
}

import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import Database from 'better-sqlite3'
import { namespaceDatabaseId } from './appDataService'
/** Read-only compatibility adapter. Does not install, authorize or register applications. */
export class LegacyWorkbenchMiniapps {
  constructor(private readonly appsRoot: string, private readonly dataRoot: string) {}
  async read(appId: string, input: Record<string, unknown>) {
    if (!['mira-workbench', 'mira-workbench-test'].includes(appId)) throw new Error('应用没有所需权限')
    const root = join(this.appsRoot, '.miniapps')
    if (!existsSync(root)) return input.id ? null : []
    if (lstatSync(root).isSymbolicLink()) throw new Error('旧小程序目录无效')
    if (input.id === undefined) return readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory() && /^[a-z][a-z0-9-]{0,63}$/.test(item.name)).map(item => item.name)
    if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.id)) throw new Error('旧小程序 ID 无效')
    const directory = join(root, input.id), files: Record<string, Uint8Array> = {}; let size = 0, count = 0
    const walk = (path: string, prefix = '') => {
      if (lstatSync(path).isSymbolicLink()) throw new Error('旧小程序路径无效')
      for (const item of readdirSync(path, { withFileTypes: true })) {
        if (item.isSymbolicLink()) throw new Error('旧小程序路径无效')
        const file = join(path, item.name), relative = prefix + item.name
        if (item.isDirectory()) walk(file, relative + '/')
        else if (item.isFile()) {
          size += lstatSync(file).size
          if (size > 256 * 1024 * 1024 || ++count > 10000) throw new Error('旧小程序过大')
          files[relative] = new Uint8Array(readFileSync(file))
        }
      }
    }
    walk(directory)
    // Preserve the old private SQLite database. Permissions deliberately require fresh Workbench approval.
    const source = join(this.dataRoot, `${input.id}.sqlite`)
    const key = namespaceDatabaseId(appId, input.id)
    const destination = join(this.dataRoot, `${key}.sqlite`)
    if (existsSync(source) && !existsSync(destination)) {
      if (lstatSync(source).isSymbolicLink()) throw new Error('旧数据库路径无效')
      const db = new Database(source, { readonly: true }), temporary = destination + '.import'
      try { await db.backup(temporary); renameSync(temporary, destination) }
      finally { db.close(); rmSync(temporary, { force: true }) }
    }
    return zipSync(files)
  }
}

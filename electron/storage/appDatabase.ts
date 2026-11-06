import { mkdirSync, lstatSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'

type Value = string | number | null
type ColumnType = 'TEXT' | 'INTEGER' | 'REAL'
type AppColumn = { name: string; type: ColumnType; primaryKey?: boolean; notNull?: boolean }
export type AppMigration = { version: number; tables?: Array<{ name: string; columns: AppColumn[] }>; addColumns?: Array<{ table: string; column: AppColumn }>; operations?: AppDataOperation[] }
export type AppDataOperation =
  | { type: 'insert'; table: string; values: Record<string, Value> }
  | { type: 'update'; table: string; values: Record<string, Value>; where: Record<string, Value> }
  | { type: 'delete'; table: string; where: Record<string, Value> }
  | { type: 'select'; table: string; where?: Record<string, Value>; orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>; limit?: number; offset?: number }

const idPattern = /^[a-z][a-z0-9-]{0,63}$/
const identifierPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !identifierPattern.test(value) || /^(sqlite_|mira_)/i.test(value)) throw new Error('数据库标识符无效')
  return `"${value}"`
}

function entries(value: unknown, required = true): Array<[string, Value]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据库参数无效')
  const result = Object.entries(value)
  if ((required && !result.length) || result.length > 64) throw new Error('数据库字段数量无效')
  for (const [key, item] of result) {
    identifier(key)
    if (item !== null && typeof item !== 'string' && (typeof item !== 'number' || !Number.isFinite(item))) throw new Error('数据库字段值无效')
    if (typeof item === 'string' && item.length > 1024 * 1024) throw new Error('数据库字段值过大')
  }
  return result as Array<[string, Value]>
}

function conditions(value: unknown) {
  const fields = entries(value, false)
  return { sql: fields.length ? ` WHERE ${fields.map(([key]) => `${identifier(key)} IS ?`).join(' AND ')}` : '', values: fields.map(([, item]) => item) }
}

function columnDefinition(column: AppColumn) {
  if (!column || !['TEXT', 'INTEGER', 'REAL'].includes(column.type) || (column.primaryKey !== undefined && typeof column.primaryKey !== 'boolean') || (column.notNull !== undefined && typeof column.notNull !== 'boolean')) throw new Error('数据库字段定义无效')
  return `${identifier(column.name)} ${column.type}${column.primaryKey ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}`
}

function canonicalJson(value: unknown, parents = new Set<object>(), depth = 0): string {
  if (depth > 12) throw new Error('数据库迁移嵌套过深')
  if (value && typeof value === 'object') {
    if (parents.has(value)) throw new Error('数据库迁移包含循环引用')
    parents.add(value)
    if (Array.isArray(value)) {
      const result = `[${value.map(item => canonicalJson(item, parents, depth + 1)).join(',')}]`
      parents.delete(value)
      return result
    }
    const object = value as Record<string, unknown>
    const result = `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key], parents, depth + 1)}`).join(',')}}`
    parents.delete(value)
    return result
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value)
  throw new Error('数据库迁移内容无效')
}

/** This store is not an authorization boundary; callers must resolve an installed app grant first. */
export class AppDatabase {
  private readonly database: Database.Database

  constructor(dataRoot: string, appId: string) {
    if (!idPattern.test(appId)) throw new Error('应用 ID 无效')
    mkdirSync(dataRoot, { recursive: true })
    if (lstatSync(dataRoot).isSymbolicLink()) throw new Error('应用数据目录无效')
    const path = join(dataRoot, `${appId}.sqlite`)
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('应用数据库路径无效')
    this.database = new Database(path)
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('trusted_schema = OFF')
    this.database.exec('CREATE TABLE IF NOT EXISTS mira_schema_version (version INTEGER NOT NULL)')
    this.database.exec('CREATE TABLE IF NOT EXISTS mira_migration_history (version INTEGER PRIMARY KEY, digest TEXT NOT NULL)')
    if (!this.database.prepare('SELECT 1 FROM mira_schema_version').get()) this.database.prepare('INSERT INTO mira_schema_version VALUES (0)').run()
  }

  migrate(migrations: AppMigration[]) {
    if (!Array.isArray(migrations) || migrations.length > 100) throw new Error('数据库迁移无效')
    return this.database.transaction(() => {
      let version = (this.database.prepare('SELECT version FROM mira_schema_version').get() as { version: number }).version
      let lastProvidedVersion = 0
      for (const migration of migrations) {
        if (!migration || !Number.isSafeInteger(migration.version) || migration.version < 1 || !Array.isArray(migration.tables ?? []) || !Array.isArray(migration.addColumns ?? []) || !Array.isArray(migration.operations ?? []) || (migration.tables?.length ?? 0) + (migration.addColumns?.length ?? 0) + (migration.operations?.length ?? 0) > 100) throw new Error('数据库迁移无效')
        if (migration.version <= lastProvidedVersion) throw new Error('数据库迁移版本顺序无效')
        lastProvidedVersion = migration.version
        const serialized = canonicalJson(migration)
        if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('数据库迁移内容过大')
        const digest = createHash('sha256').update(serialized).digest('hex')
        if (migration.version <= version) {
          const saved = this.database.prepare('SELECT digest FROM mira_migration_history WHERE version = ?').get(migration.version) as { digest: string } | undefined
          if (!saved || saved.digest !== digest) throw new Error('已执行的数据库迁移发生变化')
          continue
        }
        if (migration.version !== version + 1) throw new Error('数据库迁移版本不连续')
        for (const table of migration.tables ?? []) {
          if (!Array.isArray(table.columns) || !table.columns.length || table.columns.length > 64) throw new Error('数据库表字段无效')
          const columns = table.columns.map(columnDefinition)
          this.database.exec(`CREATE TABLE ${identifier(table.name)} (${columns.join(', ')})`)
        }
        for (const change of migration.addColumns ?? []) {
          if (!change?.column || change.column.primaryKey || change.column.notNull) throw new Error('新增字段必须允许空值且不能为主键')
          this.database.exec(`ALTER TABLE ${identifier(change.table)} ADD COLUMN ${columnDefinition(change.column)}`)
        }
        for (const operation of migration.operations ?? []) {
          if (operation.type === 'select') throw new Error('迁移不能包含查询操作')
          this.execute(operation)
        }
        version = migration.version
        this.database.prepare('INSERT INTO mira_migration_history (version, digest) VALUES (?, ?)').run(version, digest)
        this.database.prepare('UPDATE mira_schema_version SET version = ?').run(version)
      }
      return version
    })()
  }

  transaction(operations: AppDataOperation[]) {
    if (!Array.isArray(operations) || !operations.length || operations.length > 10000) throw new Error('数据库操作数量无效')
    let bytes = 0, selects = 0
    for (const operation of operations) {
      bytes += Buffer.byteLength(canonicalJson(operation))
      if (bytes > 4 * 1024 * 1024) throw new Error('数据库操作内容过大')
      if (operation?.type === 'select' && ++selects > 100) throw new Error('数据库查询数量无效')
    }
    return this.database.transaction(() => operations.map(operation => this.execute(operation)))()
  }

  private execute(operation: AppDataOperation) {
    if (!operation || typeof operation !== 'object') throw new Error('数据库操作无效')
    const table = identifier(operation.table)
    if (operation.type === 'insert') {
      const fields = entries(operation.values)
      return this.database.prepare(`INSERT INTO ${table} (${fields.map(([key]) => identifier(key)).join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`).run(...fields.map(([, value]) => value)).changes
    }
    if (operation.type === 'update') {
      const fields = entries(operation.values), where = conditions(operation.where)
      if (!where.sql) throw new Error('更新必须指定条件')
      return this.database.prepare(`UPDATE ${table} SET ${fields.map(([key]) => `${identifier(key)} = ?`).join(', ')}${where.sql}`).run(...fields.map(([, value]) => value), ...where.values).changes
    }
    if (operation.type === 'delete') {
      const where = conditions(operation.where)
      if (!where.sql) throw new Error('删除必须指定条件')
      return this.database.prepare(`DELETE FROM ${table}${where.sql}`).run(...where.values).changes
    }
    if (operation.type === 'select') {
      const where = conditions(operation.where ?? {}), limit = operation.limit ?? 100, offset = operation.offset ?? 0
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('查询数量无效')
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('查询偏移无效')
      if (operation.orderBy !== undefined && (!Array.isArray(operation.orderBy) || operation.orderBy.length > 8)) throw new Error('查询排序无效')
      const order = (operation.orderBy ?? []).map(item => {
        if (!item || (item.direction !== 'asc' && item.direction !== 'desc')) throw new Error('查询排序无效')
        return `${identifier(item.column)} ${item.direction.toUpperCase()}`
      })
      return this.database.prepare(`SELECT * FROM ${table}${where.sql}${order.length ? ` ORDER BY ${order.join(', ')}` : ''} LIMIT ? OFFSET ?`).all(...where.values, limit, offset)
    }
    throw new Error('数据库操作无效')
  }

  close() { this.database.close() }
}

import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase, type AppMigration } from '../electron/storage/appDatabase'

const roots: string[] = []
function root() { const path = mkdtempSync(join(tmpdir(), 'mira-app-db-')); roots.push(path); return path }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

const initial: AppMigration[] = [{ version: 1, tables: [{ name: 'items', columns: [{ name: 'id', type: 'TEXT', primaryKey: true }, { name: 'name', type: 'TEXT', notNull: true }] }] }]

describe('application database', () => {
  it('isolates applications and persists data across restart', () => {
    const directory = root(), first = new AppDatabase(directory, 'first-app'), second = new AppDatabase(directory, 'second-app')
    first.migrate(initial); second.migrate(initial)
    first.transaction([{ type: 'insert', table: 'items', values: { id: '1', name: 'first' } }])
    expect(second.transaction([{ type: 'select', table: 'items' }])).toEqual([[]])
    first.close(); second.close()
    const reopened = new AppDatabase(directory, 'first-app')
    expect(reopened.migrate(initial)).toBe(1)
    expect(reopened.transaction([{ type: 'select', table: 'items' }])).toEqual([[{ id: '1', name: 'first' }]])
    reopened.close()
  })

  it('rolls back failed transactions and migrations', () => {
    const database = new AppDatabase(root(), 'test-app')
    database.migrate(initial)
    expect(() => database.transaction([{ type: 'insert', table: 'items', values: { id: '1', name: 'first' } }, { type: 'insert', table: 'items', values: { id: '1', name: 'duplicate' } }])).toThrow()
    expect(database.transaction([{ type: 'select', table: 'items' }])).toEqual([[]])
    expect(() => database.migrate([{ version: 2, tables: [{ name: 'extra', columns: [{ name: 'id', type: 'TEXT' }] }, { name: 'items', columns: [{ name: 'id', type: 'TEXT' }] }] }])).toThrow()
    expect(database.migrate([{ version: 2, tables: [{ name: 'extra', columns: [{ name: 'id', type: 'TEXT' }] }] }])).toBe(2)
    database.close()
  })

  it('accepts a bounded large transaction and rolls it back on failure', () => {
    const database = new AppDatabase(root(), 'test-app')
    database.migrate(initial)
    const inserts = Array.from({ length: 150 }, (_, index) => ({ type: 'insert' as const, table: 'items', values: { id: String(index), name: 'item' } }))
    expect(() => database.transaction([...inserts, inserts[0]])).toThrow()
    expect(database.transaction([{ type: 'select', table: 'items' }])).toEqual([[]])
    expect(database.transaction(inserts)).toHaveLength(150)
    expect(() => database.transaction(Array.from({ length: 10001 }, () => ({ type: 'select' as const, table: 'items' })))).toThrow('数量')
    expect(() => database.transaction(Array.from({ length: 101 }, () => ({ type: 'select' as const, table: 'items' })))).toThrow('查询数量')
    expect(() => database.transaction(Array.from({ length: 5 }, (_, index) => ({ type: 'insert' as const, table: 'items', values: { id: `large-${index}`, name: 'x'.repeat(1024 * 1024) } })))).toThrow('过大')
    database.close()
  })

  it('adds columns in a later migration while preserving existing rows', () => {
    const database = new AppDatabase(root(), 'test-app')
    database.migrate(initial)
    database.transaction([{ type: 'insert', table: 'items', values: { id: '1', name: 'saved' } }])
    const upgrade: AppMigration[] = [{ version: 2, addColumns: [{ table: 'items', column: { name: 'icon', type: 'TEXT' } }] }]
    expect(database.migrate(upgrade)).toBe(2)
    expect(database.migrate(upgrade)).toBe(2)
    expect(database.transaction([{ type: 'select', table: 'items' }])).toEqual([[{ id: '1', name: 'saved', icon: null }]])
    database.close()
  })

  it('migrates existing rows atomically and supports ordered pagination', () => {
    const database = new AppDatabase(root(), 'test-app')
    database.migrate(initial)
    database.transaction([
      { type: 'insert', table: 'items', values: { id: '1', name: 'one' } },
      { type: 'insert', table: 'items', values: { id: '2', name: 'two' } },
    ])
    const upgrade: AppMigration = { version: 2, addColumns: [{ table: 'items', column: { name: 'icon', type: 'TEXT' } }], operations: [
      { type: 'update', table: 'items', values: { icon: 'example' }, where: { id: '1' } },
      { type: 'insert', table: 'items', values: { id: '2', name: 'duplicate' } },
    ] }
    expect(() => database.migrate([upgrade])).toThrow()
    expect(database.transaction([{ type: 'select', table: 'items', orderBy: [{ column: 'id', direction: 'desc' }], limit: 1, offset: 1 }])).toEqual([[{ id: '1', name: 'one' }]])
    upgrade.operations!.pop()
    expect(database.migrate([upgrade])).toBe(2)
    expect(database.transaction([{ type: 'select', table: 'items', where: { id: '1' } }])).toEqual([[{ id: '1', name: 'one', icon: 'example' }]])
    expect(() => database.transaction([{ type: 'select', table: 'items', orderBy: [{ column: 'id; DROP TABLE items', direction: 'asc' }] }])).toThrow()
    database.close()
  })

  it('rejects changed or reordered migrations that were already applied', () => {
    const database = new AppDatabase(root(), 'test-app')
    database.migrate(initial)
    expect(() => database.migrate([{ version: 1, tables: [{ name: 'different', columns: [{ name: 'id', type: 'TEXT' }] }] }])).toThrow('已执行的数据库迁移发生变化')
    expect(() => database.migrate([initial[0], initial[0]])).toThrow('版本顺序')
    expect(database.transaction([{ type: 'select', table: 'items' }])).toEqual([[]])
    database.close()
  })

  it('rejects cyclic migration input without executing it', () => {
    const database = new AppDatabase(root(), 'test-app')
    const migration = { version: 1, tables: [] } as AppMigration & { extra?: unknown }
    migration.extra = migration
    expect(() => database.migrate([migration])).toThrow('循环引用')
    expect(database.migrate(initial)).toBe(1)
    database.close()
  })

  it('rejects invalid identities, database paths, SQL identifiers and unrestricted deletes', () => {
    const directory = root()
    expect(() => new AppDatabase(directory, '../state')).toThrow()
    symlinkSync('/tmp', join(directory, 'unsafe.sqlite'))
    expect(() => new AppDatabase(directory, 'unsafe')).toThrow()
    const database = new AppDatabase(directory, 'safe')
    database.migrate(initial)
    expect(() => database.transaction([{ type: 'select', table: 'items; ATTACH DATABASE x' }])).toThrow()
    expect(() => database.transaction([{ type: 'select', table: 'mira_schema_version' }])).toThrow()
    expect(() => database.transaction([{ type: 'delete', table: 'items', where: {} }])).toThrow()
    database.close()
  })
})

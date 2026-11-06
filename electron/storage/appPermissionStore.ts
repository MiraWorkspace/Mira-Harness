import type Database from 'better-sqlite3'

/** Host-owned authorization state, deliberately excluded from configuration snapshots. */
export class AppPermissionStore {
  constructor(private readonly database: Database.Database) {
    database.exec('CREATE TABLE IF NOT EXISTS app_permissions (app_id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
  }

  get(id: string): unknown {
    const row = this.database.prepare('SELECT payload FROM app_permissions WHERE app_id = ?').get(id) as { payload: string } | undefined
    if (!row) return undefined
    try { return JSON.parse(row.payload) } catch { throw new Error('应用授权记录损坏') }
  }

  set(id: string, value: unknown) {
    this.database.prepare('INSERT INTO app_permissions(app_id, payload) VALUES (?, ?) ON CONFLICT(app_id) DO UPDATE SET payload = excluded.payload').run(id, JSON.stringify(value))
  }

  delete(id: string) {
    return this.database.prepare('DELETE FROM app_permissions WHERE app_id = ?').run(id).changes > 0
  }
}

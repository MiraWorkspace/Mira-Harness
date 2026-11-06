import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../electron/storage/appDatabase'
import { WorkbenchStore, type WorkbenchEntry } from '../../Mira-Workbench/src/data/workbenchStore'

describe('Workbench data on the platform database', () => {
  it('imports old websites once and keeps edits across database reopen', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mira-workbench-db-'))
    const legacy = JSON.stringify([{ id: 'custom-one', name: '旧网站', url: 'https://example.com/', category: 'assistant', builtin: false, visible: false }])
    const builtin: WorkbenchEntry = { id: 'builtin', type: 'website', name: '内置', address: 'https://example.org/', builtin: true, visible: true }
    let database = new AppDatabase(root, 'mira-workbench')
    const adapter = () => ({ migrate: async (migrations: Parameters<AppDatabase['migrate']>[0]) => database.migrate(migrations), transaction: async (operations: Parameters<AppDatabase['transaction']>[0]) => database.transaction(operations) })
    try {
      let store = new WorkbenchStore(adapter())
      const entries = await store.initialize(legacy, [builtin])
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({ id: 'custom-one', name: '旧网站', visible: false })
      entries[0].name = '修改后'
      await store.save(entries)
      database.close()
      database = new AppDatabase(root, 'mira-workbench')
      store = new WorkbenchStore(adapter())
      const restored = await store.initialize(() => { throw new Error('must not reread old storage') }, [builtin])
      expect(restored).toHaveLength(2)
      expect(restored[0]).toMatchObject({ id: 'custom-one', name: '修改后', visible: false })
      expect(JSON.parse(legacy)[0].name).toBe('旧网站')
    } finally { database.close(); rmSync(root, { recursive: true, force: true }) }
  })
})

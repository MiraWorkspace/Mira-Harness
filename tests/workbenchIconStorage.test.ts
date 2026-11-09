import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AppDatabase } from '../electron/storage/appDatabase'
import { WorkbenchStore } from '../../Mira-Workbench/src/data/workbenchStore'

it('migrates existing website rows and restores automatic icon bytes from SQLite after reopening', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workbench-icon-storage-'))
  let db = new AppDatabase(root, 'mira-workbench')
  try {
    const adapter = (old = false) => ({
      migrate: async (versions: Parameters<AppDatabase['migrate']>[0]) => db.migrate(old ? versions.slice(0, 1) : versions),
      transaction: async (operations: Parameters<AppDatabase['transaction']>[0]) => db.transaction(operations),
    })
    await new WorkbenchStore(adapter(true)).initialize(null, [])
    db.transaction([{ type: 'insert', table: 'entries', values: { id: 'custom', type: 'website', name: 'Custom', address: 'https://example.com/', icon: null, category: 'assistant', builtin: 0, visible: 1, position: 0 } }])
    db.close(); db = new AppDatabase(root, 'mira-workbench')
    const store = new WorkbenchStore(adapter()), entries = await store.initialize(null, [])
    expect(entries[0]).toMatchObject({ id: 'custom', address: 'https://example.com/' })
    entries[0].cachedIcon = 'data:image/png;base64,AQID'
    await store.save(entries)
    db.close(); db = new AppDatabase(root, 'mira-workbench')
    expect((await new WorkbenchStore(adapter()).initialize(null, []))[0].cachedIcon).toBe('data:image/png;base64,AQID')
  } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
})

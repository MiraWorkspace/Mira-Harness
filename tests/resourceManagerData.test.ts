import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { channel } from 'node:diagnostics_channel'
import { createHash } from 'node:crypto'
import { insideResourceRoot, scanResourceStorage } from '../electron/bootstrap/resourceStorage'
import { createResourceNetwork, sanitizeResourceUrl } from '../electron/bootstrap/resourceNetwork'
let temporary: string | undefined
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }) })
it('counts Mira storage without following links out of its root and supports cancellation', async () => {
  temporary = await mkdtemp(join(tmpdir(), 'mira-storage-'))
  const root = join(temporary, 'data'); await mkdir(join(root, 'sessions'), { recursive: true })
  await writeFile(join(root, 'sessions', 'task.json'), '12345'); await writeFile(join(root, 'state.sqlite'), '123')
  await writeFile(join(temporary, 'outside'), 'outside-data'); await symlink(join(temporary, 'outside'), join(root, 'external'))
  const snapshot = await scanResourceStorage(root, new AbortController().signal)
  expect(snapshot.totalBytes).toBe(8); expect(snapshot.categories.find(row => row.id === 'sessions')?.files).toBe(2)
  expect(insideResourceRoot(root, join(root, 'sessions'))).toBe(true); expect(insideResourceRoot(root, join(root, '..', 'outside'))).toBe(false)
  const controller = new AbortController(); controller.abort(); await expect(scanResourceStorage(root, controller.signal)).rejects.toThrow()
})
it('redacts credentials and query values, bounds records, clears them, and unsubscribes Node capture', () => {
  expect(sanitizeResourceUrl('https://user:password@example.com/api?token=secret#private')).toBe('https://example.com/api?token=%5Bredacted%5D')
  expect(sanitizeResourceUrl('file:///private')).toBeUndefined()
  const network = createResourceNetwork(); network.start()
  try {
    channel('undici:request:create').publish({ request: { method: 'POST', origin: 'https://example.com', path: '/api?key=secret' } })
    expect(network.snapshot().records[0]).toMatchObject({ method: 'POST', processType: 'main' })
    expect(network.snapshot().records[0].url).not.toContain('secret')
    for (let index = 0; index < 1000; index++) network.record('GET', `https://example.com/${index}`)
    expect(network.snapshot().records).toHaveLength(1000); expect(network.snapshot().dropped).toBe(1)
    network.clear(); expect(network.snapshot().records).toHaveLength(0)
  } finally { network.stop() }
  channel('undici:request:create').publish({ request: { method: 'GET', origin: 'https://example.com', path: '/' } })
  expect(network.snapshot().records).toHaveLength(0)
})
it('separates child app packages, data and web partitions without losing or duplicating bytes', async () => {
  temporary = await mkdtemp(join(tmpdir(), 'mira-storage-apps-'))
  const root = join(temporary, 'data'), appId = 'novel-studio'
  const prefix = `scope-${createHash('sha256').update(appId).digest('hex').slice(0, 24)}-`
  const files: Record<string, string> = {
    'apps/novel-studio/app.js': '11111', 'app-data/novel-studio.sqlite': '222',
    'app-data/novel-studio.sqlite-wal': '33', [`app-data/${prefix}abc.sqlite`]: '4444',
    'app-data/files/novel-studio/book.txt': '555555', 'app-data/file-grants/novel-studio.json': '{}',
    'Partitions/mira-app-novel-studio/Cache/data': '6666666', 'Partitions/mira-workbench/Local Storage/data': '88888888',
    'Partitions/mira-harness-browser/Cookies': '9999', 'Partitions/mira-app-removed-app/Cookies': '10',
    'Local Storage/data': '111', 'trash/item': '12', 'unknown-file': '13',
  }
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path); await mkdir(join(full, '..'), { recursive: true }); await writeFile(full, content)
  }
  await mkdir(join(root, 'app-data', 'empty'), { recursive: true })
  await writeFile(join(temporary, 'external-secret'), 'outside')
  await symlink(join(temporary, 'external-secret'), join(root, 'apps', 'external'))
  const result = await scanResourceStorage(root, new AbortController().signal, [{ id: appId, name: '小说工作室' }])
  const category = (id: string) => result.categories.find(item => item.id === id)!
  expect(result.totalBytes).toBe(Object.values(files).reduce((sum, text) => sum + text.length, 0))
  expect(category('apps').bytes).toBe(5)
  expect(category('apps').entries).toContainEqual(expect.objectContaining({ name: '小说工作室 · novel-studio', path: join(root, 'apps', appId) }))
  expect(category('app-data').bytes).toBe(17)
  expect(category('app-data').entries.filter(entry => entry.name.includes('小说工作室'))).toHaveLength(5)
  expect(category('partitions').bytes).toBe(21)
  expect(category('partitions').entries.map(entry => entry.name)).toEqual(['Workbench 浏览器', '小说工作室 · novel-studio', 'Mira 任务浏览器', 'removed-app'])
  expect(category('site-data').bytes).toBe(3)
  expect(category('trash').bytes).toBe(2)
  expect(category('other').entries.map(entry => entry.name)).toEqual(['unknown-file'])
  expect(result.errors).toBe(0)
  const paths = result.categories.flatMap(item => item.entries.map(entry => entry.path))
  expect(new Set(paths).size).toBe(paths.length)
  expect(paths.every(path => insideResourceRoot(root, path))).toBe(true)
})

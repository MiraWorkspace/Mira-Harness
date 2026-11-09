import { mkdtempSync, rmSync, symlinkSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AppFiles } from '../electron/services/appFiles'
const roots: string[] = []
function root() { const path = mkdtempSync(join(tmpdir(), 'mira-files-')); roots.push(path); return path }
afterEach(() => roots.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))
it('isolates app files, rejects traversal and symlinks and writes atomically', () => {
  const path = root(), files = new AppFiles(path), data = new TextEncoder().encode('private')
  files.write('app-a', { path: 'nested/file.txt', data })
  expect(new TextDecoder().decode(files.read('app-a', { path: 'nested/file.txt' }))).toBe('private')
  expect(() => files.read('app-b', { path: 'nested/file.txt' })).toThrow()
  expect(() => files.write('app-a', { path: '../escape', data })).toThrow('路径')
  const outside = root(); symlinkSync(outside, join(path, 'files/app-a/link'), 'dir')
  expect(() => files.write('app-a', { path: 'link/escape', data })).toThrow('符号链接')
})
it('binds directory handles to the owning app, persists access and enforces revocation/read-only', () => {
  const path = root(), directory = root(), files = new AppFiles(path), data = new TextEncoder().encode('written')
  const read = files.grant('app-a', directory, 'read')
  expect(() => files.write('app-a', { path: 'no.txt', grant: read.id, data })).toThrow('权限')
  const write = files.grant('app-a', directory, 'readwrite')
  new AppFiles(path).write('app-a', { path: 'ok.txt', grant: write.id, data })
  expect(readFileSync(join(directory, 'ok.txt'), 'utf8')).toBe('written')
  expect(() => files.read('app-b', { path: 'ok.txt', grant: write.id })).toThrow('权限')
  files.revoke('app-a', write.id)
  expect(() => files.read('app-a', { path: 'ok.txt', grant: write.id })).toThrow('权限')
})

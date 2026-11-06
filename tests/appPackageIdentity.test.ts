import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appPackageIdentity } from '../electron/security/appPackageIdentity'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() { const root = mkdtempSync(join(tmpdir(), 'mira-package-')); roots.push(root); return root }

describe('application package identity', () => {
  it('changes for file content, names and newly added files, and is stable across relocation', () => {
    const root = fixture(), first = join(root, 'one'), second = join(root, 'two')
    mkdirSync(first); writeFileSync(join(first, 'index.html'), 'first')
    const identity = appPackageIdentity(first)
    renameSync(first, second)
    expect(appPackageIdentity(second)).toBe(identity)
    writeFileSync(join(second, 'index.html'), 'other')
    expect(appPackageIdentity(second)).not.toBe(identity)
    writeFileSync(join(second, 'index.html'), 'first')
    writeFileSync(join(second, 'script.js'), 'script')
    expect(appPackageIdentity(second)).not.toBe(identity)
  })

  it('rejects symlinks within a package', () => {
    const root = fixture()
    symlinkSync('/tmp', join(root, 'external'))
    expect(() => appPackageIdentity(root)).toThrow('无效')
  })
})

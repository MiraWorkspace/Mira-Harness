import { describe, expect, it } from 'vitest'
import { resolveFirstPartyAppManifest, validateFirstPartyAppManifest, type FirstPartyAppManifest } from '../src/config/firstPartyApps'
import type { MicroApp } from '../src/types'

const manifest: FirstPartyAppManifest = {
  appId: 'sample-app',

  enabled: false,
  trustedSource: { type: 'github-release', repository: 'example/sample-app', releaseTag: 'v0.1.0', sha256: 'a'.repeat(64) },
  entry: { path: 'index.html' },
  shellCompatibility: { minVersion: '0.0.10' },
  apiCompatibility: { major: 1 },
  capabilities: [],
  developmentOverride: { enabled: false, entry: 'http://127.0.0.1:4173' },
}

const builtinManifest: FirstPartyAppManifest = {
  ...manifest,
  enabled: true,
  trustedSource: { type: 'builtin', packagePath: 'sample-app' },
}
const builtinApp = {
  id: 'micro-sample-app',
  code: 'sample-app',
  entry: { type: 'builtin', package: 'sample-app' },
} as MicroApp

describe('first-party application manifest contract', () => {
  it.each(['models:text.generate', 'storage:novel-projects'])('rejects the retired capability %s', capability => {
    expect(() => validateFirstPartyAppManifest({ ...manifest, capabilities: [capability as never] })).toThrow('能力白名单无效')
  })

  it('accepts the versioned identity, source, entry, compatibility, and capability fields', () => {
    expect(validateFirstPartyAppManifest(manifest)).toBe(manifest)
  })

  it('rejects an invalid release digest before any package can be considered trusted', () => {
    expect(() => validateFirstPartyAppManifest({ ...manifest, trustedSource: { ...manifest.trustedSource, sha256: 'not-a-digest' } })).toThrow('应用包摘要无效')
  })

  it('rejects capabilities outside the known platform contract', () => {
    expect(() => validateFirstPartyAppManifest({ ...manifest, capabilities: ['models:api-key' as never] })).toThrow('能力白名单无效')
  })

  it('rejects entries outside the trusted package', () => {
    for (const path of ['../other/index.html', '/apps/other/index.html', 'https://example.com/index.html', 'index.html?next=other', '%2e%2e/index.html', 'assets\\index.html']) {
      expect(() => validateFirstPartyAppManifest({ ...manifest, entry: { path } })).toThrow('包内相对路径')
    }
  })

  it('requires a matching built-in record and a compatible Shell/API version', () => {
    expect(resolveFirstPartyAppManifest(builtinApp, [builtinManifest], '0.0.10')).toBe(builtinManifest)
    expect(resolveFirstPartyAppManifest({ ...builtinApp, id: 'micro-other' }, [builtinManifest], '0.0.10')).toBeUndefined()
    expect(resolveFirstPartyAppManifest({ ...builtinApp, entry: { type: 'builtin', package: 'other' } }, [builtinManifest], '0.0.10')).toBeUndefined()
    expect(resolveFirstPartyAppManifest({ ...builtinApp, entry: { type: 'local-directory', directory: 'C:\\other' } }, [builtinManifest], '0.0.10')).toBeUndefined()
    expect(resolveFirstPartyAppManifest(builtinApp, [builtinManifest], '0.0.9')).toBeUndefined()
    expect(resolveFirstPartyAppManifest(builtinApp, [{ ...builtinManifest, apiCompatibility: { major: 2 } }], '0.0.10')).toBeUndefined()
    expect(resolveFirstPartyAppManifest(builtinApp, [{ ...builtinManifest, apiCompatibility: { major: 1, minor: 1 } }], '0.0.10')).toBeUndefined()
    expect(resolveFirstPartyAppManifest(builtinApp, [{ ...builtinManifest, shellCompatibility: { minVersion: '0.0.10', maxVersion: '0.0.11' } }], '0.0.12')).toBeUndefined()
  })

  it('rejects an inverted Shell compatibility range', () => {
    expect(() => validateFirstPartyAppManifest({ ...manifest, shellCompatibility: { minVersion: '0.0.11', maxVersion: '0.0.10' } })).toThrow('兼容版本范围无效')
  })
})

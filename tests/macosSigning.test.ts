import { beforeEach, describe, expect, it, vi } from 'vitest'
import { macBuildArguments } from '../scripts/build-macos.mjs'
import afterSign, { verifyMacSignature } from '../scripts/verify-macos-signature.mjs'

const execute = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawnSync: execute }))

beforeEach(() => {
  execute.mockReset().mockImplementation((command, args) => ({ status: 0, stderr: '', stdout: command.endsWith('plutil') ? 'com.tuyn53.mira\n' : args.includes('--display') ? 'Identifier=com.tuyn53.mira\nSignature=adhoc\n' : '' }))
})

describe('macOS signing gates', () => {
  it('explicitly signs local builds and requires verification before producing an installer', () => {
    const args = macBuildArguments(false, {})
    expect(args).toContain('--config.mac.identity=-')
    expect(args).toContain('--config.forceCodeSigning=true')
    expect(args).toContain('--config.afterSign=scripts/verify-macos-signature.mjs')
    expect(args).toContain('--config.mac.hardenedRuntime=false')
    expect(args).toContain('--config.mac.notarize=false')
  })

  it('rejects a release without notarization credentials and requires distribution signing', () => {
    expect(() => macBuildArguments(true, {})).toThrow('APPLE_KEYCHAIN_PROFILE')
    const args = macBuildArguments(true, { APPLE_KEYCHAIN_PROFILE: 'mira-notary' })
    expect(args).toContain('--config.mac.type=distribution')
    expect(args).toContain('--config.mac.hardenedRuntime=true')
    expect(args).toContain('--config.mac.notarize=true')
    expect(args).not.toContain('--config.mac.identity=-')
  })

  it('rejects the unsealed Electron signature found in the installed app', () => {
    execute.mockImplementation((command, args) => command.endsWith('plutil') ? { status: 0, stdout: 'com.tuyn53.mira\n', stderr: '' } : { status: 1, stdout: '', stderr: 'code has no resources but signature indicates they must be present' })
    expect(() => verifyMacSignature('/Applications/Mira.app')).toThrow('code has no resources')
  })

  it('rejects a valid signature with the wrong app identity', () => {
    execute.mockImplementation((command, args) => ({ status: 0, stdout: command.endsWith('plutil') ? 'com.tuyn53.mira\n' : '', stderr: args.includes('--display') ? 'Identifier=Electron\n' : '' }))
    expect(() => verifyMacSignature('/tmp/Mira.app')).toThrow('签名身份')
  })

  it('allows a verified local signature but refuses to treat it as a release', () => {
    expect(() => verifyMacSignature('/tmp/Mira.app')).not.toThrow()
    expect(() => verifyMacSignature('/tmp/Mira.app', { release: true })).toThrow('Developer ID Application')
  })

  it('requires a stapled notarization ticket for a release before allowing DMG creation', () => {
    execute.mockImplementation((command, args) => ({ status: command.endsWith('xcrun') ? 1 : 0, stdout: command.endsWith('plutil') ? 'com.tuyn53.mira\n' : '', stderr: command.endsWith('xcrun') ? 'ticket validation failed' : args.includes('--display') ? 'Identifier=com.tuyn53.mira\nAuthority=Developer ID Application: Example (TEAM)\n' : '' }))
    expect(() => afterSign({ appOutDir: '/tmp/mac-arm64', packager: { appInfo: { productFilename: 'Mira', id: 'com.tuyn53.mira' }, platformSpecificBuildOptions: { notarize: true } } })).toThrow('ticket validation failed')
  })
})

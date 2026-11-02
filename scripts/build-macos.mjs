import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function macBuildArguments(release = false, env = process.env) {
  if (release && !env.APPLE_KEYCHAIN_PROFILE) throw new Error('正式发布需要 Apple 公证凭据：先用 xcrun notarytool store-credentials 保存凭据，再设置 APPLE_KEYCHAIN_PROFILE。详见 docs/MACOS_RELEASE.md。')
  return ['--mac', 'dmg', '--arm64', '--config.forceCodeSigning=true', '--config.afterSign=scripts/verify-macos-signature.mjs',
    `--config.mac.hardenedRuntime=${release}`, `--config.mac.notarize=${release}`,
    ...(release ? ['--config.mac.type=distribution'] : ['--config.mac.identity=-'])]
}

export function buildMacOS(release = false) {
  if (process.platform !== 'darwin') throw new Error('macOS 安装包需要在 macOS 上构建。')
  if (release && !process.env.CSC_LINK) {
    const identities = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
    if (!identities.includes('Developer ID Application:')) throw new Error('没有有效的 Developer ID Application 证书。请先在 Xcode 中创建/安装包含私钥的发布证书。详见 docs/MACOS_RELEASE.md。')
  }
  const args = macBuildArguments(release)
  const run = (script, scriptArgs) => execFileSync(process.execPath, [resolve(script), ...scriptArgs], { stdio: 'inherit' })
  console.info(release ? '构建 Developer ID 签名并公证的正式安装包。' : '构建 ad-hoc 签名的本机测试安装包；对外发布请运行 npm run desktop:release。')
  run('scripts/build.mjs', ['--skip-tools'])
  run('node_modules/.bin/electron-rebuild', ['--force', '--only', 'better-sqlite3,node-pty', '--arch', 'arm64'])
  run('node_modules/.bin/electron-builder', args)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { buildMacOS(process.argv.includes('--release')) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}

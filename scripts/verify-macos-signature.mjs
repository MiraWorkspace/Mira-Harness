import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`macOS 安装包校验失败：${result.stderr || result.stdout}`)
  return result.stdout + result.stderr
}

export function verifyMacSignature(appPath, { id = 'com.tuyn53.mira', release = false } = {}) {
  const bundleId = run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(appPath, 'Contents/Info.plist')]).trim()
  if (bundleId !== id) throw new Error(`应用 Bundle ID 不匹配：${bundleId}`)
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
  const signature = run('/usr/bin/codesign', ['--display', '--verbose=4', appPath])
  if (!signature.split('\n').includes(`Identifier=${id}`)) throw new Error('签名身份与 Mira 的 Bundle ID 不匹配。')
  if (release) {
    if (!/^Authority=Developer ID Application:/m.test(signature)) throw new Error('正式发布必须使用 Developer ID Application 证书，不能使用 ad-hoc 签名。')
    run('/usr/bin/xcrun', ['stapler', 'validate', appPath])
  }
  console.info(`Mira 签名校验通过${release ? '，Apple 公证票据校验通过' : '（本机测试签名）'}。`)
}

export default function afterSign(context) {
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  verifyMacSignature(appPath, { id: context.packager.appInfo.id, release: context.packager.platformSpecificBuildOptions.notarize === true })
}

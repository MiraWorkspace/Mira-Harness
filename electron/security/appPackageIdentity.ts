import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const maxFiles = 10000
const maxBytes = 256 * 1024 * 1024

/** Computes a content identity for a package without following links. */
export function appPackageIdentity(root: string) {
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('应用包目录无效')
  const hash = createHash('sha256')
  let count = 0, total = 0
  const visit = (directory: string, prefix: string) => {
    for (const name of readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name
      const path = join(directory, name), info = lstatSync(path)
      if (++count > maxFiles || info.isSymbolicLink()) throw new Error('应用包文件无效或数量过多')
      if (info.isDirectory()) {
        hash.update(`D${Buffer.byteLength(relative)}:${relative}`)
        visit(path, relative)
      } else if (info.isFile()) {
        total += info.size
        if (total > maxBytes) throw new Error('应用包文件过大')
        const content = readFileSync(path)
        if (content.length !== info.size) throw new Error('应用包在读取时发生变化')
        hash.update(`F${Buffer.byteLength(relative)}:${relative}:${content.length}:`)
        hash.update(content)
      } else throw new Error('应用包包含不支持的文件')
    }
  }
  visit(root, '')
  return hash.digest('hex')
}

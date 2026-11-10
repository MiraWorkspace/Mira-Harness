import { webContents, type WebContentsView } from 'electron'
import type { MiraPluginItem } from '../../src/config/miraPlugins'
import type { MiraResourcePlugin, MiraResourceProcess, MiraResourceView } from '../../src/config/resourceManager'
import type { McpResourceConnection } from '../adapters/mcpManager'
import { miraWindows } from './miraMainWindow'

export interface ResourceInventorySources {
  views(): Pick<MiraResourceView, 'id' | 'name' | 'detail'>[]
  plugins(): MiraPluginItem[]
  connections(): McpResourceConnection[]
  terminals(): { pid: number; name: string; detail: string }[]
  storageApps?(): { id: string; name: string; identity?: string }[]
  clearStorageDatabase?(id: string, identity?: string): void
}

export function resourcePageLocation(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === 'file:') return url.hash.split('?')[0].replace(/^#/, '') || '本地页面'
    if (!['http:', 'https:'].includes(url.protocol)) return url.protocol === 'devtools:' ? '开发者工具' : '本地页面'
    return `${url.host}${url.pathname}${url.hash.startsWith('#/') ? url.hash.split('?')[0] : ''}`
  } catch { return '' }
}

export function collectResourceViews(known: ReturnType<ResourceInventorySources['views']>, monitorId: number) {
  const names = new Map(known.map(view => [view.id, view]))
  const windows = miraWindows().filter(window => !window.isDestroyed())
  const result = new Map<number, MiraResourceView[]>()
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue
    const owner = windows.find(window => window.webContents.id === contents.id || window.contentView.children.some(view => 'webContents' in view && (view as WebContentsView).webContents.id === contents.id))
    const nativeView = owner?.contentView.children.find(view => 'webContents' in view && (view as WebContentsView).webContents.id === contents.id)
    const bounds = nativeView?.getBounds()
    const title = contents.getTitle()
    const name = contents.id === monitorId ? '资源管理器' : names.get(contents.id)?.name ?? (owner?.webContents.id === contents.id ? 'Mira 界面' : contents.getType() === 'webview' ? '任务浏览器' : contents.getURL().startsWith('devtools:') ? '开发者工具' : '页面')
    for (const frame of contents.mainFrame.framesInSubtree) {
      if (frame.detached || frame.osProcessId <= 0) continue
      const main = frame === contents.mainFrame
      const visible = frame.visibilityState === 'visible' && (!owner || (owner.isVisible() && !owner.isMinimized())) && (!bounds || bounds.width > 0 && bounds.height > 0)
      const view = { id: frame.frameTreeNodeId, name: main ? name : frame.name || (/\/apps\/(?:micro-)?mira-harness\//.test(frame.url) ? 'Mira 任务界面' : '嵌入页面'),
        detail: [main ? names.get(contents.id)?.detail : '', main ? title : '', resourcePageLocation(frame.url)].filter(Boolean).join(' · '),
        status: visible ? (contents.isFocused() && main ? '正在交互' : '可见') : '后台' }
      const views = result.get(frame.osProcessId) ?? []
      views.push(view); result.set(frame.osProcessId, views)
    }
  }
  return result
}

export function describeResourcePlugins(plugins: MiraPluginItem[], connections: McpResourceConnection[], processes: MiraResourceProcess[]): MiraResourcePlugin[] {
  return plugins.map(plugin => {
    const live = connections.filter(connection => plugin.mcpServers?.some(server => server.id === connection.id))
    const pids = processes.filter(row => row.pluginId === plugin.id).map(row => row.pid)
    const state = plugin.error || plugin.unavailableReason || plugin.conflicts.length ? '不可用' : !plugin.enabled ? '已停用' : live.some(item => item.state === 'connected') ? '已连接' : live.some(item => item.state === 'connecting') ? '连接中' : live.some(item => item.state === 'failed' || item.state === 'authorization-required') ? '连接异常' : '已启用 · 待调用'
    const capabilities = [[plugin.skills.length, 'Skill'], [plugin.commands?.length, '命令'], [plugin.agents?.length, 'Agent'], [plugin.hooks?.length, 'Hook'], [plugin.mcpServers?.length, 'MCP']].filter(([count]) => count).map(([count, label]) => `${count} ${label}`).join(' · ')
    const runtime = live.map(item => `${item.name}：${item.state === 'connected' ? `已连接，${item.toolCount} 个工具` : item.state === 'connecting' ? '连接中' : item.state === 'authorization-required' ? '等待授权' : item.state === 'failed' ? '连接失败' : '未连接'}${item.mode === 'remote' ? '（远程服务，服务端占用不计入本机）' : item.mode === 'shared' ? '（共用 Mira 主进程，网页占用见界面与页面）' : item.pid ? `（PID ${item.pid}）` : ''}`).join('；')
    return { id: plugin.id, name: plugin.listing?.displayName || plugin.name, category: plugin.id.endsWith('@mira-builtin') ? 'builtin-plugin' : 'community-plugin', status: state, pids,
      detail: [capabilities, plugin.error || plugin.unavailableReason || (plugin.conflicts.length ? '插件名称冲突' : ''), runtime || (plugin.enabled ? '按需执行；Skill、命令、Agent 与 Hook 没有常驻独立进程' : '停用状态不代表先前启动的任务进程已经退出'), plugin.id].filter(Boolean).join(' · ') }
  })
}

export function identifyChildProcesses(rows: MiraResourceProcess[], plugins: MiraPluginItem[], connections: McpResourceConnection[], terminals: ReturnType<ResourceInventorySources['terminals']>): MiraResourceProcess[] {
  const byPid = new Map(rows.map(row => [row.pid, row]))
  return rows.map(row => {
    let ancestor: MiraResourceProcess | undefined = row
    const visited = new Set<number>()
    while (ancestor && !visited.has(ancestor.pid)) {
      visited.add(ancestor.pid)
      const connection = connections.find(item => item.pid === ancestor!.pid)
      const terminal = terminals.find(item => item.pid === ancestor!.pid)
      if (connection) {
        const pluginId = plugins.find(plugin => plugin.mcpServers?.some(server => server.id === connection.id))?.id ?? connection.id.match(/^plugin:(.+):[^:]+$/)?.[1]
        return { ...row, pluginId, name: ancestor === row ? connection.name : `${connection.name} / ${row.name}`, category: pluginId ? pluginId.endsWith('@mira-builtin') ? 'builtin-plugin' : 'community-plugin' : 'other', detail: `${pluginId || 'MCP 服务'} · ${ancestor === row ? '独立进程' : `子进程 · 父 PID ${row.parentPid}`}` }
      }
      if (terminal) return { ...row, name: ancestor === row ? terminal.name : `${terminal.name} / ${row.name}`, detail: terminal.detail }
      ancestor = ancestor.parentPid ? byPid.get(ancestor.parentPid) : undefined
    }
    return row
  })
}

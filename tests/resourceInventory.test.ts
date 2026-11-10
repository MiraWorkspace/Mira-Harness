import { expect, it, vi } from 'vitest'
import type { MiraPluginItem } from '../src/config/miraPlugins'
import type { McpResourceConnection } from '../electron/adapters/mcpManager'
import { groupResourceUsage } from '../src/resource-manager/resourceUsageView'
const state = vi.hoisted(() => ({ contents: [] as any[], windows: [] as any[] }))
vi.mock('electron', () => ({ webContents: { getAllWebContents: () => state.contents } }))
vi.mock('../electron/bootstrap/miraMainWindow', () => ({ miraWindows: () => state.windows }))
import { collectResourceViews, describeResourcePlugins, identifyChildProcesses, resourcePageLocation } from '../electron/bootstrap/resourceInventory'

const plugin = (id: string, server?: string): MiraPluginItem => ({ id, name: id, enabled: true, description: '', skills: [{ name: 'read', description: '' }], conflicts: [], unsupported: [], ...(server ? { mcpServers: [{ id: server, key: 'server', name: 'MCP', revision: '1', enabled: true }] } : {}) })

it('names shell/iframe views by PID, reports hidden frames, and strips credentials and URL parameters', () => {
  const main = { frameTreeNodeId: 1, osProcessId: 10, url: 'http://localhost:123/settings/mcp?token=private', visibilityState: 'visible' }
  const frame = { frameTreeNodeId: 2, osProcessId: 20, url: 'http://localhost:456/apps/micro-mira-harness/index.html', visibilityState: 'hidden', name: '' }
  const contents = { id: 1, mainFrame: { ...main, framesInSubtree: [] as any[] }, isDestroyed: () => false, getTitle: () => 'MCP 服务 - Mira', getURL: () => main.url, getType: () => 'window', isFocused: () => true }
  contents.mainFrame.framesInSubtree = [contents.mainFrame, frame]
  state.contents = [contents]; state.windows = [{ webContents: contents, contentView: { children: [] }, isDestroyed: () => false, isVisible: () => true, isMinimized: () => false }]
  const result = collectResourceViews([], 999)
  expect(result.get(10)).toMatchObject([{ name: 'Mira 界面', status: '正在交互', detail: 'MCP 服务 - Mira · localhost:123/settings/mcp' }])
  expect(result.get(20)).toMatchObject([{ name: 'Mira 任务界面', status: '后台' }])
  frame.name = 'Mira · 自动化'
  expect(collectResourceViews([], 999).get(20)).toMatchObject([{ name: 'Mira · 自动化', status: '后台' }])
  frame.osProcessId = 10
  expect(collectResourceViews([], 999).get(10)).toHaveLength(2)
  expect(resourcePageLocation('https://user:secret@example.com/path?token=secret#private')).toBe('example.com/path')
  expect(resourcePageLocation('file:///private/index.html#/settings/mcp?token=secret')).toBe('/settings/mcp')
})

it('treats zero-sized native views and views in minimized windows as background', () => {
  const mainFrame = { frameTreeNodeId: 3, osProcessId: 30, url: 'https://example.com', visibilityState: 'visible', framesInSubtree: [] as any[] }
  mainFrame.framesInSubtree = [mainFrame]
  const contents = { id: 3, mainFrame, isDestroyed: () => false, getTitle: () => 'Browser', getURL: () => mainFrame.url, getType: () => 'browserView', isFocused: () => false }
  let width = 0, minimized = false
  state.contents = [contents]; state.windows = [{ webContents: { id: 1 }, contentView: { children: [{ webContents: contents, getBounds: () => ({ width, height: 100 }) }] }, isDestroyed: () => false, isVisible: () => true, isMinimized: () => minimized }]
  expect(collectResourceViews([], 999).get(30)?.[0].status).toBe('后台')
  width = 400
  expect(collectResourceViews([], 999).get(30)?.[0].status).toBe('可见')
  minimized = true
  expect(collectResourceViews([], 999).get(30)?.[0].status).toBe('后台')
})

it('attributes plugin descendants, leaves ordinary children separate, and counts shared processes once', () => {
  const plugins = [plugin('review@local', 'plugin:review@local:server'), plugin('browser@mira-builtin', 'plugin:browser@mira-builtin:browser'), plugin('notes@local')]
  const connections: McpResourceConnection[] = [{ id: 'plugin:review@local:server', name: 'Review', pid: 20, state: 'connected', toolCount: 2, mode: 'local' }, { id: 'plugin:browser@mira-builtin:browser', name: 'Browser', state: 'connected', toolCount: 9, mode: 'shared' }]
  const rows = identifyChildProcesses([{ pid: 21, parentPid: 20, name: 'python', cpuPercent: 2, memoryBytes: 20 }, { pid: 20, parentPid: 1, name: 'node', cpuPercent: 3, memoryBytes: 30 }, { pid: 40, parentPid: 1, name: 'shell', cpuPercent: null, memoryBytes: 40, category: 'other' }], plugins, connections, [{ pid: 40, name: '任务终端', detail: '/project' }])
  expect(rows[0]).toMatchObject({ pluginId: 'review@local', category: 'community-plugin', name: 'Review / python' })
  expect(rows[2]).toMatchObject({ category: 'other', name: '任务终端' })
  const inventory = describeResourcePlugins(plugins, connections, rows)
  expect(inventory[0]).toMatchObject({ pids: [21, 20], status: '已连接' })
  expect(inventory[1].detail).toContain('共用 Mira 主进程')
  expect(inventory[2]).toMatchObject({ pids: [], status: '已启用 · 待调用' })
  const groups = groupResourceUsage(rows, inventory, 'memory')
  expect(groups.find(group => group.id === 'community-plugin')).toMatchObject({ cpuPercent: 5, memoryBytes: 50 })
  expect(groups.reduce((sum, group) => sum + group.memoryBytes, 0)).toBe(90)
  expect(groups.find(group => group.id === 'community-plugin')?.processes.map(row => row.pid)).toEqual([20, 21])
})

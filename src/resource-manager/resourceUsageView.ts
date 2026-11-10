// Adapted from ZCode resourceUsageView.ts (Apache-2.0).
// Copyright 2026 Z.AI Co., Ltd.; see third-party-licenses/zcode.
import type { MiraResourceSnapshot } from '../config/resourceManager'
export const resourceGroups = [{ id: 'ui', title: '界面与页面', empty: '当前没有页面进程' }, { id: 'base', title: '基础服务', empty: '当前没有基础服务进程' }, { id: 'builtin-plugin', title: '内置插件', empty: '尚未安装内置插件' }, { id: 'community-plugin', title: '社区插件', empty: '尚未安装社区插件' }, { id: 'other', title: '其他子进程', empty: '当前没有额外子进程' }] as const
export function groupResourceUsage(processes: MiraResourceSnapshot['processes'], plugins: NonNullable<MiraResourceSnapshot['plugins']> = [], metric: 'cpu' | 'memory' = 'cpu') {
  return resourceGroups.map(group => {
    const members = processes.filter(row => (row.category ?? 'base') === group.id).sort((a, b) => (metric === 'cpu' ? (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) : (b.memoryBytes ?? -1) - (a.memoryBytes ?? -1)) || a.pid - b.pid)
    return { ...group, processes: members, plugins: plugins.filter(plugin => plugin.category === group.id), pendingCpu: members.some(row => row.cpuPercent == null), cpuPercent: members.reduce((sum, row) => sum + (row.cpuPercent ?? 0), 0), memoryBytes: members.reduce((sum, row) => sum + (row.memoryBytes ?? 0), 0) }
  })
}
export function clampPercent(value: number) { return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)) }
export function formatPercent(value?: number | null) { return value == null ? '—' : `${(Number.isFinite(value) ? Math.round(value * 10) / 10 : 0).toFixed(1)}%` }
export function formatBytes(bytes?: number | null) {
  if (bytes == null) return '—'
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes, index = 0
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++ }
  return `${value.toFixed(index === 0 || value >= 100 ? 0 : 1)} ${units[index]}`
}

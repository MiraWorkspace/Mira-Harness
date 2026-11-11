export const APP_CAPABILITIES = ['storage:app', 'appearance:read', 'models:generate', 'web:search', 'notifications:send', 'workbench:manage', 'files:app', 'views:create'] as const
export type AppCapability = typeof APP_CAPABILITIES[number]
export const APP_CAPABILITY_DESCRIPTIONS: Record<AppCapability, string> = {
  'storage:app': '读取和修改此应用自己的本地数据',
  'appearance:read': '读取并跟随 Mira 的主题',
  'models:generate': '使用你配置的模型生成内容，可能产生费用',
  'web:search': '联网搜索并读取公开网页，会将关键词和目标网址发送到网络服务',
  'notifications:send': '通过 Mira 发送系统通知',
  'files:app': '读写此应用的文件，以及用户选择授权的目录',
  'views:create': '创建应用自己管理的隔离视图及消息通道',
  'workbench:manage': '管理工作台浏览器，并读取旧工作台网站数据',
}

export function resolveAppTheme(preference: unknown, systemDark: boolean): 'light' | 'dark' {
  return preference === 'dark' || (preference === 'system' && systemDark) ? 'dark' : 'light'
}

export function parseAppCapabilities(value: unknown): AppCapability[] {
  if (!Array.isArray(value) || value.length > APP_CAPABILITIES.length) throw new Error('应用权限列表无效')
  const supported = new Set<string>(APP_CAPABILITIES)
  if (value.some(item => typeof item !== 'string' || !supported.has(item)) || new Set(value).size !== value.length) throw new Error('应用权限列表无效')
  return [...value].sort() as AppCapability[]
}

export function parseInstalledAppCapabilities(id: string, value: unknown): AppCapability[] {
  const capabilities = parseAppCapabilities(value)
  if (capabilities.includes('workbench:manage') && !['mira-workbench', 'mira-workbench-test'].includes(id)) throw new Error('此应用不能申请工作台管理权限')
  return capabilities
}

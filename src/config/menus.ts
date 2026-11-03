import type { ApplicationOption, MenuItem } from '@/types'
import { microApps } from './microApps'

export const RESERVED_MENU_PATHS = new Map<string, string>(
  [
    ['/', '__platform'],
    ['/404', '__platform'],
    ['/micro', '__platform'],
  ],
)

// 设置页由静态路由承载，不能被可配置菜单覆盖。
export const RESERVED_MENU_PATH_PREFIXES = ['/settings', '/workspace']

export const mainMenus: MenuItem[] = []

export const microMenus: Record<string, MenuItem[]> = Object.fromEntries(
  microApps.filter(app => app.menus?.length).map(app => [app.code, app.menus!]),
)

export const applications: ApplicationOption[] = [
  { code: 'main', name: 'Mira', icon: 'HomeFilled', type: 'main' },
  ...microApps
    .filter(app => app.enabled)
    .sort((a, b) => a.sort - b.sort)
    .map(app => ({ code: app.code, name: app.name, icon: app.icon, type: 'microapp' as const })),
]

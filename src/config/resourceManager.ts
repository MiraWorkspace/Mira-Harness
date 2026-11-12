export type MiraResourceCategory = 'ui' | 'base' | 'builtin-plugin' | 'community-plugin' | 'other'
export interface MiraResourceView { id: number; name: string; detail: string; status: string }
export interface MiraResourceProcess {
  pid: number; name: string; category?: MiraResourceCategory
  cpuPercent: number | null; memoryBytes: number | null
  detail?: string; parentPid?: number; pluginId?: string; views?: MiraResourceView[]
}
export interface MiraResourcePlugin {
  id: string; name: string; category: 'builtin-plugin' | 'community-plugin'
  status: string; detail: string; pids: number[]
}
export interface MiraResourceSnapshot {
  sampledAt: number
  system: { cpuPercent: number | null; memoryUsedBytes: number; memoryTotalBytes: number }
  processes: MiraResourceProcess[]
  plugins?: MiraResourcePlugin[]
  warning?: string
}

export interface MiraStorageAction {
  id: string
  ownerId: string
  kind: 'cache' | 'site-data' | 'database'
  title: string
  description: string
  bytes: number
}
export interface MiraStorageEntry {
  name: string; detail?: string; path: string; bytes: number; files: number
  ownerId?: string; ownerName?: string; cacheBytes?: number
}
export interface MiraStorageSnapshot {
  root: string
  finishedAt: number
  totalBytes: number
  volume: { totalBytes: number; freeBytes: number } | null
  errors: number
  actions?: MiraStorageAction[]
  categories: { id: string; title: string; description?: string; bytes: number; files: number; entries: MiraStorageEntry[] }[]
}
export interface MiraNetworkSnapshot {
  records: { id: number; timestamp: number; processType: string; pid: number; method: string; url: string }[]
  dropped: number
}
export interface MiraResourceBridge {
  isWindows: boolean
  isMac: boolean
  windowCommand(action: 'state' | 'fullscreen-state' | 'minimize' | 'maximize' | 'close'): Promise<boolean>
  onFullscreen(callback: (fullscreen: boolean) => void): () => void
  onMaximized(callback: (maximized: boolean) => void): () => void
  getSnapshot(): Promise<MiraResourceSnapshot>
  storage: { scan(): Promise<MiraStorageSnapshot>; cancel(): Promise<void>; reveal(path: string): Promise<void>; clean(id: string): Promise<boolean> }
  network: { getSnapshot(): Promise<MiraNetworkSnapshot>; clear(): Promise<void> }
}

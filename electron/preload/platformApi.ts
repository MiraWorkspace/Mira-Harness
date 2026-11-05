import { ipcRenderer } from 'electron'

export const platformApi = {
  apps: {
    onChanged: (listener: (state: import('../../src/config/miraApps').AppsState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: import('../../src/config/miraApps').AppsState) => listener(state)
      ipcRenderer.on('platform:apps-changed', handler)
      return () => { ipcRenderer.removeListener('platform:apps-changed', handler) }
    },
    scan: () => ipcRenderer.invoke('platform:apps', 'scan'),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('platform:apps', 'setEnabled', { id, enabled }),
    setBlocked: (id: string, blocked: boolean) => ipcRenderer.invoke('platform:apps', 'setBlocked', { id, blocked }),
    refreshCatalog: (url?: string) => ipcRenderer.invoke('platform:apps', 'refreshCatalog', { url }),
    install: (id: string) => ipcRenderer.invoke('platform:apps', 'install', { id }),
    uninstall: (id: string) => ipcRenderer.invoke('platform:apps', 'uninstall', { id }),
    openDirectory: (id: string) => ipcRenderer.invoke('platform:apps', 'openDirectory', { id }),
    restart: () => ipcRenderer.invoke('platform:apps', 'restart'),
  },
  bindHostedBrowser: (sessionId: string, browserId: string, guestId: number) => ipcRenderer.invoke('mira:browser-bind', sessionId, browserId, guestId),
  hooks: {
    list: (params: unknown = {}) => ipcRenderer.invoke('platform:hooks', 'hooks.list', params),
    save: (params: unknown) => ipcRenderer.invoke('platform:hooks', 'hooks.save', params),
    delete: (params: unknown) => ipcRenderer.invoke('platform:hooks', 'hooks.delete', params),
    setEnabled: (params: unknown) => ipcRenderer.invoke('platform:hooks', 'hooks.setEnabled', params),
    trust: (params: unknown) => ipcRenderer.invoke('platform:hooks', 'hooks.trust', params),
    revokeTrust: (params: unknown) => ipcRenderer.invoke('platform:hooks', 'hooks.revokeTrust', params),
  },
  agentModels: {
    list: () => ipcRenderer.invoke('platform:agent-models', 'agent-models.list'),
    set: (params: unknown) => ipcRenderer.invoke('platform:agent-models', 'agent-models.set', params),
  },
  userAgents: {
    list: (params: unknown = {}) => ipcRenderer.invoke('platform:user-agents', 'agents.list', params),
    read: (params: unknown) => ipcRenderer.invoke('platform:user-agents', 'agents.read', params),
    save: (params: unknown) => ipcRenderer.invoke('platform:user-agents', 'agents.save', params),
    delete: (params: unknown) => ipcRenderer.invoke('platform:user-agents', 'agents.delete', params),
    setEnabled: (params: unknown) => ipcRenderer.invoke('platform:user-agents', 'agents.setEnabled', params),
  },
  promptCommands: {
    list: (params: unknown = {}) => ipcRenderer.invoke('platform:prompt-commands', 'commands.list', params),
    read: (params: unknown) => ipcRenderer.invoke('platform:prompt-commands', 'commands.read', params),
    save: (params: unknown) => ipcRenderer.invoke('platform:prompt-commands', 'commands.save', params),
    delete: (params: unknown) => ipcRenderer.invoke('platform:prompt-commands', 'commands.delete', params),
  },
  getSnapshot: () => ipcRenderer.invoke('platform:get-snapshot'),
  savePreference: (key: string, value: unknown) => ipcRenderer.invoke('platform:save-preference', key, value),
  updateMenus: (menus: unknown) => ipcRenderer.invoke('platform:update-menus', menus),
  updateMicroApps: (apps: unknown) => ipcRenderer.invoke('platform:update-microapps', apps),
  selectMicroAppDirectory: () => ipcRenderer.invoke('platform:select-microapp-directory'),
  resolveLocalMicroAppUrl: (appId: string) => ipcRenderer.invoke('platform:resolve-local-microapp-url', appId),
  createFirstPartyGrant: (appId: string) => ipcRenderer.invoke('platform:create-first-party-grant', appId),
  revokeFirstPartyGrant: (grantId: string) => ipcRenderer.invoke('platform:revoke-first-party-grant', grantId),
  invokeFirstPartyHarness: (grantId: string, method: string, params?: unknown) => ipcRenderer.invoke('platform:first-party-harness', grantId, method, params),
  exportSnapshot: () => ipcRenderer.invoke('platform:export-snapshot'),
  importSnapshot: (snapshot: string) => ipcRenderer.invoke('platform:import-snapshot', snapshot),
  restoreDefaults: () => ipcRenderer.invoke('platform:restore-defaults'),
}

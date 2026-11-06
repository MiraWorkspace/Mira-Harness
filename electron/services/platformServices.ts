import { PlatformDatabase } from '../storage/database'
import { LocalMicroAppServer } from '../adapters/localMicroAppServer'
import { readWorkbenchLegacySites } from './workbenchLegacyData'
import { legacyDataCleared } from './workbenchLegacyPolicy'
import { MiraApps, inspectMiniappPackage } from './miraApps'
import { version as shellVersion } from '../../package.json'
import { electronWebRequest } from '../adapters/electronWebRequest'
import { HarnessRuntime } from './harnessRuntime'
import { resolveMiraRipgrepPath } from './miraRuntimeTools'
import { MiraFlowController } from './flows/miraFlowController'
import { McpConfigStore } from '../storage/mcpConfigStore'
import { McpManager } from '../adapters/mcpManager'
import { createMiraComputerConnection } from './miraComputerUse'
import { MiraComputerSettings } from './miraComputerSettings'
import { saveAutomationTask } from '../ipc/automationIpc'
import { AutomationScheduler } from './automationScheduler'
import { SkillMarketplaceService } from './skillMarketplace'
import type { MiraPaths } from '../storage/miraPaths'
import type { HarnessEvent } from '../../src/config/harness'
import { app, dialog, nativeTheme, net, safeStorage, session, shell } from 'electron'
import { MiraMcpCredentialStore } from '../storage/miraMcpCredentialStore'
import { MiraMcpAuthorization } from './miraMcpAuthorization'
import { join, resolve } from 'node:path'
import { open } from 'node:fs/promises'
import { APP_CAPABILITY_DESCRIPTIONS, parseInstalledAppCapabilities } from '../../src/config/appCapabilities'
import { appPackageIdentity } from '../security/appPackageIdentity'
import { MiraWorkspaceHtml } from './miraWorkspaceHtml'
import { MiraWorkspaceMedia } from './miraWorkspaceMedia'
import { AppRuntime } from './appRuntime'
import { AppModelService } from './appModelService'
import { AppNotificationService } from './appNotificationService'
import { AppSdkDispatcher } from './appSdkDispatcher'
import { AppViewManager } from './appViewManager'
import { AppAuthorizationService } from './appAuthorizationService'
import { resolveAppTheme } from '../../src/config/appCapabilities'

const TRASH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export interface PlatformServices {
  computerSettings: MiraComputerSettings
  workspaceHtml: MiraWorkspaceHtml
  workspaceMedia: MiraWorkspaceMedia
  database: PlatformDatabase
  localMicroAppServer: LocalMicroAppServer
  apps: MiraApps
  appRuntime: AppRuntime
  appViews: AppViewManager
  appNotifications: AppNotificationService
  appTheme: () => 'light' | 'dark'
  harnessRuntime: HarnessRuntime
  miraFlowController: MiraFlowController
  mcpConfigStore: McpConfigStore
  mcpManager: McpManager
  mcpAuthorization: MiraMcpAuthorization
  automationScheduler: AutomationScheduler
  skillMarketplace: SkillMarketplaceService
  cleanupExpiredTrash: () => void
}

export async function createPlatformServices({ miraPaths, publishHarnessEvent }: {
  miraPaths: MiraPaths
  publishHarnessEvent: (event: HarnessEvent) => void
}): Promise<PlatformServices> {
  const database = new PlatformDatabase(miraPaths)
  database.models.ensureBuiltinInstances()

  const cleanupExpiredTrash = () => {
    try {
      database.harness.cleanupExpiredTrash()
    } catch (error) {
      console.warn('[Mira] 回收站过期清理失败', error)
    }
  }
  cleanupExpiredTrash()
  setInterval(cleanupExpiredTrash, TRASH_CLEANUP_INTERVAL_MS)

  const mcpConfigStore = new McpConfigStore(miraPaths)
  database.harness.recoverInterruptedSubtasks()
  database.harness.recoverInterruptedCommands()
  const mcpAuthorization = new MiraMcpAuthorization(new MiraMcpCredentialStore(miraPaths, {
    encryptString: value => safeStorage.encryptString(value), decryptString: value => safeStorage.decryptString(value),
    isAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  }))
  const computerOptions = { resourceRoot: join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'plugins/computer-use'), configPath: join(miraPaths.config, 'computer-use.json') }
  const computerSettings = new MiraComputerSettings({ ...computerOptions, openExternal: url => shell.openExternal(url) })
  const mcpManager = new McpManager(mcpAuthorization.fork(), mcpAuthorization,
    () => createMiraComputerConnection(computerOptions))
  const harnessRuntime = new HarnessRuntime(database, mcpManager, publishHarnessEvent, mcpConfigStore,
    resolveMiraRipgrepPath({ appPath: app.getAppPath(), isPackaged: app.isPackaged, resourcesPath: process.resourcesPath }),
    electronWebRequest)
  const miraFlowController = new MiraFlowController({ database, runtime: harnessRuntime, paths: miraPaths,
    resourceRoot: app.isPackaged ? join(process.resourcesPath, 'mira-flow-host') : resolve(app.getAppPath(), 'dist/mira-flow-host') })
  const automationScheduler = new AutomationScheduler(database, harnessRuntime)
  harnessRuntime.setAutomationAuthoringHost(input => saveAutomationTask(database, automationScheduler, input))
  const skillMarketplace = new SkillMarketplaceService(miraPaths, database.skills, (input, init) => net.fetch(input, init), undefined, app.isPackaged ? join(process.resourcesPath, 'plugins') : join(app.getAppPath(), 'resources/plugins'), url => session.defaultSession.resolveProxy(url))
  await skillMarketplace.pluginMarkets.seed()
  try { void mcpManager.refresh(mcpConfigStore.list()) }
  catch { console.error('[mcp] MCP 配置读取失败；请在设置中检查配置文件后重试') }
  automationScheduler.start()
  const workspaceHtml = new MiraWorkspaceHtml()
  const workspaceMedia = new MiraWorkspaceMedia()
  const localMicroAppServer = new LocalMicroAppServer({
    mediaHandler: (id, request, response) => { void workspaceMedia.handle(id, request, response) },
    builtinRoots: { 'harness-react-app': app.isPackaged ? join(process.resourcesPath, 'harness-react-app') : resolve(app.getAppPath(), 'dist/harness-react-app') },
  })
  const preferences = database.getSnapshot().preferences
  const apps = new MiraApps(miraPaths, database, localMicroAppServer, shellVersion, (input, init) => net.fetch(input, init))
  const appRuntime = new AppRuntime(join(miraPaths.root, 'app-data'), database.appPermissions, id => apps.resolvePlatformApp(id))
  const appTheme = () => resolveAppTheme(database.getSnapshot().preferences.themeMode, nativeTheme.shouldUseDarkColors)
  const appModels = new AppModelService(database.models)
  const appNotifications = new AppNotificationService(id => apps.resolvePlatformApp(id) ? [...apps.state().installed, ...apps.miniapps()].find(item => item.id === id)?.name : undefined)
  const legacyPort = typeof preferences.workbenchLegacyPort === 'number' ? preferences.workbenchLegacyPort : typeof preferences.localMicroAppPort === 'number' ? preferences.localMicroAppPort : undefined
  let appViews: AppViewManager
  const appDispatcher = new AppSdkDispatcher(appRuntime, {
    getTheme: appTheme, generate: input => appModels.generate(input), notify: input => appNotifications.notify(input),
    readLegacyWorkbenchSites: id => legacyDataCleared(database.getSnapshot().preferences, id) ? Promise.resolve(null) : readWorkbenchLegacySites(id, localMicroAppServer.port, legacyPort),
    workbenchBrowser: (ownerId, input) => appViews.workbenchBrowser(ownerId, input),
    workbenchApp: (ownerId, input) => appViews.workbenchApp(ownerId, input),
    workbenchApps: ownerId => {
      appViews.workbenchOwner(ownerId)
      return apps.miniapps().map(item => {
        let approved = false
        try { approved = item.enabled && appRuntime.isApproved(item.id) } catch { /* The installation may have changed since the scan. */ }
        return { id: item.id, name: item.name, icon: apps.platformIcon(item.id), enabled: item.enabled, approved }
      })
    },
    reviewWorkbenchApp: async (ownerId, id, authorize) => {
      const owner = appViews.workbenchOwner(ownerId)
      if (['mira-workbench', 'mira-workbench-test'].includes(id)) throw new Error('应用 ID 无效')
      const authorization = new AppAuthorizationService(appRuntime, requested => {
        const app = apps.resolvePlatformApp(requested), item = apps.miniapps().find(entry => entry.id === requested)
        return app && item ? { ...app, name: item.name } : undefined
      }, async request => {
        const result = await dialog.showMessageBox(owner, { type: 'warning', title: '小程序权限', message: `允许「${request.name}」使用以下能力？`, detail: [`应用 ID：${request.id}`, ...(request.descriptions.length ? request.descriptions : ['此应用未申请额外能力'])].join('\n'), buttons: ['取消', '允许'], defaultId: 0, cancelId: 0, noLink: true })
        authorize(); appViews.workbenchOwner(ownerId)
        return result.response === 1
      }, requested => appViews.closeApp(requested))
      return authorization.review(id)
    },
    manageWorkbenchApp: async (ownerId, action, id, authorize) => {
      const owner = appViews.workbenchOwner(ownerId)
      if (action === 'install') {
        const selected = await dialog.showOpenDialog(owner, { title: '选择小程序安装包', properties: ['openFile'], filters: [{ name: 'Mira 应用包', extensions: ['zip', 'miniapp'] }] })
        authorize(); appViews.workbenchOwner(ownerId)
        if (selected.canceled || !selected.filePaths[0]) return false
        const file = await open(selected.filePaths[0], 'r')
        let bytes: Buffer
        try {
          const info = await file.stat()
          if (!info.isFile() || info.size < 1 || info.size > 64 * 1024 * 1024) throw new Error('应用安装包大小无效')
          bytes = Buffer.alloc(info.size + 1)
          let length = 0
          while (length < bytes.length) { const result = await file.read(bytes, length, bytes.length - length, length); if (!result.bytesRead) break; length += result.bytesRead }
          if (length !== info.size) throw new Error('应用安装包在读取时发生变化')
          bytes = bytes.subarray(0, length)
        } finally { await file.close() }
        authorize(); appViews.workbenchOwner(ownerId)
        const manifest = inspectMiniappPackage(bytes)
        const capabilities = parseInstalledAppCapabilities(manifest.id, manifest.requiredCapabilities)
        const name = manifest.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()
        if (!name) throw new Error('应用名称无效')
        const result = await dialog.showMessageBox(owner, { type: 'question', title: '安装小程序', message: `安装「${name}」？`, detail: [`应用 ID：${manifest.id}`, `版本：${manifest.version}`, '申请的能力：', ...(capabilities.length ? capabilities.map(item => APP_CAPABILITY_DESCRIPTIONS[item]) : ['未申请额外能力']), '安装后需重启，首次打开时还需授权。'].join('\n'), buttons: ['取消', '安装'], defaultId: 0, cancelId: 0, noLink: true })
        authorize(); appViews.workbenchOwner(ownerId)
        if (result.response !== 1) return false
        apps.installMiniapp(bytes)
        return true
      }
      if (!id || ['mira-workbench', 'mira-workbench-test', 'mira-harness'].includes(id)) throw new Error('应用 ID 无效')
      const target = apps.miniapps().find(item => item.id === id)
      if (!target) throw new Error('未找到小程序')
      const identity = appPackageIdentity(target.directory)
      const result = await dialog.showMessageBox(owner, { type: 'warning', title: action === 'revoke' ? '撤销权限' : '卸载小程序', message: action === 'revoke' ? `撤销「${target.name}」的权限？` : `卸载「${target.name}」？`, detail: action === 'revoke' ? '再次打开时需要重新授权。' : '应用数据会保留。', buttons: ['取消', action === 'revoke' ? '撤销权限' : '卸载'], defaultId: 0, cancelId: 0, noLink: true })
      authorize(); appViews.workbenchOwner(ownerId)
      if (result.response !== 1) return false
      if (appPackageIdentity(target.directory) !== identity) throw new Error('应用已变化，请重新确认')
      if (action === 'revoke') { appRuntime.revokeApproval(id); appViews.closeApp(id) }
      else apps.uninstall(id)
      return true
    },
  })
  appViews = new AppViewManager(appRuntime, appDispatcher, id => apps.resolvePlatformEntry(id))
  apps.onAppInvalidated((id, reason) => {
    appViews.closeApp(id)
    if (reason === 'disabled') appRuntime.invalidateApp(id)
    else appRuntime.revokeApproval(id)
  })
  apps.scan()
  const preferredPort = typeof preferences.localMicroAppPort === 'number' ? preferences.localMicroAppPort : undefined
  await localMicroAppServer.start(apps.snapshot(true).microApps, preferredPort)
  if (localMicroAppServer.port && preferences.localMicroAppPort !== localMicroAppServer.port) {
    if (legacyPort !== undefined && preferences.workbenchLegacyPort === undefined) database.savePreference('workbenchLegacyPort', legacyPort)
    database.savePreference('localMicroAppPort', localMicroAppServer.port)
  }
  apps.scan()

  return { computerSettings, workspaceHtml, workspaceMedia, database, localMicroAppServer, apps, appRuntime, appViews, appNotifications, appTheme, harnessRuntime, miraFlowController, mcpConfigStore, mcpManager, mcpAuthorization, automationScheduler, skillMarketplace, cleanupExpiredTrash }
}

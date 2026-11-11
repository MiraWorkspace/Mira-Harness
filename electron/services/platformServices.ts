import { PlatformDatabase } from '../storage/database'
import { LocalMicroAppServer } from '../adapters/localMicroAppServer'
import { readWorkbenchLegacySites } from './workbenchLegacyData'
import { fetchWorkbenchSiteIcon } from './workbenchSiteIcon'
import { legacyDataCleared } from './workbenchLegacyPolicy'
import { MiraApps } from './miraApps'
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
import { AppFiles, relativeFilePath } from './appFiles'
import { LegacyWorkbenchMiniapps } from './legacyWorkbenchMiniapps'
import { MiraWorkspaceHtml } from './miraWorkspaceHtml'
import { MiraWorkspaceMedia } from './miraWorkspaceMedia'
import { AppRuntime } from './appRuntime'
import { AppModelService } from './appModelService'
import { AppWebService } from './appWebService'
import { AppNotificationService } from './appNotificationService'
import { AppSdkDispatcher } from './appSdkDispatcher'
import { AppViewManager } from './appViewManager'
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
  const appFiles = new AppFiles(join(miraPaths.root, 'app-data'))
  const legacyMiniapps = new LegacyWorkbenchMiniapps(miraPaths.apps, join(miraPaths.root, 'app-data'))
  const appTheme = () => resolveAppTheme(database.getSnapshot().preferences.themeMode, nativeTheme.shouldUseDarkColors)
  const appWeb = new AppWebService(electronWebRequest)
  const appModels = new AppModelService(database.models, undefined, appWeb)
  const appNotifications = new AppNotificationService(id => apps.resolvePlatformApp(id) ? apps.state().installed.find(item => item.id === id)?.name : undefined)
  const legacyPort = typeof preferences.workbenchLegacyPort === 'number' ? preferences.workbenchLegacyPort : typeof preferences.localMicroAppPort === 'number' ? preferences.localMicroAppPort : undefined
  let appViews: AppViewManager
  const appDispatcher = new AppSdkDispatcher(appRuntime, {
    getTheme: appTheme, generate: input => appModels.generate(input), notify: input => appNotifications.notify(input),
    listProviders: () => appModels.listProviders(), listModels: id => appModels.listModels(id), chat: (input, authorize) => appModels.chat(input, authorize),
    search: input => appWeb.search(input),
    readLegacyWorkbenchSites: id => legacyDataCleared(database.getSnapshot().preferences, id) ? Promise.resolve(null) : readWorkbenchLegacySites(id, localMicroAppServer.port, legacyPort),
    workbenchBrowser: (ownerId, input) => appViews.workbenchBrowser(ownerId, input),
    workbenchSiteIcon: url => fetchWorkbenchSiteIcon(url, (input, init) => net.fetch(input, init)),
    files: async (appId, ownerId, method, input, authorize) => {
      if (method === 'files.directories') return appFiles.directories(appId)
      if (method === 'files.read') return appFiles.read(appId, input as never)
      if (method === 'files.write') return appFiles.write(appId, input as never)
      if (method === 'files.list') return appFiles.list(appId, input)
      if (method === 'files.remove') return appFiles.remove(appId, input as never)
      if (method === 'files.revoke') { if (typeof input.id !== 'string') throw new Error('目录授权无效'); return appFiles.revoke(appId, input.id) }
      if (method === 'files.selectDirectory') {
        if (!['read', 'readwrite'].includes(input.access as string)) throw new Error('目录权限无效')
        const selected = await dialog.showOpenDialog(appViews.ownerWindow(ownerId), { title: input.access === 'read' ? '授权应用读取目录' : '授权应用读写目录', properties: ['openDirectory'] })
        authorize(); appViews.ownerWindow(ownerId)
        return selected.canceled || !selected.filePaths[0] ? null : appFiles.grant(appId, selected.filePaths[0], input.access as 'read' | 'readwrite')
      }
      throw new Error('不支持的文件方法')
    },
    views: (appId, ownerId, input) => {
      if (input.type === 'open') relativeFilePath(input.entry)
      return appViews.ownedView(ownerId, input, { mount: (id, directory, entry) => localMicroAppServer.mountResource(id, directory, entry), unmount: id => localMicroAppServer.unmountResource(id) }, input.type === 'open' ? appFiles.resolve(appId, input.directory) : undefined)
    },
    legacyMiniapps: (appId, input) => legacyMiniapps.read(appId, input),
  })
  appViews = new AppViewManager(appRuntime, appDispatcher, id => apps.resolvePlatformEntry(id))
  apps.onAppInvalidated((id, reason) => {
    appViews.closeApp(id)
    if (reason === 'disabled') appRuntime.invalidateApp(id)
    else appRuntime.revokeApproval(id)
  })
  apps.scan()
  const preferredPort = typeof preferences.localMicroAppPort === 'number' ? preferences.localMicroAppPort : undefined
  await localMicroAppServer.start(apps.snapshot().microApps, preferredPort)
  if (localMicroAppServer.port && preferences.localMicroAppPort !== localMicroAppServer.port) {
    if (legacyPort !== undefined && preferences.workbenchLegacyPort === undefined) database.savePreference('workbenchLegacyPort', legacyPort)
    database.savePreference('localMicroAppPort', localMicroAppServer.port)
  }
  apps.scan()

  return { computerSettings, workspaceHtml, workspaceMedia, database, localMicroAppServer, apps, appRuntime, appViews, appNotifications, appTheme, harnessRuntime, miraFlowController, mcpConfigStore, mcpManager, mcpAuthorization, automationScheduler, skillMarketplace, cleanupExpiredTrash }
}

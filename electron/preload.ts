import { contextBridge } from 'electron'
import { platformApi } from './preload/platformApi'
import { windowApi } from './preload/windowApi'
import { modelApi } from './preload/modelApi'
import { harnessApi } from './preload/harnessApi'
import { automationApi } from './preload/automationApi'
import { mcpApi } from './preload/mcpApi'
import { miraFlowApi } from './preload/miraFlowApi'
import { notificationApi } from './preload/notificationApi'

contextBridge.exposeInMainWorld('platform', {
  ...platformApi,
  ...windowApi,
  ...modelApi,
  ...harnessApi,
  ...automationApi,
  ...mcpApi,
  ...miraFlowApi,
  ...notificationApi,
})

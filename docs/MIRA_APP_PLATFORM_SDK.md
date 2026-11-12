# Mira 子应用底层 SDK（API 1.4 / SDK 0.4.0）

Mira 与 Harness 是同一个主应用。Workbench 等第一方可选安装应用称为子应用。Mira 管理这些子应用的安装、身份、隔离存储和原生视图；Workbench 是自己小程序的宿主，拥有小程序包格式、注册表、安装、运行、授权、目录读写权限、更新和卸载逻辑。

```text
Mira / Harness
└── 第一方子应用 Workbench（或其他子应用）
    └── 子应用自己管理的小程序 / 内容
```

小程序不注册为 Mira 子应用，不进入 Mira 应用扩展或选择器，也不直接获得 Mira 的 SDK 会话。小程序的 SDK 通道连接 Workbench；Workbench 校验请求身份和自身保存的权限，然后按需调用 Mira 通用 SDK。Mira 只校验真实调用者 Workbench 的底层能力，不保存 Workbench 小程序的业务授权。

## 第一方子应用

第一方子应用使用 `app-manifest.json`，包含 `id`、`name`、SemVer `version`、包内 `entry`、`minShellVersion`、`platformApi`、`requiredCapabilities`。使用 API 1.3 的应用必须声明 `platformApi: { "major": 1, "minor": 3 }`。第一方子应用仍通过调试目录扫描或“发现”安装更新；其生命周期不受 Workbench 管理。子应用不能通过 SDK 选择其他子应用的身份。

```ts
import { connectMiraApp } from '@mira/app-sdk'
const sdk = await connectMiraApp()
const context = await sdk.context.get()
```

SDK 源码已迁至独立仓库 [Mira-App-SDK](https://github.com/MiraWorkspace/Mira-App-SDK)，不再包含于 Harness 的 `packages` 中。0.4.0 已通过 GitHub 标签 `v0.4.0` 分发，尚未发布到 npm。子应用执行 `npm install github:MiraWorkspace/Mira-App-SDK#v0.4.0`，仍从 `@mira/app-sdk` 导入；GitHub 安装会自动构建 JavaScript 与类型声明，需要开发环境提供 Node.js、npm 和 Git。Harness 的宿主集成测试通过开发依赖固定该线上标签，锁文件记录确切提交，不依赖临时本地包或相邻源码目录。

SDK 已配置为可发布到 npm 的公共包；正式发布后，子应用可改用 `npm install @mira/app-sdk@0.4.0`。维护者在独立 SDK 项目中执行 `npm ci`、`npm test` 和 `npm pack --dry-run` 检查产物，登录具有 `@mira` scope 权限的 npm 账号后执行 `npm publish`；打包与发布会自动构建，发布目标固定为 npm 官方仓库。已发布版本不能覆盖，SDK 更新需要发布新版本，并由子应用更新依赖后重新构建。

SDK 0.2.0 移除了 `sdk.workbench.apps/install/review/uninstall/revoke/app`。旧 Workbench 包需要随新 SDK 重新构建，不能继续调用被移除的接口。

## 底层能力

| 清单能力 | SDK | Mira 负责的边界 |
| --- | --- | --- |
| `storage:app` | `storage.migrate`、`storage.transaction` | 当前子应用独立 SQLite；可选 namespace 在该子应用内部隔离 |
| `files:app` | `files.read/write/list/remove` | 当前子应用专属文件目录，或明确选择授权的目录 |
| `files:app` | `files.selectDirectory/directories/revoke` | 原生目录选择器、绑定当前子应用的持久化句柄、只读/读写及撤销校验 |
| `views:create` | `views.control`、`views.subscribe` | 隔离原生视图、父子归属、布局裁剪、消息运输与关闭 |
| `appearance:read` | `appearance.get/subscribe` | 主题读取与订阅 |
| `models:generate` | `models.listProviders/listModels/chat/generate` | 可用供应商/聊天模型选择与文本多轮调用，供应商密钥不离开 Mira |
| `web:search` | `web.search`、允许联网对话的 `web_search/web_fetch` | 复用宿主多源搜索、公开网页提取和网络限制 |
| `notifications:send` | `notifications.send` | 系统通知 |
| `workbench:manage` | `workbench.browser`、`workbench.fetchMiniappResource`、网站旧数据导入 | 网站浏览兼容与小程序资源下载，不含小程序生命周期 |

文件默认位于 `~/.mira/app-data/files/<子应用id>/`。所有路径为相对路径；拒绝路径穿越、符号链接和平台不兼容路径。写入使用临时文件后原子替换，单文件最大 64 MiB。目录授权句柄由 Mira 创建并绑定真实子应用身份；调用者不能通过提供绝对路径访问其他目录。授权句柄元数据位于文件沙箱之外，小程序无法直接改写。

```ts
await sdk.files.write({ path: 'documents/note.txt', data: new TextEncoder().encode('note') })
const grant = await sdk.files.selectDirectory('read')
if (grant) await sdk.files.read({ grant: grant.id, path: 'report.txt' })
await sdk.storage.migrate(migrations, 'private-namespace')
await sdk.storage.transaction(operations, 'private-namespace')
```

SQLite namespace 是当前子应用的内部标识，不是 Mira 应用 ID；不同子应用即使使用同名 namespace，也访问不同数据库。子应用自行决定如何分配 namespace 及其业务授权。撤销子应用会话会同时关闭其 namespace 数据库；用户明确清除子应用数据时，也会清除其全部 namespace 数据库。

## 模型调用（API 1.3）

公开类型与客户端维护在 Mira-App-SDK，宿主实现位于 `appModelService.ts`。供应商/模型列表仅返回可用的聊天项 `{ id, name }`，不暴露密钥、API 地址或完整配置。查询列表不发起生成请求。

```ts
const providers = await sdk.models.listProviders()
const models = await sdk.models.listModels(providerId)
const result = await sdk.models.chat({
  providerId, modelId,
  messages: [{ role: 'user', content: '你好' }],
})
```

`chat` 显式指定供应商与模型，每次提交完整 `user/assistant` 文本历史，可选独立 `system`。最多 100 条消息、文本合计 100000 字符，首尾必须是用户消息。返回完整文本，输出最多为模型配置和 2048 token 的较小值，超时 60 秒；暂不支持流式、附件或任意工具注册。调用方维护历史，宿主不创建对话记录。

保留 `generate({ prompt, providerId?, modelId? })`；省略模型时需要全局默认模型，未设置时返回 `MODEL_NOT_CONFIGURED`，显式选择不依赖默认模型。不可用选择返回 `MODEL_UNAVAILABLE`，远端请求失败返回 `MODEL_REQUEST_FAILED`；不透传供应商原始错误。所有方法均校验真实会话与 `models:generate`，异步回答返回前再次授权。Workbench 另行检查小程序权限，小程序不能直接获得 Mira 会话。

## 联网搜索与自主联网对话（API 1.3）

公开接口在 Mira-App-SDK 0.3.0 维护，宿主适配位于 `appWebService.ts`，复用现有 `createWebSearchTool/createWebFetchTool` 与 `electronWebRequest`，不另外实现搜索引擎。SDK 搜索和联网对话共享服务实例内冷却状态；与主对话 Agent 的引用和冷却状态分开。

`web.search({ query, limit?, engine? })` 需要独立 `web:search`，无须模型配置。默认 `engine: auto`，宿主并发回退搜索源；可选 engine 用于定向/诊断。query 最长 2000 字符，limit 默认 5、整数 1–10；25 秒总搜索预算，SDK 等待至少 35 秒。返回查询词、命中源、标题/URL/摘要、尝试状态/耗时，不返回原始错误或 Agent 来源编号。全部搜索失败返回 `WEB_SEARCH_FAILED`。

`models.chat({ providerId, modelId, messages, webSearch: true })` 同时需要模型与搜索权限，让 AI 自主搜索、读取公开网页并综合回答，正常用户不选择搜索源。模型可发起并行调用，宿主每批最多并发 3 项，总计最多 8 次工具执行、6 次模型调用、60 秒总预算。返回完整回答和 `sources: { index, title, url }[]`，与回答中的 `[[source:N]]` 对应；每次请求单独编号。仅提供搜索和读取工具，不开放任意工具。省略联网开关保持普通模型调用。

模型、工具及网络步骤开始前和最终回答交付前检查真实宿主权限；Workbench 另行检查小程序权限。撤权会阻止后续步骤和结果交付，已发起请求可能继续执行。工具失败返回安全提示给模型，不透传原始上游异常。网页/摘要是外部资料，不能当作指令或已核验正文；发现的链接不一定都已读取。

## 隔离视图与消息

```ts
const unsubscribe = sdk.views.subscribe(async ({ event, value }) => {
  if (event !== 'views.request') return
  // 根据自有注册表定位 viewId 对应对象并校验权限，不能信任 params 自报身份。
  const result = await yourAuthorizedHandler(value.viewId, value.method, value.params)
  await sdk.views.control({ type: 'reply', id: value.viewId, requestId: value.requestId, ok: true, value: result })
})
const id = await sdk.views.control({ type: 'open', key: 'notes', directory: 'content/release-1', entry: 'index.html' })
```

`directory` 必须属于当前子应用的专属文件区，不能指定其他子应用或外部目录。Mira 不解析该目录的业务清单，也不作安装、版本或小程序权限决策。视图启用 sandbox、contextIsolation，禁用 Node、webview、弹窗、下载和系统权限请求；本地资源限制在该视图挂载的目录。会话绑定主框架，导航或销毁即失效。视图消息不会直接进入 Mira 的模型、文件或数据库分发器，而是进入创建者的 `views.request`。

父子关系由 Mira 验证，其他子应用或兄弟视图不能布局、关闭或回复不属于自己的视图。父视图关闭时子视图一起关闭。`views.closed` 通知创建者清理状态。子应用可用 `event` 控制向自有内容发送的事件。系统主题不会自动授权给子视图。

## Workbench 小程序下载（API 1.4）

SDK 0.4.0 新增 `sdk.workbench.fetchMiniappResource(url, 'manifest' | 'package')`，返回原始 `Uint8Array`。仅批准了 `workbench:manage` 的 Workbench 正式版/测试版会话可调用，普通子应用即使声明相同权限也不可调用；完成前再次检查授权。

传输由 `workbenchMiniappResource.ts` 复用 `electronWebRequest`，只接受不含凭证/片段的 HTTPS 地址，拒绝已识别的本机/内网地址，不带会话 cookie，不跟随重定向。清单上限 64 KiB、15 秒，包上限 64 MiB、60 秒；流式计数限制不依赖服务端报告的 Content-Length。

Mira 不解析发布清单、不安装小程序，也不作小程序权限决策。Workbench 负责清单与包同源、大小、SHA-256、包内声明、版本、权限确认及安装回滚。小程序的 Workbench 消息通道不开放此下载方法。既有小程序模型/联网能力仍只要求 API 1.3；Workbench 在用户发起网址安装时检查 Mira API 1.4，旧宿主提示升级。

## Workbench 一次性迁移

为兼容旧实现，`storage.legacyWorkbenchMiniapps(id?)` 仅允许 Workbench 正式版/测试版使用。无 id 时返回旧 `~/.mira/apps/.miniapps/` 的目录列表；有 id 时只读导出旧包，并以 SQLite backup 保留旧独立数据库到 Workbench 对应 namespace。源包、源数据库不删除，已有目标数据库不覆盖。旧授权不迁移，用户需在 Workbench 重新审阅。

迁移适配器不安装、运行或授权小程序。正常的 Mira 扫描与应用注册不再读取 `.miniapps`。Workbench 注册表事务成功后记录迁移完成，失败可重试。旧版本暂存但尚未生效的 `.update-*` 目录仍保留在原位置，不会被静默激活。

## 验证边界

相关测试覆盖文件沙箱、目录读写限制、子视图归属、SDK 消息、Workbench 安装更新卸载和真实 macOS Electron 通道。Windows 安装版、第三方真实应用兼容性和发布者签名不在这些测试结果之内。

# Mira 子应用底层 SDK（API 1.2 / SDK 0.2.0）

Mira 与 Harness 是同一个主应用。Workbench 等第一方可选安装应用称为子应用。Mira 管理这些子应用的安装、身份、隔离存储和原生视图；Workbench 是自己小程序的宿主，拥有小程序包格式、注册表、安装、运行、授权、目录读写权限、更新和卸载逻辑。

```text
Mira / Harness
└── 第一方子应用 Workbench（或其他子应用）
    └── 子应用自己管理的小程序 / 内容
```

小程序不注册为 Mira 子应用，不进入 Mira 应用扩展或选择器，也不直接获得 Mira 的 SDK 会话。小程序的 SDK 通道连接 Workbench；Workbench 校验请求身份和自身保存的权限，然后按需调用 Mira 通用 SDK。Mira 只校验真实调用者 Workbench 的底层能力，不保存 Workbench 小程序的业务授权。

## 第一方子应用

第一方子应用使用 `app-manifest.json`，包含 `id`、`name`、SemVer `version`、包内 `entry`、`minShellVersion`、`platformApi`、`requiredCapabilities`。使用 API 1.2 的应用必须声明 `platformApi: { "major": 1, "minor": 2 }`。第一方子应用仍通过调试目录扫描或“发现”安装更新；其生命周期不受 Workbench 管理。子应用不能通过 SDK 选择其他子应用的身份。

```ts
import { connectMiraApp } from '@mira/app-sdk'
const sdk = await connectMiraApp()
const context = await sdk.context.get()
```

SDK 源码位于 `packages/mira-app-sdk`，已配置为可发布到 npm 的公共包；正式发布后，子应用执行 `npm install @mira/app-sdk@0.2.0` 即可使用，无需本地路径依赖。维护者在 SDK 目录执行 `npm pack --dry-run` 检查产物，登录具有 `@mira` scope 权限的 npm 账号后执行 `npm publish`；打包与发布会自动构建 JavaScript 和类型声明，发布目标固定为 npm 官方仓库。已发布版本不能覆盖，SDK 更新需要发布新版本，并由子应用更新依赖后重新构建。

SDK 0.2.0 移除了 `sdk.workbench.apps/install/review/uninstall/revoke/app`。旧 Workbench 包需要随新 SDK 重新构建，不能继续调用被移除的接口。

## 底层能力

| 清单能力 | SDK | Mira 负责的边界 |
| --- | --- | --- |
| `storage:app` | `storage.migrate`、`storage.transaction` | 当前子应用独立 SQLite；可选 namespace 在该子应用内部隔离 |
| `files:app` | `files.read/write/list/remove` | 当前子应用专属文件目录，或明确选择授权的目录 |
| `files:app` | `files.selectDirectory/directories/revoke` | 原生目录选择器、绑定当前子应用的持久化句柄、只读/读写及撤销校验 |
| `views:create` | `views.control`、`views.subscribe` | 隔离原生视图、父子归属、布局裁剪、消息运输与关闭 |
| `appearance:read` | `appearance.get/subscribe` | 主题读取与订阅 |
| `models:generate` | `models.generate` | 模型调用，供应商密钥不离开 Mira |
| `notifications:send` | `notifications.send` | 系统通知 |
| `workbench:manage` | `workbench.browser`、网站旧数据导入 | 既有网站浏览兼容接口，不含小程序生命周期 |

文件默认位于 `~/.mira/app-data/files/<子应用id>/`。所有路径为相对路径；拒绝路径穿越、符号链接和平台不兼容路径。写入使用临时文件后原子替换，单文件最大 64 MiB。目录授权句柄由 Mira 创建并绑定真实子应用身份；调用者不能通过提供绝对路径访问其他目录。授权句柄元数据位于文件沙箱之外，小程序无法直接改写。

```ts
await sdk.files.write({ path: 'documents/note.txt', data: new TextEncoder().encode('note') })
const grant = await sdk.files.selectDirectory('read')
if (grant) await sdk.files.read({ grant: grant.id, path: 'report.txt' })
await sdk.storage.migrate(migrations, 'private-namespace')
await sdk.storage.transaction(operations, 'private-namespace')
```

SQLite namespace 是当前子应用的内部标识，不是 Mira 应用 ID；不同子应用即使使用同名 namespace，也访问不同数据库。子应用自行决定如何分配 namespace 及其业务授权。撤销子应用会话会同时关闭其 namespace 数据库；用户明确清除子应用数据时，也会清除其全部 namespace 数据库。

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

## Workbench 一次性迁移

为兼容旧实现，`storage.legacyWorkbenchMiniapps(id?)` 仅允许 Workbench 正式版/测试版使用。无 id 时返回旧 `~/.mira/apps/.miniapps/` 的目录列表；有 id 时只读导出旧包，并以 SQLite backup 保留旧独立数据库到 Workbench 对应 namespace。源包、源数据库不删除，已有目标数据库不覆盖。旧授权不迁移，用户需在 Workbench 重新审阅。

迁移适配器不安装、运行或授权小程序。正常的 Mira 扫描与应用注册不再读取 `.miniapps`。Workbench 注册表事务成功后记录迁移完成，失败可重试。旧版本暂存但尚未生效的 `.update-*` 目录仍保留在原位置，不会被静默激活。

## 验证边界

相关测试覆盖文件沙箱、目录读写限制、子视图归属、SDK 消息、Workbench 安装更新卸载和真实 macOS Electron 通道。Windows 安装版、第三方真实应用兼容性和发布者签名不在这些测试结果之内。

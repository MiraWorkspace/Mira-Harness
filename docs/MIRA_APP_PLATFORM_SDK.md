# Mira 可安装应用 SDK（v1）

本文描述当前桌面端实现及其限制。Mira 与 Harness 指同一个主应用；Workbench 等可选安装应用称为子应用。第一方子应用通过调试目录扫描或“发现”下载安装，直接使用清单声明的 SDK 能力，不显示权限授权弹窗。Workbench 提供网站和第三方小程序入口。普通网站在独立浏览器会话中运行，不获得应用 SDK。第三方小程序使用自己的安装身份和授权，不继承 Workbench 的权限。

## 应用包

第一方子应用在开发时将包含 `app-manifest.json` 和静态网页资源的构建目录复制到 `~/.mira/apps/<id>/`，由 Mira 扫描识别；真实用户通过“发现”下载安装发布包。应用扩展页不提供本地包选择安装入口。Workbench 接入的第三方小程序支持 ZIP 包，也可使用 `.miniapp` 扩展名，底层均按 ZIP 解压。首版不启动包内后台进程、不执行安装脚本或原生模块。构建输出应使用相对资源路径；入口必须在包内。示例：

```json
{
  "manifestVersion": 1,
  "id": "example-notes",
  "name": "示例笔记",
  "version": "1.0.0",
  "entry": "index.html",
  "runtime": "platform",
  "icon": "icon.png",
  "minShellVersion": "0.1.0-beta.1",
  "platformApi": { "major": 1, "minor": 1 },
  "requiredCapabilities": ["storage:app", "appearance:read"]
}
```

`id` 由小写字母、数字和连字符组成，以字母开头，最长 64 字符；`version` 和 `minShellVersion` 使用 SemVer。`entry` 与可选 `icon` 是包内相对路径。`runtime: "platform"` 选择隔离应用运行时，即使没有申请任何额外能力也能连接 SDK；该声明要求 API 1.1。旧包未声明运行时且申请能力时仍使用平台运行时，未声明且没有能力时保留旧的网页加载方式。清单版本、最低宿主版本和 API 版本不兼容时，宿主拒绝加载。第一方子应用安装或更新后按原有流程重启加载，不要求用户审阅 SDK 权限。Workbench 的第三方小程序在安装前展示申请的能力，首次打开及安装内容变化后需要审阅授权；安装确认本身不授予 SDK 权限。第三方小程序由宿主存入 `~/.mira/apps/.miniapps/<id>/`，不会进入 Mira 的子应用选择器或应用扩展列表；不能通过清单自报第一方身份，也不能替换第一方子应用。

包大小上限为 64 MiB，解压后上限为 256 MiB、10000 个条目。禁止路径穿越和重复路径，应用目录中的符号链接不被信任。更新要求新版本高于已安装版本，暂存后在重启时切换；卸载默认保留应用数据库。已安装应用可在应用扩展页单独清除数据库，操作需要用户确认并关闭应用；已卸载应用的数据目前没有界面清除入口。当前本地包没有发布者签名，应用 ID 不是发布者身份凭证，用户应审阅安装来源及权限。远程 manifest 安装和发布者信任体系不属于本契约首版。

## 集成 SDK

SDK 源码位于 `packages/mira-app-sdk`。在 Mira-Harness 仓库中执行 `npm --prefix packages/mira-app-sdk run build`，再进入该目录执行 `npm pack` 生成可安装的 SDK 包；当前尚未发布公共包。独立应用可依赖生成的版本化包，将 SDK 与网页一同打包。

```ts
import { connectMiraApp } from '@mira/app-sdk'

const sdk = await connectMiraApp()
const { appId, capabilities } = await sdk.context.get()
const theme = await sdk.appearance.get()
const unsubscribe = sdk.appearance.subscribe(next => {
  document.documentElement.dataset.theme = next
})

// 应用结束时调用 unsubscribe() 和 sdk.dispose()。
```

SDK 连接由 Mira 为已安装的页面创建。调用方不能通过传入应用 ID 选择数据库或冒充其他应用；页面导航、关闭、停用、卸载或撤权后，原连接失效。第一方子应用不依赖用户授权记录；第三方小程序被拒绝授权时不会获得连接。权限撤销期间正在进行的模型调用不会把迟到结果交还应用。

## 能力与权限

| 清单权限 | SDK 方法 | 行为 |
| --- | --- | --- |
| `storage:app` | `storage.migrate`、`storage.transaction` | 操作当前应用独立 SQLite 数据库 |
| `appearance:read` | `appearance.get`、`appearance.subscribe` | 读取 `light` / `dark` 并订阅变化 |
| `models:generate` | `models.generate` | 使用 Mira 已配置模型，返回文本，不返回供应商凭据 |
| `notifications:send` | `notifications.send` | 经 Mira 发送系统通知 |

`context.get()` 返回宿主绑定的应用 ID、API 版本与已授权能力，不需要额外权限。模型请求包含 `prompt`，可同时提供 `providerId` 和 `modelId`；未指定时使用 Mira 默认模型。通知请求包含 `title` 和可选 `body`，是否可见还取决于操作系统通知设置。

`workbench:manage` 及 `sdk.workbench`、`storage.importLegacyWorkbenchSites` 是 Workbench 专用宿主接口，不能由普通小程序申请。权限检查在主进程执行；Workbench 转发或消息内容不能替代小程序自己的授权。

## 应用数据库

应用以声明式版本迁移定义表结构，SDK 不提供任意 SQL 或文件路径。首次启动和每次版本升级时可重复提交同一迁移；已执行迁移的内容不能修改，新增迁移必须使用连续版本。表、列标识符以字母开头，只能包含字母、数字和下划线；保留的 `sqlite_` 与 `mira_` 前缀不可使用。

```ts
await sdk.storage.migrate([{
  version: 1,
  tables: [{ name: 'notes', columns: [
    { name: 'id', type: 'TEXT', primaryKey: true },
    { name: 'title', type: 'TEXT', notNull: true },
  ] }],
}])
await sdk.storage.transaction([
  { type: 'insert', table: 'notes', values: { id: 'one', title: '第一条' } },
])
const [rows] = await sdk.storage.transaction([
  { type: 'select', table: 'notes', orderBy: [{ column: 'id', direction: 'asc' }] },
])
```

支持 `TEXT`、`INTEGER`、`REAL` 字段、在后续版本添加可空列，以及结构化 `insert`、`update`、`delete`、`select`。更新和删除必须包含条件。一个事务原子执行，失败时回滚；单次最多 10000 个操作、100 个查询及 4 MiB 请求内容，每个查询最多返回 1000 行，可使用 `offset` 分页。单条字符串值上限为 1 MiB。业务迁移由应用调用 SDK 完成，不执行应用提供的 SQL 或安装脚本。

## 错误与运行限制

SDK 请求失败抛出 `MiraSdkError`。常见代码包括 `UNAVAILABLE`、`TIMEOUT`、`DISCONNECTED`、`CAPABILITY_DENIED`、`INVALID_REQUEST`、`UNKNOWN_METHOD`、`BUSY` 和 `PLATFORM_ERROR`。应用应提示失败并允许用户重试，不能把超时视为操作成功。主题订阅返回取消函数；退出时释放订阅和连接。

应用页面运行于隔离 Electron 会话，禁止 Node 集成、子 frame、Worker、远程脚本和原生权限请求。应用可访问自身包内资源；远端 HTTPS 可用于连接和图片，不能从其他应用包加载脚本或资源。应用的 API 结果只能代表当前授权；它不能访问其他应用数据库或 Mira 供应商密钥。

## 验证状态

仓库测试覆盖独立数据库、迁移回滚、授权撤销、应用视图隔离，以及真实 Electron 中 Workbench 打开示例应用的 SDK 链路；该链路中的模型和通知使用替身。macOS 与 Windows 安装版的安装、更新、重启、卸载、权限和真实模型/通知验收仍需分别完成。不要将构建或模拟测试等同于安装版验收。

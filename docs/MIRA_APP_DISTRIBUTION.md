# Mira 可选应用：本地调试与线上目录

## 当前交付边界

已实现本地应用发现、名称/Logo/版本/DEV 标签、启停、应用选择器与本地静态入口加载；已实现 GitHub Release JSON 请求、校验、兼容版本选择和缓存回退，以及正式 ZIP 的首次安装与本地应用卸载。升级替换与回滚尚未实现；当前不提供一键升级，不自动替换本地文件。

## 三份数据各自负责什么

| 数据 | 位置 | 职责 |
| --- | --- | --- |
| 线上目录 | GitHub Release 的 `apps-catalog.json` 附件 | 可选应用、发布版本、兼容性、包 URL、大小、SHA-256 |
| 应用清单 | `~/.mira/apps/<id>/app-manifest.json` | 包自身名称、Logo、版本、入口和测试标志 |
| 用户状态 | Mira 本地偏好 | `localAppsEnabled` 保存启停；`appsCatalogUrl` 保存目录来源 |

本地应用扫描结果仅合并进运行时快照，不写入内置应用注册表。Harness 保持内置，不能被同 ID 的本地应用覆盖。

## 本地包格式

```text
~/.mira/apps/mira-workbench-test/
├── app-manifest.json
├── index.html
├── mira-workbench-logo.png
└── assets/
```

```json
{
  "manifestVersion": 1,
  "id": "mira-workbench-test",
  "name": "Mira Workbench",
  "version": "0.1.0",
  "description": "聚合常用 AI 网站与搜索工具，支持自定义网站和内部标签页。",
  "icon": "mira-workbench-logo.png",
  "entry": "index.html",
  "test": true,
  "minShellVersion": "0.1.0-beta.1",
  "platformApi": { "major": 1, "minor": 0 },
  "requiredCapabilities": []
}
```

- ID 必须与目录名一致，仅含小写字母、数字、连字符，字母开头；正式 Workbench 使用 `mira-workbench`，测试版使用 `mira-workbench-test`，两者可并存。
- `name`、`version`、`entry`、兼容性和能力数组必填；`icon`、`description`、`test` 可选，`test` 默认为 false。版本使用 SemVer。
- 入口与图标都是包内相对文件路径，禁止绝对地址、上级目录与越界符号链接。应用目录本身不能是符号链接；清单最大 64 KB。
- 当前宿主 API 为 1.0：major 必须相同，宿主 minor 必须大于等于所需 minor；宿主版本还须满足 `minShellVersion`。
- 当前本地加载通道只承载 iframe 静态网页，`requiredCapabilities` 必须为空；包自己声明能力不会得到授权。第一方能力授权仍遵守 [SDK 契约](MIRA_FIRST_PARTY_SDK_CONTRACT.md)。
- 静态资源须支持子路径，Vite 使用 `base: './'`。包不能依赖 Node.js 或直接调用宿主 IPC。各应用需自行使用独立的存储键；当前承载方式不提供独立的应用存储分区。

Mira 启动时自动扫描，进入“设置 → 应用扩展”也会扫描，粘贴或更新文件后重新进入该页即可刷新。有效且启用的应用进入前台选择器，测试版在设置与选择器显示 DEV 标识。无效包不会进入选择器；调试列表不显示内部错误。删除应用目录并重新进入该页即可移除本地入口。

Workbench 提供 `npm run install:test`：构建测试版并复制整个 `dist` 的内容到上述目录。测试脚本仅允许覆盖同 ID 且 `test: true` 的测试目录。测试版和正式版的网站配置使用不同存储键。

## 线上目录与发布维护

以 [apps-catalog.example.json](examples/apps-catalog.example.json) 为协议示例。当前 `example: true` 表示示例发布数据，所有 URL/摘要均应在正式发布前核对和替换。生产目录移除 `example` 与 `notice`，每个发布包填写真实下载地址、正整数 `sizeBytes` 和 64 位 SHA-256；规划应用可以使用 `releases: []`。

`schemaVersion` 是协议版本，`revision` 是目录修订号，每次维护递增并更新 `publishedAt`。`releases` 可以保留历史版本；宿主按 SemVer 选择最高兼容正式版本，不依赖数组顺序。默认不提示 preview 版本，测试包不参与线上升级。线上目录不能使用 `test` 字段。

建议维护一个固定 tag（例如 `apps-catalog`）的 Release，附件名称固定为 `apps-catalog.json`；以后替换同名附件即可维持地址稳定。地址格式如下，OWNER/REPO 需要替换：

```text
https://github.com/OWNER/REPO/releases/download/apps-catalog/apps-catalog.json
```

也接受 `https://github.com/OWNER/REPO/releases/latest/download/apps-catalog.json`，但 latest 指向的每个正式 Release 都必须带该附件，因此固定 tag 更易管理。JSON 内各应用的发布包地址可以指向不同仓库的版本 Release。当前仅支持公开目录，不配置 GitHub 令牌。

应用扩展页不向用户提供目录地址或本地目录操作控件。默认目录地址为 `https://github.com/MiraWorkspace/Mira-Harness/releases/download/apps-catalog/apps-catalog.json`，已有非空来源配置继续沿用。进入该页自动请求，也可点击“检查更新”重试。请求失败或没有读取到列表时统一显示缺省状态，不显示错误、缓存提示或示例规划数据；服务仍保留有效缓存供后续读取。

请求限时 12 秒，目录最大 1 MB，应用与每个应用版本数各最多 100。非 GitHub Release JSON URL、错误 HTTP 状态、HTML、无效 JSON 和不符合协议的数据均不替换有效缓存。最近成功的目录保存在 `~/.mira/config/apps-catalog-cache.json`；请求失败时仅回退到同一来源的缓存，不混用其他来源。缓存与目录元数据不代表发布包已验证或安装。

## 安装与卸载

官方列表为尚未安装且有兼容正式版本的应用提供“安装”。主进程从已校验的目录选择版本，不接受渲染进程传入下载地址或任意磁盘路径。安装包限 64 MB，下载限时 120 秒；文件大小和 SHA-256 均须匹配。ZIP 路径禁止越界、重复或大小写冲突及 Windows 保留文件名，最多 10000 个条目、解压后总大小 256 MB。

包先解压到应用根目录内的隐藏临时目录；校验清单 ID/版本、非 DEV 标志、兼容性、入口和 Logo 后才移动到 `~/.mira/apps/<id>/`。失败清理临时目录；已存在的应用目录不会被覆盖。安装成功刷新官方应用行，操作变为“重启”；主进程保留待重启状态，重新进入设置仍显示“重启”。新安装的正式应用在进程重启前不进入资源服务和标题栏选择器，重启后正常加载。

从 JSON 读取的应用始终保留在“官方应用”，已安装时显示“卸载”，不提供“打开”或“停用”。确认后删除该 ID 的整个应用目录及其中的文件，并清除启停偏好、资源服务和选择器入口；内置 Harness 不能卸载。符号链接仅删除链接，保留其指向的外部文件。该操作不清理宿主浏览器的共享 localStorage、Cookie 或登录数据；卸载范围是应用目录。卸载后官方列表仍保留该行，操作变为“重启”，重启后才恢复“安装”。

## 验证记录（2026-11-04）

- 上一轮 7 个相关测试文件、174 项测试通过，覆盖清单/目录/安装包校验、兼容版本选择、本地资源服务、选择器启停状态、卸载文件删除与资源失效、DEV 并存、重复安装保护、失败临时文件清理、IPC 来源限制、远程读取与失败缓存，以及界面安装/卸载确认、取消、失败重试和返回路径。
- 使用独立用户目录 `/tmp/mira-workbench-local-20261104/.mira` 启动 macOS Electron：设置识别 Workbench Logo/版本/测试标签，前台选择器显示测试应用，成功加载包内首页与 17 个网站卡片；停用后阻止加载。
- 发布后实际下载目录、Logo 和 ZIP 均返回 HTTP 200，ZIP 大小和 SHA-256 与目录一致。
- 上一轮使用独立用户目录的 macOS Electron，从真实 GitHub 目录发现 Workbench，点击安装后生成正式应用目录，成功打开 17 个网站首页，选择器显示正式应用；实机验证卸载确认框及取消后保留。确认卸载后的文件删除、资源返回 404、选择器移除及重新安装通过服务/界面自动化测试，未在实机点击最终删除。
- 本机直连 GitHub 超时；上述真实下载使用已运行的本地代理（仅隔离测试实例的启动参数）。没有修改系统或产品代理设置，网络可达性仍取决于用户环境。
- Workbench 的远端网站浏览、登录、弹窗与宿主网页容器兼容性另行验收；上述本地应用入口验证不代表这些已通过。Windows 和安装版未验收。

## Harness 本轮改动范围

目录协议与解析（`src/config/miraApps.ts`）、应用目录扫描/缓存服务（`electron/services/miraApps.ts`）、用户目录、主进程服务与 IPC/preload、静态包入口承载、运行时应用合并与导航、应用选择器 Logo/测试标签、应用扩展设置页及相关测试。未修改 Harness 的对话、Agent 或模型执行逻辑。

本轮接通线上首次安装与卸载实际修改的 Harness 文件：

- `src/config/miraApps.ts`：官方目录默认地址。
- `electron/services/miraApps.ts`：默认来源、受校验 ZIP 安装、本地目录卸载、资源与偏好同步。
- `electron/ipc/platformIpc.ts`、`electron/preload/platformApi.ts`、`src/types/index.ts`：安装/卸载接口与宿主主页面来源限制。
- `src/pages/backend/appExtensions/index.vue`：真实目录、检查更新、安装/卸载按钮、确认与失败反馈、卸载后设置返回路径。
- `tests/miraApps.test.ts`、`tests/platformIpc.test.ts`、`tests/miraAppExtensions.test.ts`：服务、IPC 和界面生命周期测试。
- `docs/MIRA_APP_DISTRIBUTION.md`：分发行为和验证边界。

本轮未修改 Workbench 源码，也未重新上传 GitHub 代码或替换已发布资源。

## 简化应用管理交互（2026-11-04）

- 页面只保留搜索、调试列表和官方应用列表，移除页面介绍、成功说明、内联错误和启停操作。
- 只有扫描到 `test: true` 的子应用才显示“调试列表”；每行仅提供“打开目录”，主进程根据 ID 校验调试应用并打开对应目录，不接受任意路径。
- 官方应用的单一操作位置显示“安装”“卸载”或“重启”。安装/卸载进行中禁用重复操作，完成后等待重启；状态保存在当前主进程，离开再进入页面不会丢失。
- 安装失败通知：“安装失败 / 请检查网络连接后重试。”卸载、打开目录及重启失败也仅使用简短通知，不展示内部错误。
- 安装后的重启弹窗：“安装已完成。重启 Mira 后即可使用「应用名」。”卸载后的弹窗：“卸载已完成。建议重启 Mira，完成应用资源清理。”按钮为“立即重启 / 稍后”。
- “立即重启”通过主页面 IPC 调用 `app.relaunch()` 和 `app.quit()`，沿用 Mira 现有服务清理与退出流程；点击“稍后”保留待重启状态。

本次验证：7 个相关测试文件共 177 项通过，`vue-tsc --noEmit`、生产构建和 `git diff --check` 通过。独立 macOS Electron 实例从真实目录安装后显示“重启”，点击“稍后”保留状态；点击“立即重启”成功重新启动，正式 Workbench 出现在选择器并打开 17 个网站的首页，官方列表同一行变为“卸载”。实机未点击最终卸载，文件删除及待重启状态由自动化测试覆盖。额外执行的 `desktopShutdown.test.ts` 有 3 项既有失败：HEAD 中的 Electron mock 缺少 `powerSaveBlocker`，未修改此无关测试。

本次简化涉及的 Harness 文件：`src/pages/backend/appExtensions/index.vue`、`src/config/miraApps.ts`、`electron/services/miraApps.ts`、`electron/ipc/platformIpc.ts`、`electron/preload/platformApi.ts`、`src/types/index.ts`、`tests/miraAppExtensions.test.ts`、`tests/miraApps.test.ts`、`tests/platformIpc.test.ts` 及本文档。Workbench 源码未改动。

## 手动删除应用的同步（2026-11-05）

主进程监听 `~/.mira/apps/` 直属目录变化，合并 150ms 内的文件事件后重新扫描，将变化通知主窗口。手动删除子应用目录后，资源入口、标题栏选择器和已打开的应用扩展页同步更新；当前正在显示的应用不存在时，使用替换导航自动返回 Mira Harness，不显示空白页或删除错误提示。删除其他应用不打断当前应用；设置页保留当前页面，但将失效的 `from` 返回地址改为 Harness。监听在退出时关闭，安装后等待重启的规则保持不变。

测试覆盖真实文件系统删除、扫描与监听事件交错、退出取消待处理事件、当前应用回退、其他应用不受影响、设置返回地址修正、启动时删除及监听注销。类型检查、生产构建和相关测试通过；本轮 macOS 实机窗口验证因电脑锁屏未完成。

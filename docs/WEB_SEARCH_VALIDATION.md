# Mira 内置网页搜索：免 Key 搜索源验证

实现参考 [dsh-free-search 0.9.42](https://github.com/dddmuc/dsh-free-search/tree/ff0a7009d6ccd3a69605f14781110060e747252c)，直接集成在 Mira 内置 `web_search`。MIT 许可保留于 `licenses/dsh-free-search.txt` 及打包源码注释。

## 当前行为

- `web_search({ query, limit?, engine? })`，默认 `engine: "auto"`；`limit` 默认 5，最多 10。
- 国内 `cn.bing.com` 首发；慢于 1.2 秒、2.4 秒时逐步增加搜索工作槽，最多同时尝试 3 类源；首个通过过滤的结果返回后取消其他请求。
- 单源 8 秒，整轮 25 秒，覆盖正文读取；取消会关闭底层 Electron 请求及正文流。
- 默认顺序：`bing → exa → anysearch → keenable → firecrawl → parallel → you → sogou → so360 → baidu-html → tavily → ddg → ddg-lite → searxng → toutiao`。
- 微信文章属于垂直搜索，通过 `engine: "wechat"` 显式调用，不用微信站内结果代替普通全网搜索。
- 显式指定 `engine` 时只测该源，并绕过冷却；SearXNG 在该类内部尝试六个公共实例，无需自建。
- 验证码/限流冷却 5 分钟，匿名档拒绝/额度问题冷却 15 分钟，网络/解析等错误冷却 30 秒。健康状态在当前 Mira 进程的多个会话和轮次之间共享。
- 结构化 `details` 包含实际命中的 `engine`、各次尝试的状态/耗时 `attempts`，继续使用 Mira 原有来源编号。只有成功结果分配引用编号。
- 需要 Key、登录、本机 CLI 或用户自建实例的源未自动接入，例如 degoog 自建服务、AGY 和需凭据的国内 API。

## 广告和结果质量

- 过滤结果区块中明确的广告/推广/赞助标记、已知广告跳转域名和路径、API 返回的明确赞助字段。过滤后无有效结果则继续回退。
- 不因文章讨论广告行业而删除正常结果；这些规则不能识别所有软文或证明页面内容可信。
- 解开 Bing、DuckDuckGo 及头条明确携带目标 URL 的跳转，去除已知跟踪参数并按 URL 去重；保留搜狗/微信签名链接的资源参数。
- Bing 增加关键词重叠检查，防止正常 HTTP 页面却返回其他查询的替代结果。短查询保守放行；该规则可能过滤部分语义相关但缺少原词的结果，随后交给其他源。
- 搜索摘要不等同于已读取并核实正文。重要事实仍应抓取原文核验。

## macOS Electron 实测

2026-11-11，通过 `electron.net.request` 测试，未配置或读取任何搜索 API Key。查询为 `TypeScript 官方文档`，每源最多 3 条。这是当前机器网络/代理出口的单次样本，不代表所有国内直连网络或长期 SLA。

| engine | 搜索源 | 本次结果 | 耗时 |
|---|---|---|---|
| `bing` | 国内 Bing | 返回结果 | 2.41 秒 |
| `so360` | 360 搜索 | 循环重定向 | 4.45 秒 |
| `sogou` | 搜狗 | 返回结果 | 2.29 秒 |
| `baidu-html` | 百度网页 | 验证码 | 2.84 秒 |
| `ddg` | DuckDuckGo HTML | 反爬验证 | 1.68 秒 |
| `ddg-lite` | DuckDuckGo Lite | 反爬验证 | 1.69 秒 |
| `wechat` | 微信文章 | 返回结果 | 2.10 秒 |
| `toutiao` | 头条 | 返回结果 | 2.34 秒 |
| `anysearch` | AnySearch | 返回结果 | 2.42 秒 |
| `tavily` | Tavily | HTTP 429 限流 | 1.09 秒 |
| `firecrawl` | Firecrawl | 返回结果 | 1.61 秒 |
| `exa` | Exa MCP | 返回结果 | 1.39 秒 |
| `keenable` | Keenable MCP | 返回结果 | 1.37 秒 |
| `parallel` | Parallel MCP | 返回结果 | 2.26 秒 |
| `you` | You.com | 返回结果 | 1.30 秒 |
| `searxng` | 公开 SearXNG | 公开实例限流或非 JSON 响应 | 5.05 秒 |

16 类源中 10 类返回结果；其余 6 类保留适配，可显式重测，正常运行遇到失败时切源并冷却。免 Key 匿名额度仍受上游限流和地区策略影响。相同查询的自动模式本次耗时 0.72 秒，命中 Bing；该查询之前已被显式测试，不能用这个耗时代表首次请求。

额外中文查询：`中国科学院 人工智能 最新研究`。Bing 返回了飞书/展会等无关内容，被相关性检查拒绝；Exa 返回 `cas.cn`、`ia.cas.cn` 等相关结果。自动模式随后成功使用 Exa。搜狗对该中文查询曾返回验证码，AnySearch 曾超时，说明单次成功不等于稳定可用。

## 复现

```sh
node scripts/test-web-search.mjs "TypeScript 官方文档" /tmp/mira-search.json
node scripts/test-web-search.mjs "中国科学院 人工智能 最新研究" /tmp/mira-search-cn.json bing exa
```

第二条显式测试 Bing、Exa，再测试自动模式。脚本使用独立临时 Electron profile，不修改用户 Mira 配置；报告写入指定路径。默认报告路径为仓库根目录的 `web-search-results.local.json`。

## 检查边界

- 85 项定向测试通过：16 类源响应、MCP JSON/SSE 和错误、广告过滤、无关结果、失败回退、超时/总预算、冷却、取消和引用连续性，以及运行时与子任务回归。
- 真实 Electron 的 POST 中文 JSON 传输、无 Cookie 请求、上传关闭后的正文取消测试通过。
- 修改文件的严格 TypeScript 检查、`electron-vite build` 和 `git diff --check` 通过。
- 扩展检查 `harnessGlobalMcpIdentity.test.ts` 存在 2 项既有失败：测试直接构造的 MCP 客户端没有注册为已连接。用 HEAD 版本的搜索工具、Electron 适配器和 HarnessRuntime 替换加载后可复现相同失败，本次未修改该模块。
- 未进行 Windows Electron 或打包后安装验收。没有添加 API Key 设置页、自建实例配置或新的依赖。

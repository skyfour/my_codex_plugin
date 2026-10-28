# API 调试台

本地 Postman 式 Codex 插件，管理 HTTP/HTTPS 请求、集合和环境，执行 Postman 前置/响应脚本与断言，查看响应、历史和运行报告。请求从本机发出，支持 localhost 和内网，无需额外 OpenAI API Key。

## 前置条件与安装限制

- macOS、Node.js ≥22.13（建议 Node 24 LTS，含 npm）、Git，以及已登录的 Codex 桌面版与 CLI。
- CLI 需支持 `codex plugin`，桌面版需支持 MCP Apps；`node` 和 `codex` 需能被桌面应用找到。
- 敏感变量及 Cookie 值依赖 macOS Keychain，当前完整安装不支持 Windows／Linux。
- 请求从本机发出，访问内网／本机服务需确保本机网络与服务可用。

## 安装与更新

还未克隆仓库时，先按[仓库快速开始](../../README.md#快速开始)获取源码；以下命令均在仓库根目录执行。

```sh
npm run install:api-client
```

只安装 API 调试台的锁定依赖、构建界面、检查 MCP 并注册该插件。更新时执行：

```sh
git pull --ff-only
npm run install:api-client
```

重新打开 Codex，确认插件已启用，再点击左侧「API 调试台」或输入「打开 API 调试台」。更新保留本机集合与环境；只执行 `git pull` 不会更新已安装实例。

## 支持范围

支持嵌套集合、参数、请求头、常见请求体、Cookie、Basic/Bearer/API Key、cURL/Postman、OpenAPI3/Swagger2 JSON/YAML、HAR 导入和 GraphQL、JSON/CSV 数据迭代和取消运行。当前不支持 OAuth 授权窗口、GraphQL 以外的其他协议、Vault 或云脚本包。

## 快速操作

- 侧栏可按名称、URL 或 HTTP 方法搜索集合和请求；搜索时自动展示匹配项的上级目录，清空搜索后恢复折叠状态。点击顶部「侧栏」可收起导航，把空间留给请求与响应；`⌘/Ctrl + K` 可重新打开并聚焦搜索。
- 参数、请求头及变量表格可直接在末尾空白行输入，按 Enter 添加并聚焦下一行，也保留「添加一行」按钮。未输入的尾部空行不会保存或发送。
- `⌘/Ctrl + Enter` 发送当前请求，`⌘/Ctrl + S` 保存；弹窗打开时不会误发底层请求。切换请求会记住各自的编辑页和脚本阶段。
- 选中环境后点击旁边的「编辑」可直接修改当前环境。请求页的名称与保存操作集中在一行；新建请求和文件夹仍可从集合、文件夹菜单进入，标签栏加号可直接新建请求。

## 整体导入与导出

集合列表顶部的「导出全部」将所有集合、环境和全局变量保存为一个 `api-client-workspace-日期.json` 文件，包含文件夹、请求配置，以及集合／文件夹／单个请求的请求前和响应后脚本。导出前会保存当前草稿；保存失败时停止导出。

在另一台电脑安装 API Client 后，点击「导入」选择该文件，先查看集合名称及集合、请求、环境和全局变量数量，再确认导入。也继续支持原有 Postman Collection v2.1、环境 JSON 和 cURL。

导入以新增副本方式处理集合和环境，同名自动添加「（导入）」后缀，不覆盖原集合；全局变量按名称补充，重名时保留本机值并提示。请求 ID 保持不变，以保留脚本中的 `pm.execution.setNextRequest()` 跳转。全部内容先验证，再一次性写入；失败时整体回滚。导入不会执行脚本或自动发送请求。

备份格式标识为 `codex-api-client-workspace`，格式版本为 `1`。文件上限 20 MB，最多 1000 个集合及 1000 个环境，目录最多 64 层；超过限制会拒绝操作，避免生成无法恢复的备份。已标记的敏感变量保留名称和类型，值留空，且不携带 Keychain 引用；普通变量、请求配置和脚本文本保留原内容。Cookie、历史、机器设置及附件文件不包含在备份中，本地文件请求体需在目标电脑重新选择附件。

## 变量与响应查看

URL 中能在当前作用域解析的变量显示绿色，未设置的变量显示红色并带点状下划线。悬停或将输入光标移入变量，可查看值及来源；敏感值显示掩码，空字符串与未设置分别提示。取值遵循运行时作用域顺序：文件夹、选中环境、集合、全局；禁用变量不参与解析。脚本保存的变量变化会在运行后刷新。

JSON 响应支持格式化缩进及类型配色，搜索与原始模式保留；响应正文独立滚动，格式化、搜索、复制和保存工具栏固定在响应区顶部。

## 本地数据与运行限制

默认数据目录为 `~/Library/Application Support/Codex API Client`，可通过 `CODEX_API_CLIENT_DATA_DIR` 修改。敏感变量和 Cookie 值使用 macOS Keychain；新电脑需要重新配置敏感值。将密码、Token 标记为敏感并通过 `{{token}}` 引用，不要硬编码到脚本或 URL。普通响应可存入本地历史。

每次保存检查 revision，遇到并发冲突保留未保存编辑。默认超时为请求 30 秒、脚本 5 秒、运行 120 秒；每个服务最多同时 4 次运行，不作为压测工具。

## 本地示例

在仓库根目录运行 `node plugins/codex-api-client/scripts/demo-server.mjs`，导入 `plugins/codex-api-client/examples/` 中的集合与环境，选择本地演示环境后运行集合。执行会实际发送请求，导入本身不会执行。

## 常见问题

**新电脑如何继续使用原有请求？** 在旧电脑点击「导出全部」，在新电脑安装插件后导入备份。敏感值、Cookie 和本机文件附件不随备份迁移，需要重新配置；详细范围见[整体导入与导出](#整体导入与导出)。

**界面更新了，安装后仍是旧版？** 先确认安装脚本完成构建，再重新打开 Codex 并新建聊天。开发预览也需先运行 `npm run build`。

**变量显示红色或鉴权失败？** 检查是否选中正确环境、变量是否启用，以及 Keychain 中的敏感值是否已保存。悬停变量可查看解析来源；不要把 Token 写入 URL 或脚本以绕过配置。

**请求超时或访问不了 localhost？** 请求从运行插件的本机发送；确认目标服务、端口、代理与本机网络可用。本插件不用于压测，默认时限与并发限制见上文。

## 开发与验证

在插件目录执行 `npm ci`、`npm run build`、`npm test`、`npm run check`。`npm run dev` 在 `127.0.0.1:47890` 提供独立预览。浏览器验证使用 `npm exec playwright -- test --config playwright.tree.config.ts`，需要 Chrome。

完整界面与易用性回归使用 `npm exec playwright -- test --config playwright.usability.config.ts`；先执行 `npm run build`，确保预览加载最新界面。

## 兼容模式与规范导入

标准新建集合和普通 Postman/OpenAPI/HAR/cURL 导入默认严格模式：local > data > environment > collection > global；文件夹变量不进入运行作用域。既有未标记且包含文件夹变量的本地集合和 v1 工作区备份保留扩展行为；文件夹变量通过临时作用域覆盖运行数据。可在集合概览切换模式，配置保存在 `x-codex-api-client.compatibilityMode`（`strict` / `extended`），其余扩展字段、请求 ID、认证和未编辑的 body 元信息保留。单条请求发送忽略 `setNextRequest`，集合 Runner 保留跳转语义。

`api_import_preview` 和 `api_import` 的原 `text` 参数继续有效，新增可选 `localFiles: {相对文件名: 文件文本}`。支持 OpenAPI 3.0/3.1、Swagger 2.0 的 JSON/YAML，经官方 `openapi-to-postmanv2@6.4.2` 转为请求模板；HAR 导入 URL、重复 Header、Cookie、原始文本或表单请求体。预览显示请求数量、地址、认证类型和未支持项。HAR 响应/时序不导入，缺少文件内容的 HAR 上传拒绝；OpenAPI 回调、Webhook、链接与响应校验不自动执行，示例/变量及认证需检查。

规范导入只处理所选主文件和明确提供的依赖。UI 支持多个依赖文件或选择依赖目录；目录相对路径以所选目录为根。远程 `$ref`、绝对路径、越界引用、不存在的本地引用、外部文件循环引用均拒绝；不会自动读取文件系统或访问网络。依赖总计不超过 20 MB、100 个文件，展开限制 100000 节点及 100 层。递归的主文件内部 schema 引用由官方转换器处理。

cURL 额外支持 `-G/--get`、`--data-urlencode`、`-A/--user-agent`、`-e/--referer` 以及常见短参数紧接值。保留无 shell 执行原则；文件 URL 编码、代理、重试、`--insecure`、`--location`、`--compressed` 等不能保真选项明确拒绝，避免静默改变传输行为。

## GraphQL

在请求体类型选择 GraphQL，编辑 query、JSON variables 和 operationName。保存/导入/导出仍使用 Postman `body.mode=graphql`；发送、脚本、断言、环境、继承认证、Cookie 和网络设置沿用 HTTP Runner。GraphQL cURL 导出为 JSON 请求体，变量 JSON 无效时拒绝导出。

点击「发送 Schema introspection」后才实际访问目标，打开页面不会发送。该操作先保存草稿，再通过 `api_graphql_introspect({collectionId,itemId,environmentId?})` 使用既有 HTTP 运行链返回 runId；使用 `api_run_result` 轮询并可通过 `api_run_cancel` 取消。保存请求的 body 不改变，但原有脚本照常执行，可能写入环境等作用域。成功后选择 schema 类型，在查询中输入字段前缀或 Ctrl+Space 使用实际字段补全；服务端禁用 introspection、GraphQL 错误或 HTTP 错误会明确提示。

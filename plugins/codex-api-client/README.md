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

支持嵌套集合、参数、请求头、常见请求体、Cookie、Basic/Bearer/API Key 与高级鉴权、cURL/Postman、OpenAPI3/Swagger2 JSON/YAML、HAR 导入和 GraphQL、JSON/CSV 数据迭代和取消运行。OAuth2 支持系统浏览器授权码 + PKCE、客户端凭据和刷新；当前不支持 GraphQL 以外的其他协议、Vault 或云脚本包。

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


## 高级鉴权与请求网络

认证表单使用已安装 `postman-runtime` 的字段：Digest、OAuth1、OAuth2 Bearer、AWS Signature v4、Hawk、NTLM、EdgeGrid、JWT、ASAP。界面显示必需字段，缺失或非法配置会阻止请求；签名仍由运行时完成。密码、Token、私钥、结构明确的 Authorization/Cookie 请求头、代理凭据和证书口令在保存、导入及完整恢复时自动进入 Keychain。复制集合/环境使用 `api_document_duplicate` 在后端重新保护凭据，返回值仍隐藏。

OAuth2 的“开始 OAuth 授权”是唯一打开系统浏览器的操作。授权码使用 S256 PKCE、随机 state 和 `http://127.0.0.1:<临时端口>/oauth/callback`；提供方需要允许回环动态端口。授权期限为 3 分钟，取消、过期、完成或服务关闭会关闭监听器。Token 端点只接受 HTTPS（回环本地模拟服务允许 HTTP），不跟随跳转，客户端凭据通过表单提交。Token 保存到指定环境变量，刷新配置保存为同环境下 `<变量名>.__oauth` 敏感变量；不返回 Token、code 或提供方错误正文。刷新仅更新指定变量，不修改其他环境。普通导出排除这些值，完整加密备份可迁移它们。

`api_oauth_start({flow,authorizationUrl?,tokenUrl,clientId,clientSecret?,scope?,target:{kind,id,key}})`、`api_oauth_poll({sessionId})`、`api_oauth_cancel({sessionId})`、`api_oauth_refresh({target})` 均仅对 App 可见。`target.kind` 为 `environment` 或 `globals`（UI 选择环境）；结果只含会话状态、目标和过期时间等脱敏元信息。客户端凭据与刷新操作立即返回 pending 会话 ID，界面通过 poll 获取完成状态，交换期间可取消；离开认证面板也会取消。最多 4 个活动 OAuth 会话，完成结果保留 5 分钟，最多 100 条。

请求“网络”面板可覆盖超时、TLS 校验、重定向、代理和上传 CA/客户端证书；省略字段继承全局，保存在请求 item 的 `x-codex-api-client.network`。`proxy:null` 表示直接连接，不回退系统环境变量代理。全局设置支持 `proxyCredentials:[{key:"username",value,type:"secret"},{key:"password",value,type:"secret"}]` 及 `noProxy` 原生 URL 匹配规则（如 `http+https://localhost:*/*`）。凭据和绕过规则由 Postman SDK 处理。请求 CA/证书路径纳入加密备份附件访客并在恢复时重映射，文件访问仍受显式许可/上传附件限制。HTTP 集合逐项重置网络设置，后续请求不继承前一请求的覆盖。

### SSE / WebSocket / Socket.IO 交互调试

在请求地址栏选择协议，保存后点击「连接协议」。协议配置保存在 `request['x-codex-api-client'].protocol`，格式为 `{version:1,type:'sse'|'websocket'|'socketio',connectTimeout?,operationTimeout?,reconnectAttempts?,reconnectDelay?,path?,auth?,subprotocols?}`。URL、请求头和常用认证沿用请求本身，环境仅在连接时在后端解析；Socket.IO 握手 `auth` 的各值使用 `{key,type:'secret',value}` 保存，自动进入 Keychain，普通导出排除值。`path/auth` 仅用于 Socket.IO，`subprotocols` 仅用于 WebSocket。导入、打开请求或服务重启不会连接。

SSE 实时显示多行 data、event、id、retry；WebSocket 可发送文本或 Base64 二进制；Socket.IO 支持事件名、JSON 参数数组、二进制及可选 ACK。默认连接超时 30 秒（继承请求 requestTimeout），操作超时 5 秒，自动重连 0 次。SSE/Socket.IO 可显式设置最多 3 次重连，间隔默认 1000ms、最大 60 秒；SSE 采用服务端 retry（同样封顶 60 秒），重连携带 Last-Event-ID。WebSocket 通过再次点击连接显式重连。

每服务最多 4 个活动会话及 4 个保留会话；新建时淘汰最旧终态会话。每会话最多 1000 条/10 MiB，单条序列化事件最多 1 MiB，超限单条改为固定错误事件；界面只显示最近 200 条。`api_protocol_connect({collectionId,itemId,environmentId?})` 返回 `{sessionId,state}`；`api_protocol_action({sessionId,action,payload})`：WebSocket `send` 使用 `{text}` 或 `{encoding:'base64',base64}`，Socket.IO `emit` 使用 `{event,args?,binary?,ack?}`；`api_protocol_events({sessionId,after?,limit?})`（limit 1–1000）返回 `{state,events,cursor,firstSeq,gap}`，事件为 `{seq,time,type,data}`。二进制在脱敏后表示为 `{encoding:'base64',base64,size}`。`gap` 表示旧游标前的数据已被淘汰。`api_protocol_disconnect({sessionId})` 显式关闭。会话仅属于创建它的服务；标签切换保留连接，关闭所属标签（包含非活动标签）和服务退出会断开。

协议不执行 HTTP Runner、pm.* 脚本或逐消息断言；HTTP Send/Runner 拒绝混入协议请求，cURL 导出拒绝协议请求，Postman 导出明确警告其协议扩展无法作为原生 HTTP 执行。支持请求头、Basic/Bearer/OAuth2 header/header API key；其他认证明确拒绝。网络继承 item 扩展 `network` 与全局设置；ws/Socket.IO 支持 strictSSL，SSE 必须验证 TLS。代理、代理认证、自定义 CA、客户端证书和 noProxy 暂不支持，配置存在时连接会明确失败；ws/Socket.IO 的 followRedirects=false 覆盖也会明确失败。协议错误使用固定信息，密钥及其 Base64/hex/URL 编码和二进制回显会在缓冲前脱敏。自定义业务请求头中未标记的秘密和消息正文不能自动分类，请用敏感变量引用。

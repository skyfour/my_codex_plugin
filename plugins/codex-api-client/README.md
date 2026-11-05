# API 调试台

在 Codex 里保存请求、切换环境、发送接口，再看响应和断言结果。请求从本机发出，也能访问本机可达的 localhost 和内网服务。

[安装](#安装与更新) · [发送第一个请求](#发送第一个请求) · [支持范围](#支持范围) · [完整说明](docs/reference.md) · [插件集首页](../../README.md)

![API 调试用途插画：蓝橙插头间交换请求信封和响应收据，旁边是一组变量标签。](../../docs/assets/readme/api-client-cover.png)

## 发送第一个请求

1. 新建集合和请求，或导入已有的 Postman 集合、环境或 cURL。
2. 填写地址、参数和认证。需要变量时选择环境，用 `{{baseUrl}}`、`{{token}}` 引用。
3. 点击「发送」，查看响应正文、请求历史和断言结果。

敏感值用 macOS Keychain 保存。导入只保存配置；发送请求、运行集合和连接协议都由你发起。使用插件无需额外 OpenAI API Key。

## 安装与更新

需要 macOS、Node.js ≥22.13、Git，以及已登录的 Codex 桌面版和 CLI。CLI 需支持 `codex plugin`，桌面版需支持 MCP Apps，`node` 和 `codex` 要能被桌面应用找到。

先按[仓库快速开始](../../README.md#快速开始)克隆仓库。在仓库根目录执行：

```sh
npm run install:api-client
```

脚本会准备锁定依赖、构建界面、检查 MCP，再注册插件。更新时先 `git pull --ff-only`，再执行同一安装命令。完成后重开 Codex 并新建聊天，启用插件，点击左侧「API 调试台」或说“打开 API 调试台”。已有本机集合和环境会保留。

## 支持范围

| 平时要做什么 | 可以使用的功能 |
| --- | --- |
| 调试 HTTP 接口 | 参数、请求头、常见请求体、Cookie、环境变量、认证 |
| 跑一组请求 | Postman 请求前／响应后脚本、断言、JSON／CSV 数据迭代、运行报告 |
| 复用已有接口资料 | Postman、cURL、OpenAPI 3／Swagger 2 JSON 或 YAML、HAR 导入 |
| 调试 GraphQL | query、variables、operationName，显式获取 schema 后补全字段 |
| 查看持续连接 | SSE、WebSocket、Socket.IO |
| 调试其他协议 | gRPC、MQTT、远程 MCP 的交互客户端 |

HTTP 脚本与 Runner、持续连接和原生协议各有范围限制。协议请求不会执行 `pm.*` 脚本，也不能混入 HTTP 集合运行；不支持 Vault 或云脚本包。[完整兼容说明 →](docs/reference.md#支持范围)

## 常用操作

`⌘/Ctrl + Enter` 发送，`⌘/Ctrl + S` 保存，`⌘/Ctrl + K` 搜索请求。表格末尾的空行可以直接输入，按 Enter 继续添加。

侧栏支持按名称、URL 或方法搜索；也可以收起侧栏，把空间留给请求与响应。变量会提示解析值与来源，敏感值显示掩码。JSON 响应支持格式化、搜索、复制和保存。

[变量与响应](docs/reference.md#变量与响应查看) · [GraphQL](docs/reference.md#graphql) · [鉴权、OAuth 与网络设置](docs/reference.md#高级鉴权与请求网络) · [协议调试](docs/reference.md#sse--websocket--socketio-交互调试)

## 密码加密完整备份

换电脑前，先选择适合的导出方式：

| 方式 | 包含什么 | 适合什么时候 |
| --- | --- | --- |
| 导出全部 | 集合、环境、全局变量和脚本；已标记的敏感值留空 | 迁移普通请求，或在检查内容后分享配置 |
| 完整备份与恢复 | 密码加密的配置、凭据、Cookie、设置与引用附件；历史可选 | 把自己的完整工作区迁到另一台电脑 |

普通导出仍保留普通变量、请求配置和脚本文本，分享前需要检查。完整归档应和密码妥善保存。导入前会预览并确认，恢复后不会自动发送请求或连接协议。

[普通导入导出](docs/reference.md#整体导入与导出) · [完整归档格式与恢复行为](docs/reference.md#密码加密完整备份)

## 本地数据与运行限制

默认数据在 `~/Library/Application Support/Codex API Client`，可用 `CODEX_API_CLIENT_DATA_DIR` 更换目录。敏感变量与 Cookie 值保存在 Keychain；当前完整安装仅支持 macOS。

默认请求超时 30 秒、脚本 5 秒、整次运行 120 秒；每个服务最多同时 4 次运行。普通响应可保存在本地历史。本工具用于接口调试。[存储与限制 →](docs/reference.md#本地数据与运行限制)

## 本地示例

在仓库根目录运行 `node plugins/codex-api-client/scripts/demo-server.mjs`，再导入 [examples](examples/) 中的集合和环境，选择本地演示环境后发送或运行。

## 常见问题

变量变红或鉴权失败时，先检查当前环境、变量是否启用及 Keychain 中的值。访问不了 localhost 时，核对目标服务、端口、代理和本机网络。安装后仍显示旧界面时，确认安装脚本已完成构建，再重开 Codex 并新建聊天。

[完整排查说明 →](docs/reference.md#常见问题)

## 问题与建议

反馈技能随插件安装。新建聊天后可以说：

> 帮我给 API 调试台提交 issue：导入集合后，有一条请求的参数丢失了。

有 GitHub 连接时可按指令提交，否则提供草稿和表单链接。附上实际版本与最小复现；移除令牌、Cookie、认证头、真实接口数据及私人路径。

[报告问题](https://github.com/skyfour/my_codex_plugin/issues/new?template=bug_report.yml) · [提出建议](https://github.com/skyfour/my_codex_plugin/issues/new?template=feature_request.yml) · [查看反馈](https://github.com/skyfour/my_codex_plugin/issues)

## 开发与验证

[本插件构建与测试](docs/reference.md#开发与验证) · [仓库开发说明](../../docs/development.md) · [完整使用说明](docs/reference.md) · [反馈与维护](../../docs/feedback.md)

# API 调试台

本地 Postman 式 Codex 插件，管理 HTTP/HTTPS 请求、集合和环境，执行 Postman 前置/响应脚本与断言，查看响应、历史和运行报告。请求从本机发出，支持 localhost 和内网，无需额外 OpenAI API Key。

安装与更新见[仓库说明](../../README.md)。需要 macOS、Node.js >=22.13 和支持 MCP Apps 的 Codex 客户端。在 Codex 中输入「打开 API 调试台」。

支持嵌套集合、参数、请求头、常见请求体、Cookie、Basic/Bearer/API Key、cURL/Postman 导入导出、JSON/CSV 数据迭代和取消运行。当前不支持 OAuth 授权窗口、其他协议、Vault 或云脚本包。

默认数据目录为 `~/Library/Application Support/Codex API Client`，可通过 `CODEX_API_CLIENT_DATA_DIR` 修改。敏感变量和 Cookie 值使用 macOS Keychain；新电脑需要重新配置敏感值。将密码、Token 标记为敏感并通过 `{{token}}` 引用，不要硬编码到脚本或 URL。普通响应可存入本地历史。

每次保存检查 revision，遇到并发冲突保留未保存编辑。默认超时为请求 30 秒、脚本 5 秒、运行 120 秒；每个服务最多同时 4 次运行，不作为压测工具。

示例：运行 `node scripts/demo-server.mjs`，导入 `examples/` 中的集合与环境，选择本地演示环境后运行集合。执行会实际发送请求，导入本身不会执行。

开发：`npm ci`、`npm run build`、`npm test`、`npm run check`。`npm run dev` 在 `127.0.0.1:47890` 提供独立预览。浏览器验证使用 `npm exec playwright -- test --config playwright.tree.config.ts`，需要 Chrome。

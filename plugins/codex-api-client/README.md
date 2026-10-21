# API 调试台

本地 Postman 式 Codex 插件，管理 HTTP/HTTPS 请求、集合和环境，执行 Postman 前置/响应脚本与断言，查看响应、历史和运行报告。请求从本机发出，支持 localhost 和内网，无需额外 OpenAI API Key。

安装与更新见[仓库说明](../../README.md)。需要 macOS、Node.js >=22.13 和支持 MCP Apps 的 Codex 客户端。在 Codex 中输入「打开 API 调试台」。

支持嵌套集合、参数、请求头、常见请求体、Cookie、Basic/Bearer/API Key、cURL/Postman 导入导出、JSON/CSV 数据迭代和取消运行。当前不支持 OAuth 授权窗口、其他协议、Vault 或云脚本包。

## 整体导入与导出

集合列表顶部的「导出全部」将所有集合、环境和全局变量保存为一个 `api-client-workspace-日期.json` 文件，包含文件夹、请求配置，以及集合／文件夹／单个请求的请求前和响应后脚本。导出前会保存当前草稿；保存失败时停止导出。

在另一台电脑安装 API Client 后，点击「导入」选择该文件，先查看集合名称及集合、请求、环境和全局变量数量，再确认导入。也继续支持原有 Postman Collection v2.1、环境 JSON 和 cURL。

导入以新增副本方式处理集合和环境，同名自动添加「（导入）」后缀，不覆盖原集合；全局变量按名称补充，重名时保留本机值并提示。请求 ID 保持不变，以保留脚本中的 `pm.execution.setNextRequest()` 跳转。全部内容先验证，再一次性写入；失败时整体回滚。导入不会执行脚本或自动发送请求。

备份格式标识为 `codex-api-client-workspace`，格式版本为 `1`。文件上限 20 MB，最多 1000 个集合及 1000 个环境，目录最多 64 层；超过限制会拒绝操作，避免生成无法恢复的备份。已标记的敏感变量保留名称和类型，值留空，且不携带 Keychain 引用；普通变量、请求配置和脚本文本保留原内容。Cookie、历史、机器设置及附件文件不包含在备份中，本地文件请求体需在目标电脑重新选择附件。

## 变量与响应查看

URL 中能在当前作用域解析的变量显示绿色，未设置的变量显示红色并带点状下划线。悬停或将输入光标移入变量，可查看值及来源；敏感值显示掩码，空字符串与未设置分别提示。取值遵循运行时作用域顺序：文件夹、选中环境、集合、全局；禁用变量不参与解析。脚本保存的变量变化会在运行后刷新。

JSON 响应支持格式化缩进及类型配色，搜索与原始模式保留；响应正文独立滚动，格式化、搜索、复制和保存工具栏固定在响应区顶部。

默认数据目录为 `~/Library/Application Support/Codex API Client`，可通过 `CODEX_API_CLIENT_DATA_DIR` 修改。敏感变量和 Cookie 值使用 macOS Keychain；新电脑需要重新配置敏感值。将密码、Token 标记为敏感并通过 `{{token}}` 引用，不要硬编码到脚本或 URL。普通响应可存入本地历史。

每次保存检查 revision，遇到并发冲突保留未保存编辑。默认超时为请求 30 秒、脚本 5 秒、运行 120 秒；每个服务最多同时 4 次运行，不作为压测工具。

示例：运行 `node scripts/demo-server.mjs`，导入 `examples/` 中的集合与环境，选择本地演示环境后运行集合。执行会实际发送请求，导入本身不会执行。

开发：`npm ci`、`npm run build`、`npm test`、`npm run check`。`npm run dev` 在 `127.0.0.1:47890` 提供独立预览。浏览器验证使用 `npm exec playwright -- test --config playwright.tree.config.ts`，需要 Chrome。

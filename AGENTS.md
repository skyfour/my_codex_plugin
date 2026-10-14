# 个人 Codex 插件仓库

此仓库集中维护用户自用的 Codex 插件。后续新增个人插件默认放入 `plugins/<插件名>/`，并注册到 `.agents/plugins/marketplace.json`，沿用统一安装入口。

- 优先中文沟通与文档。
- 仅提交源码、资源、锁文件、测试和安装说明；禁止上传数据库、令牌、凭据、个人任务、真实接口环境、机器配置或 node_modules。
- 插件名及市场名是稳定安装标识，不随意更改。
- 安装和更新通过 `node scripts/install.mjs` 完成，保留已有本地数据。
- 当前完整支持 macOS；API Client 使用系统 Keychain，不将其改成明文存储以迁就其他系统。

## Testing

- `npm run prepare:plugins`：安装锁定依赖、构建 API 界面并验证 MCP，不注册插件。
- `npm test`：验证市场结构、版本与全部现有 Node 测试。
- `npm run check`：API Client 的真实 stdio MCP 连接及内联 UI 检查。
- API 浏览器测试：在 `plugins/codex-api-client` 执行 `npm exec playwright -- test --config playwright.tree.config.ts`，需要 Chrome。
- 安装流程验证使用独立临时 `CODEX_HOME`，避免覆盖用户现有插件配置。

- `npm run test:task-panel-ui`：原生 MCP 宿主模拟测试，覆盖顶部导入入口、无响应刷新、查询错误恢复、带环境变量时的令牌替换及宿主通知期间的输入焦点、草稿和异步搜索恢复，需要 Chrome。

- `npm run test:local-review-ui`：本地人工审查原生宿主模拟，覆盖输入焦点、快照、行内评论、审阅状态、历史、导出和错误恢复，需要 Chrome。

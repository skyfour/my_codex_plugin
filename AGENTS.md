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
- `npm run test:ui`：构建当前 API 源码并测试三个插件的完整浏览器套件。新增控件审计拒绝空定位器、指针遮挡以及只有程序滚动隐藏父容器才能到达的控件；截图/JSON 默认在 `/tmp/codex-plugin-ui-audit`，可设置 `UI_AUDIT_DIR`。
- 安装流程验证使用独立临时 `CODEX_HOME`，避免覆盖用户现有插件配置。

- `npm run test:task-panel-ui`：原生 MCP 宿主模拟测试，覆盖顶部导入入口、无响应刷新、查询错误恢复、带环境变量时的令牌替换及宿主通知期间的输入焦点、草稿和异步搜索恢复，需要 Chrome。

- `npm run test:local-review-ui`：本地人工审查原生宿主模拟，覆盖多项目打开/切换/恢复、目录浏览与批量添加、对齐差异、语法高亮、提交历史、输入焦点、快照、行内评论、导出和错误恢复，以及长名称、空状态、深浅主题、Stage/Unstage 和可配置大文件上限，需要 Chrome。

- MCP 内联第三方 JS 时，HTML 占位替换使用 `replace(marker, () => source)`，避免库源码中的 `$&` 被当作替换标记。异步操作的按钮状态按当前界面重算，不恢复操作开始前的全局 disabled 快照。
- 原生宿主浏览器测试使用 localhost 安全上下文，保留 `crypto.randomUUID` 等宿主 API。重绘后的焦点身份包含表单/来源泳道和控件身份，不能仅用重复的 input name。

## 版本与发布

- 日常开发只提交代码，不逐轮增加版本。修复和 UI 调整合并后递增补丁号；完整新功能批次稳定后再递增次版本号。
- 已发布版本内容保持不变。未发布功能放在开发分支，不覆盖同版本安装缓存；正式发布时统一更新版本、验证并安装。

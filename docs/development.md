# 开发与验证

[返回首页](../README.md) · [维护约定](../AGENTS.md)

| 命令 | 用途 |
| --- | --- |
| `npm run prepare:plugins` | 显式准备任务看板、API 调试台和代码审查，不注册插件 |
| `npm run install:dbx -- --prepare` | 单独准备 DBX 适配器，不注册插件或启动 Docker |
| `npm run setup:dbx` | 准备或恢复官方 DBX Docker 服务，完成健康与兼容预检；不注册插件或强制更新本体 |
| `npm run issues` | 查看 GitHub Issues 反馈收件箱；加 `-- 123` 可读指定反馈和讨论 |
| `npm run test:feedback` | 验证反馈收件箱的分页、过滤、错误提示与认证边界 |
| `npm run validate` | 检查市场、插件版本、MCP 入口与锁定依赖 |
| `npm test` | 验证结构、安装选择与各插件 Node 测试 |
| `npm run check` | 检查 API 调试台、代码审查和 DBX 的 stdio MCP 与内联界面；DBX 检查不启动 Docker |
| `npm run test:ui` | 运行任务看板、API 调试台和代码审查的完整浏览器测试，需要 Chrome |
| `npm run test:dbx-ui` | 单独验证 DBX 管理入口与内嵌工作台，需要 Chrome |

各插件的完整使用说明保留开发命令、数据目录和已知限制，入口位于对应 README。浏览器测试截图／JSON 默认写入 `/tmp/codex-plugin-ui-audit`，可通过 `UI_AUDIT_DIR` 指定；代码审查截图还可用 `CODEX_UI_SCREENSHOT_DIR` 设置。

## README 图片

仓库与四个插件首页使用同一套原创概念插画，统一表达各工具的用途。文件清单、提示词和更新约定见[插画说明](assets/readme/README.md)。图片通过相对路径引用，不依赖外部图床。

## 设计与验证记录

- [三个插件的界面复核](ui-review-2026-10-15.md)
- [代码审查功能与流畅性 QA](review-fluency-qa-2026-10-16.md)
- [API 调试台设计说明](superpowers/specs/2026-10-28-api-client-local-design.md)
- [API 调试台实现计划](superpowers/plans/2026-10-28-api-client-local.md)

## 仓库约定

新增插件放入 `plugins/<name>/`，提供独立 README、清单、MCP 入口、源码、锁文件和安装入口，再注册到 `.agents/plugins/marketplace.json`。不提交 `node_modules`、构建包、运行数据库或凭据。

只有用户明确要求发布时才递增版本、推送、合并与更新正式安装缓存。开发分支的同版本预览应使用隔离目录，不覆盖已发布安装。

更多说明：[任务提交联动](task-commit-context.md) · [代码审查界面](review-surface.md) · [Git 工作台](git-workbench.md) · [维护约定](../AGENTS.md) · [更新记录](../CHANGELOG.md) · [GitHub Releases](https://github.com/skyfour/my_codex_plugin/releases)

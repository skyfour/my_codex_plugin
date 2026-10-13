# 任务看板

从 TAPD 选择导入任务，在自定义泳道间拖拽安排进度，查看来源全文，关联本机 Codex 会话。工作流支持配置允许的状态流转；不向 TAPD 回写。

安装与更新见[仓库说明](../../README.md)。在 Codex 中输入「打开任务看板」。需要 Node.js >=22.13 和支持 `plugin`、`app-server --stdio` 的 Codex CLI。

运行 `npm run configure` 在终端配置 TAPD 工作空间、账户完整姓名与 Token。凭据输入不回显。看板中「导入任务」需要用户查询、勾选、确认，不自动导入。

点击任务可绑定已有会话或新建空会话。创建后只绑定并请求打开，不自动发送任务或启动执行；解除关联不删除会话。宿主版本不支持会话跳转时，可按界面显示的 `codex resume <ID>` 恢复。

数据保存在 `${CODEX_HOME:-~/.codex}/task-panel/board.sqlite`，凭据在同目录 `credentials.json`（0600）。`TASK_PANEL_HOME` 可指定独立目录；配置终端与 Codex 应使用相同环境变量。升级保留本地泳道和关联，数据库升级后不支持直接降级。

开发：`npm ci`、`npm test`、`npm run dev -- --demo`。正式使用由 Codex 按需启动 stdio MCP。`npm run build` 是原独立市场打包器，统一仓库安装无需运行。

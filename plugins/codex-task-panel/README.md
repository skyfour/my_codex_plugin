# 任务看板

从 TAPD 选择导入任务，在自定义泳道间拖拽安排进度，查看来源全文，关联本机 Codex 会话。工作流支持配置允许的状态流转；不向 TAPD 回写。

安装与更新见[仓库说明](../../README.md)。在 Codex 中输入「打开任务看板」。需要 Node.js >=22.13 和支持 `plugin`、`app-server --stdio` 的 Codex CLI。

在「设置 → 数据源」配置 TAPD 工作空间、账户完整姓名，再在「本地凭据」输入 Access Token 并保存。输入隐藏，保存后清空，不返回令牌。终端 `npm run configure` 仍可作为备用方式；即使配置了环境变量 `TAPD_ACCESS_TOKEN`，输入框仍可编辑；重新保存的本地令牌立即优先生效，旧配置在重新保存前保持原优先级。看板中「导入任务」需要用户查询、勾选、确认，不自动导入。

点击任务可绑定已有会话或新建空会话。创建后只绑定并请求打开，不自动发送任务或启动执行；解除关联不删除会话。宿主版本不支持会话跳转时，可按界面显示的 `codex resume <ID>` 恢复。

数据保存在 `${CODEX_HOME:-~/.codex}/task-panel/board.sqlite`，凭据在同目录 `credentials.json`（0600）。`TASK_PANEL_HOME` 可指定独立目录；配置终端与 Codex 应使用相同环境变量。升级保留本地泳道和关联，数据库升级后不支持直接降级。

开发：`npm ci`、`npm test`、`npm run dev -- --demo`。正式使用由 Codex 按需启动 stdio MCP。`npm run build` 是原独立市场打包器，统一仓库安装无需运行。

顶部「＋ 导入任务」直接打开选择入口，不等待宿主刷新，也不发送 TAPD 请求。进入后点击「查询候选任务」才开始查询；缺少配置时使用「设置数据源」。

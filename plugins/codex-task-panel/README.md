# 任务看板

把 TAPD 任务放进 Codex，按泳道安排进度，再把任务和处理它的会话连起来。

[安装](#安装与更新) · [第一次使用](#第一次使用) · [完整说明](docs/reference.md) · [反馈](#问题与建议) · [插件集首页](../../README.md)

![任务看板用途插画：任务卡片在四个分类间移动，一根线连接到讨论气泡。](../../docs/assets/readme/task-panel-cover.png)

## 从任务到会话

1. **挑任务。** 查询 TAPD 候选任务，勾选后确认导入。
2. **排进度。** 在泳道间拖动卡片，打开任务查看原始描述。
3. **开始处理。** 关联已有 Codex 会话，或从已有项目新建会话。

泳道进度保存在本机，不回写 TAPD。新建会话会预填任务链接，发送内容由你决定。

## 安装与更新

需要 macOS、Node.js ≥22.13、Git，以及已登录的 Codex 桌面版和 CLI。CLI 需支持 `codex plugin` 和 `app-server --stdio`，桌面版需支持 MCP Apps。按项目新建会话所需的 CLI 接口见[前置条件](docs/reference.md#前置条件与安装限制)。

先按[仓库快速开始](../../README.md#快速开始)克隆仓库。以下命令在仓库根目录执行：

```sh
npm run install:task-panel
```

更新时先运行 `git pull --ff-only`，再运行同一安装命令。本机任务、泳道和会话关联会保留。完成后重新打开 Codex 并新建聊天，启用插件，点击左侧「任务看板」或说“打开任务看板”。

## 第一次使用

打开「设置 → 数据源」，填写 TAPD 工作空间和账户完整姓名，在「本地凭据」保存 Access Token。接着点击「＋ 导入任务 → 查询候选任务」，勾选并确认导入。

点击任务卡片，关联已有会话，或选择 Codex 中的本机项目新建空会话。项目列表沿用桌面端配置；解除关联会保留原会话。

| 你想做的事 | 到哪里操作 |
| --- | --- |
| 调整任务进度 | 拖动卡片；允许的流转在工作流中配置 |
| 查看背景 | 打开卡片，阅读导入时保存的原始描述与来源链接 |
| 在聊天里读取任务 | 提供已导入的 TAPD 任务链接，由看板读取本地信息 |
| 接着处理旧任务 | 从卡片恢复已关联会话 |

查询和导入需要本机可访问的 TAPD 工作空间与有效凭据。附件与评论需到 TAPD 查看；看板显示最近一次导入的数据，来源有变化时可重新查询导入。

## 源码提交联动

在任务详情的「源码提交关联」中，可以从 TAPD 获取完整源码关键字，或手动保存原文。已保存内容可离线使用。

同时安装[本地代码审查](../codex-local-review/README.md)后，在它的 Summary 提交区选择任务，即可获取关键字并应用到提交说明。两边通过本机提交上下文接口协作，凭据与缓存由看板管理。

[联动流程与接口边界 →](../../docs/task-commit-context.md)

## 数据保存在本机

任务、泳道和关联位于 `${CODEX_HOME:-~/.codex}/task-panel/board.sqlite`；同目录的 `credentials.json` 权限为 0600。可用 `TASK_PANEL_HOME` 指定独立目录。

每台电脑各自保存进度。换电脑后先安装、配置并导入任务；数据库升级后不能直接降级。[数据与会话恢复细节 →](docs/reference.md#第一次使用)

## 常见问题

查不到任务时，先核对工作空间、账户完整姓名和令牌。无法跳转会话时，可按界面提示用 `codex resume <ID>` 恢复。创建结果不确定时，先点「检查已有会话」，再决定如何重试。

[完整排查说明 →](docs/reference.md#常见问题)

## 问题与建议

反馈技能随插件安装。新建聊天后可以说：

> 帮我给任务看板提交 issue：查询候选任务时出现了……

有 GitHub 连接时可按指令提交，否则提供草稿和表单链接。附上实际安装版本、复现步骤，并移除令牌、个人任务和私人路径。

[报告问题](https://github.com/skyfour/my_codex_plugin/issues/new?template=bug_report.yml) · [提出建议](https://github.com/skyfour/my_codex_plugin/issues/new?template=feature_request.yml) · [查看反馈](https://github.com/skyfour/my_codex_plugin/issues)

## 开发与验证

[本插件开发命令](docs/reference.md#开发与验证) · [仓库开发说明](../../docs/development.md) · [完整使用说明](docs/reference.md) · [反馈与维护](../../docs/feedback.md)

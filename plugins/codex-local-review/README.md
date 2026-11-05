# 本地代码审查

打开一个本地项目，看清改动，留下批注，再决定哪些内容进入提交。整个过程放在 Codex 侧栏里，普通审查无需远程仓库。

[安装](#安装与更新) · [第一次审查](#第一次审查) · [Git 操作](#git-工作台) · [完整说明](docs/reference.md) · [插件集首页](../../README.md)

![代码审查用途插画：两页代码并排比较，修改行连接到批注，旁边是一枚审阅印章。](../../docs/assets/readme/local-review-cover.png)

## 第一次审查

1. 点击「打开项目…」或按 `⌘O`，选择一个本地项目。
2. 在 Summary 连续浏览整批改动，或打开单个文件查看并排／统一差异。
3. 点击代码行号旁的「＋」留下批注，标记已审阅；需要交接时导出 Markdown 或 JSON。

首次批注或标记已审阅会保存当前比较范围的审查快照。快照记录当时的代码，之后可从「审查记录」回来继续看。

## 安装与更新

需要 macOS、Node.js ≥22.13、Git，以及已登录的 Codex 桌面版和 CLI。CLI 需支持 `codex plugin`，桌面版需支持 MCP Apps；`node`、`git` 和 `codex` 要能被桌面应用找到。

先按[仓库快速开始](../../README.md#快速开始)克隆仓库，在仓库根目录执行：

```sh
npm run install:local-review
```

更新时先运行 `git pull --ff-only`，再执行同一安装命令。完成后重开 Codex 并新建聊天，启用插件，点击左侧「本地代码审查」或说“打开本地代码审查”。已有本机记录与批注会保留。

## 浏览和审查

| 要看什么 | 怎么看 |
| --- | --- |
| 整批未提交改动 | Summary 按未暂存／已暂存连续展示 |
| 一个文件的差异 | 打开文件标签，切换并排或统一视图、展开上下文 |
| 过去的提交 | 提交历史可按当前、全部或指定分支显示 |
| 两个分支的差别 | 从左侧分支比较 `HEAD → 分支` |
| 多个项目 | 最近项目、顶部标签、`⌘P` 搜索切换 |
| 更大的阅读空间 | 点击差异区「全屏审阅」，按 `Esc` 返回 |

批注保留原始行号，可以从汇总跳回代码。文件在审阅后发生变化时，需要刷新并重新核对。普通文件夹也可浏览代码和保存单文件审查。

[项目切换](docs/reference.md#打开与切换项目) · [差异与快照](docs/reference.md#浏览和审查) · [Summary 与文件标签](../../docs/review-surface.md)

## Git 工作台

可以对全部改动、所选文件或单个改动块执行 Stage / Unstage，在 Summary 写提交说明，再提交暂存区。审阅状态单独保存，暂存需要明确操作。

顶部提供分支切换、创建分支、Fetch、Pull 和 Push。同步沿用本机 Git／SSH 认证；Pull 仅快进，Push 只推送选中的分支，不强制推送或附带 tags。提交只创建本地 commit，推送另行操作。

Discard 会丢弃未暂存内容，所列的未跟踪文件也会被删除，执行前会要求确认。历史比较保持只读；合并冲突、自动 stash 和完整提交关系图尚未提供。

[Stage 与审阅范围](docs/reference.md#stage--unstage) · [分支、同步与 Discard 的完整边界](../../docs/git-workbench.md)

## TAPD 任务联动提交

同时安装并配置[任务看板](../codex-task-panel/README.md)后，在 Summary 提交区选择已导入的任务，获取它的源码关键字，再点击「应用到提交说明」。这一步会覆盖当前整段说明，之后仍可按本次改动修改标题和正文，保留任务标识即可。

代码审查通过本机接口向看板取提交上下文。TAPD 凭据和缓存由看板管理；普通审查与提交可以独立使用。把 commit 关联回远端 TAPD 仍需要项目的源码应用和 Webhook 配置。

[完整联动流程](docs/reference.md#工作区常驻提交编辑区) · [接口与领域边界](../../docs/task-commit-context.md)

## 本地数据与限制

记录与批注保存在 `${CODEX_HOME:-~/.codex}/local-review/reviews.sqlite`，可通过 `LOCAL_REVIEW_HOME` 指定目录。各电脑独立保存，Git push 不会同步审查记录。

单文件默认上限 5 MiB、快照总量默认上限 50 MiB，这两项可在设置中调整。每次快照最多 300 个文件。代码预览只读，写入由明确的 Git 操作触发。[大小设置、历史范围与文件访问限制 →](docs/reference.md#本地数据与限制)

## 常见问题

没有任务看板时，取消 TAPD 关联即可普通提交。切换历史显示范围只影响可见提交；顶部的分支切换会实际检出。大文件或批注提示变化时，先核对设置与当前磁盘内容。

[完整排查说明 →](docs/reference.md#常见问题)

## 问题与建议

反馈技能随插件安装。新建聊天后可以说：

> 帮我给本地代码审查提交 issue：切换项目后，刚才的批注没有显示……

有 GitHub 连接时可按指令提交，否则提供草稿和表单链接。附实际版本和复现步骤，移除业务代码、私人项目路径与敏感信息。

[报告问题](https://github.com/skyfour/my_codex_plugin/issues/new?template=bug_report.yml) · [提出建议](https://github.com/skyfour/my_codex_plugin/issues/new?template=feature_request.yml) · [查看反馈](https://github.com/skyfour/my_codex_plugin/issues)

## 开发与验证

修改审查 UI、Git 刷新或异步状态后，发布前需要完成完整的 `npm run test:local-review-ui`，需要 Chrome。

[本插件测试说明](docs/reference.md#开发与验证) · [仓库开发说明](../../docs/development.md) · [完整使用说明](docs/reference.md) · [反馈与维护](../../docs/feedback.md)

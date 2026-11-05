# Codex 插件集

我自己在用的几个 Codex 插件：排任务、调接口、看代码、查数据库。装好后从 Codex 左侧打开，需要哪个就装哪个。

[开始安装](#快速开始) · [选择插件](#选择插件) · [问题与建议](#问题与建议) · [更新记录](CHANGELOG.md)

![四个插件的用途插画：任务卡片、请求与响应、代码批注、数据库查询。](docs/assets/readme/cover.png)

## 快速开始

当前完整安装支持 **macOS**，需要 **Node.js ≥22.13、Git，以及已登录的 Codex 桌面版和 CLI**。CLI 需支持 `codex plugin`，桌面版需支持 MCP Apps；`node` 和 `codex` 要能被桌面应用找到。

```sh
git clone https://github.com/skyfour/my_codex_plugin.git
cd my_codex_plugin
```

接着，从下面选一个安装命令执行。安装器会准备依赖、构建和检查，再注册所选插件。完成后**重新打开 Codex 并新建聊天**，确认插件已启用，再点击左侧图标。

## 选择插件

| 插件 | 用来做什么 | 在仓库根目录执行 |
| --- | --- | --- |
| [任务看板](plugins/codex-task-panel/README.md) | 从 TAPD 导入任务，排进度，关联 Codex 会话 | `npm run install:task-panel` |
| [API 调试台](plugins/codex-api-client/README.md) | 保存和发送请求，看响应，运行脚本与断言 | `npm run install:api-client` |
| [本地代码审查](plugins/codex-local-review/README.md) | 看差异、留批注，暂存、提交和同步分支 | `npm run install:local-review` |
| [DBX 数据库工作台](plugins/dbx/README.md) | 在侧栏使用官方 DBX Web，管理连接和查询 | `npm run install:dbx` |

任务看板导入需配置 TAPD 工作空间、账户完整姓名和 Access Token。API 调试台使用 macOS Keychain 保存敏感值。DBX 需要先启动 Docker，首次安装会拉取官方镜像并准备服务。

四个插件分别安装、分别更新。普通代码审查与提交可以单独使用；需要把 TAPD 任务带进提交信息时，再同时安装任务看板。

[完整安装步骤与首次使用 →](docs/installation.md#快速开始)

## 安装与更新

回到首次克隆的仓库，拉取代码，再运行需要更新的插件命令。例如：

```sh
git pull --ff-only
npm run install:local-review
```

完成后重开 Codex 并新建聊天。安装和更新保留已有本机数据；**只拉取代码不会更新已安装实例**。DBX 本体更新使用 `npm run update:dbx`，与适配器版本分开管理。

[批量安装与 DBX 恢复](docs/installation.md#安装与更新) · [数据与换电脑安装](docs/installation.md#数据与换电脑安装)

## 问题与建议

反馈技能随所选插件一起安装。在 Codex 中可以直接说：

> 帮我给 API 调试台提交 issue：导入集合后，有一条请求的参数丢失了。

它会整理实际版本、复现步骤和预期结果。有 GitHub 连接时可按你的指令提交；没有连接时会给出草稿和表单链接。提交前请移除凭据、业务数据和私人路径。

[报告问题](https://github.com/skyfour/my_codex_plugin/issues/new?template=bug_report.yml) · [提出建议](https://github.com/skyfour/my_codex_plugin/issues/new?template=feature_request.yml) · [已有反馈](https://github.com/skyfour/my_codex_plugin/issues)

维护者用 GitHub 通知／邮件接收反馈。在仓库中可以说“查看插件反馈”，或运行 `npm run issues`。接收设置和处理流程见[反馈与维护说明](docs/feedback.md)。

## 常见问题

安装后没有入口、仍显示旧版，或 Docker 准备失败时，先查看[安装排查](docs/installation.md#常见问题)。

## 开发与验证

构建、测试和文档资源约定见[开发说明](docs/development.md)。每个插件首页都链接了完整使用说明，参数和操作边界保留在对应文档中。

[任务与提交联动](docs/task-commit-context.md) · [审阅界面](docs/review-surface.md) · [Git 工作台](docs/git-workbench.md) · [维护约定](AGENTS.md) · [GitHub Releases](https://github.com/skyfour/my_codex_plugin/releases)

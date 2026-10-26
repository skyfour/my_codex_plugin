# Codex 插件集

在 Codex 左侧打开任务看板、API 调试台、本地代码审查和 DBX 数据库工作台。通过 GitHub 分发，**每个插件独立安装、独立更新**，无需一次安装全部插件。

[快速开始](#快速开始) · [选择插件](#选择插件) · [安装与更新](#安装与更新) · [常见问题](#常见问题) · [开发与验证](#开发与验证)

## 选择插件

| 插件 | 适合做什么 | 插件版本 | 使用与限制 |
| --- | --- | --- | --- |
| **任务看板** | 从 TAPD 选择导入任务，安排泳道进度，关联 Codex 会话 | 0.4.7 | [任务看板说明](plugins/codex-task-panel/README.md) |
| **API 调试台** | 管理请求、集合与环境，执行脚本与断言，导入／导出工作区 | 0.2.1 | [API 调试台说明](plugins/codex-api-client/README.md) |
| **本地代码审查** | 浏览 Git 差异与历史，添加批注，暂存、提交和同步分支 | 0.5.12 | [代码审查说明](plugins/codex-local-review/README.md) |
| **DBX 数据库工作台** | 在侧栏使用完整官方 Docker Web，管理连接、查询数据库 | 0.6.42 | [DBX 说明](plugins/dbx/README.md) |

DBX 表格中的版本是 **Codex 适配器版本**。DBX 本体跟随官方稳定发行版，通过工作台中的更新入口独立更新，无需自行编译；上游交互有较大变化时需先更新适配器。

> DBX 适配器 0.6.41 已将官方服务准备移到安装阶段；侧栏复用已准备的本机服务。

## 快速开始

### 1. 准备环境

当前仓库的完整安装流程支持 **macOS**，需要：

- **Node.js ≥22.13**，建议 Node 24 LTS，包含 npm。
- **Git**，以及已登录的 **Codex 桌面版与 CLI**。CLI 需支持 `codex plugin`，桌面版需支持 MCP Apps。
- `node` 和 `codex` 位于 Codex 桌面应用可以继承的 PATH。

插件各自的额外条件：

| 插件 | 额外条件与边界 |
| --- | --- |
| 任务看板 | TAPD 导入需要工作空间、账户完整姓名和 Access Token；会话关联需 CLI 支持 `app-server --stdio`；不回写 TAPD 状态 |
| API 调试台 | 敏感变量与 Cookie 使用 macOS Keychain；请求从运行插件的本机发出 |
| 本地代码审查 | Git／SSH 认证沿用本机配置；TAPD 任务关联另需同机任务看板，普通审查和提交可独立使用 |
| DBX | 安装、使用与更新时需运行 Docker Desktop 或兼容的本地 Docker Engine，并能通过 `docker info` 访问；不需要启动 DBX 桌面应用 |

可先在终端检查：

```sh
node --version
codex plugin --help
```

### 2. 获取仓库并选择安装

```sh
git clone https://github.com/skyfour/my_codex_plugin.git
cd my_codex_plugin
```

只执行需要的命令：

| 插件 | 安装或更新适配器 |
| --- | --- |
| 任务看板 | `npm run install:task-panel` |
| API 调试台 | `npm run install:api-client` |
| 本地代码审查 | `npm run install:local-review` |
| DBX | `npm run install:dbx` |

例如，只需要代码审查就执行 `npm run install:local-review`；希望关联 TAPD 任务时，再执行 `npm run install:task-panel`。

每个命令安装所选插件的锁定依赖，执行所需构建与 MCP 检查，再注册到 `my-codex-plugins` 市场。没有默认安装的插件。**安装 DBX 时还会先准备官方 Docker 服务**：首次下载官方镜像、创建并启动容器，完成健康与嵌入兼容预检后才注册插件。终端会显示各阶段进度；Docker、网络或预检失败会使安装失败，不会报告安装成功。已有容器与数据会保留，重跑安装不会强制更新 DBX 本体。

### 3. 在 Codex 中打开

安装完成后，重新打开 Codex 并新建聊天，在插件设置中确认已启用，再点击左侧相应图标。

| 插件 | 第一次使用 |
| --- | --- |
| 任务看板 | 在设置中配置 TAPD 数据源与本地凭据；从「导入任务」查询、勾选并确认 |
| API 调试台 | 新建请求，或导入 Postman 集合、环境和 cURL；敏感值通过变量引用 |
| 本地代码审查 | 打开本地项目，浏览工作区或提交历史，添加批注并保存审查记录 |
| DBX | 安装已完成镜像与服务准备；侧栏复用或启动已有容器，在官方工作台中设置首次密码并添加连接 |

前三个插件也支持在聊天中输入「打开任务看板」「打开 API 调试台」「打开本地代码审查」。DBX 直接点击左侧 DBX 图标。

## 安装与更新

### 更新所选插件

保留首次克隆的仓库目录。每次更新先进入该目录拉取源码，再运行需要更新的插件命令：

```sh
git pull --ff-only
npm run install:local-review
```

将第二行换为上表中的对应命令即可。更新完成后重新打开 Codex 并新建聊天。**只运行 `git pull` 不会更新已安装实例**；本仓库注册的是本地目录，不使用 `marketplace upgrade`。

### 单独更新官方 DBX

在 DBX 侧栏点击「更新官方 DBX」，或在仓库根目录执行：

```sh
npm run update:dbx
```

这会查询官方最新稳定版本并更新本机 Docker 服务，数据保留在独立持久化目录。已有服务更新前会备份；启动失败时尝试恢复升级前的数据与原镜像，结果会明确提示失败。详情见 [DBX 更新与恢复](plugins/dbx/README.md#更新官方-dbx)。

通过嵌入兼容预检的 DBX 本体版本可直接更新；上游接口变化时可能仍需适配器更新。适配器自身更新使用 `git pull --ff-only` 和 `npm run install:dbx`。

已安装插件需要补做首次准备或恢复服务时，先启动 Docker，再在仓库根目录运行 `npm run setup:dbx`。该命令复用已有服务与数据，不强制更新本体，也不注册或更新 Codex 插件；明确升级本体仍使用 `npm run update:dbx`。侧栏缺少已准备的容器时会提示先运行安装或准备命令，不在打开面板时首次拉取镜像。

### 一次明确选择多个插件

```sh
node scripts/install.mjs --plugin codex-task-panel --plugin codex-local-review
```

`--plugin` 可重复使用；不带参数只显示帮助。`--prepare` 也必须明确列出插件，只准备源码依赖、构建与 MCP 检查，不启动 Docker、创建运行数据或注册到 Codex。

## 数据与换电脑安装

插件数据保存在本机。新电脑仍按[快速开始](#快速开始)选择安装所需插件，再按各插件说明配置或迁移数据；GitHub 仓库不包含你的任务、代码审查记录、请求凭据或数据库连接。

| 插件 | 新电脑如何继续使用 |
| --- | --- |
| 任务看板 | 重新配置 TAPD 并导入所需任务；本地泳道和 Codex 会话关联各设备独立 |
| API 调试台 | 在旧电脑「导出全部」，新电脑导入备份；敏感值、Cookie 与本机附件需重新配置，见[迁移范围](plugins/codex-api-client/README.md#整体导入与导出) |
| 本地代码审查 | Git 项目照常克隆；审查记录与批注在本机目录，可导出 Markdown／JSON 供查看 |
| DBX | 使用独立 Docker 数据目录；原生 0.6.39 的旧目录不会自动迁移，见[DBX 数据说明](plugins/dbx/README.md#数据与旧版迁移) |

默认数据目录与环境变量分别写在各插件 README。安装／更新不会自动跨设备同步数据。迁移运行中的数据库前先停止对应服务，不要把凭据或数据库提交到 Git。

## 常见问题

**为什么不能只在 Codex 中添加 GitHub 仓库？** 这些插件需要安装 npm 依赖，API 调试台还需要构建界面；安装脚本负责准备文件并注册插件。完整流程是「克隆仓库 → 选择安装 → 重开 Codex」。

**安装后没有左侧入口，或仍显示旧版？** 检查安装脚本是否成功、插件是否启用，再重新打开 Codex 并新建聊天。终端能运行命令但桌面应用找不到时，检查桌面应用继承的 PATH。

**DBX 安装或首次准备失败？** 先检查 Docker 后台、`docker info` 和终端中显示的网络、端口或兼容预检错误。解决后，未完成安装时重跑 `npm run install:dbx`；已安装时可运行 `npm run setup:dbx` 补准备，再重试侧栏。保留现有数据目录，不需要删除连接和历史。

**更新会清空数据吗？** 插件安装和更新保留各自的本机数据目录。DBX Docker 改造使用新目录，旧原生数据也保留，但不会自动导入；不要把新界面中的空列表当作旧数据被删除。

**支持 Windows／Linux 吗？** 当前完整安装流程仅验证 macOS。API 调试台依赖 macOS Keychain；DBX 使用官方 Docker 镜像，不再绑定 Apple Silicon 原生包，其他系统的完整安装仍需单独验证。

**之前装过独立版本，如何避免重复入口？** 先确认本仓库的实例正常，再在 Codex 设置中停用或卸载旧市场实例。旧 DBX 的安装标识为 `dbx@dbx-local`，本仓库为 `dbx@my-codex-plugins`；安装器不会自动删除旧插件或数据。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm run prepare:plugins` | 显式准备任务看板、API 调试台和代码审查，不注册插件 |
| `npm run install:dbx -- --prepare` | 单独准备 DBX 适配器，不注册插件或启动 Docker |
| `npm run setup:dbx` | 准备或恢复官方 DBX Docker 服务，完成健康与兼容预检；不注册插件或强制更新本体 |
| `npm run validate` | 检查市场、插件版本、MCP 入口与锁定依赖 |
| `npm test` | 验证结构、安装选择与各插件 Node 测试 |
| `npm run check` | 检查 API 调试台、代码审查和 DBX 的 stdio MCP 与内联界面；DBX 检查不启动 Docker |
| `npm run test:ui` | 运行任务看板、API 调试台和代码审查的完整浏览器测试，需要 Chrome |
| `npm run test:dbx-ui` | 单独验证 DBX 管理入口与内嵌工作台，需要 Chrome |

每个插件的独立 README 包含开发命令、数据目录和已知限制。浏览器测试截图／JSON 默认写入 `/tmp/codex-plugin-ui-audit`，可通过 `UI_AUDIT_DIR` 指定；代码审查截图还可用 `CODEX_UI_SCREENSHOT_DIR` 设置。

新增插件放入 `plugins/<name>/`，提供独立 README、清单、MCP 入口、源码、锁文件和安装入口，再注册到 `.agents/plugins/marketplace.json`。不提交 `node_modules`、构建包、运行数据库或凭据。

只有用户明确要求发布时才递增版本、推送、合并与更新正式安装缓存。开发分支的同版本预览应使用隔离目录，不覆盖已发布安装。

更多说明：[任务提交联动](docs/task-commit-context.md) · [代码审查界面](docs/review-surface.md) · [Git 工作台](docs/git-workbench.md) · [维护约定](AGENTS.md) · [更新记录](CHANGELOG.md) · [GitHub Releases](https://github.com/skyfour/my_codex_plugin/releases)

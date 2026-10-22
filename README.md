# Codex 插件集

在 Codex 侧栏里管理任务、调试接口、审阅代码和操作数据库。

通过 GitHub 分发，每个插件独立安装与更新，需要哪几个就安装哪几个。日常使用由 Codex 启动所需服务；DBX 也无需另外启动桌面应用。

[快速开始](#快速开始) · [使用指南](#开始使用) · [更新插件](#更新插件) · [常见问题](#常见问题) · [开发与维护](#开发与维护)

## 插件一览

| 插件 | 可以做什么 | 当前版本 |
| --- | --- | --- |
| [任务看板](plugins/codex-task-panel/README.md) | 从 TAPD 选择导入任务，安排泳道进度，关联 Codex 会话 | 0.4.7 |
| [API 调试台](plugins/codex-api-client/README.md) | 管理 HTTP 请求、集合与环境，整体备份迁移，执行脚本与断言 | 0.2.1 |
| [本地代码审查](plugins/codex-local-review/README.md) | 浏览差异、添加审阅评论，以及暂存、提交、拉取和推送 Git 改动 | 0.5.5 |
| [DBX 数据库工作台](plugins/dbx/README.md) | 在 Codex 内使用 DBX 工作台，管理连接、查询数据库 | 0.6.39 |

## 快速开始

### 安装前准备

- **macOS**：当前安装脚本仅支持 macOS；DBX 发布包另要求 **Apple Silicon（M 系列芯片）**。
- **Node.js ≥ 22.13**：建议 Node 24 LTS，需包含 npm。
- **Git**，以及已登录的 **Codex 桌面版与 CLI**。CLI 需支持 `codex plugin`；任务看板的会话功能还需支持 `codex app-server --stdio`。

`node` 和 `codex` 需能被 Codex 桌面应用找到。可先在终端检查：

```sh
node --version
codex plugin --help
```

### 1. 获取仓库

在准备存放插件源码的位置执行：

```sh
git clone https://github.com/skyfour/my_codex_plugin.git
cd my_codex_plugin
```

### 2. 安装插件

选择需要的插件，在仓库根目录执行对应命令：

| 插件 | 安装命令 |
| --- | --- |
| 任务看板 | `npm run install:task-panel` |
| API 调试台 | `npm run install:api-client` |
| 本地代码审查 | `npm run install:local-review` |
| DBX | `npm run install:dbx` |

例如，只安装任务看板和本地代码审查：

```sh
npm run install:task-panel
npm run install:local-review
```

每个命令对应 `plugins/<插件名>/install.mjs`，只准备并安装该插件：按需安装依赖或下载原生程序、执行所需构建，再注册到 `my-codex-plugins` 插件市场。**没有默认安装的插件。**

安装 DBX 时，脚本会从本仓库的 [GitHub Releases](https://github.com/skyfour/my_codex_plugin/releases) 下载对应原生程序并校验 SHA-256，无需安装 Rust 或自行编译。平台与发布方式见 [DBX 说明](plugins/dbx/README.md)。

<details>
<summary>高级：一次指定多个插件</summary>

也可以明确列出本次需要安装的插件：

```sh
node scripts/install.mjs --plugin codex-task-panel --plugin codex-local-review
```

`--plugin` 可重复使用。单个 `--plugin` 命令仍可使用；不带参数运行 `node scripts/install.mjs` 只显示帮助，不安装任何插件。

</details>

### 3. 在 Codex 中打开

安装完成后，重新打开 Codex 并新建聊天，在插件设置中确认插件已启用，然后点击左侧对应图标。

任务看板、API 调试台和本地代码审查也可以在聊天中输入「打开任务看板」「打开 API 调试台」或「打开本地代码审查」。DBX 直接点击左侧 DBX 图标。

> 请保留克隆目录，后续更新仍使用它。当前安装流程是「克隆 GitHub 仓库 → 运行安装脚本」；只添加远程插件市场不会准备 npm 依赖、API 界面和 DBX 原生程序。

## 开始使用

| 插件 | 第一次打开后 |
| --- | --- |
| 任务看板 | 在「设置 → 数据源」填写 TAPD 工作空间 ID、账户完整姓名，在「本地凭据」保存 Access Token。之后从「导入任务」查询、勾选并确认。 |
| API 调试台 | 新建请求，或导入已有的 Postman 集合、环境和 cURL。密码、Token 等值请标记为敏感，通过变量引用。 |
| 本地代码审查 | 点击「打开项目…」选择本地项目，浏览工作区差异或提交历史，添加评论并保存审查记录。 |
| DBX | 在工作台设置密码、按提示完成迁移，再添加数据库连接。 |

任务看板保存配置不会自动导入任务，也不会向 TAPD 回写状态。API 调试台的请求从本机发出，支持 localhost 和内网。

代码审查可独立使用；如需在提交时关联 TAPD 任务，还需安装并配置任务看板。安装任务看板时会自动登记其本机联动接口。详见[任务提交联动](docs/task-commit-context.md)。

## 更新插件

进入首次克隆的仓库目录，获取最新源码：

```sh
git pull --ff-only
```

再执行需要更新的插件各自的安装命令。例如，只更新任务看板和本地代码审查：

```sh
npm run install:task-panel
npm run install:local-review
```

其他插件使用[安装命令表](#2-安装插件)中的对应命令；DBX 单独执行 `npm run install:dbx`。每个命令只更新指定插件，不安装或更新其他插件。

完成后重新打开 Codex 并新建聊天。**只执行 `git pull` 不会更新已安装的插件**，还需要重新运行安装脚本。本仓库注册的是本地目录，更新不使用 `marketplace upgrade`。

更新保留各插件已有的本地数据。DBX 的版本与校验值由 `plugins/dbx/release.json` 固定；版本未变化时会跳过原生程序下载。

## 数据与迁移

插件工作数据保存在本机，安装和更新不会自动跨设备同步任务、会话、请求集合、环境或凭据。新设备按[快速开始](#快速开始)安装，再配置各插件。

- **任务看板**：每台设备单独配置 TAPD，可从相同来源重新导入任务；本地泳道和 Codex 会话关联各自独立。
- **API 调试台**：在集合列表点击「导出全部」，可将所有集合、环境、全局变量及各级 API 脚本保存为一个工作区备份，再通过「导入」迁移；也支持 Postman 导入 / 导出。敏感变量和 Cookie 值保存在 macOS 钥匙串，新设备需要重新配置。详见[整体导入与导出](plugins/codex-api-client/README.md#整体导入与导出)。
- **本地代码审查与 DBX**：审查记录、数据库连接配置和历史保留在各自的本地数据目录。

<details>
<summary>查看默认数据目录与自定义方式</summary>

| 插件 | 默认目录 | 自定义环境变量 |
| --- | --- | --- |
| 任务看板 | `${CODEX_HOME:-~/.codex}/task-panel/` | `TASK_PANEL_HOME` |
| API 调试台 | `~/Library/Application Support/Codex API Client` | `CODEX_API_CLIENT_DATA_DIR` |
| 本地代码审查 | `${CODEX_HOME:-~/.codex}/local-review/` | `LOCAL_REVIEW_HOME` |
| DBX | `~/Library/Application Support/com.dbx.codex` | `DBX_CODEX_DATA_DIR` |

配置工具与 Codex 应使用相同的环境变量。任务看板的 TAPD 凭据保存在其本机目录中的 `credentials.json`，权限为 `0600`，不会返回到聊天。

备份或迁移本地数据库前先停止对应服务；不要把数据、凭据放进 Git，也不要通过云盘并发同步运行中的 SQLite 文件。

</details>

## 常见问题

### 为什么不能只在 Codex 中添加 GitHub 仓库？

本仓库中的 Node 插件需要安装依赖，API 调试台需要构建界面，DBX 需要下载原生程序。安装脚本负责这些步骤，并将准备好的插件注册到 Codex。完整流程见[快速开始](#快速开始)。

### 安装后没有侧栏入口，或仍显示旧界面？

先确认脚本执行成功、插件已在 Codex 设置中启用，再重新打开 Codex 并新建聊天，让插件连接重新加载。若终端能运行 `node` 和 `codex`，桌面应用却提示找不到命令，请检查桌面应用继承的 PATH。

### 已安装过旧版独立插件，如何避免重复入口？

先安装本仓库中的插件并确认可用，再在 Codex 插件设置中停用、卸载旧实例，例如来自 `task-panel-local` 或 `codex-api-client-local` 市场的插件。安装脚本不会自动删除旧插件或数据。

旧 DBX 实例 `dbx@dbx-local` 可在确认新实例 `dbx@my-codex-plugins` 正常后移除：

```sh
codex plugin remove dbx@dbx-local
```

### 支持 Windows 或 Linux 吗？

当前完整安装仅支持 macOS。API 调试台的敏感值依赖 macOS 钥匙串，DBX 目前只发布 macOS Apple Silicon 包。

## 开发与维护

在仓库根目录执行：

| 命令 | 用途 |
| --- | --- |
| `npm run prepare:plugins` | 仅供开发：明确准备三个 Node 插件的锁定依赖、构建 API 界面、检查插件配置与 MCP 入口；不修改 Codex 安装配置 |
| `npm run validate` | 检查插件市场、版本、MCP 入口与发布包信息 |
| `npm test` | 运行结构验证和现有 Node 测试 |
| `npm run check` | 检查 API 调试台与代码审查的真实 stdio MCP 连接和内联界面 |
| `npm run test:ui` | 运行三个 Node 插件的完整浏览器测试，需要 Chrome |

<details>
<summary>目录约定与单独验证</summary>

新增插件放入 `plugins/<name>/`，包含 `.codex-plugin/plugin.json`、`.mcp.json`、skills、源码、锁文件及独立的 `install.mjs` 入口，并注册到 `.agents/plugins/marketplace.json`；同时在根目录 `package.json` 添加对应的 `install:<简称>` 命令。有构建步骤时同时更新安装逻辑。

任务看板直接运行源码；API 界面构建产物在其 `dist/index.html`；DBX 原生程序和工作台由安装器下载。这些构建产物及 `node_modules` 不提交到 Git。DBX 的打包、校验与发布顺序见 [DBX 维护说明](plugins/dbx/README.md)。

可单独运行 `npm run test:api-ui`、`npm run test:task-panel-ui` 或 `npm run test:local-review-ui`。代码审查 UI 截图默认写入仓库的 `test-results/local-review/`，可通过 `CODEX_UI_SCREENSHOT_DIR` 指定其他目录；相对路径按当前工作目录解析。控件审计截图与 JSON 默认在 `/tmp/codex-plugin-ui-audit`，可通过 `UI_AUDIT_DIR` 修改。

</details>

更多说明：[Summary 与文件标签](docs/review-surface.md) · [Git 工作台](docs/git-workbench.md) · [界面验证记录](docs/ui-review-2026-10-15.md) · [维护约定](AGENTS.md) · [更新记录](CHANGELOG.md) · [GitHub Releases](https://github.com/skyfour/my_codex_plugin/releases)

插件市场结构参考 [OpenAI 官方插件打包文档](https://developers.openai.com/plugins/build/plugins#marketplace-metadata)。

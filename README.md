# 我的 Codex 插件

个人 Codex 插件统一源码与安装仓库。后续自用插件继续收录到这里。

| 插件 | 版本 | 打开方式 |
| --- | --- | --- |
| [任务看板](plugins/codex-task-panel) | 0.4.5 | 打开任务看板 |
| [API 调试台](plugins/codex-api-client) | 0.1.0 | 打开 API 调试台 |
| [本地代码审查](plugins/codex-local-review) | 0.4.1 | 打开本地代码审查 |
| [DBX 数据库工作台](plugins/dbx) | 0.6.39 | 点击 Codex 左侧 DBX 图标 |

## 在其他电脑安装

当前完整支持 **macOS**（API 调试台敏感值依赖系统钥匙串）。先安装 Git、Node.js >=22.13（建议 Node 24 LTS）、Codex 桌面版及支持 `codex plugin` 的 CLI，并完成 Codex 登录。`node` 和 `codex` 需要在桌面应用的 PATH 中可用。

```sh
git clone git@github.com:skyfour/my_codex_plugin.git
cd my_codex_plugin
node scripts/install.mjs
```

未配置 GitHub SSH 时，克隆可改用 `git clone https://github.com/skyfour/my_codex_plugin.git`。

安装脚本自动安装锁文件中的依赖、构建 API 界面、检查插件 MCP，然后注册 `my-codex-plugins` 本地市场并安装原有三个插件。每台电脑只需运行一次；完成后重新打开 Codex 并新建聊天，在插件设置中确认启用，再输入上表的打开方式。正常使用无需手动启动后台服务。

DBX 按需安装，目前提供 **macOS Apple Silicon** 包：

```sh
node scripts/install.mjs --plugin dbx
```

安装器自动从[本仓库的 DBX Release](https://github.com/skyfour/my_codex_plugin/releases/tag/dbx-v0.6.39)下载原生程序、校验 SHA-256 并安装插件。首次使用时在左侧 DBX 界面设置密码、完成迁移并添加连接，无需启动 DBX 桌面应用。也可以用 `--plugin codex-task-panel` 等名称只准备和安装一个插件。

**请保留克隆目录**，用于后续更新。仓库分发源码，Git 直接注册不会自动安装 npm 依赖；请使用上述流程，不要只执行 `codex plugin marketplace add skyfour/my_codex_plugin`。

如果已安装旧市场 `task-panel-local` 或 `codex-api-client-local` 中的插件，在 Codex 插件设置中停用旧实例，避免出现重复入口；确认新实例正常后再卸载旧实例。安装脚本不删除旧插件或本地数据。

## 更新插件

```sh
cd my_codex_plugin
git pull --ff-only
node scripts/install.mjs
```

随后重新打开 Codex 并新建聊天。注册的是本地目录，因此更新使用 `git pull`，无需 `marketplace upgrade`。

更新 DBX 时，在同一克隆目录执行 `git pull --ff-only`，再运行 `node scripts/install.mjs --plugin dbx`。`plugins/dbx/release.json` 固定发布版本与校验值；版本未变化时安装器跳过下载。原生程序放在 Git 忽略目录，数据库配置和数据仍在各机器的 DBX 数据目录，不会被更新脚本删除。新版本如何发布见 [DBX 维护说明](plugins/dbx/README.md)。

## 配置任务看板

直接打开看板的「设置 → 数据源」，填写并保存 TAPD 工作空间 ID、账户完整姓名，再在「本地凭据」输入 Access Token 并点击「保存凭据」。令牌输入隐藏，保存后清空输入框，只在本机以 0600 权限保存，不返回到聊天。

保存凭据后即可通过「导入任务」查询、勾选并确认。保存配置不会自动导入，也不会发起 TAPD 请求。

终端备用方式：在 `plugins/codex-task-panel` 中执行 `npm run configure`。即使设置了 `TAPD_ACCESS_TOKEN`，也能直接输入并保存新令牌，保存后本地令牌立即优先生效，无需移除环境变量。旧配置在重新保存前保持原优先级。

## 多电脑数据边界

此仓库统一安装与升级程序，**不会自动同步任务、会话、接口集合、环境或凭据**。

- 任务看板：`${CODEX_HOME:-~/.codex}/task-panel/`；`TASK_PANEL_HOME` 可自定义。每台电脑单独配置 TAPD，同一来源可重新导入；本地泳道和会话关联各自独立。
- API 调试台：`~/Library/Application Support/Codex API Client`；`CODEX_API_CLIENT_DATA_DIR` 可自定义。集合、环境可用 Postman 导出/导入迁移；敏感值不随默认导出迁移，在新电脑重新填写。
- 本地代码审查：`${CODEX_HOME:-~/.codex}/local-review/`；`LOCAL_REVIEW_HOME` 可自定义。保存最近项目、固定项目、人工评论、已审阅状态与代码快照，不依赖远程仓库或 AI。
- DBX：`~/Library/Application Support/com.dbx.codex`；`DBX_CODEX_DATA_DIR` 可自定义。连接、密码和历史只留在本机。
- 升级前可备份本地数据目录。不要将这些目录放进 Git，也不要并发使用云盘同步正在运行的 SQLite 文件。

## 开发与验证

```sh
npm run prepare:plugins
npm test
npm run check
npm run test:task-panel-ui
npm run test:local-review-ui
```

`test:task-panel-ui` 需要 Chrome，模拟原生宿主无响应时打开导入页、查询错误恢复，以及宿主推送期间的全输入控件焦点与草稿保留。

`prepare:plugins` 不修改 Codex 配置，适用于准备源码和 CI。任务面板直接运行源码；API 界面构建产物位于其 `dist/index.html`，不提交到 Git。

一般插件放在 `plugins/<name>/`，包含 `.codex-plugin/plugin.json`、`.mcp.json`、skills、源码和锁文件，然后加入 `.agents/plugins/marketplace.json`；如有专门构建步骤，同时更新安装脚本。DBX 是原生发布包，使用 `plugins/dbx/release.json` 固定版本和 SHA-256，由安装器自动获取。

市场结构参考 [OpenAI 官方插件打包文档](https://developers.openai.com/plugins/build/plugins#marketplace-metadata)。

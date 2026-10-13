# 我的 Codex 插件

个人 Codex 插件统一源码与安装仓库。后续自用插件继续收录到这里。

| 插件 | 版本 | 打开方式 |
| --- | --- | --- |
| [任务看板](plugins/codex-task-panel) | 0.4.1 | 打开任务看板 |
| [API 调试台](plugins/codex-api-client) | 0.1.0 | 打开 API 调试台 |

## 在其他电脑安装

当前完整支持 **macOS**（API 调试台敏感值依赖系统钥匙串）。先安装 Git、Node.js >=22.13（建议 Node 24 LTS）、Codex 桌面版及支持 `codex plugin` 的 CLI，并完成 Codex 登录。`node` 和 `codex` 需要在桌面应用的 PATH 中可用。

```sh
git clone git@github.com:skyfour/my_codex_plugin.git
cd my_codex_plugin
node scripts/install.mjs
```

未配置 GitHub SSH 时，克隆可改用 `git clone https://github.com/skyfour/my_codex_plugin.git`。

安装脚本自动安装锁文件中的依赖、构建 API 界面、检查 API MCP，然后注册 `my-codex-plugins` 本地市场并安装两个插件。每台电脑只需运行一次；完成后重新打开 Codex 并新建聊天，在插件设置中确认启用，再输入上表的打开方式。正常使用无需手动启动后台服务。

**请保留克隆目录**，用于后续更新。仓库分发源码，Git 直接注册不会自动安装 npm 依赖；请使用上述流程，不要只执行 `codex plugin marketplace add skyfour/my_codex_plugin`。

如果已安装旧市场 `task-panel-local` 或 `codex-api-client-local` 中的插件，在 Codex 插件设置中停用旧实例，避免出现重复入口；确认新实例正常后再卸载旧实例。安装脚本不删除旧插件或本地数据。

## 更新所有插件

```sh
cd my_codex_plugin
git pull --ff-only
node scripts/install.mjs
```

随后重新打开 Codex 并新建聊天。注册的是本地目录，因此更新使用 `git pull`，无需 `marketplace upgrade`。

## 配置任务看板

直接打开看板的「设置 → 数据源」，填写并保存 TAPD 工作空间 ID、账户完整姓名，再在「本地凭据」输入 Access Token 并点击「保存凭据」。令牌输入隐藏，保存后清空输入框，只在本机以 0600 权限保存，不返回到聊天。

保存凭据后即可通过「导入任务」查询、勾选并确认。保存配置不会自动导入，也不会发起 TAPD 请求。

终端备用方式：在 `plugins/codex-task-panel` 中执行 `npm run configure`。如果设置了 `TAPD_ACCESS_TOKEN`，环境变量优先；界面会提示先移除变量并重新打开 Codex，再设置本地凭据。

## 多电脑数据边界

此仓库统一安装与升级程序，**不会自动同步任务、会话、接口集合、环境或凭据**。

- 任务看板：`${CODEX_HOME:-~/.codex}/task-panel/`；`TASK_PANEL_HOME` 可自定义。每台电脑单独配置 TAPD，同一来源可重新导入；本地泳道和会话关联各自独立。
- API 调试台：`~/Library/Application Support/Codex API Client`；`CODEX_API_CLIENT_DATA_DIR` 可自定义。集合、环境可用 Postman 导出/导入迁移；敏感值不随默认导出迁移，在新电脑重新填写。
- 升级前可备份本地数据目录。不要将这些目录放进 Git，也不要并发使用云盘同步正在运行的 SQLite 文件。

## 开发与验证

```sh
npm run prepare:plugins
npm test
npm run check
```

`prepare:plugins` 不修改 Codex 配置，适用于准备源码和 CI。任务面板直接运行源码；API 界面构建产物位于其 `dist/index.html`，不提交到 Git。

新增插件放在 `plugins/<name>/`，包含 `.codex-plugin/plugin.json`、`.mcp.json`、skills、源码和锁文件，然后加入 `.agents/plugins/marketplace.json`；如有专门构建步骤，同时更新安装脚本。

市场结构参考 [OpenAI 官方插件打包文档](https://developers.openai.com/plugins/build/plugins#marketplace-metadata)。

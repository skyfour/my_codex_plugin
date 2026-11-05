# DBX for Codex

在 Codex 侧栏连接数据库、编写 SQL、查看结果。使用完整的[官方 DBX Web 工作台](https://github.com/t8y2/dbx)，由本插件管理本机 Docker 服务。

[安装](#安装与更新插件) · [第一次打开](#第一次打开) · [更新 DBX](#更新官方-dbx) · [数据迁移](#数据与旧版迁移) · [插件集首页](../../README.md)

![DBX 用途插画：查询纸条进入本地容器中的数据库，再返回结果表格。](../../docs/assets/readme/dbx-cover.png)

## 安装与更新插件

需要 macOS、Node.js ≥22.13、Git、已登录的 Codex 桌面版和 CLI，以及 **Docker Desktop 或兼容的本地 Docker Engine**。CLI 需支持 `codex plugin`，桌面版需支持 MCP Apps；`node`、`npm`、`codex` 和 `docker` 要能被桌面应用找到。

先按[仓库快速开始](../../README.md#快速开始)克隆仓库，启动 Docker，在仓库根目录执行：

```sh
docker info
npm run install:dbx
```

安装会准备依赖、检查 MCP、拉取官方镜像、启动容器并检查健康与嵌入兼容性，全部成功后才注册插件。终端会显示进度和错误原因；已有容器与数据保留，重装不会强制更新 DBX 本体。

更新适配器时先运行 `git pull --ff-only`，再执行 `npm run install:dbx`。完成后重开 Codex 并新建聊天，确认插件已启用，再点击左侧 DBX 图标。

[镜像来源与完整安装要求 →](docs/reference.md#前置条件与安装限制)

## 第一次打开

1. 等安装完成，保持 Docker 后台运行。
2. 点击 Codex 左侧 DBX 图标，打开已准备的官方工作台。
3. 在工作台中设置首次密码，再添加数据库连接、编写查询。

后续打开会复用或启动已有容器。无需启动 DBX 桌面应用；关闭面板不会删除容器和数据。默认工作台地址是本机 `127.0.0.1:54224`。

### 连接本机数据库时

容器中的 `localhost` 指 DBX 容器自身。Docker Desktop 下访问这台电脑上的数据库通常使用 `host.docker.internal`；其他 Docker Engine 需检查对应网络配置。

SQLite 文件可放入运行目录的 `data/user-databases/`，在 DBX 中填写 `/app/data/user-databases/文件名`。不要覆盖 DBX 自己的数据库和密钥目录。

[容器连接、导出与剪贴板限制 →](docs/reference.md#容器内连接与嵌入限制)

## 更新官方 DBX

侧栏顶部显示 DBX 本体版本。点击「更新官方 DBX」，或在仓库根目录执行：

```sh
npm run update:dbx
```

它会查询官方最新稳定发行版。更新已有服务前先备份数据和密钥，再启动新版并检查兼容性；失败时尝试恢复旧镜像和升级前的数据。备份会保留，更新结果会说明是否恢复成功。

**适配器版本和 DBX 本体版本分开管理。** 更新本体通常无需更新插件；上游嵌入接口变化时，仍可能需要新版适配器。[更新与恢复细节 →](docs/reference.md#更新官方-dbx)

## 数据与旧版迁移

默认运行目录为 `~/.codex/dbx-docker/`，其中保存 `data/`、密钥、`backups/` 和 `exports/`，位于插件安装缓存之外。

| 要调整什么 | 环境变量 | 默认值 |
| --- | --- | --- |
| 运行与数据目录 | `DBX_CODEX_DOCKER_HOME` | `~/.codex/dbx-docker` |
| 本机端口 | `DBX_CODEX_DOCKER_PORT` | `54224` |

Codex 与终端命令需要使用相同配置。更换目录会使用独立数据，修改端口变量不会迁移已有容器。

旧原生版的 `~/Library/Application Support/com.dbx.codex` 会保留，**不会自动迁入 Docker 版**。首次看到空连接列表时，先检查所用版本和数据目录。迁移请通过旧工作台导出，再按官方支持的方式导入。[迁移完整说明 →](docs/reference.md#数据与旧版迁移)

## 常见问题

Docker、下载或启动失败时，先检查后台、`docker info` 和终端中显示的原因。未完成安装就重跑 `npm run install:dbx`；已经安装、需要补准备或恢复服务时运行：

```sh
npm run setup:dbx
```

该命令复用已有服务与数据，不注册插件，也不强制升级本体。端口冲突、更新失败或异常退出后遗留锁时，按[完整排查说明](docs/reference.md#常见问题)处理，保留原数据和备份。

## 问题与建议

反馈技能随插件安装。新建聊天后可以说：

> 帮我给 DBX 提交 issue：Docker 已启动，但侧栏显示连接失败……

有 GitHub 连接时可按指令提交，否则提供草稿和表单链接。附上适配器版本、工作台中的 DBX 版本和复现步骤；移除连接凭据、数据库内容与私人路径。

[报告问题](https://github.com/skyfour/my_codex_plugin/issues/new?template=bug_report.yml) · [提出建议](https://github.com/skyfour/my_codex_plugin/issues/new?template=feature_request.yml) · [查看反馈](https://github.com/skyfour/my_codex_plugin/issues)

## 开发与验证

[依赖准备、测试与隔离预览](docs/reference.md#开发与验证) · [仓库开发说明](../../docs/development.md) · [完整使用说明](docs/reference.md) · [反馈与维护](../../docs/feedback.md)

## 上游与许可

[DBX 官方源码](https://github.com/t8y2/dbx) · [官方 Docker 部署](https://github.com/t8y2/dbx/blob/main/deploy/docker-compose.release.yml)

适配器按 Apache-2.0 许可维护，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。官方应用由官方镜像提供。

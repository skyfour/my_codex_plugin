# DBX for Codex

从 Codex 左侧直接打开完整的 [官方 DBX Web 工作台](https://github.com/t8y2/dbx)，管理数据库连接、编写查询和查看结果。插件只提供轻量 Codex 入口与本机 Docker 管理，不再分发自行编译的 `dbx-web` 或固定版本工作台。

工作台占满主体区域，顶部保留一行版本、状态与更新工具栏。无需启动 DBX 桌面应用；使用工作台时需要 Docker 后台运行。

> 从适配器 **0.6.40** 起使用官方 Docker Web。升级前请先准备 Docker；旧原生版的数据会保留，但不会自动迁移。

> 安装期预热为当前开发分支改动，尚未发布；本轮保留现有版本号，不更新正式插件缓存。

## 前置条件与安装限制

- macOS、Node.js ≥22.13（建议 Node 24 LTS，含 npm）、Git，以及已登录的 Codex 桌面版与 CLI。
- CLI 支持 `codex plugin`，桌面版支持 MCP Apps；`node`、`npm`、`codex` 和 `docker` 需位于桌面应用能继承的 PATH。
- 已安装 **Docker Desktop 或兼容的本地 Docker Engine**，并能通过 `docker info` 访问本机 Docker 后台。
- 安装前先启动 Docker 后台。首次准备与更新需要访问 GitHub 的官方发行信息和官方 Docker 镜像仓库；已有容器可直接复用。
- 当前完整安装流程仅验证 macOS。官方 Docker 镜像支持的架构由上游决定，不再要求下载本仓库的 Apple Silicon 原生包。

插件安装先准备 Node 依赖并检查 MCP，再在终端完成官方服务准备：首次拉取镜像、创建并启动容器，检查健康状态与嵌入兼容性。**全部成功后才注册到 Codex**；任一阶段失败会使安装失败，并在终端显示原因。已有容器与数据会保留，重跑安装不会强制升级 DBX 本体。

## 安装与更新插件

还未克隆仓库时，先按[仓库快速开始](../../README.md#快速开始)获取源码。以下命令均在仓库根目录执行：

```sh
npm run install:dbx
```

只准备官方服务并安装、注册 DBX，不安装任务看板、API 调试台或代码审查。首次下载等耗时步骤在安装终端中显示进度，完成后再打开侧栏。适配器源码更新时执行：

```sh
git pull --ff-only
npm run install:dbx
```

重新打开 Codex 并新建聊天，确认插件已启用，再点击左侧 DBX 图标。只运行 `git pull` 不会更新已安装的适配器。

**插件版本与官方 DBX 版本分开管理。** 当前适配器版本为 `0.6.40`，它不再约束 Docker 中运行的 DBX 本体版本；当前官方版本在工作台顶部显示。通过兼容预检的官方版本可以直接更新；若上游改变了嵌入接口或出现无法适配的交互，仍需先更新适配器。

已安装插件需要单独补准备或恢复服务时，在相同环境配置下执行：

```sh
npm run setup:dbx
```

它会准备缺少的服务，或复用、启动已有容器，并完成健康与兼容预检；不会注册插件，也不强制更新 DBX 本体。明确升级使用独立的 `npm run update:dbx`。

## 第一次打开

1. 安装前启动本机 Docker 后台，确认 `docker info` 正常，并等待 `npm run install:dbx` 成功。
2. 点击 Codex 左侧 DBX 图标，插件会复用或启动已准备的容器，不在打开面板时首次拉取镜像。缺少容器时会提示先运行 `npm run install:dbx` 或 `npm run setup:dbx`。
3. 同一面板显示完整官方工作台后，在其中完成首次密码设置，再按官方界面添加数据库连接。安装与准备命令不代设密码。

后续打开会复用已有的健康容器；已停止的本插件容器可重新启动。关闭面板或 Codex 不会删除 Docker 容器、数据库连接和历史。

适配器只管理自己的容器，不接管同名的其他容器；检测到冲突时会显示错误。默认仅将工作台映射到本机 `127.0.0.1:54224`，不会对局域网开放服务。

## 更新官方 DBX

在侧栏顶部点击「更新官方 DBX」，或在仓库根目录执行：

```sh
npm run update:dbx
```

更新使用 [t8y2/dbx 官方最新稳定发行版](https://github.com/t8y2/dbx/releases/latest)，不使用预发布版本，也不依赖适配器内的固定版本清单。镜像下载后使用不可变镜像 ID 创建服务。

更新已有服务时，适配器会先停止自己的旧容器，将整个持久化数据目录备份到 `backups/<时间与唯一标识>/data`，再启动新版。备份包含数据库配置、历史及其密钥文件；不会只复制 SQLite 而遗漏 `.dbx/secret.key`。

新服务还会检查官方前端的入口、懒加载脚本及确认弹窗兼容性，不只检测端口。健康或前端兼容检查失败时，适配器会尝试停止新容器、保留失败数据为备份内的 `failed-data`，恢复升级前的数据和原镜像。即使旧服务恢复可用，更新仍显示失败，不会报告已升级成功。恢复也失败时保留错误与备份，需先排查再重试。

预检成功后按不可变镜像 ID 与适配层代码摘要缓存结果；重复打开不必每次扫描全部官方脚本。更换镜像或修改兼容层后会重新检查，失败的检查不会覆盖原有记录。

更新与启动按同一运行目录串行执行，避免重复点击并发重建。更新期间工作台会暂时中断；备份不会自动删除，请按实际空间自行保留需要的副本。

## 数据与旧版迁移

默认运行目录：

```text
~/.codex/dbx-docker/
```

其中保存密钥、持久化 `data/`、升级备份 `backups/` 和导出文件 `exports/`。数据位于插件安装缓存之外，更新适配器不删除这些文件。

| 配置 | 环境变量 | 默认值 |
| --- | --- | --- |
| 独立运行与数据目录 | `DBX_CODEX_DOCKER_HOME` | `~/.codex/dbx-docker` |
| 本机工作台端口 | `DBX_CODEX_DOCKER_PORT` | `54224` |

Codex 与终端管理命令应使用相同配置，确保它们管理同一个服务。更换目录表示使用另一份独立数据，不会自动复制原目录。

**旧原生插件的 `~/Library/Application Support/com.dbx.codex` 不会自动迁移，也不会被删除。** Docker 版首次出现空连接列表不代表旧数据丢失。不要直接把运行中的旧目录覆盖到 Docker 数据中；需要迁移时先通过旧工作台导出所需配置，再按官方界面支持的方式导入。旧版主密码和密钥也不会自动继承。

## 容器内连接与嵌入限制

- 容器中的 `localhost` 指 DBX 容器自身。Docker Desktop 访问这台电脑上的数据库通常使用 `host.docker.internal`；其他 Docker Engine 的解析和网络配置需自行确认。远程数据库仍需允许容器访问对应地址和端口。
- 当前只将运行目录的 `data/` 挂载为容器 `/app/data`。SQLite 文件不能直接填写宿主机的 `/Users/...` 路径；可将副本放在 `data/user-databases/`，在 DBX 中填写 `/app/data/user-databases/文件名`。请勿覆盖 DBX 自己的数据库或 `.dbx/` 密钥目录。
- Codex 禁用原生浏览器确认框、弹窗和下载；适配器提供面板内确认框、宿主外链与本地导出桥，不会自动批准确认操作。登录表单仍需用户设置密码。
- 导出保存到运行目录的 `exports/`，界面显示实际位置；单文件上限 **256 MiB**，最多同时导出 **4 个**文件。中断后超过 10 分钟无活动的未完成文件会定时清理，已完成文件不自动删除。
- 当前 macOS 复制通过系统剪贴板完成，单次最多 **4 MiB**。如果系统拒绝访问，可选中文字后手动复制。

打开工作台后，适配器会加载官方 MCP 数据库工具；首次密码设置、迁移与数据库权限仍由官方 DBX 管理。插件只转发官方工具，不绕过其访问范围或写入限制。

## 常见问题

**为什么不把 Docker 镜像打包到插件 GitHub Release？** [官方已经提供预编译镜像](https://github.com/t8y2/dbx#self-hosted-docker)，安装时直接准备该镜像即可，无需本仓库再次编译或维护镜像副本。这样插件的发布频率不会限制官方 DBX 本体更新；镜像缓存在本机 Docker 中，侧栏不会首次下载。安装仍需联网访问官方发行信息与镜像仓库。

**为什么还需要 Docker 后台？** DBX 本体运行在官方容器中，适配器只负责显示工作台和管理本机服务。它替代 DBX 桌面应用，不替代容器运行环境。

**插件版本为什么和官方 DBX 版本不同？** Codex 插件设置显示适配器版本；工作台工具栏显示 Docker 中的官方 DBX 版本。更新本体点击「更新官方 DBX」，无需修改插件版本。

**Docker 不可用或启动失败？** 先检查 Docker 后台和 `docker info`，再按终端或侧栏显示的网络、端口、容器冲突或兼容预检错误排查。未完成安装时重跑 `npm run install:dbx`；已安装插件可运行 `npm run setup:dbx` 补准备或恢复服务，再重试侧栏。无需删除数据目录或重新设置已有密码。

**端口被占用怎么办？** 首次创建前设置空闲的 `DBX_CODEX_DOCKER_PORT`，并让 Codex 与终端命令保持一致。已有容器的端口不能仅修改变量后自动迁移；需要先核对归属、保留数据并安全重建，或使用新的运行目录创建独立实例。插件会拒绝端口不匹配的容器，也不会停止占用该端口的其他服务。

**更新失败后还能用旧版吗？** 新版健康检查失败时会尝试恢复旧镜像与升级前数据；状态会明确说明回滚是否成功。请保留 `backups/`，不要在失败原因未明时删除数据目录。

**异常退出后一直提示正在更新？** 正常关闭会等待当前操作结束。进程被强制终止时可能遗留运行目录下的 `.operation-lock/owner.json`；先确认记录的进程与其他启动、更新进程均已停止，再人工移走该锁目录。不要删除 `data/`，并保留 `backups/` 以便恢复。适配器不会自动删除归属不明的锁。

**可以自动迁移旧原生版或其他电脑的数据吗？** 当前不做自动迁移。默认使用独立 Docker 数据目录；跨设备配置与数据需按官方工作台支持的方式迁移，备份包含密钥，应按敏感数据保存。

## 开发与验证

只准备适配器依赖与 MCP 检查，不注册 Codex、启动 Docker 或创建运行数据：

```sh
npm run install:dbx -- --prepare
```

在仓库根目录执行：

```sh
npm --prefix plugins/dbx test
npm --prefix plugins/dbx run check
npm run test:dbx-ui
```

Node 测试与 MCP smoke 不要求运行 Docker；`test:dbx-ui` 使用真实 Chrome、模拟运行时和 HTTP 工作台验证严格嵌入沙箱中的适配器链路，不启动 Docker，不代表所有数据库后端均已实测。真实官方镜像验证另使用隔离的运行目录和空闲端口，不读取旧原生数据目录或正式 Docker 数据。

本机管理入口：

```sh
node plugins/dbx/scripts/manage.mjs status
node plugins/dbx/scripts/manage.mjs setup
node plugins/dbx/scripts/manage.mjs start
node plugins/dbx/scripts/manage.mjs update
```

开发时为这些命令指定独立的 `DBX_CODEX_DOCKER_HOME` 和 `DBX_CODEX_DOCKER_PORT`，例如 `/tmp/dbx-codex-dev` 与 `54225`（先确认端口空闲）。`status` 只查询状态；`setup` 可首次下载与准备服务，`start` 仅复用或启动已有容器，`update` 明确下载并升级本体。这三个命令会实际管理该目录对应的 Docker 服务。

预览同一份内嵌界面而不注册到 Codex，可使用独立目录运行：

```sh
DBX_CODEX_DOCKER_HOME=/tmp/dbx-codex-dev \
DBX_CODEX_DOCKER_PORT=54225 \
node plugins/dbx/scripts/manage.mjs setup

DBX_CODEX_DOCKER_HOME=/tmp/dbx-codex-dev \
DBX_CODEX_DOCKER_PORT=54225 \
node plugins/dbx/scripts/preview.mjs
```

先在独立目录完成服务准备，再打开预览终端打印的本机 URL；预览复用或启动已准备的容器。预览使用与 MCP 相同的工作台、工具和严格 iframe 沙箱，但并不代表已经更新 Codex 中的正式安装。

## 上游与许可

- [DBX 官方源码](https://github.com/t8y2/dbx)
- [官方 Docker 部署配置](https://github.com/t8y2/dbx/blob/main/deploy/docker-compose.release.yml)
- [本插件仓库](https://github.com/skyfour/my_codex_plugin)

适配器按 Apache-2.0 许可维护，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。官方应用从官方镜像运行，不再从本仓库下载自建 DBX 二进制或专用工作台 HTML。

# DBX for Codex

在 Codex 侧栏使用完整的 [DBX Web 工作台](https://github.com/t8y2/dbx)。新安装默认运行本机原生 Web 后端，**不需要 Docker，也不需要自行安装 Rust 或编译 DBX**。Docker 作为可选运行方式保留。

本次原生模式仍处于开发验证阶段，正式适配器版本为 0.6.42；正式安装尚未切换默认行为。

## 安装与首次打开

完整安装流程目前支持 macOS（Apple Silicon 与 Intel），需要 Node.js ≥22.13、npm、Git，以及已登录的 Codex 桌面版和支持 `codex plugin` 的 CLI。安装、首次准备和更新需要联网访问 GitHub。

在仓库根目录执行：

```sh
npm run install:dbx
```

安装器自动选择平台安装包，下载后验证 SHA-256，再启动仅监听本机的 Web 服务，完成健康与界面兼容检查后才注册插件。失败会在安装终端显示原因，重试不会删除连接或历史。安装成功后，重新打开 Codex 并新建聊天，点击左侧 DBX，在官方界面完成首次密码设置。插件不会代设密码。

侧栏只复用或启动已安装的服务，不在首次打开面板时下载程序。已安装插件需要补准备或恢复服务时执行 `npm run setup:dbx`。关闭面板或 Codex 不会删除数据，也不会终止已准备的本机服务。

## 选择运行方式

默认选择规则：

- 新安装使用 `native`。
- 显式配置 Docker 运行目录或端口，或检测到原 Docker 目录内已有 DBX 数据库时，继续使用 `docker`，避免突然出现另一份空数据。
- `DBX_CODEX_RUNTIME=native` 或 `docker` 可以明确指定模式。

| 配置 | 环境变量 | 默认值 |
| --- | --- | --- |
| 运行模式 | `DBX_CODEX_RUNTIME` | 新安装 `native`，已有 Docker 数据保持 `docker` |
| 原生运行与数据目录 | `DBX_CODEX_NATIVE_HOME` | `~/.codex/dbx-native` |
| 原生端口 | `DBX_CODEX_NATIVE_PORT` | `54225` |
| 自备原生程序（开发使用） | `DBX_CODEX_NATIVE_BIN` | 自动下载已验证发行包 |
| Docker 运行与数据目录 | `DBX_CODEX_DOCKER_HOME` | `~/.codex/dbx-docker` |
| Docker 端口 | `DBX_CODEX_DOCKER_PORT` | `54224` |

设置 `CODEX_HOME` 时，默认运行目录位于该目录。终端命令和 Codex MCP 服务必须使用相同环境配置；这些变量可在 Codex MCP 配置中传入。只在终端前缀设置变量不会永久修改桌面应用的环境。

显式选择 Docker 安装：

```sh
DBX_CODEX_RUNTIME=docker npm run install:dbx
```

Docker 模式需要本机 Docker 后台和可访问的 `docker info`。镜像使用固定官方版本，优先 `docker.cnb.cool/dbxio.com/dbx`，失败回退 `t8y2/dbx`。不修改用户的 Docker 全局加速配置；第三方加速器的 403 与原生模式无关。已有容器按归属验证后复用。

**切换模式不等于迁移数据。** 原生、Docker 和旧版 `~/Library/Application Support/com.dbx.codex` 使用不同目录，不自动复制或删除。已有 Docker 用户可以继续使用 Docker；需要迁移时先从旧工作台导出，再按官方功能导入，不要复制运行中的数据库或遗漏加密密钥。

## 更新与恢复

适配器与 DBX 本体分别更新：

```sh
# 更新适配器
 git pull --ff-only
 npm run install:dbx

# 明确更新 DBX 本体；侧栏也有同一入口
 npm run update:dbx
```

本体更新查询官方最新稳定版本；原生模式还要求该平台对应的验证产物已经发布，否则保留现有服务并报告缺少产物。macOS 的 Web 二进制由本仓库从对应官方标签构建，Linux 的原生下载器使用官方发布包；Linux 的完整插件安装仍未验证，Windows 原生模式暂不支持。

下载、哈希校验与程序版本检查完成后，更新才停止自己的旧服务，将整个 `data/` 目录备份到 `backups/<时间与唯一标识>/data`，再启动新版。健康或前端兼容检查失败时尝试恢复原程序和原数据；即使回滚成功，更新也会显示失败。无法确认故障进程已停止时不覆盖数据，保留备份供排查。备份不会自动删除，包含连接与密钥，应按敏感数据保存。

原生模式通过 PID、启动身份和二进制 SHA-256 管理自己的进程，拒绝接管端口上的其他服务。macOS 启动后还检查实际监听地址为 `127.0.0.1`。升级/启动按运行目录加锁，避免并发替换。

## 数据与连接

运行目录保存持久化 `data/`、`secrets/`、升级 `backups/` 和导出 `exports/`；原生模式另保存 `releases/`、进程记录和 `workbench.log`。这些文件位于插件缓存之外，适配器更新不删除它们。

原生模式中，数据库地址 `localhost` 指本机，可使用本机可访问的 SQLite 路径。Docker 中 `localhost` 指容器，Docker Desktop 访问宿主机通常使用 `host.docker.internal`；宿主机 SQLite 文件需放入挂载的 `data/` 目录，并填写对应 `/app/data/...` 路径。不要覆盖 DBX 自己的数据库或密钥目录。

工作台使用与官方相同的认证与数据库权限。Codex 禁用原生确认框、弹窗和下载；插件提供面板内确认框、宿主外链与本地导出桥，不自动批准操作。导出保存在运行目录 `exports/`，单文件上限 256 MiB，同时最多 4 个。macOS 剪贴板复制上限 4 MiB。

## 常见问题

**没有 Docker 能装吗？** 新安装默认可以，下载原生程序直接运行；已使用 Docker 的用户仍保持原模式，可明确切换并自行迁移所需配置。

**从 GitHub 下载的是镜像吗？** 原生模式下载可执行 Web 后端，不是 Docker 镜像。官方 macOS Release 目前只有桌面应用，没有独立 macOS Web 包，因此本仓库的维护者 CI 从官方版本标签构建 macOS Web 产物；安装用户无需编译。不同系统、架构的包不能混用。

**下载、端口或兼容检查失败？** 按安装终端显示的原因处理，然后重跑安装或 `npm run setup:dbx`。端口被占用时可选择另一端口并保持终端与 MCP 环境一致，插件不会停止其他程序。不要删除数据目录来解决下载错误。

**异常退出后一直提示正在更新？** 强制终止管理进程可能遗留 `.operation-lock/`。先确认其他启动/更新进程均已结束，再人工移走锁目录。不要删除 `data/` 或升级备份，插件不会自动删除归属不明的锁。

## 开发与验证

```sh
npm run install:dbx -- --prepare
npm --prefix plugins/dbx test
npm --prefix plugins/dbx run check
npm run test:dbx-ui
```

`--prepare` 只准备依赖、构建与 MCP 检查，不注册插件、不下载本体或启动服务。Node 测试使用隔离目录和测试进程，不要求 Docker；UI 集成测试使用真实 Chrome 和模拟运行时。实际官方原生程序需另行用独立目录验证，不读取正式数据。

原生预览示例（先确认端口空闲）：

```sh
DBX_CODEX_RUNTIME=native DBX_CODEX_NATIVE_HOME=/tmp/dbx-native-dev \
DBX_CODEX_NATIVE_PORT=55225 node plugins/dbx/scripts/manage.mjs setup

DBX_CODEX_RUNTIME=native DBX_CODEX_NATIVE_HOME=/tmp/dbx-native-dev \
DBX_CODEX_NATIVE_PORT=55225 node plugins/dbx/scripts/preview.mjs
```

维护者在 GitHub Actions 手动运行 `Build DBX native Web`，输入官方稳定版本号。CI 校验未修改的上游标签，构建 ARM64/Intel Web 程序并验证版本，输出压缩包和 SHA-256 工件；不自动发布。完成两种架构验证后，将产物发布到本仓库 `dbx-native-v<版本>` Release，保留 GitHub 资产的 SHA-256 digest。下载器拒绝缺失 digest 或版本/来源不匹配的包。

## 上游与许可

[DBX 官方源码](https://github.com/t8y2/dbx) · [本插件仓库](https://github.com/skyfour/my_codex_plugin)

适配器与分发许可见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。macOS 原生包从未修改的上游源码构建并附带上游 LICENSE；它不是上游官方发布的 macOS Web 包。

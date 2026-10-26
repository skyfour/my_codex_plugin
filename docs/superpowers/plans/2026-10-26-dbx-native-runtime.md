# DBX 无 Docker 安装

目标：新安装默认启动本机原生 Web 后端；现有 Docker 用户保持原数据与服务，可显式选择运行模式。

- [x] 新增原生下载器：按系统/架构选择官方发布包；macOS 使用本仓库从上游固定版本构建的产物。下载校验 SHA-256，拒绝越界、链接与不完整安装，失败保留旧版本。
- [x] 新增 NativeRuntime，与 DockerRuntime 共用 status/ensure/update/token/home/baseUrl 契约。仅监听本机；依据 PID、启动身份与二进制校验管理自有进程；升级前备份并在失败时恢复。
- [x] 配置默认 native，已有 Docker 数据保持 docker；环境变量显式覆盖。安装与侧栏文案改为通用本地服务，不再检查 Docker 作为默认前置。
- [x] 增加维护者构建/打包流程，终端用户无需 Rust。更新文档并覆盖无 Docker 安装、校验失败、端口冲突、进程重用、升级回滚和旧 Docker 兼容。
- [ ] 在独立目录验证原生后端，运行全量测试、MCP 与界面集成检查。未请求发版时保留开发版本和正式安装。

验证记录：
- 全仓 `npm test` 334 项通过（新增边界测试后 DBX 专项继续通过）。
- 原生/下载/配置 17 项通过；包含真正子进程启动、完整下载解包、拒绝停止时不回滚数据。
- `npm run test:dbx-ui` 14 项通过；stdio MCP smoke 通过。
- 已有本机 DBX 0.6.39 原生程序在独立目录启动并通过本机监听/前端检查；不以此替代 0.6.55 产物验证。
- 维护者构建流程已单独合入 PR #21，0.6.55 macOS 两架构构建中：https://github.com/skyfour/my_codex_plugin/actions/runs/40297101522 。
- 尚未发布原生适配器或更改正式安装、正式 Docker 数据。

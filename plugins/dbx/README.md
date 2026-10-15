# DBX for Codex

这里维护 DBX 的 Codex 插件入口。原生程序来自 [DBX Codex 集成源码](https://github.com/skyfour/dbx/tree/feat/codex-plugin)，基于 [DBX](https://github.com/t8y2/dbx)，按 Apache-2.0 许可分发。安装器从本仓库的 GitHub Release 下载与本机匹配的包，校验 `release.json` 中固定的 SHA-256，然后填充 `bin/` 和 `assets/workbench.html`；这些构建产物不提交到 Git。

当前发布包只覆盖 macOS Apple Silicon。Codex 会启动本地工作台与 MCP 服务，无需启动 DBX 桌面应用。首次使用时在 DBX 界面设置密码、完成迁移并配置数据库连接；本地数据保存在 `~/Library/Application Support/com.dbx.codex`，不在本仓库中。

安装或更新：

```sh
git pull --ff-only
node scripts/install.mjs --plugin dbx
```

新版本的发布顺序：在 DBX 源码仓库构建和验证对应平台的包；将包上传到本仓库的 `dbx-v<版本>` Release；更新此目录的插件版本及 `release.json` 的版本、文件名和 SHA-256；运行 `npm test` 和隔离安装验证后提交。已发布的同一版本附件保持不变。用户更新只需要拉取仓库并再次运行上面的安装命令，安装器不会触及数据库数据目录。

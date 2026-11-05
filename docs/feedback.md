# 插件反馈与维护

所有反馈集中到 [skyfour/my_codex_plugin 的 Issues](https://github.com/skyfour/my_codex_plugin/issues)。使用 GitHub 原生通知接收新反馈，使用仓库内的分诊技能跟进，不部署额外服务。

## 用户提交

从任务看板 **0.4.10**、API 调试台 **0.3.2**、本地代码审查 **0.5.14**、DBX 适配器 **0.6.43** 起包含反馈技能。已有安装请先 `git pull --ff-only`，再运行对应的 `npm run install:<简称>`；只更新需要使用的插件，无需重新配置本机数据。

安装任意一个插件，会一并安装该插件的反馈技能，无需额外命令。重新打开 Codex 并新建聊天后，可以说：

> 帮我给 API 调试台提交 issue：导入集合时出现……

反馈技能整理插件版本、现象、复现步骤、预期结果和最小必要的环境信息。有可用的 GitHub 连接且用户明确要求提交时，创建 issue 并返回真实链接；否则提供草稿和表单链接，由用户登录 GitHub 提交。仅说“遇到问题”时先协助诊断，不自动公开发布。

- [报告问题](https://github.com/skyfour/my_codex_plugin/issues/new?template=bug_report.yml)
- [提出建议](https://github.com/skyfour/my_codex_plugin/issues/new?template=feature_request.yml)
- [查看已有反馈](https://github.com/skyfour/my_codex_plugin/issues)

公开反馈中只保留必要信息。不要提交令牌、Cookie、认证头、完整请求环境、真实接口数据、数据库连接、个人任务或本机绝对路径。需要截图或日志时，先裁剪并脱敏。

## 维护者接收

在仓库页面右上角选择 **Watch → Custom → Issues → Apply**，再在 [GitHub 通知设置](https://github.com/settings/notifications) 中为 Watching 启用 On GitHub 和 Email。这样新 issue 和后续讨论可通过 GitHub 收件箱、邮件或 GitHub Mobile 接收。通知是否实际送达取决于账户设置；安装插件不会修改用户通知偏好。

表单默认分配给 `skyfour`。这只覆盖使用表单创建的反馈，其他客户端创建的 issue 也要通过 Watch 和统一收件箱查看。

## 查看与处理

在本仓库打开 Codex，可以说：

> 查看插件反馈，按优先级整理待处理 issue。
>
> 处理插件 issue #123，复现问题并提出修复方案。

仓库内的 `.agents/skills/plugin-issue-triage/SKILL.md` 提供分诊流程，只供维护者在本仓库使用，不随插件安装给普通用户。读取优先使用已连接的 GitHub 工具。无连接时仍可运行不依赖 `gh` 的只读命令：

```sh
npm run issues
npm run issues -- --state closed
npm run issues -- 123
```

列表自动遍历分页并排除 PR；详情包含讨论。公开仓库无需令牌，遇到 GitHub 限流可使用已连接的 GitHub 工具，或通过本机环境变量 `GH_TOKEN` / `GITHUB_TOKEN` 认证。命令只读取固定仓库，不发评论、不改状态。

处理时先按插件和类型分类，再判断影响范围与复现条件。建议使用 GitHub 默认标签 `bug`、`enhancement`、`question`；缺信息、待处理、处理中可以用人工维护的标签或 Project 状态。回复、修改标签、关闭 issue 或推送修复，按维护者本轮明确授权执行。修复验证后关联 PR，在合并或实际发布后再说明用户可用的版本。

## 开发与上线边界

反馈技能更新需运行六个离线模型场景，方法见 [Testing](../AGENTS.md#testing)，入口为 `node scripts/feedback-eval.mjs --input` 和 `--results <模型输出JSON文件>`。场景只模拟 GitHub 结果，用来检查提交意图、版本、隐私和降级决策；真实服务端提交、分配及邮件投递仍需上线后核验。

反馈技能直接放在各插件声明的 `skills/` 中，不从安装缓存外引用共享文件。安装命令保留按插件选择的行为，不额外安装插件或改写全局技能。DBX 也声明自己的技能目录。

GitHub 表单必须进入默认分支才会显示；已安装插件也必须在正式发布后更新才能获得反馈技能。开发阶段不递增版本、不推送、不覆盖正式缓存。发布后用普通 GitHub 用户验证表单，再用维护者账户验证通知和回复链路。

参考：[OpenAI 插件技能打包](https://developers.openai.com/plugins/deploy/submission#package-identity-and-components)、[GitHub issue 表单](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)、[GitHub 通知设置](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications)。

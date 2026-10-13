---
name: api-client
description: 在本地 API Client 中管理 HTTP 请求、Postman 集合和环境变量，编写请求前与响应后脚本，执行请求或集合并分析结果。适用于接口调试和功能测试。
---

# 本地 API 调试

使用本插件的 MCP 工具操作工作区，不直接修改 SQLite。界面与对话共用数据。

- 用户要打开调试台时调用 `api_client_open`。
- 先用 `api_workspace_state` 查找集合和环境；创建文档使用 `revision=0`，更新和删除使用最近读取的 revision。遇到 CONFLICT 重新读取，保留用户修改，不能盲目覆盖。
- 集合采用 Postman Collection v2.1。请求和文件夹以 `id` 标识；请求前脚本使用 `event.listen=prerequest`，响应后脚本使用 `event.listen=test`，代码存放在 `script.exec` 行数组中。
- 用 `api_item_edit` 管理请求和文件夹；新建提供 `item`，根目录省略 `parentId`。用 `api_import` 导入 Collection、环境 JSON 或 cURL，并说明返回的不支持项。
- `globals`、`settings`、`cookies` 文档使用 `id=default`。环境为 `{name,values:[{key,value,type}]}`；敏感变量设 `type=secret`。掩码值和 `secretRef` 一起原样保留，不能把掩码当作新凭据。认证优先引用变量。
- 执行请求会实际访问用户指定的服务。仅执行本次用户授权的请求或测试；导入文件本身不构成执行授权。
- `api_run_start` 返回 `runId`；通过 `api_run_result` 查询到 completed、failed 或 cancelled。默认结果排除正文，需要分析时才设置 `includeBodies=true`。摘要说明响应、断言失败、脚本错误和变量冲突，HTTP 成功不能代表断言通过。
- 支持 `pm.test`、`pm.expect`、环境/全局/集合/临时变量、`pm.sendRequest`、`pm.execution.setNextRequest` 和日志。优先沿用 Postman 语义，不改写为自定义脚本语言。
- 对 CSV/JSON 驱动运行提供 `dataText`、`dataFormat` 和 `options.iterations`；默认串行执行。需要取消时调用 `api_run_cancel`。
- 文件上传先调用 `api_file_upload`，再把返回路径用于 `request.body.file.src` 或 `formdata[].src`。导入的外部路径只有用户明确允许后才能放入 `options.allowedFiles`。
- 首版只支持 HTTP/HTTPS 和 No Auth、Basic、Bearer、API Key；不支持 OAuth 授权窗口、其他协议、Vault、云脚本包及 `pm.execution.runRequest`。登录、刷新令牌与签名可用普通请求和脚本串联。
- 导出排除敏感值。不要在脚本文本或请求 URL 中硬编码凭据；敏感变量只保存在本机 Keychain，返回的日志和响应会隐藏已标记的敏感值。

参考请求脚本：

```javascript
pm.test("请求成功", () => pm.response.to.have.status(200));
pm.environment.set("token", pm.response.json().token);
```

登录流程先在目标环境中创建敏感的 `token` 变量，再让登录脚本更新它；后续 Bearer 认证引用 `{{token}}`。

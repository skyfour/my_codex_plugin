---
name: api-client
description: 在本地 API Client 中管理 HTTP 请求、Postman 集合和环境变量，编写请求前与响应后脚本，执行请求或集合并分析结果。适用于接口调试和功能测试。
---

# 本地 API 调试

使用本插件的 MCP 工具操作工作区，不直接修改 SQLite。界面与对话共用数据。

- 用户要打开调试台时调用 `api_client_open`。
- 先用 `api_workspace_state` 查找集合和环境；创建文档使用 `revision=0`，更新和删除使用最近读取的 revision。遇到 CONFLICT 重新读取，保留用户修改，不能盲目覆盖。
- 集合采用 Postman Collection v2.1。请求和文件夹以 `id` 标识；请求前脚本使用 `event.listen=prerequest`，响应后脚本使用 `event.listen=test`，代码存放在 `script.exec` 行数组中。
- 用 `api_item_edit` 管理请求和文件夹；新建提供 `item`，根目录省略 `parentId`。用 `api_import_preview` 预览，再用 `api_import` 导入工作区v1、Collection、环境JSON、cURL、OpenAPI3/Swagger2或HAR，并说明返回的不支持项。
- `globals`、`settings`、`cookies` 文档使用 `id=default`。环境为 `{name,values:[{key,value,type}]}`；敏感变量设 `type=secret`。掩码值和 `secretRef` 一起原样保留，不能把掩码当作新凭据。认证优先引用变量。
- 执行请求会实际访问用户指定的服务。仅执行本次用户授权的请求或测试；导入文件本身不构成执行授权。
- `api_run_start` 返回 `runId`；通过 `api_run_result` 查询到 completed、failed 或 cancelled。默认结果排除正文，需要分析时才设置 `includeBodies=true`。摘要说明响应、断言失败、脚本错误和变量冲突，HTTP 成功不能代表断言通过。
- 支持 `pm.test`、`pm.expect`、环境/全局/集合/临时变量、`pm.sendRequest`、`pm.execution.setNextRequest` 和日志。优先沿用 Postman 语义，不改写为自定义脚本语言。
- 对 CSV/JSON 驱动运行提供 `dataText`、`dataFormat` 和 `options.iterations`；默认串行执行。需要取消时调用 `api_run_cancel`。
- 文件上传先调用 `api_file_upload`，再把返回路径用于 `request.body.file.src` 或 `formdata[].src`。导入的外部路径只有用户明确允许后才能放入 `options.allowedFiles`。
- HTTP/GraphQL 使用官方运行时，支持高级鉴权、OAuth2 PKCE/客户端凭据/刷新、请求网络覆盖；OAuth操作只对App可见。默认严格Postman变量优先级；文件夹变量需集合扩展模式。
- `pm.execution.runRequest(id,{variables})` 在工作区查找保存请求，优先当前集合，外部重复ID拒绝。深度最多4、每次运行总调用20，继承变量/脚本/认证并受整次期限和取消约束；不支持Vault/云包。
- SSE、WebSocket/Socket.IO、gRPC、MQTT、远程MCP通过 `api_protocol_connect/action/events/disconnect` 交互调试。仅显式连接；不执行HTTP Runner、pm.*或逐消息断言。MCP禁止stdio，gRPC须显式提供proto依赖或选择reflection。事件有界脱敏，关闭所属标签或服务时清理资源。
- 响应HTML/Visualizer是无脚本、无导航、无外网的静态隔离预览；SVG下载，PDF可下载后本地打开。Cookie值只在App专用域编辑界面显示，不索取或输出到模型结果。
- 完整密码加密备份/恢复通过App-only工具和界面操作；不要从模型调用这些工具或索取备份密码。默认合并新增副本，冲突默认保留本机，替换前生成快照；有活动运行/协议/OAuth时先停止，恢复本身不执行请求。普通导出仍排除凭据，脚本硬编码秘密需用户自行检查。
- 导出排除敏感值。不要在脚本文本或请求 URL 中硬编码凭据；敏感变量只保存在本机 Keychain，返回的日志和响应会隐藏已标记的敏感值。

参考请求脚本：

```javascript
pm.test("请求成功", () => pm.response.to.have.status(200));
pm.environment.set("token", pm.response.json().token);
```

登录流程先在目标环境中创建敏感的 `token` 变量，再让登录脚本更新它；后续 Bearer 认证引用 `{{token}}`。

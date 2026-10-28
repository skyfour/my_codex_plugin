import { z } from 'zod';
const id=z.string().min(1).max(200);
const kind=z.enum(['collection','environment','globals','settings','cookies']);
const object=z.record(z.string(),z.unknown());
const revision=z.number().int().min(0);
const options=z.object({
  requestTimeout:z.number().int().positive().optional(),scriptTimeout:z.number().int().positive().optional(),
  runTimeout:z.number().int().positive().optional(),iterations:z.number().int().positive().optional(),
  delay:z.number().int().min(0).optional(),stopOnFailure:z.boolean().optional(),strictSSL:z.boolean().optional(),
  followRedirects:z.boolean().optional(),maxResponseSize:z.number().int().positive().optional(),
  proxy:z.string().optional(),noProxy:z.array(z.string()).optional(),proxyCredentials:z.array(object).optional(),caFile:z.string().optional(),certificates:z.array(object).optional(),allowedFiles:z.array(z.string()).optional(),
}).strict();
const oauthTarget=z.object({kind:z.enum(['environment','globals']),id,key:z.string().min(1).max(200)}).strict();
export const TOOL_DEFINITIONS = [
  ['api_protocol_connect','显式连接保存的 SSE/WebSocket/Socket.IO 请求。凭据仅在本机解析，不运行 pm.* 或 HTTP Runner。',z.object({collectionId:id,itemId:id,environmentId:id.optional()}).strict(),'protocolConnect',false],
  ['api_protocol_action','发送文本/二进制或 Socket.IO emit，事件始终脱敏。',z.object({sessionId:id,action:z.string().min(1).max(100),payload:z.unknown().optional()}).strict(),'protocolAction',false],
  ['api_protocol_events','读取有界脱敏事件；gap 表示游标之前的记录已淘汰。',z.object({sessionId:id,after:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1000).optional()}).strict(),'protocolEvents',true],
  ['api_protocol_disconnect','关闭当前服务拥有的协议会话。',z.object({sessionId:id}).strict(),'protocolDisconnect',false],
  ['api_oauth_start','App 专用：显式启动 OAuth2，Token 仅写入所选敏感变量。',z.object({flow:z.enum(['authorization_code','client_credentials']),authorizationUrl:z.string().optional(),tokenUrl:z.string(),clientId:z.string(),clientSecret:z.string().optional(),scope:z.string().optional(),target:oauthTarget}).strict(),'oauthStart',false,'app'],
  ['api_oauth_poll','App 专用：读取脱敏授权状态。',z.object({sessionId:id}).strict(),'oauthPoll',true,'app'],
  ['api_oauth_cancel','App 专用：取消授权并关闭回环监听。',z.object({sessionId:id}).strict(),'oauthCancel',false,'app'],
  ['api_oauth_refresh','App 专用：刷新指定变量中的 Token。',z.object({target:oauthTarget}).strict(),'oauthRefresh',false,'app'],
  ['api_document_duplicate','复制文档，凭据仅在后端重新保护。',z.object({kind:z.enum(['collection','environment']),id}).strict(),'duplicateDocument',false],
  ['api_backup_start','App 专用加密备份传输。',z.object({operation:z.enum(['export','import']),password:z.string().min(1).max(1024),includeHistory:z.boolean().optional(),mode:z.enum(['merge','replace']).optional(),context:z.object({selectedEnvironment:z.string().max(200).optional(),ui:z.object({theme:z.enum(['light','dark']).optional(),sidebarOpen:z.boolean().optional(),responseTab:z.string().max(30).optional()}).strict().optional()}).strict().optional()}).strict(),'backupStart',false,'app'],
  ['api_backup_chunk','App 专用加密归档分块。',z.object({transferId:id,offset:z.number().int().min(0).optional(),base64:z.string().max(1400000).optional()}).strict(),'backupChunk',false,'app'],
  ['api_backup_finish','App 专用预览或确认恢复。',z.object({transferId:id,decisions:z.record(z.string(),z.enum(['local','backup'])).optional()}).strict(),'backupFinish',false,'app'],
  ['api_backup_cancel','App 专用取消备份。',z.object({transferId:id}).strict(),'backupCancel',false,'app'],
  ['api_client_open','打开 API 调试界面并读取本地工作区。',z.object({}).strict(),'state',true],
  ['api_workspace_state','读取集合、环境、设置及历史摘要；敏感变量被隐藏。',z.object({}).strict(),'state',true],
  ['api_document_get','读取 collection/environment/globals/settings/cookies 文档和 revision。',z.object({kind,id}).strict(),'get',true],
  ['api_document_put','创建或更新文档。创建 revision=0，更新必须使用最新 revision。集合采用 Postman v2.1；globals/settings/cookies 的 id 固定为 default。敏感变量 type=secret。',z.object({kind,id:id.optional(),data:object,revision}).strict(),'put',false],
  ['api_document_delete','按最新 revision 删除本地文档。',z.object({kind,id,revision}).strict(),'remove',false],
  ['api_item_edit','新建、更新、复制、移动、排序或删除集合内的请求和文件夹。新建提供 item 和 parentId；根目录省略 parentId。',z.object({collectionId:id,itemId:id.optional(),operation:z.enum(['upsert','duplicate','move','delete']),parentId:id.optional(),position:z.number().int().min(0).optional(),item:object.optional(),revision}).strict(),'editItem',false],
  ['api_workspace_export','导出全部集合、环境、全局变量和 API 脚本为工作区备份，排除已标记的敏感值。',z.object({}).strict(),'exportWorkspace',true],
  ['api_import_preview','验证工作区备份或 Postman/cURL、OpenAPI3/Swagger2 JSON/YAML、HAR 并预览集合、请求及环境数量，不写入数据。',z.object({text:z.string().max(20*1024*1024),localFiles:z.record(z.string(),z.string()).optional()}).strict(),'previewImport',true],
  ['api_import','导入工作区备份、Postman Collection v2.1、环境 JSON、单条 cURL、OpenAPI3/Swagger2 JSON/YAML 或 HAR（localFiles 仅来自用户选择的依赖文件）；工作区以新增副本方式原子导入。',z.object({text:z.string().max(20*1024*1024),localFiles:z.record(z.string(),z.string()).optional()}).strict(),'import',false],
  ['api_export','导出 Postman 文档或请求 cURL；敏感值和 Keychain 引用始终排除。',z.object({kind,id,format:z.enum(['postman','curl']).optional(),itemId:id.optional()}).strict(),'export',true],
  ['api_file_upload','接收用户选择的文件，以 base64 保存为本地附件，返回可用于 file/formdata 的路径，最大 20 MB。',z.object({name:z.string().min(1),base64:z.string().max(28*1024*1024)}).strict(),'upload',false],
  ['api_graphql_introspect','用户显式发送 GraphQL schema introspection；沿用保存请求的 URL、认证、环境、脚本和网络设置，返回可取消的 runId，不修改请求体。',z.object({collectionId:id,itemId:id,environmentId:id.optional()}).strict(),'graphqlIntrospect',false],
  ['api_run_start','从本机执行 HTTP 请求或集合，运行脚本并返回 runId。可指定 itemId、environmentId、JSON/CSV 数据及选项。请求会实际影响目标服务。',z.object({collectionId:id,itemId:id.optional(),environmentId:id.optional(),data:z.array(object).optional(),dataText:z.string().optional(),dataFormat:z.enum(['json','csv']).optional(),options:options.optional()}).strict(),'start',false],
  ['api_run_result','按 runId 读取状态、断言、日志和变量变化。默认排除响应正文；仅在需要分析正文时使用 includeBodies=true。',z.object({runId:id,includeBodies:z.boolean().optional()}).strict(),'result',true],
  ['api_run_cancel','取消指定 runId 的运行。',z.object({runId:id}).strict(),'cancel',false],
];
export async function invoke(service,name,args) {
  const def=TOOL_DEFINITIONS.find(d=>d[0]===name);if(!def)throw new Error('UNKNOWN_TOOL');
  return service[def[3]](def[2].parse(args));
}

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
  proxy:z.string().optional(),caFile:z.string().optional(),certificates:z.array(object).optional(),allowedFiles:z.array(z.string()).optional(),
}).strict();
export const TOOL_DEFINITIONS = [
  ['api_client_open','打开 API 调试界面并读取本地工作区。',z.object({}).strict(),'state',true],
  ['api_workspace_state','读取集合、环境、设置及历史摘要；敏感变量被隐藏。',z.object({}).strict(),'state',true],
  ['api_document_get','读取 collection/environment/globals/settings/cookies 文档和 revision。',z.object({kind,id}).strict(),'get',true],
  ['api_document_put','创建或更新文档。创建 revision=0，更新必须使用最新 revision。集合采用 Postman v2.1；globals/settings/cookies 的 id 固定为 default。敏感变量 type=secret。',z.object({kind,id:id.optional(),data:object,revision}).strict(),'put',false],
  ['api_document_delete','按最新 revision 删除本地文档。',z.object({kind,id,revision}).strict(),'remove',false],
  ['api_item_edit','新建、更新、复制、移动、排序或删除集合内的请求和文件夹。新建提供 item 和 parentId；根目录省略 parentId。',z.object({collectionId:id,itemId:id.optional(),operation:z.enum(['upsert','duplicate','move','delete']),parentId:id.optional(),position:z.number().int().min(0).optional(),item:object.optional(),revision}).strict(),'editItem',false],
  ['api_workspace_export','导出全部集合、环境、全局变量和 API 脚本为工作区备份，排除已标记的敏感值。',z.object({}).strict(),'exportWorkspace',true],
  ['api_import_preview','验证工作区备份或 Postman/cURL 并预览集合、请求及环境数量，不写入数据。',z.object({text:z.string().max(20*1024*1024)}).strict(),'previewImport',true],
  ['api_import','导入工作区备份、Postman Collection v2.1、环境 JSON 或单条 cURL；工作区以新增副本方式原子导入。',z.object({text:z.string().max(20*1024*1024)}).strict(),'import',false],
  ['api_export','导出 Postman 文档或请求 cURL；敏感值和 Keychain 引用始终排除。',z.object({kind,id,format:z.enum(['postman','curl']).optional(),itemId:id.optional()}).strict(),'export',true],
  ['api_file_upload','接收用户选择的文件，以 base64 保存为本地附件，返回可用于 file/formdata 的路径，最大 20 MB。',z.object({name:z.string().min(1),base64:z.string().max(28*1024*1024)}).strict(),'upload',false],
  ['api_run_start','从本机执行 HTTP 请求或集合，运行脚本并返回 runId。可指定 itemId、environmentId、JSON/CSV 数据及选项。请求会实际影响目标服务。',z.object({collectionId:id,itemId:id.optional(),environmentId:id.optional(),data:z.array(object).optional(),dataText:z.string().optional(),dataFormat:z.enum(['json','csv']).optional(),options:options.optional()}).strict(),'start',false],
  ['api_run_result','按 runId 读取状态、断言、日志和变量变化。默认排除响应正文；仅在需要分析正文时使用 includeBodies=true。',z.object({runId:id,includeBodies:z.boolean().optional()}).strict(),'result',true],
  ['api_run_cancel','取消指定 runId 的运行。',z.object({runId:id}).strict(),'cancel',false],
];
export async function invoke(service,name,args) {
  const def=TOOL_DEFINITIONS.find(d=>d[0]===name);if(!def)throw new Error('UNKNOWN_TOOL');
  return service[def[3]](def[2].parse(args));
}

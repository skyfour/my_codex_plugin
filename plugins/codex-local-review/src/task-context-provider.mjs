import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {z} from 'zod';
// Review's anti-corruption layer: a local commit-context port, not a task repository.
const keyword=z.string().max(2048).refine(s=>!/[\x00-\x1f]/.test(s));
const task=z.object({taskId:z.string().uuid(),title:z.string().max(4096),source:z.object({workspaceId:z.string().max(32),objectId:z.string().max(32)}),state:z.string().max(256),keyword});
const listSchema=z.object({contractVersion:z.literal(1),tasks:z.array(task).max(2000)});
const contextSchema=z.object({contractVersion:z.literal(1),taskId:z.string().uuid(),title:z.string().max(4096),keyword:keyword.refine(s=>Boolean(s.trim()))});
export class TaskContextProvider {
  constructor({env=process.env,request,timeoutMs=30000}={}) { this.timeoutMs=timeoutMs;this.env=env;this.request=request??((name,args)=>this.call(name,args)); }
  async call(name,args) {
    const registry=join(this.env.CODEX_HOME??join(homedir(),'.codex'),'integrations','task-commit-context-v1.json');
    let descriptor;
    try {descriptor=JSON.parse(await readFile(registry,'utf8'));}
    catch {throw Error('任务看板联动尚未注册，请更新任务看板并重新打开 Codex。');}
    if(descriptor.contractVersion!==1||descriptor.transport!=='mcp-stdio'||typeof descriptor.entrypoint!=='string'||!isAbsolute(descriptor.entrypoint))throw Error('任务看板联动接口不兼容，请更新两个插件。');
    const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-sqlite',descriptor.entrypoint],cwd:homedir(),env:Object.fromEntries(Object.entries(this.env).filter(([,v])=>typeof v==='string')),stderr:'ignore'});
    const client=new Client({name:'local-review-task-context',version:'1.0.0'});
    const signal=AbortSignal.timeout(this.timeoutMs);
    try {
      await client.connect(transport,{signal,timeout:this.timeoutMs});
      const result=await client.callTool({name,arguments:args},undefined,{signal,timeout:this.timeoutMs});
      if(result.isError)throw Error(result.content?.find(c=>c.type==='text')?.text??'任务看板无法提供提交上下文，请重试。');
      return result.structuredContent;
    } catch(e) {
      if(signal.aborted)throw Error('任务看板联动超时，请重试。');
      // MCP/provider diagnostics may contain local paths; do not expose raw protocol errors.
      if(e.code!==undefined)throw Error('无法连接任务看板联动接口，请更新任务看板后重试。');
      throw e;
    } finally {await client.close().catch(()=>{});await transport.close().catch(()=>{});}
  }
  async listTasks() {
    try {
      const result=listSchema.parse(await this.request('task_context_list',{}));
      return {tasks:result.tasks.map(t=>({id:t.taskId,title:t.title,account:t.source.workspaceId,sourceId:t.source.objectId,state:t.state,keyword:t.keyword})),notice:''};
    } catch(e) {return {tasks:[],notice:e instanceof z.ZodError?'任务看板联动数据格式不兼容，请更新两个插件。':e.message};}
  }
  async getCommitContext(taskId) {
    let result;try {result=contextSchema.parse(await this.request('task_commit_context',{taskId}));}
    catch(e) {if(e instanceof z.ZodError)throw Error('任务看板返回的提交上下文无效');throw e;}
    if(result.taskId!==taskId)throw Error('任务看板返回了其他任务的提交上下文');
    return {taskId:result.taskId,keyword:result.keyword};
  }
}

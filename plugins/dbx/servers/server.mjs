import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema,ListResourcesRequestSchema,ReadResourceRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {configuredRuntime} from '../src/config.mjs';
import {createWebProxy} from '../src/proxy.mjs';
import {Transfers,writeClipboard} from '../src/transfers.mjs';

export const UI_URI='ui://dbx/docker-workbench.html';
const mimeType='text/html;profile=mcp-app';
const empty={type:'object',properties:{},additionalProperties:false};
const output=data=>({content:[{type:'text',text:'DBX'}],structuredContent:data});

export async function createDbxServer({runtime=configuredRuntime(),proxyFactory=createWebProxy,clipboard=writeClipboard,backendFactory}={}){
  const server=new Server({name:'dbx-codex',version:'0.6.42'},{capabilities:{tools:{listChanged:true},resources:{}}});
  let currentVersion=null;
  const proxy=await proxyFactory({upstream:runtime.baseUrl,getVersion:()=>currentVersion}), transfers=new Transfers(runtime.home);
  let backend=null,backendPromise=null,job=null,jobPromise=null,latest=null,backendTools=[],generation=0,closing=false,closePromise=null;
  const icons=[{src:`data:image/png;base64,${(await readFile(new URL('../assets/icon.png',import.meta.url))).toString('base64')}`,mimeType:'image/png',sizes:['256x256']}];
  const definitions=[],actions=new Map();
  const register=(name,handler,{render=false,readonly=true,schema=empty,description=name}={})=>{
    definitions.push({name,title:render?'DBX':name,description,inputSchema:schema,annotations:{readOnlyHint:readonly,destructiveHint:!readonly,openWorldHint:false},...(render?{icons}:{}),_meta:render?{ui:{resourceUri:UI_URI},'openai/ui':{entrypoints:[{type:'global'}]}}:{ui:{visibility:['app']}}});
    actions.set(name,handler);
  };
  const disconnect=async()=>{generation++;const old=backend;backend=null;backendPromise=null;backendTools=[];if(old)await old.close().catch(()=>{});await server.notification({method:'notifications/tools/list_changed'}).catch(()=>{});};
  const connectBackend=async()=>{
    if(closing)throw new Error('DBX 连接正在关闭');
    if(backend)return backend;if(backendPromise)return backendPromise;
    const currentGeneration=generation;
    const attempt=(async()=>{
      const candidate=backendFactory?await backendFactory():new Client({name:'dbx-codex',version:'0.6.42'});
      try{
        if(!backendFactory)await candidate.connect(new StreamableHTTPClientTransport(new URL('/mcp',runtime.baseUrl),{requestInit:{headers:{Authorization:`Bearer ${await runtime.token()}`}}}),{timeout:4000});
        const listed=await candidate.listTools(undefined,{timeout:4000});
        if(currentGeneration!==generation||job?.phase==='running')throw new Error('DBX 正在更新，请稍后重试');
        backendTools=listed.tools.filter(tool=>!actions.has(tool.name));backend=candidate;
        await server.notification({method:'notifications/tools/list_changed'}).catch(()=>{});return candidate;
      }catch(error){await candidate.close().catch(()=>{});throw error;}
      finally{if(backendPromise===attempt)backendPromise=null;}
    })();backendPromise=attempt;return attempt;
  };
  const compatibilityBlocked=()=>job?.phase==='failed'&&job.result?.code==='WEB_COMPATIBILITY'&&!job.result?.rolledBack;
  const view=async()=>{const state=job?.phase==='running'?{phase:'starting',currentVersion,baseUrl:runtime.baseUrl}:await runtime.status();currentVersion=state.currentVersion;return {...state,...(compatibilityBlocked()?{phase:'error',message:job.error}:{}),job,latest,url:proxy.url,mcpReady:Boolean(backend)};};
  const begin=kind=>{
    if(closing)throw new Error('DBX 连接正在关闭');
    if(job?.phase==='running')return {job};
    job={kind,phase:'running',startedAt:new Date().toISOString(),fromVersion:currentVersion,progress:{stage:'docker',message:'正在检查 Docker 后台…'}};
    const current=job;
    jobPromise=(async()=>{try{await disconnect();current.result=await runtime[kind]({allowDownload:kind==='update',onProgress:progress=>{if(job===current&&current.phase==='running')current.progress=progress;}});if(current.result.phase!=='ready')throw new Error(current.result.message||'DBX 操作未完成');currentVersion=current.result.currentVersion;current.phase='complete';void connectBackend().catch(()=>{});}catch(error){current.phase='failed';current.error=error.message;}})();
    return {job};
  };
  register('dbx_codex_open',async()=>({name:'DBX',architecture:'official-docker-web'}),{render:true,description:'在 Codex 侧栏打开完整 DBX 官方 Web 工作台。'});
  register('dbx_codex_status',async()=>{const state=await view();if(state.phase==='ready'&&job?.phase!=='running'&&!backend&&!backendPromise)void connectBackend().catch(()=>{});return state;});
  register('dbx_codex_start',async()=>begin('ensure'),{readonly:false,description:'只启动或复用安装阶段已准备的官方 Docker 容器，不在侧栏首次下载镜像。'});
  register('dbx_codex_check_update',async()=>{latest=await runtime.latest();return view();},{description:'检查 DBX 官方稳定版，不替换运行中的容器。'});
  register('dbx_codex_update',async()=>begin('update'),{readonly:false,description:'仅响应用户点击更新：备份数据并更新官方镜像；会中断本插件的 DBX 操作。'});
  register('dbx_codex_clipboard',({text})=>clipboard(text),{readonly:false,schema:{type:'object',properties:{text:{type:'string',maxLength:4194304}},required:['text'],additionalProperties:false}});
  register('dbx_codex_transfer',({action,payload})=>transfers.action(action,payload),{readonly:false,schema:{type:'object',properties:{action:{type:'string',enum:['download-open','download-write','download-close','download-cancel']},payload:{type:'object'}},required:['action','payload'],additionalProperties:false}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[...definitions,...backendTools]}));
  server.setRequestHandler(CallToolRequestSchema,async({params})=>{
    try{
      if(actions.has(params.name)){
        const args=params.arguments??{},def=definitions.find(tool=>tool.name===params.name);
        if(!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).some(key=>!Object.hasOwn(def.inputSchema.properties,key))||(def.inputSchema.required??[]).some(key=>!Object.hasOwn(args,key)))throw new Error('无效参数');
        return output(await actions.get(params.name)(args));
      }
      if(job?.phase==='running')throw new Error('DBX 正在启动或更新，请稍后重试');
      if(compatibilityBlocked())throw new Error(job.error);
      const client=await connectBackend();if(!backendTools.some(tool=>tool.name===params.name))throw new Error('未知的 DBX 工具');
      // All database policy and approval checks remain in the official server.
      return await client.callTool(params);
    }catch(error){return {isError:true,content:[{type:'text',text:error.message}],structuredContent:{code:'DBX_OPERATION_FAILED'}};}
  });
  server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[{uri:UI_URI,name:'DBX 工作台',mimeType}]}));
  const readUi=async()=>{
    const [template,script]=await Promise.all([readFile(new URL('../ui/index.html',import.meta.url),'utf8'),readFile(new URL('../ui/app.js',import.meta.url),'utf8')]);
    return {contents:[{uri:UI_URI,mimeType,text:template.replace('/* APP_SCRIPT */',script.replace(/<\/script/gi,'<\\/script')),_meta:{ui:{prefersBorder:false,csp:{frameDomains:[proxy.origin],connectDomains:[],resourceDomains:[]},permissions:{clipboardWrite:{}}}}}]};
  };
  server.setRequestHandler(ReadResourceRequestSchema,async({params})=>{if(params.uri!==UI_URI)throw new Error('Unknown resource');return readUi();});
  return {server,runtime,proxy,actions,view,readUi,close(){if(closePromise)return closePromise;closing=true;closePromise=(async()=>{await jobPromise;await disconnect();await transfers.close();await proxy.close();await server.close();})();return closePromise;}};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const app=await createDbxServer();await app.server.connect(new StdioServerTransport());
  let closing=false;const close=()=>{if(closing)return;closing=true;void app.close().finally(()=>process.exit(0));};
  process.on('SIGTERM',close);process.on('SIGINT',close);process.stdin.once('end',close);
}

import {readFileSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {registerAppResource,RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/server';
import {z} from 'zod';
import {snapshot,ReviewStore,markdown} from '../src/review.mjs';
export const URI='ui://codex-local-review/v1.html';
export function html(){return readFileSync(new URL('../ui/index.html',import.meta.url),'utf8').replace('<!-- SCRIPT -->',`<script type="module">${readFileSync(new URL('../ui/app.mjs',import.meta.url),'utf8').replaceAll('</script','<\\/script')}</script>`);}
export async function createServer({dir=process.env.LOCAL_REVIEW_HOME??join(process.env.CODEX_HOME??join(homedir(),'.codex'),'local-review')}={}){
 const store=await ReviewStore.open(dir),server=new McpServer({name:'codex-local-review',version:'0.1.0'}),definitions=[],actions=new Map();
 const register=(name,schema,fn,{open=false,write=false}={})=>{const config={title:open?'本地代码审查':name,description:open?'打开本地人工代码审查面板，无需远程仓库或 AI。':name,inputSchema:schema,annotations:{readOnlyHint:!write,destructiveHint:false,openWorldHint:false},_meta:open?{ui:{resourceUri:URI},'openai/ui':{entrypoints:[{type:'global'}]}}:{ui:{visibility:['app']}},...(open?{icons:[{src:`data:image/svg+xml;base64,${readFileSync(new URL('../assets/icon-sidebar.svg',import.meta.url)).toString('base64')}`,mimeType:'image/svg+xml',sizes:['any']}]}:{})};
 const call=async args=>{try{return {content:[{type:'text',text:'操作完成'}],structuredContent:await fn(schema.parse(args))};}catch(e){return {isError:true,content:[{type:'text',text:e instanceof z.ZodError?'输入参数无效':e.message}],structuredContent:{error:true}};}};actions.set(name,call);server.registerTool(name,config,call);definitions.push({name,...config,inputSchema:z.toJSONSchema(schema,{target:'draft-7'})});};
 const id=z.string().uuid(),empty=z.object({}).strict();
 register('review_open',empty,()=>({reviews:store.list()}),{open:true});
 register('review_create',z.object({project:z.string().min(1).max(4096),mode:z.enum(['working','staged','unstaged','commits','files']),base:z.string().max(512).optional(),target:z.string().max(512).optional(),paths:z.array(z.string().min(1).max(4096)).max(300).optional()}).strict(),async args=>({review:store.add(await snapshot(args))}),{write:true});
 register('review_get',z.object({id}).strict(),({id})=>({review:store.get(id)}));
 register('review_update',z.object({id,version:z.number().int().positive(),path:z.string(),reviewed:z.boolean().optional(),deleteComment:id.optional(),comment:z.object({side:z.enum(['before','after']),line:z.number().int().positive(),severity:z.enum(['note','issue','blocking']),text:z.string().min(1).max(10000)}).strict().optional()}).strict(),args=>({review:store.update(args)}),{write:true});
 register('review_export',z.object({id}).strict(),({id})=>{const r=store.get(id);return {markdown:markdown(r),json:JSON.stringify(r,null,2)};});
 registerAppResource(server,'本地代码审查',URI,{},async()=>({contents:[{uri:URI,mimeType:RESOURCE_MIME_TYPE,text:html(),_meta:{ui:{prefersBorder:false}}}]}));
 server.server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:definitions}));return {server,store,actions};
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){const {server,store}=await createServer();await server.connect(new StdioServerTransport());for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>void server.close().finally(()=>{store.close();process.exit(0);}));}

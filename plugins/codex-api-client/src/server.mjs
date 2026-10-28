import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { registerAppTool,registerAppResource,RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { Store } from './store.mjs';
import { ApiService } from './service.mjs';
import { TOOL_DEFINITIONS,invoke } from './tools.mjs';
export const APP_URI='ui://codex-api-client/index.html';
const sidebarIcons=[{src:`data:image/svg+xml;base64,${readFileSync(new URL('../assets/icon-sidebar.svg',import.meta.url)).toString('base64')}`,mimeType:'image/svg+xml',sizes:['20x20']}];
export const defaultDataDirectory=()=>process.env.CODEX_API_CLIENT_DATA_DIR||join(homedir(),'Library','Application Support','Codex API Client');
export function createServer({directory=defaultDataDirectory(),secrets}={}) {
  const store=new Store(directory,secrets),service=new ApiService(store);
  const server=new McpServer({name:'codex-api-client',version:'0.2.1',icons:sidebarIcons});
  const publishedTools=[];
  registerAppResource(server,'Codex API Client',APP_URI,{_meta:{ui:{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[]}}}},async()=>({
    contents:[{uri:APP_URI,mimeType:RESOURCE_MIME_TYPE,text:await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),_meta:{ui:{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[]}}}}],
  }));
  for(const [name,description,inputSchema,,readOnly,visibility]of TOOL_DEFINITIONS) {
    const config={title:name==='api_client_open'?'API 调试台':name,description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:name==='api_document_delete',openWorldHint:['api_run_start','api_protocol_connect','api_protocol_action'].includes(name)}};
    const handler=async args=>{
      try {const value=await invoke(service,name,args);return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}
      catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
    };
    const privateConfig=visibility==='app'?{...config,_meta:{ui:{visibility:['app']}}}:config;
    const descriptor=name==='api_client_open'?{...config,icons:sidebarIcons,_meta:{ui:{resourceUri:APP_URI},'openai/ui':{entrypoints:[{type:'global'}]}}}:privateConfig;
    if(name==='api_client_open'||visibility==='app')registerAppTool(server,name,descriptor,handler);
    else server.registerTool(name,descriptor,handler);
    publishedTools.push({name,...descriptor,inputSchema:z.toJSONSchema(inputSchema,{target:'draft-7'}),execution:{taskSupport:'forbidden'}});
  }
  // SDK 1.32.1 drops icons in registerTool/tools/list. Publish through its public
  // low-level handler while retaining SDK validation and dispatch for tool calls.
  server.server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:publishedTools}));
  const close=async()=>{await service.close();await server.close();store.close();};
  return {server,service,store,close};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const app=createServer();
  process.once('SIGTERM',()=>app.close().finally(()=>process.exit()));
  process.once('SIGINT',()=>app.close().finally(()=>process.exit()));
  await app.server.connect(new StdioServerTransport());
  process.stdin.once('end',()=>app.close().finally(()=>process.exit()));
}

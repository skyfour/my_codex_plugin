import {realpathSync} from 'node:fs';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {BoardStore} from '../src/store.mjs';
import {CommitContextService} from '../src/commit-context-service.mjs';
import {loadToken} from '../src/credentials.mjs';
import {readScmKeyword} from '../src/tapd.mjs';
import {errorText,errorCode} from '../src/errors.mjs';
import {registerCommitContextProvider} from '../src/provider-registration.mjs';
// Public integration endpoint deliberately exposes no board mutation or credential tools.
export function createCommitContextServer({dataDir=process.env.TASK_PANEL_HOME??join(process.env.CODEX_HOME??join(homedir(),'.codex'),'task-panel'),env=process.env,store=new BoardStore(join(dataDir,'board.sqlite')),credentials=()=>loadToken(dataDir,env),readKeyword=readScmKeyword}={}) {
  const service=new CommitContextService({store,credentials,readKeyword});
  const server=new McpServer({name:'task-commit-context',version:'1.0.0'});
  const register=(name,inputSchema,fn,write=false)=>server.registerTool(name,{inputSchema,annotations:{readOnlyHint:!write,destructiveHint:false,openWorldHint:write}},async args=>{
    try{return {content:[{type:'text',text:'操作完成'}],structuredContent:await fn(args)};}
    catch(e){return {isError:true,content:[{type:'text',text:errorText(e)}],structuredContent:{code:errorCode(e)}};}
  });
  register('task_context_list',{},()=>service.list());
  register('task_commit_context',{taskId:z.string().uuid(),refresh:z.boolean().optional()},({taskId,refresh})=>service.get(taskId,{refresh}),true);
  return {server,store};
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  if(process.argv.includes('--register'))await registerCommitContextProvider();
  else {
    const {server,store}=createCommitContextServer();await server.connect(new StdioServerTransport());
    let closed=false;const close=async()=>{if(closed)return;closed=true;await server.close();store.close();};
    process.stdin.on('end',()=>void close());
    for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void close().finally(()=>process.exit(0)));
  }
}

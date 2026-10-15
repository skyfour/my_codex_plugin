import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {promisify} from 'node:util';import {execFile} from 'node:child_process';import {BoardStore} from '../../codex-task-panel/src/store.mjs';
const exec=promisify(execFile),moduleUrl=new URL('../src/task-board.mjs',import.meta.url).href;
async function scenario(t,{customHome=false}={}){
 const codeHome=await mkdtemp(join(tmpdir(),'mcp-credential-'));t.after(()=>rm(codeHome,{recursive:true,force:true}));const boardDir=customHome?join(codeHome,'custom-board'):join(codeHome,'task-panel');await mkdir(boardDir,{recursive:true});
 const store=new BoardStore(join(boardDir,'board.sqlite'));store.applyImport([{provider:'tapd',account:'100',resourceType:'tasks',sourceId:'111001',sourceUpdatedAt:1,title:'Test',body:'',sender:'',url:'https://www.tapd.cn/100/prong/tasks/view/111001',sourceState:'open',owner:'test'}],{runId:'one'});const taskId=store.snapshot().tasks[0].id;store.close();
 const config=JSON.parse(await readFile(new URL('../.mcp.json',import.meta.url),'utf8')).mcpServers['local-review'];
 const host={CODEX_HOME:codeHome,TAPD_ACCESS_TOKEN:'synthetic-env-token',...(customHome?{TASK_PANEL_HOME:boardDir}:{})};
 const forwarded=Object.fromEntries(config.env_vars.filter(key=>host[key]!==undefined).map(key=>[key,host[key]]));
 // Launch with exactly the plugin's declared environment. Direct function
 // injection used by the older tests missed the real host allowlist boundary.
 const script=`import assert from 'node:assert/strict';import {fetchBoardKeyword} from ${JSON.stringify(moduleUrl)};await fetchBoardKeyword(${JSON.stringify(taskId)},{fetchImpl:async(url,opts)=>{assert.equal(opts.headers.authorization,'Bearer synthetic-env-token');return new Response(JSON.stringify({status:1,data:'--task=1@tapd-100 --user=test'}));}});console.log('keyword fetched');`;
 const {stdout}=await exec(process.execPath,['--experimental-sqlite','--input-type=module','-e',script],{env:{PATH:process.env.PATH,HOME:process.env.HOME,...forwarded}});assert.match(stdout,/keyword fetched/);
}
test('MCP launch forwards environment-only TAPD credential without a local credential file',async t=>scenario(t));
test('MCP launch forwards a custom task-panel data directory with the credential',async t=>scenario(t,{customHome:true}));

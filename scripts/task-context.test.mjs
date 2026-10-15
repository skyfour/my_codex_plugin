import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,writeFile,readFile,symlink} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {BoardStore} from '../plugins/codex-task-panel/src/store.mjs';import {registerCommitContextProvider} from '../plugins/codex-task-panel/src/provider-registration.mjs';import {TaskContextProvider} from '../plugins/codex-local-review/src/task-context-provider.mjs';
for(const customHome of [false,true])test(`public MCP stdio contract across isolated processes (custom data home=${customHome})`,async t=>{
 const codeHome=await mkdtemp(join(tmpdir(),'task-context-ipc-'));t.after(()=>rm(codeHome,{recursive:true,force:true}));const dataDir=join(codeHome,customHome?'custom-board':'task-panel');
 const store=new BoardStore(join(dataDir,'board.sqlite'));store.applyImport([{provider:'tapd',account:'100',resourceType:'tasks',sourceId:'111001',sourceUpdatedAt:1,title:'Synthetic',body:'private-body',sender:'Test',url:'https://www.tapd.cn/100/prong/tasks/view/111001',sourceState:'open',owner:'test'}],{runId:'test'});const taskId=store.snapshot().tasks[0].id;store.saveScmKeyword(taskId,'--task=1@tapd-100');store.close();
 await registerCommitContextProvider({codeHome});
 const manifest=JSON.parse(await readFile(new URL('../plugins/codex-local-review/.mcp.json',import.meta.url),'utf8')).mcpServers['local-review'];const host={CODEX_HOME:codeHome,...(customHome?{TASK_PANEL_HOME:dataDir}:{})};const env=Object.fromEntries(manifest.env_vars.filter(k=>host[k]!==undefined).map(k=>[k,host[k]]));
 const provider=new TaskContextProvider({env});assert.equal((await provider.listTasks()).tasks[0].id,taskId);assert.deepEqual(await provider.getCommitContext(taskId),{taskId,keyword:'--task=1@tapd-100'});
 const missing='00000000-0000-4000-8000-000000000001';await assert.rejects(provider.getCommitContext(missing),/任务不存在/);
 // Clear only synthetic keyword: prove credential failure comes from provider, without network.
 const again=new BoardStore(join(dataDir,'board.sqlite'));again.saveScmKeyword(taskId,'');again.close();await assert.rejects(provider.getCommitContext(taskId),/尚未配置 TAPD/);
 // Simulate an old/unavailable cached provider rather than falling back to task SQL.
 await registerCommitContextProvider({codeHome,entrypoint:join(codeHome,'removed.mjs')});const unavailable=await provider.listTasks();assert.deepEqual(unavailable.tasks,[]);assert.ok(unavailable.notice);
});

test('provider registration executes through a filesystem alias',async t=>{
 const codeHome=await mkdtemp(join(tmpdir(),'context-alias-'));t.after(()=>rm(codeHome,{recursive:true,force:true}));
 const alias=join(codeHome,'provider-alias.mjs');await symlink(fileURLToPath(new URL('../plugins/codex-task-panel/servers/commit-context.mjs',import.meta.url)),alias);
 await promisify(execFile)(process.execPath,['--experimental-sqlite',alias,'--register'],{env:{...process.env,CODEX_HOME:codeHome}});
 const descriptor=JSON.parse(await readFile(join(codeHome,'integrations/task-commit-context-v1.json'),'utf8'));assert.equal(descriptor.contractVersion,1);assert.equal(descriptor.transport,'mcp-stdio');
});
test('unresponsive provider times out and its child process exits',async t=>{
 const codeHome=await mkdtemp(join(tmpdir(),'context-timeout-'));t.after(()=>rm(codeHome,{recursive:true,force:true}));const entrypoint=join(codeHome,'hang.mjs'),pidFile=join(codeHome,'pid');
 await writeFile(entrypoint,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
 await registerCommitContextProvider({codeHome,entrypoint});const provider=new TaskContextProvider({env:{CODEX_HOME:codeHome},timeoutMs:1000});const result=await provider.listTasks();assert.deepEqual(result.tasks,[]);assert.match(result.notice,/超时/);
 const pid=Number(await readFile(pidFile,'utf8'));let exited=false;
 for(let i=0;i<40;i++){try{process.kill(pid,0);}catch(e){assert.equal(e.code,'ESRCH');exited=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(exited,true,'timed-out provider must not become a resident process');
});

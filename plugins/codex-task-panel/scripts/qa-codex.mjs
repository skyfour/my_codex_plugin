import {mkdtempSync,mkdirSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {withCodex,CodexThreads} from '../src/codex-client.mjs';
import {CodexProjects} from '../src/codex-projects.mjs';
import {ThreadService} from '../src/thread-service.mjs';
import {BoardStore} from '../src/store.mjs';
import {source} from '../tests/fixtures.mjs';
const home=mkdtempSync(join(tmpdir(),'panel-empty-chat-'));
const binary=process.env.TASK_PANEL_CODEX_BINARY||'codex';
const sent=[];
const connect=(fn,options={})=>withCodex(async call=>fn((method,params)=>{sent.push(method);return call(method,params);}),{...options,launch:(command,args,opts)=>spawn(binary,args,{...opts,env:{...process.env,CODEX_HOME:home}}),timeout:15000});
const store=new BoardStore(':memory:');
try{
 const roots=[join(home,'main'),join(home,'extra')];roots.forEach(p=>mkdirSync(p));
 const {project}=await connect(call=>call('project/create',{name:'任务看板 QA 项目',roots:roots.map(path=>({path})),idempotencyKey:randomUUID()}),{experimentalApi:true});
 writeFileSync(join(home,'.codex-global-state.json'),JSON.stringify({'local-projects':{qa:{id:'qa',name:'任务看板 QA 项目',rootPaths:roots}},'project-order':['qa'],'selected-project':{type:'local',projectId:'qa'},'app-server-project-id-by-legacy-project-id-by-host':{['local:'+home]:{qa:project.id}}}));
 const projects=new CodexProjects({codeHome:home,connect:fn=>connect(fn,{experimentalApi:true})});
 assert.deepEqual((await projects.list()).items.map(p=>p.title),['任务看板 QA 项目']);
 const provider=new CodexThreads(connect);
 store.applyImport([source()],{runId:'qa'});
 const service=new ThreadService(store,provider,projects),args={taskId:store.snapshot().tasks[0].id,requestId:randomUUID(),title:'任务看板 QA 空会话',projectId:'qa'};
 const {thread,bound}=await service.create(args);assert.equal(bound,true);
 assert.equal((await service.create(args)).thread.id,thread.id);
 assert.equal(sent.filter(m=>m==='thread/start').length,1);
 const {thread:stored}=await connect(call=>call('thread/read',{threadId:thread.id,includeTurns:true}));
 assert.equal(stored.id,thread.id);
 assert.equal(stored.name,'任务看板 QA 空会话');
 assert.equal(stored.projectId,project.id);
 assert.ok(statSync(stored.path).size>0,'rollout must exist after the creating process exits');
 assert.deepEqual(stored.turns,[]);
 // Reading metadata alone does not prove the desktop can acquire the writer.
 const resumedResult=await connect(call=>call('thread/resume',{threadId:thread.id})),resumed=resumedResult.thread;
 assert.equal(resumed.id,thread.id);
 assert.deepEqual(resumed.turns,[]);
 assert.ok(!sent.some(m=>m.startsWith('turn/')));
 assert.deepEqual(resumed.projectId,project.id);
 assert.deepEqual(resumedResult.runtimeWorkspaceRoots,roots);
 console.log(JSON.stringify({passed:true,cliVersion:execFileSync(binary,['--version'],{encoding:'utf8'}).trim(),createdInIsolatedCodexHome:true,selectedExistingProject:true,projectAssigned:true,rootsPreserved:roots.length,idempotentRetry:true,rolloutPersisted:true,resumedAcrossConnections:true,named:true,turnRequests:0,methods:sent}));
}catch(e){console.error(JSON.stringify({passed:false,error:e.message,methods:sent}));process.exitCode=1;}
finally{store.close();rmSync(home,{recursive:true,force:true});}

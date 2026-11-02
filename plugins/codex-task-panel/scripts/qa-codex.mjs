import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {withCodex,CodexThreads} from '../src/codex-client.mjs';
const home=mkdtempSync(join(tmpdir(),'panel-empty-chat-'));
const binary=process.env.TASK_PANEL_CODEX_BINARY||'codex';
const sent=[];
const connect=fn=>withCodex(async call=>fn((method,params)=>{sent.push(method);return call(method,params);}),{launch:(command,args,opts)=>spawn(binary,args,{...opts,env:{...process.env,CODEX_HOME:home}}),timeout:15000});
try{
 const provider=new CodexThreads(connect);
 const thread=await provider.create(home,()=>{},'任务看板 QA 空会话');
 await provider.verifyCreated(thread.id);
 const {thread:stored}=await connect(call=>call('thread/read',{threadId:thread.id,includeTurns:true}));
 assert.equal(stored.id,thread.id);
 assert.equal(stored.name,'任务看板 QA 空会话');
 assert.ok(statSync(stored.path).size>0,'rollout must exist after the creating process exits');
 assert.deepEqual(stored.turns,[]);
 // Reading metadata alone does not prove the desktop can acquire the writer.
 const {thread:resumed}=await connect(call=>call('thread/resume',{threadId:thread.id}));
 assert.equal(resumed.id,thread.id);
 assert.deepEqual(resumed.turns,[]);
 assert.ok(!sent.some(m=>m.startsWith('turn/')));
 console.log(JSON.stringify({passed:true,cliVersion:execFileSync(binary,['--version'],{encoding:'utf8'}).trim(),createdInIsolatedCodexHome:true,rolloutPersisted:true,resumedAcrossConnections:true,named:true,turnRequests:0,methods:sent}));
}catch(e){console.error(JSON.stringify({passed:false,error:e.message,methods:sent}));process.exitCode=1;}
finally{rmSync(home,{recursive:true,force:true});}

import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {withCodex,CodexThreads} from '../src/codex-client.mjs';
const home=mkdtempSync('/tmp/panel-empty-chat-');
const sent=[];
const connect=fn=>withCodex(async call=>fn((method,params)=>{sent.push(method);return call(method,params);}),{launch:(command,args,opts)=>spawn(command,args,{...opts,env:{...process.env,CODEX_HOME:home}}),timeout:15000});
try{const provider=new CodexThreads(connect);const thread=await provider.create('/tmp',()=>{},'任务看板 QA 空会话');const read=await provider.read(thread.id);assert.equal(read.id,thread.id);assert.equal(read.title,'任务看板 QA 空会话');const listed=await provider.list();const emptyListed=listed.items.some(t=>t.id===thread.id);assert.ok(!sent.some(m=>m.startsWith('turn/')));const result={passed:true,createdInIsolatedCodexHome:true,persistedAcrossConnections:true,named:true,listed:emptyListed,limitation:emptyListed?null:'当前 Codex CLI 的 thread/list 未返回无消息空会话，但 thread/read 可跨连接按 ID 读取。',turnRequests:0,methods:sent};writeFileSync('docs/qa-2026-10-12/real-codex.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}catch(e){writeFileSync('docs/qa-2026-10-12/real-codex.json',JSON.stringify({passed:false,error:e.message,methods:sent},null,2));console.error(e.message);process.exitCode=1;}finally{rmSync(home,{recursive:true,force:true});}

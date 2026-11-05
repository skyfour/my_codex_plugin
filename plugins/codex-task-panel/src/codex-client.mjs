import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {stat} from 'node:fs/promises';

// Each operation owns one short-lived stdio connection; never send turn/start.
export async function withCodex(fn,{launch=spawn,timeout=15000,shutdownTimeout=15000,experimentalApi=false}={}){
 const grouped=process.platform!=='win32';
 const child=launch('codex',['app-server','--stdio'],{stdio:['pipe','pipe','pipe'],detached:grouped}),pending=new Map();let seq=0,failed=false,closed=false,operationFailed=false;
 const exited=new Promise(resolve=>child.once('close',()=>{closed=true;resolve();}));
 const fail=code=>{failed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(code));}pending.clear();};
 child.on('error',()=>fail('CODEX_UNAVAILABLE'));child.on('exit',()=>fail('CODEX_UNAVAILABLE'));
 child.stdin.on('error',()=>fail('CODEX_UNAVAILABLE'));child.stderr.resume();
 const lines=createInterface({input:child.stdout});
 lines.on('line',line=>{try{const result=JSON.parse(line),p=pending.get(result.id);if(!p)return;pending.delete(result.id);clearTimeout(p.timer);result.error?p.reject(new Error('THREAD_UNAVAILABLE')):p.resolve(result.result);}catch{fail('CODEX_UNAVAILABLE');}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  if(failed)return reject(new Error('CODEX_UNAVAILABLE'));
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);const error=new Error('CODEX_TIMEOUT');error.method=method;reject(error);},timeout);
  pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');
 });
 try{await call('initialize',{clientInfo:{name:'codex-task-panel',version:'0.4.10'},...(experimentalApi?{capabilities:{experimentalApi:true}}:{})});child.stdin.write('{"method":"initialized"}\n');return await fn(call);}
 catch(error){operationFailed=true;throw error;}
 finally{
  fail('CODEX_UNAVAILABLE');
  // EOF lets app-server drain queued core operations and flush the rollout.
  // Wait for close as well, so the desktop can acquire the thread's writer lock.
  let forced=false;
  const timer=setTimeout(()=>{
   forced=true;
   // npm's codex launcher inherits its pipes into a native child. Kill this
   // connection's whole group, then release pipes even if a descendant detached.
   try{if(grouped&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{child.kill('SIGKILL');}
   child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
  },shutdownTimeout);
  try{if(!closed)child.stdin.end();await exited;}
  finally{clearTimeout(timer);lines.close();}
  if(forced&&!operationFailed)throw new Error('CODEX_TIMEOUT');
 }
}
export const threadSummary=t=>{
 if(!t||typeof t.id!=='string'||!(/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(t.id))||typeof t.cwd!=='string')throw new Error('THREAD_UNAVAILABLE');
 return {id:t.id,title:String(t.name||t.preview||'未命名会话').slice(0,512),cwd:t.cwd,updatedAt:Number(t.updatedAt)||0};
};
export class CodexThreads {
 constructor(connect=withCodex){this.connect=connect;}
 list({search='',cursor}={}){return this.connect(async call=>{const r=await call('thread/list',{limit:25,archived:false,...(search.trim()?{searchTerm:search.trim()}:{}),...(cursor?{cursor}:{}),sortKey:'updated_at',sortDirection:'desc'});return {items:r.data.filter(t=>!t.ephemeral).map(threadSummary),nextCursor:r.nextCursor??null};});}
 read(id){return this.connect(async call=>threadSummary((await call('thread/read',{threadId:id,includeTurns:false})).thread));}
 verifyCreated(id){return this.connect(async call=>{
  const {thread}=await call('thread/read',{threadId:id,includeTurns:false});
  if(threadSummary(thread).id!==id||typeof thread.path!=='string'||!await stat(thread.path).then(s=>s.isFile()&&s.size>0,()=>false))throw new Error('CREATION_UNKNOWN');
 });}
 inspect(ids){return this.connect(call=>Promise.all(ids.map(async id=>{try{return {...threadSummary((await call('thread/read',{threadId:id,includeTurns:false})).thread),available:true};}catch{return {id,available:false};}})));}
 async create(cwd,onCreated,title,project){let thread,creationAttempted=false;try{return await this.connect(async call=>{creationAttempted=true;thread=threadSummary((await call('thread/start',{cwd,ephemeral:false,...(project?{projectId:project.nativeId,runtimeWorkspaceRoots:project.roots}:{})})).thread);onCreated(thread);await call('thread/name/set',{threadId:thread.id,name:title});return {...thread,title};},{experimentalApi:Boolean(project)});}catch(e){e.creationAttempted=creationAttempted;if(e.method==='thread/start'&&e.message==='CODEX_TIMEOUT')e.message='CREATION_TIMEOUT';if(thread)e.thread=thread;throw e;}}
}

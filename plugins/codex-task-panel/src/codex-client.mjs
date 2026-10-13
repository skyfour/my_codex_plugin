import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Each operation owns one short-lived stdio connection; never send turn/start.
export async function withCodex(fn,{launch=spawn,timeout=15000}={}){
 const child=launch('codex',['app-server','--stdio'],{stdio:['pipe','pipe','pipe']}),pending=new Map();let seq=0,failed=false;
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
 try{await call('initialize',{clientInfo:{name:'codex-task-panel',version:'0.4.0'}});child.stdin.write('{"method":"initialized"}\n');return await fn(call);}
 finally{fail('CODEX_UNAVAILABLE');lines.close();child.kill();}
}
export const threadSummary=t=>{
 if(!t||typeof t.id!=='string'||!(/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(t.id))||typeof t.cwd!=='string')throw new Error('THREAD_UNAVAILABLE');
 return {id:t.id,title:String(t.name||t.preview||'未命名会话').slice(0,512),cwd:t.cwd,updatedAt:Number(t.updatedAt)||0};
};
export class CodexThreads {
 constructor(connect=withCodex){this.connect=connect;}
 list({search='',cursor}={}){return this.connect(async call=>{const r=await call('thread/list',{limit:25,archived:false,...(search.trim()?{searchTerm:search.trim()}:{}),...(cursor?{cursor}:{}),sortKey:'updated_at',sortDirection:'desc'});return {items:r.data.filter(t=>!t.ephemeral).map(threadSummary),nextCursor:r.nextCursor??null};});}
 read(id){return this.connect(async call=>threadSummary((await call('thread/read',{threadId:id,includeTurns:false})).thread));}
 inspect(ids){return this.connect(call=>Promise.all(ids.map(async id=>{try{return {...threadSummary((await call('thread/read',{threadId:id,includeTurns:false})).thread),available:true};}catch{return {id,available:false};}})));}
 async create(cwd,onCreated,title){let thread;try{return await this.connect(async call=>{thread=threadSummary((await call('thread/start',{cwd,ephemeral:false})).thread);onCreated(thread);await call('thread/name/set',{threadId:thread.id,name:title});return {...thread,title};});}catch(e){if(e.method==='thread/start'&&e.message==='CODEX_TIMEOUT')e.message='CREATION_TIMEOUT';if(thread)e.thread=thread;throw e;}}
}

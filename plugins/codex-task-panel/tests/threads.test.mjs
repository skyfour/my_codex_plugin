import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {BoardStore} from '../src/store.mjs';
import {ThreadService} from '../src/thread-service.mjs';
import {withCodex,threadSummary,CodexThreads} from '../src/codex-client.mjs';
import {errorText} from '../src/errors.mjs';
import {source} from './fixtures.mjs';
const thread=(title='会话')=>({id:randomUUID(),title,cwd:tmpdir(),updatedAt:1000});
function fixture(){const store=new BoardStore(':memory:');store.applyImport([source(),source('2')],{runId:'seed'});return {store,ids:store.snapshot().tasks.map(t=>t.id)};}
test('many-to-many links deduplicate, survive source updates, unbind only the pair',()=>{
 const {store,ids}=fixture(),a=thread(),b=thread();try{store.bindThreads(ids[0],[a,a,b]);store.bindThreads(ids[1],[a]);assert.deepEqual(store.snapshot().tasks.map(t=>t.threadCount),[2,1]);store.applyImport([source('1',{title:'更新',sourceUpdatedAt:2000})],{runId:'update'});assert.equal(store.threads(ids[0]).length,2);store.unbindThread(ids[0],a.id);assert.equal(store.threads(ids[1]).length,1);assert.equal(store.getTask(ids[0]).threadCount,1);}finally{store.close();}
});
test('schema 1 upgrades transactionally and links persist across restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'panel-migrate-')),path=join(dir,'board.sqlite');let store=new BoardStore(path);try{store.applyImport([source()],{runId:'seed'});const id=store.snapshot().tasks[0].id;store.db.exec("DROP TABLE workflow_transitions; DELETE FROM meta WHERE key='workflow_version'; DROP TABLE task_threads; DROP TABLE thread_creations; UPDATE meta SET value=1 WHERE key='schema'");store.close();store=new BoardStore(path);assert.equal(store.getTask(id).title,'任务 1');store.bindThreads(id,[thread()]);store.close();store=new BoardStore(path);assert.equal(store.threads(id).length,1);assert.equal(store.db.prepare("SELECT value FROM meta WHERE key='schema'").get().value,3);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('candidate search/cursor forwarded; exact IDs validated before any binding; missing links retained',async()=>{
 const {store,ids}=fixture(),a=thread();let query;const provider={list:async args=>(query=args,{items:[a],nextCursor:'next'}),read:async id=>{if(id!==a.id)throw Error('THREAD_UNAVAILABLE');return a;}};const service=new ThreadService(store,provider);try{assert.equal((await service.candidates({search:'foo',cursor:'page'})).nextCursor,'next');assert.deepEqual(query,{search:'foo',cursor:'page'});await assert.rejects(service.bind(ids[0],[a.id,randomUUID()]));assert.equal(store.threads(ids[0]).length,0);await service.bind(ids[0],[a.id,a.id]);provider.read=async()=>{throw Error();};const links=await service.linked(ids[0]);assert.equal(links[0].available,false);assert.equal(links[0].title,a.title);}finally{store.close();}
});
test('empty creation is idempotent and partial binding failure recovers without second create',async()=>{
 const {store,ids}=fixture(),a=thread();let creates=0;const service=new ThreadService(store,{create:async(cwd,saved,title)=>{creates++;saved({...a,title});return {...a,title};}}),args={taskId:ids[0],requestId:randomUUID(),title:'空会话',cwd:tmpdir()};const bind=store.bindThreads.bind(store);try{store.bindThreads=()=>{throw Error('disk');};assert.equal((await service.create(args)).bound,false);store.bindThreads=bind;assert.equal((await service.create(args)).bound,true);assert.equal((await service.create(args)).thread.id,a.id);assert.equal(creates,1);assert.equal(store.threads(ids[0]).length,1);await assert.rejects(service.create({...args,title:'不同'}),/CONFIRMATION_REUSED/);}finally{store.close();}
});
test('invalid cwd never creates; timeout with unknown result blocks duplicate creation',async()=>{
 const {store,ids}=fixture();let creates=0;const service=new ThreadService(store,{create:async()=>{creates++;throw Error('CODEX_TIMEOUT');}}),args={taskId:ids[0],requestId:randomUUID(),title:'空会话',cwd:tmpdir()};try{await assert.rejects(service.create({...args,cwd:'relative'}),/INVALID_CWD/);assert.equal(creates,0);await assert.rejects(service.create(args),/CODEX_TIMEOUT/);await assert.rejects(service.create(args),/CREATION_UNKNOWN/);assert.equal(creates,1);}finally{store.close();}
});
test('stdio handshake, request error and timeout always close child; no execution messages',async()=>{
 const messages=[];let killed=0,closed=0;const launch=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{killed++;child.emit('close');};child.stdin.on('finish',()=>{closed++;child.emit('close',0);});child.stdin.on('data',chunk=>{for(const line of chunk.toString().trim().split('\n')){const msg=JSON.parse(line);messages.push(msg);if(msg.id&&msg.method!=='timeout')child.stdout.write(JSON.stringify(msg.method==='bad'?{id:msg.id,error:{message:'secret'}}:{id:msg.id,result:{ok:true}})+'\n');}});return child;};
 assert.deepEqual(await withCodex(call=>call('thread/list'),{launch}),{ok:true});await assert.rejects(withCodex(call=>call('bad'),{launch}),/THREAD_UNAVAILABLE/);await assert.rejects(withCodex(call=>call('timeout'),{launch,timeout:10}),/CODEX_TIMEOUT/);assert.equal(killed,0);assert.equal(closed,3);assert.equal(messages[0].method,'initialize');assert.equal(messages[1].method,'initialized');assert.ok(messages.every(m=>m.method!=='turn/start'));
});
test('known created ID remains recoverable when rename or journal save fails',async()=>{
 const {store,ids}=fixture(),a=thread();let creates=0;const provider={create:async(cwd,saved)=>{creates++;saved(a);const e=Error('CODEX_TIMEOUT');e.thread=a;throw e;}},service=new ThreadService(store,provider),args={taskId:ids[0],requestId:randomUUID(),title:'new',cwd:tmpdir()};try{assert.equal((await service.create(args)).thread.id,a.id);assert.equal(creates,1);store.saveCreation=()=>{throw Error('disk');};provider.create=async()=>{creates++;const e=Error('disk');e.thread=a;throw e;};const next={...args,requestId:randomUUID()};const r=await service.create(next);assert.equal(r.bound,false);assert.equal(r.thread.id,a.id);await assert.rejects(service.create(next),/CREATION_UNKNOWN/);assert.equal(creates,2);}finally{store.close();}
});

test('thread summary validates UUIDs and excludes turn content',()=>{const t=thread();const mapped=threadSummary({...t,name:'标题',turns:[{secret:'private'}]});assert.equal(mapped.title,'标题');assert.equal(mapped.turns,undefined);assert.throws(()=>threadSummary({...t,id:'-'.repeat(36)}),/THREAD_UNAVAILABLE/);});

test('blank search omits searchTerm while title search and cursor are preserved',async()=>{const calls=[],provider=new CodexThreads(async fn=>fn(async(method,params)=>{calls.push({method,params});return {data:[],nextCursor:null};}));await provider.list();await provider.list({search:'   '});await provider.list({search:' 标题 ',cursor:'page-2'});assert.equal(Object.hasOwn(calls[0].params,'searchTerm'),false);assert.equal(Object.hasOwn(calls[1].params,'searchTerm'),false);assert.equal(calls[2].params.searchTerm,'标题');assert.equal(calls[2].params.cursor,'page-2');});

test('read timeout never suggests a creation; start timeout retains recovery warning',()=>{assert.doesNotMatch(errorText(Error('CODEX_TIMEOUT')),/创建|新建/);assert.match(errorText(Error('CREATION_TIMEOUT')),/创建结果/);});

test('stdio completion drains queued persistence and releases the writer before returning',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'panel-stdio-drain-')),rollout=join(dir,'rollout.jsonl');let child;
 // Older app-servers acknowledge the rename before processing its queued write.
 const source=`
  import {createInterface} from 'node:readline';
  import {writeFile} from 'node:fs/promises';
  let queued=false;
  const lines=createInterface({input:process.stdin});
  lines.on('line',line=>{const message=JSON.parse(line);if(!message.id)return;
   if(message.method==='thread/name/set')queued=true;
   process.stdout.write(JSON.stringify({id:message.id,result:{ok:true}})+'\\n');
  });
  lines.on('close',async()=>{if(queued)await writeFile(process.argv[1],'persisted');process.exit(0);});
 `;
 try{
  const result=await withCodex(async call=>{await call('thread/name/set',{threadId:randomUUID(),name:'empty'});return 'created';},{launch:(cmd,args,options)=>(child=spawn(process.execPath,['--input-type=module','-e',source,rollout],options))});
  assert.equal(result,'created');
  assert.equal(existsSync(rollout),true,'rollout must be persisted before the caller can open it');
  assert.equal(readFileSync(rollout,'utf8'),'persisted');
  assert.equal(child.exitCode,0,'the writer process must have exited normally');
 }finally{child?.kill('SIGKILL');rmSync(dir,{recursive:true,force:true});}
});

test('stalled shutdown is bounded, kills the child and preserves an earlier operation error',async()=>{
 const source=`
  import {createInterface} from 'node:readline';
  setInterval(()=>{},1000);
  createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n');});
 `;
 for(const operationError of [null,new Error('THREAD_UNAVAILABLE')]){
  let child;
  try{
   await assert.rejects(withCodex(async()=>{if(operationError)throw operationError;return 'created';},{shutdownTimeout:25,launch:(cmd,args,options)=>(child=spawn(process.execPath,['--input-type=module','-e',source],options))}),operationError??/CODEX_TIMEOUT/);
   assert.equal(child.signalCode,'SIGKILL');
  }finally{child?.kill('SIGKILL');}
 }
});

test('shutdown timeout terminates an npm-style wrapper and its native writer',async()=>{
 const native=`
  import {createInterface} from 'node:readline';
  setInterval(()=>{},1000);
  createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:{pid:process.pid}})+'\\n');});
 `;
 const wrapper=`import {spawn} from 'node:child_process';const child=spawn(process.execPath,['--input-type=module','-e',process.argv[1]],{stdio:'inherit'});child.on('exit',()=>process.exit(0));`;
 let child,nativePid,operation,timer;
 try{
  operation=withCodex(async call=>{nativePid=(await call('probe')).pid;},{shutdownTimeout:25,launch:(cmd,args,options)=>(child=spawn(process.execPath,['--input-type=module','-e',wrapper,native],options))});
  const watchdog=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('cleanup never completed')),1000);});
  await assert.rejects(Promise.race([operation,watchdog]),/CODEX_TIMEOUT/);
  assert.equal(child.signalCode,'SIGKILL');
  await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(Error('native writer survived cleanup')),1000);const check=()=>{try{process.kill(nativePid,0);setTimeout(check,10);}catch(e){clearTimeout(deadline);e.code==='ESRCH'?resolve():reject(e);}};check();});
 }finally{clearTimeout(timer);if(nativePid)try{process.kill(nativePid,'SIGKILL');}catch{}child?.kill('SIGKILL');await operation?.catch(()=>{});}
});

test('a known created ID is not bound until its rollout exists; retry reuses the same ID',async()=>{
 const {store,ids}=fixture(),dir=mkdtempSync(join(tmpdir(),'panel-unpersisted-')),path=join(dir,'rollout.jsonl'),a=thread();let starts=0;
 const provider=new CodexThreads(async fn=>{
  let creating=false;
  const result=await fn(async method=>{
   if(method==='thread/start'){creating=true;starts++;return {thread:{...a,path}};}
   if(method==='thread/read')return {thread:{...a,path}};
   return {};
  });
  if(creating)throw new Error('CODEX_TIMEOUT');
  return result;
 });
 const service=new ThreadService(store,provider),args={taskId:ids[0],requestId:randomUUID(),title:'new',cwd:dir};
 try{
  await assert.rejects(service.create(args),/CREATION_UNKNOWN/);
  assert.equal(store.threads(ids[0]).length,0);
  assert.equal(store.creation(args.requestId).thread.id,a.id);
  writeFileSync(path,'');
  await assert.rejects(service.create(args),/CREATION_UNKNOWN/);
  writeFileSync(path,'persisted');
  assert.equal((await service.create(args)).bound,true);
  assert.equal(starts,1);
  rmSync(path);
  store.saveCreation=()=>{throw new Error('disk');};
  await assert.rejects(service.create({...args,requestId:randomUUID()}),/CREATION_UNKNOWN/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

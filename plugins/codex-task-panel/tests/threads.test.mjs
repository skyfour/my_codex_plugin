import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
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
 const messages=[];let killed=0;const launch=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{killed++;};child.stdin.on('data',chunk=>{for(const line of chunk.toString().trim().split('\n')){const msg=JSON.parse(line);messages.push(msg);if(msg.id&&msg.method!=='timeout')child.stdout.write(JSON.stringify(msg.method==='bad'?{id:msg.id,error:{message:'secret'}}:{id:msg.id,result:{ok:true}})+'\n');}});return child;};
 assert.deepEqual(await withCodex(call=>call('thread/list'),{launch}),{ok:true});await assert.rejects(withCodex(call=>call('bad'),{launch}),/THREAD_UNAVAILABLE/);await assert.rejects(withCodex(call=>call('timeout'),{launch,timeout:10}),/CODEX_TIMEOUT/);assert.equal(killed,3);assert.equal(messages[0].method,'initialize');assert.equal(messages[1].method,'initialized');assert.ok(messages.every(m=>m.method!=='turn/start'));
});
test('known created ID remains recoverable when rename or journal save fails',async()=>{
 const {store,ids}=fixture(),a=thread();let creates=0;const provider={create:async(cwd,saved)=>{creates++;saved(a);const e=Error('CODEX_TIMEOUT');e.thread=a;throw e;}},service=new ThreadService(store,provider),args={taskId:ids[0],requestId:randomUUID(),title:'new',cwd:tmpdir()};try{assert.equal((await service.create(args)).thread.id,a.id);assert.equal(creates,1);store.saveCreation=()=>{throw Error('disk');};provider.create=async()=>{creates++;const e=Error('disk');e.thread=a;throw e;};const next={...args,requestId:randomUUID()};const r=await service.create(next);assert.equal(r.bound,false);assert.equal(r.thread.id,a.id);await assert.rejects(service.create(next),/CREATION_UNKNOWN/);assert.equal(creates,2);}finally{store.close();}
});

test('thread summary validates UUIDs and excludes turn content',()=>{const t=thread();const mapped=threadSummary({...t,name:'标题',turns:[{secret:'private'}]});assert.equal(mapped.title,'标题');assert.equal(mapped.turns,undefined);assert.throws(()=>threadSummary({...t,id:'-'.repeat(36)}),/THREAD_UNAVAILABLE/);});

test('blank search omits searchTerm while title search and cursor are preserved',async()=>{const calls=[],provider=new CodexThreads(async fn=>fn(async(method,params)=>{calls.push({method,params});return {data:[],nextCursor:null};}));await provider.list();await provider.list({search:'   '});await provider.list({search:' 标题 ',cursor:'page-2'});assert.equal(Object.hasOwn(calls[0].params,'searchTerm'),false);assert.equal(Object.hasOwn(calls[1].params,'searchTerm'),false);assert.equal(calls[2].params.searchTerm,'标题');assert.equal(calls[2].params.cursor,'page-2');});

test('read timeout never suggests a creation; start timeout retains recovery warning',()=>{assert.doesNotMatch(errorText(Error('CODEX_TIMEOUT')),/创建|新建/);assert.match(errorText(Error('CREATION_TIMEOUT')),/创建结果/);});

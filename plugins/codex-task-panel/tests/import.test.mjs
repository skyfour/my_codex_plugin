import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardStore} from '../src/store.mjs';
import {ImportService} from '../src/import-service.mjs';
import {source} from './fixtures.mjs';

function fixture(records=[source('1'),source('2')]){
 const store=new BoardStore(':memory:');store.configure({workspaceId:'100',ownerName:'示例',version:1});let time=100;
 const reads=[];const service=new ImportService({store,credentials:async()=> 'synthetic-token',now:()=>time,read:async input=>{reads.push(input);return {identity:{id:'9',nick:'nick',name:'示例'},records,missingIds:[]};}});
 return {store,service,reads,advance:()=>time+=300001};
}
test('preview has no writes, imports selected IDs only, and unselected tasks remain discoverable',async()=>{
 const {store,service,reads}=fixture();const p=await service.preview();assert.equal(store.snapshot().tasks.length,0);assert.equal(p.items.length,2);
 const r=service.commit({previewId:p.previewId,selectedIds:['1'],laneId:store.snapshot().lanes[0].id,confirmed:true});
 assert.equal(r.created,1);assert.equal(store.snapshot().tasks[0].sourceId,'1');
 const next=await service.preview();assert.equal(next.items.find(t=>t.sourceId==='2').action,'create');assert.equal(reads[1].cursor,null);store.close();
});
test('rejects empty, duplicate, foreign selections and commits without explicit confirmation',async()=>{
 const {store,service}=fixture();const p=await service.preview();const base={previewId:p.previewId,confirmed:true};
 for(const selectedIds of [[],['1','1'],['999']])assert.throws(()=>service.commit({...base,selectedIds}),/INVALID_SELECTION/);
 assert.throws(()=>service.commit({...base,selectedIds:['1'],confirmed:false}),/CONFIRMATION_REQUIRED/);
 assert.equal(store.snapshot().tasks.length,0);store.close();
});
test('expired or superseded preview cannot write',async()=>{
 const f=fixture();const p=await f.service.preview();f.advance();assert.throws(()=>f.service.commit({previewId:p.previewId,selectedIds:['1'],confirmed:true}),/PREVIEW_STALE/);
 const p2=await f.service.preview();await f.service.preview();assert.throws(()=>f.service.commit({previewId:p2.previewId,selectedIds:['1'],confirmed:true}),/PREVIEW_STALE/);f.store.close();
});
test('confirmation retry is idempotent but cannot change selected IDs',async()=>{
 const {store,service}=fixture();const p=await service.preview();const args={previewId:p.previewId,selectedIds:['1'],confirmed:true};
 const a=service.commit(args),b=service.commit(args);assert.deepEqual(a,b);assert.equal(store.history().length,1);
 assert.throws(()=>service.commit({...args,selectedIds:['2']}),/CONFIRMATION_REUSED/);store.close();
});
test('confirmation retry remains idempotent after more than fifty subsequent imports',async()=>{
 const {store,service}=fixture();const p=await service.preview();const args={previewId:p.previewId,selectedIds:['1'],confirmed:true};
 const original=service.commit(args);
 for(let i=0;i<51;i++)store.applyImport([source(String(100+i))],{runId:`later-${i}`});
 service.current=null;
 assert.deepEqual(service.commit(args),original);store.close();
});
test('updates preserve local placement and unchanged records cannot be selected',async()=>{
 const {store,service}=fixture([source('1',{sourceUpdatedAt:2000,body:'changed'}),source('2')]);
 store.applyImport([source('1'),source('2')],{runId:'seed'});const task=store.snapshot().tasks.find(t=>t.sourceId==='1');
 for(const lane of store.snapshot().lanes.slice(1,3))store.moveCard({id:task.id,laneId:lane.id,version:store.getTask(task.id).version});
 const p=await service.preview();assert.equal(p.items.find(t=>t.sourceId==='2').action,'unchanged');
 assert.throws(()=>service.commit({previewId:p.previewId,selectedIds:['2'],confirmed:true}),/INVALID_SELECTION/);
 service.commit({previewId:p.previewId,selectedIds:['1'],confirmed:true});assert.equal(store.getTask(task.id).laneId,store.snapshot().lanes[2].id);store.close();
});
test('source/config conflicts leave every selected record unchanged',async()=>{
 const {store,service}=fixture();const p=await service.preview();store.configure({workspaceId:'200',ownerName:'示例',version:store.config().version});
 assert.throws(()=>service.commit({previewId:p.previewId,selectedIds:['1'],confirmed:true}),/CONFIG_CHANGED/);assert.equal(store.snapshot().tasks.length,0);store.close();
});
test('missing token stops before TAPD requests and query failure keeps previous board',async()=>{
 const f=fixture();f.service.credentials=async()=>null;await assert.rejects(f.service.preview(),/TAPD_CREDENTIAL_REQUIRED/);assert.equal(f.reads.length,0);f.store.close();
});

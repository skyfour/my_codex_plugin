import test from 'node:test';import assert from 'node:assert/strict';
import {BoardStore} from '../src/store.mjs';import {CommitContextService} from '../src/commit-context-service.mjs';import {loadToken,saveToken} from '../src/credentials.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
const source={provider:'tapd',account:'100',resourceType:'tasks',sourceId:'111001',sourceUpdatedAt:1,title:'Task',body:'private-body',sender:'Test',url:'https://www.tapd.cn/100/prong/tasks/view/111001',sourceState:'open',owner:'test'};
function fixture(t,options={}) {const store=new BoardStore(':memory:');t.after(()=>store.close());store.applyImport([source],{runId:'a'});const id=store.snapshot().tasks[0].id;return {store,id,service:new CommitContextService({store,...options})};}
test('missing keyword is fetched by board and persisted; cached/manual keyword needs no credential',async t=>{
 let reads=0;const {service,store,id}=fixture(t,{credentials:async()=>'synthetic',readKeyword:async input=>{reads++;assert.deepEqual(input,{token:'synthetic',workspaceId:'100',objectId:'111001'});return '--task=1@tapd-100';}});
 assert.equal((await service.get(id)).keyword,'--task=1@tapd-100');await service.get(id);assert.equal(reads,1);
 store.saveScmKeyword(id,'manual');assert.equal((await service.get(id)).keyword,'manual');assert.equal(reads,1);
 await service.get(id,{refresh:true});assert.equal(reads,2);
 const data=service.list();assert.equal(data.contractVersion,1);assert.doesNotMatch(JSON.stringify(data),/private-body|synthetic|owner|sender/);
});
test('failed refresh preserves saved keyword; absent credential never calls gateway',async t=>{
 const {service,store,id}=fixture(t,{credentials:async()=>null,readKeyword:async()=>{throw Error('must not call');}});
 await assert.rejects(service.get(id),/TAPD_CREDENTIAL_REQUIRED/);store.saveScmKeyword(id,'saved');await assert.rejects(service.get(id,{refresh:true}),/TAPD_CREDENTIAL_REQUIRED/);assert.equal(store.scmKeyword(id),'saved');
 service.credentials=async()=>'fake';
 service.readKeyword=async()=> 'line\nbreak';await assert.rejects(service.get(id,{refresh:true}),/INVALID_SCM_KEYWORD/);assert.equal(store.scmKeyword(id),'saved');
});
test('board alone loads environment token and explicit local replacement',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'context-credential-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const {service,id}=fixture(t,{credentials:()=>loadToken(dir,{TAPD_ACCESS_TOKEN:'env-token'}),readKeyword:async({token})=>{assert.equal(token,'env-token');return 'env-keyword';}});
 await service.get(id);await saveToken(dir,'local-token');service.readKeyword=async({token})=>{assert.equal(token,'local-token');return 'local-keyword';};assert.equal((await service.get(id,{refresh:true})).keyword,'local-keyword');
});

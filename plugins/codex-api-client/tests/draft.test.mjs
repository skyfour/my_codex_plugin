import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ApiService} from '../src/service.mjs';
import {Store} from '../src/store.mjs';
import {invoke} from '../src/tools.mjs';
import {TRANSFER_LIMIT} from '../src/workspace-transfer.mjs';

async function setup(t) {
  const directory=await mkdtemp(join(tmpdir(),'api-draft-'));
  const keys=new Map();
  const store=new Store(directory,{
    async set(key,value){keys.set(key,value);},
    async get(key){return keys.get(key);},
    async delete(key){keys.delete(key);},
  });
  const service=new ApiService(store);
  t.after(async()=>{await service.close();store.close();await rm(directory,{recursive:true,force:true});});
  return {service,store,keys};
}

async function complete(service,args) {
  const {runId,status}=await invoke(service,'api_run_draft',args);
  assert.equal(status,'running');
  await service.active.get(runId)?.completion;
  return service.result({runId,includeBodies:true});
}

test('interactive cURL stays temporary and sends the same headers through the shared runner',async t=>{
  const {service,store,keys}=await setup(t),hits=[];
  const server=createServer((req,res)=>{
    hits.push({url:req.url,accept:req.headers.accept,authorization:req.headers.authorization,apiKey:req.headers['x-api-key']});
    res.setHeader('Set-Cookie','draft=session-cookie-fixture; Path=/');
    res.end(JSON.stringify(req.headers));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const accept='application/json, text/plain, */*';
  const text="curl '{{baseUrl}}/draft' -H 'Accept: "+accept+"' -H 'Authorization: Bearer draft-test-bearer' -H 'X-Api-Key: draft-test-key'";
  const environment=await service.put({kind:'environment',data:{name:'Local',values:[{key:'baseUrl',value:'http://127.0.0.1:'+server.address().port}]}});
  const before=store.workspaceIdentity();
  assert.equal((await invoke(service,'api_import_preview',{text})).source,'curl');
  const {draft,warnings}=await invoke(service,'api_import_interactive',{text});
  assert.deepEqual(warnings,[]);
  assert.equal(draft.kind,'collection');
  assert.equal(draft.revision,0);
  assert.equal(draft.data.item.length,1);
  const [item]=draft.data.item;
  assert.ok(draft.id&&item.id);
  assert.equal(item.request.header[0].value,accept);
  assert.equal(item.request.header[1].type,'secret');
  assert.equal(item.request.header[2].type,'secret');
  assert.equal(store.workspaceIdentity(),before);
  assert.equal(keys.size,0);
  assert.deepEqual(hits,[]);

  const run=await complete(service,{environmentId:environment.id,item:{...item,event:[{listen:'test',script:{exec:[
    'pm.environment.set("draftEnvironment", "kept");',
    'pm.globals.set("draftGlobal", "kept");',
    'pm.collectionVariables.set("draftCollection", "transient");',
    'pm.test("draft response",()=>pm.response.to.have.status(200));'
  ]}}]}});
  assert.equal(run.status,'completed',JSON.stringify(run.errors));
  assert.equal(run.collectionId,undefined);
  assert.equal(run.itemId,item.id);
  assert.equal(run.assertions[0].name,'draft response');
  assert.deepEqual(hits,[{url:'/draft',accept,authorization:'Bearer draft-test-bearer',apiKey:'draft-test-key'}]);
  const body=JSON.parse(run.responses[0].body);
  assert.equal(body.accept,accept);
  for(const secret of ['draft-test-bearer','draft-test-key','session-cookie-fixture'])assert.ok(!store.workspaceIdentity().includes(secret),secret);
  assert.deepEqual((await service.state()).collections,[]);
  assert.equal((await store.get('environment',environment.id)).data.values.find(row=>row.key==='draftEnvironment').value,'kept');
  assert.equal((await store.get('globals','default')).data.values.find(row=>row.key==='draftGlobal').value,'kept');
  assert.equal((await store.get('cookies','default',{reveal:true})).data.cookies[0].value,'session-cookie-fixture');
});

test('only the interactive import changes cURL persistence',async t=>{
  const {service}=await setup(t);
  const text="curl 'http://example.test' -H 'Accept: */*'";
  const {draft}=await invoke(service,'api_import_interactive',{text});
  const saved=await invoke(service,'api_document_put',draft);
  assert.equal(saved.id,draft.id);
  assert.equal(saved.revision,1);
  assert.equal(saved.data.item[0].id,draft.data.item[0].id);
  assert.equal((await invoke(service,'api_import',{text})).document.revision,1);
  const postmanText=JSON.stringify({info:{name:'Saved by import'},item:[]});
  assert.equal((await invoke(service,'api_import_preview',{text:postmanText})).source,undefined);
  assert.equal((await invoke(service,'api_import_interactive',{text:postmanText})).document.data.info.name,'Saved by import');
  assert.equal((await service.state()).collections.length,3);
});

test('draft execution rejects folders and oversized payloads before creating a run',async t=>{
  const {service,store}=await setup(t);
  const before=store.workspaceIdentity();
  await assert.rejects(invoke(service,'api_run_draft',{item:{name:'Folder',item:[],request:{url:'http://example.test'}}}),/INVALID_DOCUMENT/);
  await assert.rejects(invoke(service,'api_run_draft',{item:{name:'Large',request:{url:'http://example.test',body:{mode:'raw',raw:'a'.repeat(TRANSFER_LIMIT)}}}}),/LIMIT/);
  assert.equal(store.workspaceIdentity(),before);
});

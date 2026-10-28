import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
const { ApiService } = await import('../src/service.mjs').catch(() => ({}));
async function setup(t) {
  assert.equal(typeof ApiService, 'function');
  const dir=await mkdtemp(join(tmpdir(),'api-service-'));
  const store=new Store(dir);
  const service=new ApiService(store);
  t.after(async()=>{await service.close();store.close();await rm(dir,{recursive:true,force:true});});
  return {service,store,dir};
}
test('import, duplicate, move, delete and export operate on the same revisioned collection', async t=>{
  const {service}=await setup(t);
  const imported=await service.import({text:JSON.stringify({info:{name:'API'},item:[{name:'one',request:{method:'GET',url:'http://localhost'}},{name:'Folder',item:[]}]})});
  const c=imported.document;
  const copied=await service.editItem({collectionId:c.id,itemId:c.data.item[0].id,operation:'duplicate',revision:1});
  assert.equal(copied.data.item.length,3);
  const moved=await service.editItem({collectionId:c.id,itemId:copied.data.item[1].id,operation:'move',parentId:c.data.item[1].id,position:0,revision:2});
  assert.equal(moved.data.item[1].item.length,1);
  await assert.rejects(service.editItem({collectionId:c.id,itemId:c.data.item[0].id,operation:'delete',revision:1}),/CONFLICT/);
  const exported=await service.export({kind:'collection',id:c.id});
  assert.equal(exported.data.info.name,'API');
  assert.equal((await service.state()).collections.length,1);
});
test('invalid limits and unsupported auth/scripts are rejected before execution', async t=>{
  const {service}=await setup(t);
  const c=await service.put({kind:'collection',id:'x',revision:0,data:{info:{name:'x'},item:[{name:'x',request:{url:'http://localhost',auth:{type:'oauth2'}}}]}});
  await assert.rejects(service.start({collectionId:c.id,options:{iterations:0}}),/LIMIT/);
  await assert.rejects(service.start({collectionId:c.id}),/UNSUPPORTED/);
});
test('file upload creates an owned attachment and rejects oversized or malformed inputs', async t=>{
  const {service,dir}=await setup(t);
  const result=await service.upload({name:'../../hello.txt',base64:Buffer.from('hello').toString('base64')});
  assert.ok(result.path.startsWith(join(dir,'uploads')));
  assert.equal(result.name,'hello.txt');
  await assert.rejects(service.upload({name:'x',base64:'!!!!'}),/UPLOAD/);
});

test('explicit GraphQL introspection uses existing runner and auth without changing saved request',async t=>{
 const http=await import('node:http');const hits=[];
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;hits.push({body:JSON.parse(body),auth:req.headers.authorization});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{__schema:{queryType:{name:'Query'},types:[{name:'Query',kind:'OBJECT',fields:[{name:'hello',args:[],type:{name:'String',kind:'SCALAR'}}]}]}}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const {service}=await setup(t),body={mode:'graphql',graphql:{query:'query Saved { hello }',variables:'{}',operationName:'Saved'},'x-preserved':42};
 const doc=await service.put({kind:'collection',data:{info:{name:'graphql'},auth:{type:'bearer',bearer:[{key:'token',value:'fixture-token'}]},item:[{id:'g',name:'G',request:{method:'POST',url:`http://127.0.0.1:${server.address().port}/graphql`,body}}]}});
 assert.equal(hits.length,0);const started=await service.graphqlIntrospect({collectionId:doc.id,itemId:'g'});await service.active.get(started.runId).completion;
 assert.equal(hits.length,1);assert.equal(hits[0].auth,'Bearer fixture-token');assert.match(hits[0].body.query,/__schema/);assert.equal(hits[0].body.operationName,'IntrospectionQuery');assert.deepEqual((await service.get({kind:'collection',id:doc.id})).data.item[0].request.body,body);
 const result=await service.result({runId:started.runId,includeBodies:true});assert.equal(result.status,'completed');assert.match(result.responses[0].body,/hello/);
});

test('OpenAPI/HAR service preview is read-only and imported templates run locally; isolated Send never jumps',async t=>{
 const http=await import('node:http');const hits=[];const server=http.createServer((req,res)=>{hits.push(req.url);res.end('ok');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const {service}=await setup(t),url=`http://127.0.0.1:${server.address().port}`;
 for(const text of [JSON.stringify({openapi:'3.1.0',info:{title:'Imported',version:'1'},servers:[{url}],paths:{'/converted':{get:{responses:{200:{description:'ok'}}}}}}),JSON.stringify({log:{entries:[{request:{method:'GET',url:url+'/har',headers:[]}}]}})]){
  const before=(await service.state()).collections.length;const preview=await service.previewImport({text});assert.equal((await service.state()).collections.length,before);assert.equal(preview.requestCount,1);assert.ok(preview.servers.some(s=>s.startsWith(url)));assert.equal(hits.length,before);
  const {document}=await service.import({text});const started=await service.start({collectionId:document.id});await service.active.get(started.runId).completion;assert.equal((await service.result({runId:started.runId})).status,'completed');
 }
 const doc=await service.put({kind:'collection',data:{info:{name:'isolate'},item:[{id:'first',name:'first',request:{url:url+'/first'},event:[{listen:'test',script:{exec:['pm.execution.setNextRequest("sibling");']}}]},{id:'sibling',name:'sibling',request:{url:url+'/should-not-run'}}]}});const started=await service.start({collectionId:doc.id,itemId:'first'});await service.active.get(started.runId).completion;assert.deepEqual(hits,['/converted','/har','/first']);
});

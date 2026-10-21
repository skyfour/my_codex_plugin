import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {Store} from '../src/store.mjs';
import {ApiService} from '../src/service.mjs';
import {invoke} from '../src/tools.mjs';
async function setup(t){const dir=await mkdtemp('/tmp/api-transfer-'),values=new Map();const secrets={async set(k,v){values.set(k,v);},async get(k){return values.get(k);},async delete(k){values.delete(k);}};const store=new Store(dir,secrets),service=new ApiService(store);t.after(async()=>{await service.close();store.close();await rm(dir,{recursive:true,force:true});});return {store,service,values,secrets};}
const event=[{listen:'prerequest',script:{exec:['pm.variables.set("before", "yes");']}},{listen:'test',script:{exec:['pm.test("ok",()=>pm.response.to.have.status(200));']}}];
const collection=name=>({info:{name},event,variable:[{key:'base',value:'{{host}}'}],item:[{name:'folder',event,item:[{name:'request',event,request:{method:'GET',url:'{{host}}/api'}}]}]});

test('workspace export and import preserve every collection environment globals and all script scopes',async t=>{
 const a=await setup(t),b=await setup(t);
 for(const name of ['one','two'])await a.service.put({kind:'collection',revision:0,data:collection(name)});
 await a.service.put({kind:'environment',revision:0,data:{name:'dev',values:[{key:'host',value:'http://localhost'},{key:'token',type:'secret',value:'private-never-export'}]}});
 await a.service.put({kind:'globals',revision:0,data:{values:[{key:'shared',value:'preserved'}]}});
 const result=await invoke(a.service,'api_workspace_export',{}),text=JSON.stringify(result.data);
 assert.equal(result.data.collections.length,2);assert.equal(result.data.environments.length,1);assert.ok(!text.includes('private-never-export'));assert.ok(!text.includes('secretRef'));
 const preview=await invoke(b.service,'api_import_preview',{text});assert.equal(preview.collectionCount,2);assert.equal(preview.requestCount,2);assert.equal(preview.environmentCount,1);assert.equal((await b.service.state()).collections.length,0);
 const imported=await invoke(b.service,'api_import',{text});assert.equal(imported.documents.length,4);
 const state=await b.service.state();assert.equal(state.collections.length,2);assert.equal(state.environments[0].data.values[0].value,'http://localhost');assert.equal(state.globals.data.values[0].value,'preserved');
 for(const c of state.collections){assert.deepEqual(c.data.event,event);assert.deepEqual(c.data.item[0].event,event);assert.deepEqual(c.data.item[0].item[0].event,event);}
 await invoke(b.service,'api_import',{text});const again=await b.service.state();assert.equal(again.collections.length,4);assert.equal(new Set(again.collections.map(c=>c.data.info.name)).size,4);assert.equal(again.environments.length,2);assert.equal(again.globals.data.values.length,1);
});

test('invalid bundles never partially import and unsupported versions are rejected',async t=>{
 const {service}=await setup(t);await service.put({kind:'collection',revision:0,data:collection('existing')});
 const data=(await invoke(service,'api_workspace_export',{})).data;
 for(const patch of [{version:99},{collections:[collection('valid'),{info:{name:'bad'},item:[null]}]},{environments:[{name:'bad',values:'wrong'}]}]){
  await assert.rejects(invoke(service,'api_import',{text:JSON.stringify({...data,...patch})}),/IMPORT/);
  assert.equal((await service.state()).collections.length,1);
 }
});

test('batch import rolls back all database writes and created secrets on storage failure',async t=>{
 const {service,store,values}=await setup(t);await service.put({kind:'collection',revision:0,data:collection('source')});
 const bundle=(await invoke(service,'api_workspace_export',{})).data;bundle.environments=[{name:'secret',values:[{key:'token',type:'secret',value:''}]}];
 store.db.exec("CREATE TRIGGER reject_environment BEFORE INSERT ON documents WHEN NEW.kind='environment' BEGIN SELECT RAISE(ABORT,'forced failure'); END;");
 await assert.rejects(invoke(service,'api_import',{text:JSON.stringify(bundle)}),/forced failure/);
 assert.equal((await service.state()).collections.length,1);assert.equal((await service.state()).environments.length,0);assert.equal(values.size,0);
});

test('existing global values win conflicts and ordinary Postman imports keep their contract',async t=>{
 const {service}=await setup(t);await service.put({kind:'globals',revision:0,data:{values:[{key:'same',value:'local'}]}});
 await service.put({kind:'collection',revision:0,data:collection('one')});const bundle=(await invoke(service,'api_workspace_export',{})).data;bundle.globals={values:[{key:'same',value:'foreign'},{key:'new',value:'added'}]};
 const result=await invoke(service,'api_import',{text:JSON.stringify(bundle)});assert.ok(result.warnings.some(w=>w.includes('same')));
 const globals=(await service.state()).globals.data.values;assert.equal(globals.find(v=>v.key==='same').value,'local');assert.equal(globals.find(v=>v.key==='new').value,'added');
 assert.equal((await service.import({text:JSON.stringify(collection('legacy'))})).document.kind,'collection');
});

test('restored environment globals and inherited API scripts execute with real HTTP requests',async t=>{
 const http=await import('node:http');let hits=0;
 const server=http.createServer((req,res)=>{hits++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:req.url}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const source=await setup(t),target=await setup(t),data=collection('executable');
 data.event=[{listen:'prerequest',script:{exec:['pm.variables.set("inherited", "collection");']}}];
 data.item[0].event=[{listen:'prerequest',script:{exec:['pm.variables.set("folder", "folder");']}}];
 data.item[0].item[0].event=[{listen:'prerequest',script:{exec:['pm.environment.set("fromScript", "yes");']}},{listen:'test',script:{exec:['pm.test("restored scripts and scopes",()=>pm.expect(pm.response.json().url).to.equal("/check?global=shared&before=yes&scope=collection&folder=folder"));']}}];
 data.item[0].item[0].request.url='{{host}}/check?global={{shared}}&before={{fromScript}}&scope={{inherited}}&folder={{folder}}';
 await source.service.put({kind:'collection',revision:0,data});await source.service.put({kind:'environment',revision:0,data:{name:'restored-env',values:[{key:'host',value:'http://127.0.0.1:'+server.address().port}]}});await source.service.put({kind:'globals',revision:0,data:{values:[{key:'shared',value:'shared'}]}});
 const bundle=await invoke(source.service,'api_workspace_export',{});await invoke(target.service,'api_import',{text:JSON.stringify(bundle.data)});assert.equal(hits,0);
 const state=await target.service.state(),run=await target.service.start({collectionId:state.collections[0].id,environmentId:state.environments[0].id});
 await target.service.active.get(run.runId).completion;const result=await target.service.result({runId:run.runId,includeBodies:true});
 assert.equal(hits,1);assert.equal(result.status,'completed');assert.equal(result.errors.length,0);assert.equal(result.assertions.length,1);assert.equal(result.assertions[0].error,undefined);
 assert.equal((await target.service.state()).environments[0].data.values.find(v=>v.key==='fromScript').value,'yes');
});

test('workspace roundtrip preserves request IDs used by setNextRequest scripts',async t=>{
 const http=await import('node:http'),server=http.createServer((req,res)=>res.end('{}'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const source=await setup(t),target=await setup(t),url='http://127.0.0.1:'+server.address().port;
 await source.service.put({kind:'collection',revision:0,data:{info:{name:'id-flow'},item:[{id:'first-id',name:'first',event:[{listen:'test',script:{exec:['pm.execution.setNextRequest("target-id");']}}],request:{url}},{id:'skip-id',name:'skip',request:{url}},{id:'target-id',name:'target',request:{url}}]}});
 const data=(await invoke(source.service,'api_workspace_export',{})).data;await invoke(target.service,'api_import',{text:JSON.stringify(data)});const collection=(await target.service.state()).collections[0];
 const run=await target.service.start({collectionId:collection.id});await target.service.active.get(run.runId).completion;const result=await target.service.result({runId:run.runId});assert.deepEqual(result.responses.map(r=>r.name),['first','target']);
});

test('exported backups obey the same collection count limit as import',async t=>{
 const {service,store}=await setup(t);
 await store.putMany(Array.from({length:1001},(_,index)=>({kind:'collection',id:String(index),data:{info:{name:'c'+index},item:[]},expectedRevision:0})));
 await assert.rejects(invoke(service,'api_workspace_export',{}),/IMPORT|EXPORT/);
});

test('failed asynchronous secret preparation waits for delayed writes before cleanup',async t=>{
 const {store,values,secrets}=await setup(t);const write=secrets.set;let calls=0;
 secrets.set=async(k,v)=>{calls++;if(calls===1)throw new Error('keychain locked');await new Promise(r=>setTimeout(r,20));await write(k,v);};
 await assert.rejects(store.putMany([{kind:'environment',id:'env',expectedRevision:0,data:{values:[{key:'one',type:'secret',value:'one'},{key:'two',type:'secret',value:'two'}]}}]),/keychain locked/);
 assert.equal(values.size,0);assert.equal(await store.get('environment','env'),null);
});

test('batch commit rejects a writer that changes revisions while secrets are prepared',async t=>{
 const {store,secrets}=await setup(t);await store.put('environment','env',{values:[]},0);const write=secrets.set;let changed=false;
 secrets.set=async(k,v)=>{if(!changed){changed=true;await store.put('environment','env',{name:'concurrent',values:[]},1);}await write(k,v);};
 await assert.rejects(store.putMany([{kind:'collection',id:'new',expectedRevision:0,data:collection('new')},{kind:'environment',id:'env',expectedRevision:1,data:{values:[{key:'token',type:'secret',value:'draft'}]}}]),/CONFLICT/);
 assert.equal(await store.get('collection','new'),null);assert.equal((await store.get('environment','env')).data.name,'concurrent');
});

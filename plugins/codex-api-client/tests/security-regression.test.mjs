import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {redact,MASK} from '../src/secrets.mjs';
import {Store} from '../src/store.mjs';
import {ApiService} from '../src/service.mjs';
const memory=()=>{const m=new Map();return{async set(k,v){m.set(k,v);},async get(k){return m.get(k);},async delete(k){m.delete(k);}};};
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'api-security-'));const store=new Store(dir,memory()),service=new ApiService(store);t.after(async()=>{await service.close();store.close();await rm(dir,{recursive:true,force:true});});return{dir,store,service};}
test('redaction preserves property names, numbers and escaped strings',()=>{
  assert.deepEqual(redact({id:'id',time:123,body:'quote"\n123'},['id','123','quote"\n']),{id:MASK,time:123,body:MASK+MASK});
});
test('a concurrent sensitivity change is preserved and prevents plaintext script persistence',async t=>{
  const {store,service}=await setup(t);
  const original=await store.put('environment','dev',{values:[{key:'token',type:'string',value:'v0'}]},0);
  await store.put('environment','dev',{values:[{key:'token',type:'secret',value:'v0'}]},1);
  const run={errors:[],variableChanges:[]},s=[];
  await service.persistScope('environment','dev',original,[{key:'token',type:'string',value:'new-token'}],run,s);
  assert.match(run.errors[0].message,/VARIABLE_CONFLICT/);
  assert.equal((await store.get('environment','dev')).data.values[0].type,'secret');
  assert.ok(s.includes('new-token'));assert.equal(store.row('environment','dev').data.includes('new-token'),false);
});
test('Basic credentials and session cookies are protected in history, SQLite and replay',async t=>{
  const {store,service,dir}=await setup(t),password='secret-password-123',basic=Buffer.from('alice:'+password).toString('base64');
  const server=http.createServer((req,res)=>{res.setHeader('Set-Cookie','token='+password+'; Path=/');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({authorization:req.headers.authorization,cookie:req.headers.cookie}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  await service.put({kind:'environment',id:'dev',data:{values:[{key:'password',type:'secret',value:password}]}});
  const doc=await service.put({kind:'collection',data:{info:{name:'Secure'},item:[{name:'Auth',request:{url:'http://127.0.0.1:'+server.address().port,auth:{type:'basic',basic:[{key:'username',value:'alice'},{key:'password',value:'{{password}}'}]}}}]}});
  for(let n=0;n<2;n++){
    const {runId}=await service.start({collectionId:doc.id,environmentId:'dev'});
    let result;for(let i=0;i<200;i++){result=await service.result({runId,includeBodies:true});if(result.status!=='running')break;await new Promise(r=>setTimeout(r,30));}
    assert.equal(result.status,'completed',JSON.stringify(result.errors));
    assert.equal(JSON.stringify(result).includes(password),false);assert.equal(JSON.stringify(result).includes(basic),false);
    assert.equal(Buffer.from(result.responses[0].bodyBase64,'base64').toString().includes(basic),false);
  }
  assert.equal(store.row('cookies','default').data.includes(password),false);
  assert.equal((await store.get('cookies','default',{reveal:true})).data.cookies[0].value,password);
  assert.equal((await readFile(join(dir,'workspace.sqlite-wal'))).includes(Buffer.from(password)),false);
  assert.equal((await readFile(join(dir,'workspace.sqlite-wal'))).includes(Buffer.from(basic)),false);
});
test('collection script final scope persists set unset and secrets into the next Send',async t=>{
 const {store,service}=await setup(t),seen=[];
 const server=http.createServer((req,res)=>{seen.push(req.url);res.end('ok');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const doc=await service.put({kind:'collection',data:{info:{name:'scope'},variable:[{key:'count',value:'0'},{key:'removed',value:'old'},{key:'token',value:'initial-secret',type:'secret'}],item:[{id:'write',request:{url:`http://127.0.0.1:${server.address().port}/write`},event:[{listen:'test',script:{exec:['pm.collectionVariables.set("count","1");pm.collectionVariables.set("count","2");pm.collectionVariables.unset("count");pm.collectionVariables.set("count","3");pm.collectionVariables.unset("removed");pm.collectionVariables.set("token","final-secret");']}}]},{id:'read',request:{url:`http://127.0.0.1:${server.address().port}/{{count}}/{{token}}`}}]}});
 for(const itemId of ['write','read']){const {runId}=await service.start({collectionId:doc.id,itemId,singleRequest:true});let run;for(let i=0;i<300;i++){run=await service.result({runId,includeBodies:true});if(run.status!=='running')break;await new Promise(r=>setTimeout(r,20));}assert.equal(run.status,'completed',JSON.stringify(run.errors));assert.ok(!JSON.stringify(run).includes('final-secret'));}
 assert.deepEqual(seen,['/write','/3/final-secret']);const values=(await store.get('collection',doc.id,{reveal:true})).data.variable;assert.equal(values.find(v=>v.key==='count').value,'3');assert.ok(!values.some(v=>v.key==='removed'));assert.equal(values.find(v=>v.key==='token').type,'secret');
});

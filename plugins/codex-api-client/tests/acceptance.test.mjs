import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { ApiService } from '../src/service.mjs';
import { executeCollection } from '../src/execution.mjs';
const secrets=()=>{const map=new Map();return{async get(k){return map.get(k);},async set(k,v){map.set(k,v);},async delete(k){map.delete(k);}};};
async function finished(service,id){for(let i=0;i<200;i++){const r=await service.result({runId:id,includeBodies:true});if(r.status!=='running')return r;await new Promise(r=>setTimeout(r,30));}throw new Error('run did not complete');}
test('import login flow, persist token and cookies, redact secrets, reopen and replay through service',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'api-accept-')),keychain=secrets();
  let store=new Store(dir,keychain),service=new ApiService(store);
  const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/login'){res.setHeader('Set-Cookie','sid=abc; Path=/');res.end('{"token":"new-private-token"}');}else res.end(JSON.stringify({auth:req.headers.authorization,cookie:req.headers.cookie}));});
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${fixture.address().port}`;
  t.after(async()=>{fixture.closeAllConnections();fixture.close();await service.close();store.close();await rm(dir,{recursive:true,force:true});});
  const environment=await service.put({kind:'environment',id:'dev',revision:0,data:{name:'Dev',values:[{key:'token',type:'secret',value:'old-private-token'}]}});
  const c=await service.import({text:JSON.stringify({info:{name:'Acceptance'},item:[{id:'login',name:'Login',request:{method:'POST',url:url+'/login'},event:[{listen:'test',script:{exec:['pm.environment.set("token",pm.response.json().token);']}}]},{id:'profile',name:'Profile',request:{method:'GET',url:url+'/profile',auth:{type:'bearer',bearer:[{key:'token',value:'{{token}}'}]}},event:[{listen:'test',script:{exec:['console.log(pm.environment.get("token")); pm.test("login chain",()=>{pm.expect(pm.response.json().auth).to.eql("Bearer "+pm.environment.get("token"));pm.expect(pm.response.json().cookie).to.include("sid=abc");});']}}]}]})});
  const run=await service.start({collectionId:c.document.id,environmentId:environment.id});
  const result=await finished(service,run.runId);
  assert.equal(result.status,'completed',JSON.stringify(result.errors));assert.equal(result.assertions.length,1);assert.equal(result.assertions[0].error,undefined);
  assert.equal(JSON.stringify(result).includes('new-private-token'),false);
  assert.equal(JSON.stringify(result).includes('old-private-token'),false);
  assert.equal(Buffer.from(result.responses[0].bodyBase64,'base64').toString().includes('new-private-token'),false);
  assert.equal((await store.get('environment','dev',{reveal:true})).data.values[0].value,'new-private-token');
  const wal=await readFile(join(dir,'workspace.sqlite-wal'));const index=wal.indexOf(Buffer.from('new-private-token'));
  assert.equal(index,-1,'new secret must not remain in SQLite WAL: '+(index>=0?wal.subarray(Math.max(0,index-150),index+150).toString():''));
  await service.close();store.close();store=new Store(dir,keychain);service=new ApiService(store);
  assert.equal((await service.state()).collections.length,1);
  const replay=await service.start({collectionId:c.document.id,itemId:'profile',environmentId:'dev'});
  const replayResult=await finished(service,replay.runId);assert.equal(replayResult.status,'completed');assert.equal(replayResult.assertions[0].error,undefined);
  const summary=await service.result({runId:replay.runId});assert.equal('body' in summary.responses[0],false);
});

test('TLS verification rejects self-signed servers and explicit custom CA trusts them',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'api-tls-')),key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
  const server=https.createServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>res.end('trusted'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();server.close();await rm(dir,{recursive:true,force:true});});
  const collection={info:{name:'TLS'},item:[{name:'TLS',request:{url:`https://localhost:${server.address().port}`,method:'GET'}}]};
  const denied=await executeCollection({collection});assert.ok(denied.errors.length);
  const accepted=await executeCollection({collection,options:{caFile:cert,allowedFiles:[cert]}});assert.equal(accepted.status,'completed',JSON.stringify(accepted.errors));assert.equal(accepted.responses[0].body,'trusted');
});

test('query, repeated headers, JSON/XML/urlencoded, Basic/API Key and redirects reach the server correctly',async t=>{
  const server=http.createServer(async(req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{Location:'/echo'});return res.end();}const b=[];for await(const c of req)b.push(c);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:req.url,headers:req.headers,body:Buffer.concat(b).toString()}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const url=`http://127.0.0.1:${server.address().port}`;
  const cases=[
    {url:url+'/echo?x=1&x=2',header:[{key:'X-Tag',value:'one'},{key:'X-Tag',value:'two'}],auth:{type:'basic',basic:[{key:'username',value:'user'},{key:'password',value:'pass'}]},body:{mode:'raw',raw:'{"hello":1}',options:{raw:{language:'json'}}}},
    {url:url+'/echo',auth:{type:'apikey',apikey:[{key:'key',value:'api_key'},{key:'value',value:'abc'},{key:'in',value:'query'}]},body:{mode:'raw',raw:'<hello/>',options:{raw:{language:'xml'}}}},
    {url:url+'/echo',body:{mode:'urlencoded',urlencoded:[{key:'x',value:'a b'}]}},
    {url:url+'/redirect',method:'GET'}
  ];
  const result=await executeCollection({collection:{info:{name:'HTTP'},item:cases.map((r,i)=>({name:String(i),request:{method:'POST',...r}}))}});
  assert.equal(result.status,'completed');const values=result.responses.map(r=>JSON.parse(r.body));
  assert.equal(values[0].url,'/echo?x=1&x=2');assert.equal(values[0].headers.authorization,'Basic dXNlcjpwYXNz');assert.equal(values[0].headers['x-tag'],'one, two');assert.match(values[0].headers['content-type'],/application\/json/);
  assert.equal(values[1].url,'/echo?api_key=abc');assert.equal(values[1].body,'<hello/>');assert.equal(new URLSearchParams(values[2].body).get('x'),'a b');assert.equal(values[3].url,'/echo');
});

test('client certificate authenticates an mTLS server and HTTP proxy receives requests',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'api-mtls-')),key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
  const bytes=await readFile(cert),server=https.createServer({key:await readFile(key),cert:bytes,ca:bytes,requestCert:true,rejectUnauthorized:true},(req,res)=>res.end(req.socket.authorized?'client accepted':'denied'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const collection={info:{name:'mTLS'},item:[{name:'cert',request:{url:`https://localhost:${server.address().port}`,method:'GET'}}]};
  const result=await executeCollection({collection,options:{caFile:cert,allowedFiles:[cert,key],certificates:[{name:'local',matches:[`https://localhost:${server.address().port}/*`],key:{src:key},cert:{src:cert}}]}});
  assert.equal(result.status,'completed',JSON.stringify(result.errors));assert.equal(result.responses[0].body,'client accepted');
  const scoped=structuredClone(collection);scoped.item[0].id='scoped';scoped.item[0]['x-codex-api-client']={network:{caFile:cert,certificates:[{matches:[`https://localhost:${server.address().port}/*`],key:{src:key},cert:{src:cert}}]}};
  scoped.item.push({id:'no-cert',name:'no-cert',request:{url:`https://localhost:${server.address().port}`,method:'GET'}});
  const mixed=await executeCollection({collection:scoped,options:{allowedFiles:[cert,key]}});assert.deepEqual(mixed.responses.map(r=>r.itemId),['scoped']);assert.ok(mixed.errors.some(e=>e.itemId==='no-cert'));

  const proxy=http.createServer((req,res)=>res.end('proxied '+req.url));
  // Runtime uses CONNECT tunnels for explicit proxies, including HTTP requests.
  const net=await import('node:net');
  proxy.on('connect',(req,client,head)=>{const [host,port]=req.url.split(':');const remote=net.connect(Number(port),host,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(client);client.pipe(remote);});remote.on('error',()=>client.destroy());client.on('error',()=>remote.destroy());});
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  const target=http.createServer((req,res)=>res.end('through proxy'));await new Promise(r=>target.listen(0,'127.0.0.1',r));
  let connects=0;proxy.on('connect',()=>connects++);
  t.after(async()=>{for(const s of [server,proxy,target]){s.closeAllConnections();s.close();}await rm(dir,{recursive:true,force:true});});
  const proxied=await executeCollection({collection:{info:{name:'proxy'},item:[{name:'proxy',request:{url:`http://127.0.0.1:${target.address().port}`,method:'GET'}}]},options:{proxy:`http://127.0.0.1:${proxy.address().port}`}});
  assert.equal(proxied.status,'completed',JSON.stringify(proxied.errors));assert.equal(proxied.responses[0].body,'through proxy');assert.equal(connects,1);
});

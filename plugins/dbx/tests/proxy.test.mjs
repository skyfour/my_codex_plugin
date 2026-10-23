import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {test} from 'node:test';
import {createWebProxy} from '../src/proxy.mjs';

function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
async function upstream(t,handler,upgrade){
  const server=http.createServer(handler),sockets=new Set();
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  if(upgrade)server.on('upgrade',upgrade);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
  return {server,origin:`http://127.0.0.1:${server.address().port}`};
}
async function proxy(t,origin,options={}){const value=await createWebProxy({upstream:origin,...options});t.after(()=>value.close());return value;}
function request(origin,path,{headers={},method='GET',body}={}){
  const target=new URL(origin);
  return new Promise((resolve,reject)=>{
    const req=http.request({host:target.hostname,port:target.port,path,method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.once('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));res.once('error',reject);
    });req.once('error',reject);req.end(body);
  });
}
const route=(value,path='')=>new URL(value.url).pathname+path.replace(/^\//,'');

test('HTTP login cookies stay in the private proxy jar and caller credentials never reach upstream',{timeout:5000},async t=>{
  const seen=[];
  const remote=await upstream(t,(req,res)=>{
    seen.push({url:req.url,cookie:req.headers.cookie,authorization:req.headers.authorization,origin:req.headers.origin});
    if(req.url==='/login')res.setHeader('Set-Cookie',['session=private-db-cookie; HttpOnly; SameSite=Strict','csrf=private-csrf; HttpOnly']);
    if(req.url==='/logout')res.setHeader('Set-Cookie',['session=; Max-Age=0','csrf=; Max-Age=0']);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));
  });
  const local=await proxy(t,remote.origin);
  const login=await request(local.origin,route(local,'login'));
  assert.equal(login.status,200);assert.equal(login.headers['set-cookie'],undefined);
  const response=await request(local.origin,route(local,'api'),{headers:{Cookie:'session=attacker',Authorization:'Bearer browser-token',Origin:local.origin}});
  assert.equal(response.status,200);
  assert.equal(seen[1].cookie,'session=private-db-cookie; csrf=private-csrf');
  assert.equal(seen[1].authorization,undefined);assert.equal(seen[1].origin,undefined);
  assert.ok(!JSON.stringify(response).includes('private-db-cookie'));
  await request(local.origin,route(local,'logout'));
  await request(local.origin,route(local,'api'));
  assert.equal(seen.at(-1).cookie,undefined);
});

test('capability tokens and cookie jars are isolated per proxy instance',{timeout:5000},async t=>{
  const seen=[];
  const remote=await upstream(t,(req,res)=>{seen.push(req.headers.cookie);if(req.url==='/login')res.setHeader('Set-Cookie','session=instance-one; HttpOnly');res.end('ok');});
  const one=await proxy(t,remote.origin),two=await proxy(t,remote.origin);
  assert.notEqual(one.url,two.url);
  await request(one.origin,route(one,'login'));
  assert.equal((await request(one.origin,route(two,'api'))).status,404);
  await request(two.origin,route(two,'api'));
  assert.equal(seen.at(-1),undefined);
  await request(one.origin,route(one,'api'));
  assert.equal(seen.at(-1),'session=instance-one');
});

test('raw proxy paths reject network-path URLs, traversal, encoded separators, wrong Host and foreign Origin',{timeout:5000},async t=>{
  let externalHits=0,upstreamHits=0;
  const external=await upstream(t,(_req,res)=>{externalHits++;res.end('SSRF reached');});
  const remote=await upstream(t,(_req,res)=>{upstreamHits++;res.end('upstream reached');});
  const local=await proxy(t,remote.origin),prefix=new URL(local.url).pathname;
  const authority=new URL(external.origin).host;
  for(const suffix of [`/${authority}/probe`,`\\${authority}/probe`,'../secret','api/../secret','%2e%2e/secret','api%2fsecret','api%5csecret','api\\secret']){
    const result=await request(local.origin,prefix+suffix);
    assert.equal(result.status,404,`untrusted raw path: ${suffix}`);
  }
  assert.equal((await request(local.origin,'/api')).status,404);
  assert.equal((await request(local.origin,route(local,'api'),{headers:{Host:'attacker.invalid'}})).status,404);
  assert.equal((await request(local.origin,route(local,'api'),{headers:{Origin:'http://attacker.invalid'}})).status,404);
  assert.equal(externalHits,0);assert.equal(upstreamHits,0);
  const allowed=await request(local.origin,route(local,'api?source=https%3A%2F%2Fexample.invalid'),{headers:{Origin:'null'}});
  assert.equal(allowed.status,200);assert.equal(upstreamHits,1);
});

test('HTML, root assets, CSS and local redirects remain inside the capability namespace',{timeout:5000},async t=>{
  const remote=await upstream(t,(req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{Location:'/login?from=workbench'}).end();return;}
    if(req.url==='/external'){res.writeHead(302,{Location:'https://unexpected.invalid/login'}).end();return;}
    if(req.url==='/assets/app.css'){res.setHeader('Content-Type','text/css');res.end('a { background: url("/db-icons/mysql.svg") }');return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");res.setHeader('ETag','original-body');
    res.end('<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css"></head><body><img src="/db-icons/mysql.svg"><script src="/assets/app.js"></script><a href="https://docs.example.invalid">Docs</a></body></html>');
  });
  const local=await proxy(t,remote.origin),prefix=new URL(local.url).pathname;
  const result=await request(local.origin,prefix);
  assert.equal(result.status,200);
  assert.ok(result.body.includes(`<base href="${prefix}">`));
  for(const resource of ['_codex/compat.js','assets/app.css','db-icons/mysql.svg','assets/app.js'])assert.ok(result.body.includes(prefix+resource),resource);
  assert.ok(result.body.includes('https://docs.example.invalid'));
  assert.ok(!result.body.includes(prefix+prefix.slice(1)),'HTML asset prefixes must be applied exactly once');
  assert.equal(result.headers['x-frame-options'],undefined);assert.equal(result.headers['content-security-policy'],undefined);assert.equal(result.headers.etag,undefined);
  assert.equal(result.headers['cache-control'],'no-store');assert.equal(result.headers['referrer-policy'],'no-referrer');
  const css=await request(local.origin,route(local,'assets/app.css'));assert.ok(css.body.includes(`${prefix}db-icons/mysql.svg`));
  const redirected=await request(local.origin,route(local,'redirect'));assert.equal(redirected.headers.location,prefix+'login?from=workbench');
  const external=await request(local.origin,route(local,'external'));assert.equal(external.status,502);assert.equal(external.headers.location,undefined);
  const compat=await request(local.origin,route(local,'_codex/compat.js'));assert.equal(compat.status,200);assert.match(compat.headers['content-type'],/javascript/);assert.ok(compat.body.includes(JSON.stringify(prefix)));assert.match(compat.body,/window\.fetch/);
});

test('served official JavaScript uses parsed dialog adaptation and unknown synchronous contracts fail closed',{timeout:5000},async t=>{
  const remote=await upstream(t,(req,res)=>{res.setHeader('Content-Type','text/javascript');res.end(req.url==='/assets/unknown.js'?'export function remove(){return window.confirm("unknown synchronous result")}':'export async function remove(){if(window.confirm("Delete?"))return "/assets/ok.svg";return "no"}');});
  const local=await proxy(t,remote.origin,{getVersion:()=> '0.6.52'}),prefix=new URL(local.url).pathname;
  const result=await request(local.origin,route(local,'assets/app.js'));
  assert.equal(result.status,200);assert.match(result.body,/await globalThis\.__dbxCompat\.confirm/);assert.ok(result.body.includes(prefix+'assets/ok.svg'));
  const blocked=await request(local.origin,route(local,'assets/unknown.js'));
  assert.equal(blocked.status,503);assert.match(blocked.body,/compatibility/);assert.ok(!blocked.body.includes('return window.confirm'));
});

test('SSE events stream before upstream closes and preserve event framing',{timeout:5000},async t=>{
  const finish=deferred(),first=deferred();
  const remote=await upstream(t,async(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write('event: result\ndata: one\n\n');await finish.promise;res.end('data: two\n\n');});
  const local=await proxy(t,remote.origin),target=new URL(local.origin),chunks=[];
  const completed=new Promise((resolve,reject)=>{
    const req=http.get({host:target.hostname,port:target.port,path:route(local,'events')},res=>{
      assert.match(res.headers['content-type'],/event-stream/);
      res.on('data',chunk=>{chunks.push(chunk.toString());first.resolve();});res.once('end',resolve);res.once('error',reject);
    });req.once('error',reject);t.after(()=>req.destroy());
  });
  try{await Promise.race([first.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('SSE buffered until end')),1500).unref())]);assert.equal(chunks.join(''),'event: result\ndata: one\n\n');}
  finally{finish.resolve();}
  await completed;assert.equal(chunks.join(''),'event: result\ndata: one\n\ndata: two\n\n');
});

for(const closing of ['downstream','proxy'])test(`${closing} close cancels the upstream SSE connection`,{timeout:5000},async t=>{
  const disconnected=deferred(),first=deferred();
  const remote=await upstream(t,(_req,res)=>{
    res.once('close',()=>disconnected.resolve(true));
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: pending\n\n');
  });
  const local=await proxy(t,remote.origin);
  const req=http.get(local.url+'events',res=>{
    res.on('error',()=>{});res.once('data',()=>first.resolve(res));res.resume();
  });req.on('error',()=>{});t.after(()=>req.destroy());
  const response=await first.promise;
  if(closing==='downstream')response.destroy();else await local.close();
  assert.equal(await Promise.race([disconnected.promise,new Promise(resolve=>setTimeout(()=>resolve(false),1000).unref())]),true,'upstream SSE must close with its consumer');
});

for(const closing of ['downstream','proxy'])test(`${closing} close cancels a pending upstream WebSocket upgrade`,{timeout:5000},async t=>{
  const connected=deferred(),disconnected=deferred();
  const remote=await upstream(t,(_req,res)=>res.end(),(_req,socket)=>{
    socket.once('end',()=>socket.end());socket.once('close',()=>disconnected.resolve(true));connected.resolve();
  });
  const local=await proxy(t,remote.origin);
  const req=http.request(local.url+'terminal',{headers:{Connection:'Upgrade',Upgrade:'websocket'}});
  req.on('error',()=>{});req.end();t.after(()=>req.destroy());
  await connected.promise;
  if(closing==='downstream')req.destroy();else await local.close();
  assert.equal(await Promise.race([disconnected.promise,new Promise(resolve=>setTimeout(()=>resolve(false),1000).unref())]),true,'an abandoned upgrade must close its upstream connection');
});

test('official webPath wrapping an already scoped database icon stays in the same namespace',async t=>{
  const seen=[];const remote=await upstream(t,(req,res)=>{seen.push(req.url);res.setHeader('Content-Type','image/svg+xml');res.end('<svg/>');});
  const local=await proxy(t,remote.origin),prefix=new URL(local.url).pathname;
  const result=await request(local.origin,prefix+prefix.slice(1)+'icons/database/sqlite.svg');
  assert.equal(result.status,200);assert.deepEqual(seen,['/icons/database/sqlite.svg']);assert.equal(result.body,'<svg/>');
});

test('WebSocket upgrade keeps private cookies server-side and tunnels both directions',{timeout:5000},async t=>{
  const received=deferred();let headers;
  const incoming=Buffer.from([0x81,0x82,1,2,3,4,0x6e,0x69]); // masked client text "ok"
  const outgoing=Buffer.from([0x81,2,0x68,0x69]); // server text "hi"
  const remote=await upstream(t,(_req,res)=>{res.setHeader('Set-Cookie','session=ws-private; HttpOnly');res.end('logged in');},(req,socket,head)=>{
    headers=req.headers;
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSet-Cookie: handshake-private=secret; HttpOnly\r\n\r\n');
    socket.write(outgoing);
    if(head.length)received.resolve(head);else socket.once('data',value=>received.resolve(value));
  });
  const local=await proxy(t,remote.origin);await request(local.origin,route(local,'login'));
  const target=new URL(local.origin);
  let req,socket;
  const upgrade=await new Promise((resolve,reject)=>{
    req=http.request({host:target.hostname,port:target.port,path:route(local,'terminal'),headers:{Connection:'Upgrade',Upgrade:'websocket',Cookie:'session=attacker',Authorization:'Bearer browser',Origin:local.origin}});
    req.once('upgrade',(response,connection,head)=>{socket=connection;resolve({response,head});});req.once('error',reject);req.end();
  });
  t.after(()=>{socket?.destroy();req?.destroy();});
  assert.equal(upgrade.response.statusCode,101);
  assert.equal(upgrade.response.headers['set-cookie'],undefined,'upstream HttpOnly cookies must never enter the host browser');
  assert.equal(headers.cookie,'session=ws-private');assert.equal(headers.authorization,undefined);
  const bytes=upgrade.head.length?upgrade.head:await new Promise((resolve,reject)=>{socket.once('data',resolve);socket.once('error',reject);});
  assert.deepEqual(bytes,outgoing);
  socket.write(incoming);assert.deepEqual(await received.promise,incoming);
});

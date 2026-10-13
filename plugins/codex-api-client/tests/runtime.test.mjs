import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { executeCollection } = await import('../src/execution.mjs').catch(() => ({}));
const script = (listen, code) => ({ listen, script: { type: 'text/javascript', exec: code.split('\n') } });
const item = (id, url, extra = {}) => ({ id, name: id, request: { method: 'GET', url }, ...extra });
async function fixture(t) {
  const hits = [];
  const server = http.createServer(async (req, res) => {
    hits.push(req.url);
    const parts = []; for await (const c of req) parts.push(c);
    if (req.url === '/slow') await new Promise(r => setTimeout(r, 2000));
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/echo' }); return res.end(); }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/login') { res.setHeader('Set-Cookie', 'session=abc; Path=/'); return res.end(JSON.stringify({ token: 'TOKEN-local-123' })); }
    res.end(JSON.stringify({ url: req.url, headers: req.headers, body: Buffer.concat(parts).toString() }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}`, hits };
}
test('login scripts set token, inherit scripts and auth, persist cookies and capture assertions', async t => {
  assert.equal(typeof executeCollection, 'function');
  const {url} = await fixture(t);
  const collection = { info: { name: 'Flow' }, event: [script('prerequest', 'console.log("collection"); pm.variables.set("order", "C");')], item: [
    item('login', url+'/login', { event: [script('test', 'pm.environment.set("token", pm.response.json().token); pm.test("login",()=>pm.response.to.have.status(200));')] }),
    { id:'folder', name:'Folder', auth:{ type:'bearer', bearer:[{key:'token', value:'{{token}}'}] }, event:[script('prerequest','pm.variables.set("order",pm.variables.get("order")+"F");')], item:[
      item('profile', url+'/echo', { event:[script('prerequest','pm.request.headers.add({key:"X-Order",value:pm.variables.get("order")+"R"});'),script('test','const r=pm.response.json(); pm.test("auth",()=>pm.expect(r.headers.authorization).to.eql("Bearer TOKEN-local-123")); pm.test("cookie",()=>pm.expect(r.headers.cookie).to.include("session=abc")); pm.test("order",()=>pm.expect(r.headers["x-order"]).to.eql("CFR"));')] })
    ] }
  ] };
  const result = await executeCollection({ collection, environment:{ values:[] } });
  assert.equal(result.status, 'completed', JSON.stringify(result.errors));
  assert.equal(result.responses.length, 2);
  assert.equal(result.assertions.length, 4);
  assert.equal(result.assertions.filter(a=>a.error).length, 0);
  assert.equal(result.environment.values.find(v=>v.key==='token').value, 'TOKEN-local-123');
  assert.ok(result.cookies.cookies.some(c=>c.key==='session'));
  assert.ok(result.logs.length);
});
test('runtime applies Postman variable precedence and sendRequest, jump and stopOnFailure', async t => {
  assert.equal(typeof executeCollection, 'function');
  const {url,hits} = await fixture(t);
  const collection = { info:{name:'Data'}, variable:[{key:'x',value:'collection'}], item:[
    item('first', url+'/echo?x={{x}}', { event:[script('prerequest', `pm.sendRequest('${url}/extra', (e,r)=>{pm.test('extra',()=>pm.expect(r.code).to.eql(200));});`), script('test','pm.test("data",()=>pm.expect(pm.response.json().url).to.eql("/echo?x=data")); pm.execution.setNextRequest("last");')] }),
    item('skip',url+'/skip'), item('last',url+'/last',{event:[script('test','pm.test("fails",()=>pm.expect(1).to.eql(2));')]}), item('after',url+'/after')
  ]};
  const result=await executeCollection({collection,environment:{values:[{key:'x',value:'environment'}]},globals:{values:[{key:'x',value:'global'}]},data:[{x:'data'}],options:{stopOnFailure:true}});
  assert.equal(result.assertions.filter(a=>a.error).length,1);assert.equal(result.status,'failed');
  assert.ok(hits.includes('/extra')); assert.equal(hits.includes('/skip'),false); assert.equal(hits.includes('/after'),false);
});
test('script timeout, script errors and request timeout terminate with actionable errors', async t => {
  assert.equal(typeof executeCollection, 'function');
  const {url}=await fixture(t);
  for (const [scriptText, target, options] of [['while(true){}', '/echo',{scriptTimeout:100}], ['throw new Error("bad-script")','/echo',{}], ['', '/slow',{requestTimeout:100}]]) {
    const result=await executeCollection({collection:{info:{name:'Errors'},item:[item('error',url+target,{event:[script('prerequest',scriptText)]})]},options});
    assert.ok(result.errors.length,JSON.stringify(result));
  }
});
test('cancel interrupts in-flight request and no further requests execute', async t => {
  assert.equal(typeof executeCollection, 'function');
  const {url,hits}=await fixture(t), controller=new AbortController();
  const pending=executeCollection({collection:{info:{name:'Cancel'},item:[item('slow',url+'/slow'),item('after',url+'/after')]}},{signal:controller.signal});
  setTimeout(()=>controller.abort(),300);
  const result=await pending; assert.equal(result.status,'cancelled'); assert.equal(hits.includes('/after'),false);
});
test('multipart and binary uploads read only explicitly allowed files', async t => {
  assert.equal(typeof executeCollection, 'function');
  const {url}=await fixture(t), dir=await mkdtemp(join(tmpdir(),'api-upload-')), path=join(dir,'sample.txt');
  t.after(()=>rm(dir,{recursive:true,force:true})); await writeFile(path,'upload-me');
  const collection={info:{name:'Files'},item:[item('file',url+'/echo')]};
  collection.item[0].request={method:'POST',url:url+'/echo',body:{mode:'file',file:{src:path}}};
  const denied=await executeCollection({collection}); assert.ok(denied.errors.length);
  const result=await executeCollection({collection,options:{allowedFiles:[path]}});
  assert.equal(JSON.parse(result.responses[0].body).body,'upload-me');
  collection.item[0].request.body={mode:'formdata',formdata:[{key:'file',type:'file',src:path},{key:'name',value:'Alice',type:'text'}]};
  const form=await executeCollection({collection,options:{allowedFiles:[path]}});
  assert.match(JSON.parse(form.responses[0].body).body,/upload-me/);
});

test('nested folder variables inherit, override and do not leak into sibling requests',async t=>{
  const {url}=await fixture(t);
  const responseScript=expected=>[script('test',`pm.test('folder scope',()=>pm.expect(pm.response.json().url).to.eql('${expected}'));`)];
  const collection={info:{name:'Folders'},variable:[{key:'scope',value:'collection'}],item:[
    {id:'f',name:'Outer',variable:[{key:'scope',value:'outer'}],item:[item('outer',url+'/echo?scope={{scope}}',{event:responseScript('/echo?scope=outer')}),{id:'nested',name:'Inner',variable:[{key:'scope',value:'inner'}],item:[item('inner',url+'/echo?scope={{scope}}',{event:[...responseScript('/echo?scope=inner'),script('test','pm.environment.set("scope","changed-environment");')]})]}]},
    item('sibling',url+'/echo?scope={{scope}}',{event:responseScript('/echo?scope=changed-environment')})]};
  const result=await executeCollection({collection,environment:{values:[{key:'scope',value:'environment'}]}});
  assert.equal(result.status,'completed',JSON.stringify(result.errors));assert.equal(result.assertions.length,3);assert.equal(result.assertions.some(a=>a.error),false,JSON.stringify(result.assertions));
  assert.equal(result.collectionVariables.find(v=>v.key==='scope').value,'collection');
});

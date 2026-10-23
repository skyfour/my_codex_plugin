import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDbxServer} from '../plugins/dbx/servers/server.mjs';
import {createPreview} from '../plugins/dbx/src/preview.mjs';
import {auditSession} from './ui-audit-helpers.mjs';

// Fixture-only browser integration. The runtime and DBX HTTP application below
// are synthetic; the plugin shell, stdio handlers' actions, proxy, compatibility
// rewrite, bridge and export writer are the actual source under test.
// No Docker executable, official image, user database or OS clipboard is used.
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url));
const {chromium}=require('playwright');
const directory=process.env.UI_AUDIT_DIR||'/tmp/codex-plugin-ui-audit';
await mkdir(directory,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'dbx-browser-fixture-'));
const home=join(temporary,'runtime'),copies=[],calls={ensure:0,update:0,latest:0,remove:0,setup:0,login:0,logout:0,workbench:0};
const runtimeState={phase:'absent',currentVersion:null};
let version='0.6.52',updateRelease=null,setup=false,load=0;
const expectedBytes=Buffer.from(Array.from({length:150123},(_,index)=>index*37%256));
const appScript=`
document.documentElement.dataset.fixtureScriptReady='yes';
const status=document.getElementById('result');
const setup=document.getElementById('setup');
if(setup)setup.addEventListener('submit',async event=>{event.preventDefault();const response=await fetch(setup.dataset.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value})});if(!response.ok)throw Error('Setup failed');location.reload();});
const logout=document.getElementById('logout');
if(logout)logout.addEventListener('click',async()=>{await fetch('/api/auth/logout',{method:'POST'});location.reload();});
const danger=document.getElementById('danger');
if(danger)danger.addEventListener('click',async()=>{if(!window.confirm('删除这个测试对象？')){status.textContent='已取消删除';return;}await fetch('/api/remove',{method:'POST'});status.textContent='已删除测试对象';});
const copy=document.getElementById('copy');
if(copy)copy.addEventListener('click',async()=>{await navigator.clipboard.writeText('fixture SELECT 1; 中文');status.textContent='复制完成';});
const download=document.getElementById('download');
if(download)download.addEventListener('click',()=>{const bytes=Uint8Array.from({length:150123},(_,i)=>i*37%256),anchor=document.createElement('a');anchor.href=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));anchor.download='fixture-export.bin';anchor.click();});
const external=document.getElementById('external');
if(external)external.addEventListener('click',()=>window.open('https://example.invalid/dbx-fixture-help','_blank'));
`;
const sockets=new Set();
const upstream=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/assets/app.js'){res.setHeader('Content-Type','text/javascript');res.end(appScript);return;}
  if(req.url==='/db-icons/mysql.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#4378db"/><path d="M6 7h16v14H6z" fill="white"/></svg>');return;}
  if(['/api/auth/setup','/api/auth/login'].includes(req.url)&&req.method==='POST'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString()).password,'Fixture-only-Password-123!');
    if(req.url.endsWith('/setup')){calls.setup++;setup=true;}else calls.login++;res.setHeader('Set-Cookie','dbx_session=fixture-private-cookie; HttpOnly; SameSite=Strict; Path=/');res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;
  }
  if(req.url==='/api/auth/logout'&&req.method==='POST'){calls.logout++;res.setHeader('Set-Cookie','dbx_session=; Max-Age=0; Path=/');res.end('ok');return;}
  if(req.url==='/api/remove'&&req.method==='POST'){calls.remove++;res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
  if(req.url==='/spoof'){
    res.setHeader('Content-Type','text/html');res.end(`<script>parent.postMessage({type:'dbx-compat',id:'forged-sibling',action:'clipboard-write',payload:{text:'forged clipboard'}},'*');document.documentElement.dataset.sent='yes';</script>`);return;
  }
  if(req.url!=='/'){res.writeHead(404).end('missing fixture route');return;}
  const authenticated=setup&&req.headers.cookie?.includes('dbx_session=fixture-private-cookie');
  if(authenticated)calls.workbench++;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>DBX HTTP Fixture</title><style>body{font:15px system-ui;margin:0;padding:30px;background:#17202c;color:#e4eaf5}h1{font-size:23px}button,input{font:inherit;padding:9px 13px;margin:6px;border:1px solid #78859a;border-radius:5px}button{cursor:pointer}section{padding:18px;border:1px solid #394558}#result{min-height:24px}</style></head><body data-load="${++load}" data-version="${version}">${authenticated?`<h1>Fixture DBX v${version}</h1><section id="workspace"><img id="database-icon" alt="MySQL" src="/db-icons/mysql.svg"><p>官方工作台 HTTP fixture · 连接 / SQL / 结果区域</p><button id="danger">删除测试对象</button><button id="copy">复制 SQL</button><button id="download">导出测试文件</button><button id="external">帮助链接</button><button id="logout">退出测试登录</button><p id="result" role="status"></p></section>`:`<h1>${setup?'登录 DBX':'设置 DBX 密码'}</h1><form id="setup" data-endpoint="/api/auth/${setup?'login':'setup'}"><label for="password">${setup?'登录密码':'新密码'}</label><input id="password" type="password" autocomplete="new-password" required><button type="submit">${setup?'登录工作台':'设置并进入工作台'}</button></form>`}<script type="module" src="/assets/app.js"></script></body></html>`);
});
upstream.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const backend={listTools:async()=>({tools:[]}),close:async()=>{}};
const runtime={home,baseUrl:`http://127.0.0.1:${upstream.address().port}`,status:async()=>({...runtimeState}),ensure:async()=>{calls.ensure++;Object.assign(runtimeState,{phase:'ready',currentVersion:version});return {...runtimeState};},latest:async()=>{calls.latest++;return {version:'0.6.53'};},update:async()=>{calls.update++;runtimeState.phase='starting';await new Promise(resolve=>{updateRelease=resolve;});version='0.6.53';Object.assign(runtimeState,{phase:'ready',currentVersion:version});return {...runtimeState};},token:async()=>{throw Error('fixture must not request a real MCP token');}};
let app,preview,browser,audit;
try{
  app=await createDbxServer({runtime,clipboard:async text=>{copies.push(text);return {copied:true};},backendFactory:async()=>backend});
  preview=await createPreview(app);
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:950}}),page=await context.newPage(),dialogs=[];
  page.on('console',message=>{if(message.type()==='error')console.log('FIXTURE browser error: '+message.text());});
  page.on('pageerror',error=>console.log('FIXTURE uncaught: '+error.message));
  page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.dismiss();});
  audit=await auditSession(page,'dbx-docker-ui');
  page.on('response',response=>{if(response.status()>=400)console.log(`FIXTURE HTTP ${response.status()} ${response.url()}`);});
  await page.goto(preview.url);
  const plugin=page.frameLocator('iframe[title="Codex MCP 开发宿主"]'),workbench=plugin.frameLocator('#workbench');
  await audit.check('fixture: sidebar auto-starts inside strict sandbox and shows the embedded setup screen',async()=>{
    assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts allow-same-origin');
    await workbench.getByRole('heading',{name:'设置 DBX 密码'}).waitFor();
    assert.equal(calls.ensure,1);assert.equal(calls.update,0);
    assert.equal(page.url(),preview.url);
    assert.equal(await plugin.locator('#version').textContent(),'官方 v0.6.52');
    assert.equal(await plugin.locator('#workbench').isVisible(),true);
    assert.equal(context.pages().length,1);
    await audit.screenshot('setup');
  });
  await audit.check('fixture: setup authenticates through the private cookie jar and database icon loads',async()=>{
    await workbench.locator('html[data-fixture-script-ready=yes]').waitFor({state:'attached'});
    await workbench.getByRole('button',{name:'设置并进入工作台'}).click();
    await workbench.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    assert.equal(calls.setup,0,'invalid required form must not reach the backend');
    await workbench.getByLabel('新密码').fill('Fixture-only-Password-123!');
    await workbench.getByLabel('新密码').press('Enter');
    await workbench.getByRole('heading',{name:'Fixture DBX v0.6.52'}).waitFor();
    assert.equal(calls.setup,1);assert.ok(calls.workbench>=1);
    const icon=workbench.locator('#database-icon');
    await icon.evaluate(node=>node.complete?undefined:new Promise((resolve,reject)=>{node.onload=resolve;node.onerror=()=>reject(Error('icon did not load'));}));
    assert.equal(await icon.evaluate(node=>node.naturalWidth),28);
    assert.ok(!(await context.cookies()).some(cookie=>cookie.name==='dbx_session'));
    await workbench.getByRole('button',{name:'退出测试登录'}).click();
    await workbench.getByRole('heading',{name:'登录 DBX'}).waitFor();
    await workbench.getByLabel('登录密码').fill('Fixture-only-Password-123!');
    await workbench.getByRole('button',{name:'登录工作台'}).click();
    await workbench.getByRole('heading',{name:'Fixture DBX v0.6.52'}).waitFor();
    assert.equal(calls.login,1);assert.equal(calls.logout,1);
    await audit.screenshot('workbench');
  });
  await audit.check('fixture: async native confirm is adapted to a DOM dialog and cancellation preserves the object',async()=>{
    await workbench.getByRole('button',{name:'删除测试对象'}).click();
    const dialog=workbench.getByRole('dialog',{name:'删除这个测试对象？'});await dialog.waitFor();
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
    await workbench.locator('#result').filter({hasText:'已取消删除'}).waitFor();assert.equal(calls.remove,0);
    await workbench.getByRole('button',{name:'删除测试对象'}).click();
    await dialog.getByRole('button',{name:'确定',exact:true}).click();
    await workbench.locator('#result').filter({hasText:'已删除测试对象'}).waitFor();assert.equal(calls.remove,1);
    assert.deepEqual(dialogs,[],'native browser dialogs must not be used in this sandbox');
  });
  await audit.check('fixture: clipboard bridge copies the exact text through the injected host implementation',async()=>{
    await workbench.getByRole('button',{name:'复制 SQL'}).click();
    await workbench.locator('#result').filter({hasText:'复制完成'}).waitFor();
    assert.deepEqual(copies,['fixture SELECT 1; 中文']);
  });
  await audit.check('fixture: blob export crosses the real chunked bridge and writes all bytes with a visible path',async()=>{
    await workbench.getByRole('button',{name:'导出测试文件'}).click();
    const notice=workbench.getByRole('status').filter({hasText:'已保存：'});await notice.waitFor();
    const exported=(await readdir(join(home,'exports'))).filter(name=>name.endsWith('-fixture-export.bin'));
    assert.equal(exported.length,1);
    const path=join(home,'exports',exported[0]);assert.deepEqual(await readFile(path),expectedBytes);
    assert.ok((await notice.textContent()).includes(path));
    assert.ok((await plugin.locator('#toast').textContent()).includes(path));
    await audit.screenshot('export');
  });
  await audit.check('fixture: a same-origin sibling frame cannot forge a clipboard bridge message',async()=>{
    const before=copies.length;
    await plugin.locator('body').evaluate((_,url)=>{const node=document.createElement('iframe');node.id='spoof-frame';node.hidden=true;node.src=url+'spoof';document.body.append(node);},app.proxy.url);
    const sibling=plugin.frameLocator('#spoof-frame');await sibling.locator('html[data-sent=yes]').waitFor({state:'attached'});
    // Source equality is the guard: this frame has the workbench's origin but
    // is not the iframe registered by the shell. Drain real message turns.
    await plugin.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(copies.length,before);
    await plugin.locator('#spoof-frame').evaluate(node=>node.remove());
  });
  await audit.check('fixture: external links request the host bridge without opening a popup (destination not opened)',async()=>{
    await page.evaluate(()=>{window.fixtureHostLinks=[];addEventListener('message',event=>{if(event.data?.method==='ui/open-link')window.fixtureHostLinks.push(event.data.params.url);});});
    await workbench.getByRole('button',{name:'帮助链接'}).click();
    await page.waitForFunction(()=>window.fixtureHostLinks.length===1);
    assert.deepEqual(await page.evaluate(()=>window.fixtureHostLinks),['https://example.invalid/dbx-fixture-help']);
    assert.equal(context.pages().length,1);assert.equal(page.url(),preview.url);
  });
  await audit.check('fixture: checking official stable metadata leaves the current service unchanged',async()=>{
    await plugin.locator('#check').click();
    await plugin.locator('#activity').filter({hasText:'官方最新 v0.6.53'}).waitFor();
    assert.equal(calls.latest,1);assert.equal(calls.update,0);
    assert.equal(await plugin.locator('#version').textContent(),'官方 v0.6.52');
  });
  await audit.check('fixture: update confirmation cancellation performs no runtime update',async()=>{
    await plugin.getByRole('button',{name:'一键更新官方版本'}).click();
    await plugin.getByRole('dialog').waitFor();
    assert.match(await plugin.getByRole('dialog').textContent(),/备份.*中断/s);
    await plugin.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(calls.update,0);
  });
  await audit.check('fixture: confirmed update reloads the same embedded frame when the official version changes',async()=>{
    const initialLoad=await workbench.locator('body').getAttribute('data-load');
    await plugin.getByRole('button',{name:'一键更新官方版本'}).click();
    await plugin.getByRole('button',{name:'备份并更新',exact:true}).click();
    await plugin.locator('#heading').filter({hasText:'正在更新 DBX'}).waitFor();
    assert.equal(calls.update,1);assert.equal(await plugin.locator('#update').isDisabled(),true);
    assert.equal(await plugin.locator('#check').isDisabled(),true);
    updateRelease();updateRelease=null;
    await workbench.getByRole('heading',{name:'Fixture DBX v0.6.53'}).waitFor({timeout:10000});
    assert.notEqual(await workbench.locator('body').getAttribute('data-load'),initialLoad);
    assert.equal(await plugin.locator('#version').textContent(),'官方 v0.6.53');
    assert.equal(page.url(),preview.url);assert.equal(context.pages().length,1);
    await audit.screenshot('updated');
  });
  await audit.check('fixture: a Docker error stays visible and retry restores the embedded workbench',async()=>{
    Object.assign(runtimeState,{phase:'docker-unavailable',message:'Fixture Docker 后台暂不可用'});
    await plugin.locator('#refresh').click();
    await plugin.locator('#detail').filter({hasText:'Fixture Docker 后台暂不可用'}).waitFor();
    assert.equal(await plugin.locator('#retry').isVisible(),true);
    await plugin.locator('#retry').click();
    await plugin.locator('#state').waitFor({state:'hidden'});
    await workbench.getByRole('heading',{name:'Fixture DBX v0.6.53'}).waitFor();
    assert.equal(calls.ensure,2);
    await audit.screenshot('recovered');
  });
  await audit.check('fixture: the toolbar and complete workbench remain reachable in a narrow panel',async()=>{
    await page.setViewportSize({width:390,height:750});
    assert.equal(await plugin.locator('body').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
    for(const id of ['refresh','check','update'])await plugin.locator('#'+id).click({trial:true});
    assert.equal(await workbench.locator('#workspace').isVisible(),true);
    await audit.screenshot('narrow');
  });
  await audit.finish();
  await writeFile(join(directory,'dbx-docker-ui-scope.json'),JSON.stringify({fixtureOnly:true,realDocker:false,officialImage:false,externalLink:'host request only; no destination opened',checks:'actual shell, proxy, sandbox, bridges and export writer; synthetic upstream and runtime',calls,bytes:expectedBytes.length},null,2));
  console.log('DBX browser integration passed (fixture-only; real official Docker validation is separate).');
}finally{
  updateRelease?.();
  await browser?.close();await preview?.close();await app?.close();
  for(const socket of sockets)socket.destroy();await new Promise(resolve=>upstream.close(resolve));
  await rm(temporary,{recursive:true,force:true});
}

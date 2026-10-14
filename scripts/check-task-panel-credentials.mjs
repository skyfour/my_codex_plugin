import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=fileURLToPath(new URL('../plugins/codex-task-panel',import.meta.url));
const dir=await mkdtemp('/tmp/credential-ui-');
let child,browser;
async function serve(extra={}){
 const env={...process.env,TASK_PANEL_DEV_HOME:dir,...extra};delete env.TAPD_ACCESS_TOKEN;if(extra.TAPD_ACCESS_TOKEN)env.TAPD_ACCESS_TOKEN=extra.TAPD_ACCESS_TOKEN;
 child=spawn(process.execPath,['--experimental-sqlite','scripts/dev.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Preview timeout')),10000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Preview exited '+code));});child.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});});
}
async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}child=null;}
try{
 const url=await serve();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function settings(){await page.locator('[data-act=settings]').click();await page.locator('[data-settings-tab=source]').click();await page.locator('#tapd-token').waitFor();}
 await page.goto(url);await settings();assert.equal(await page.locator('#tapd-token').getAttribute('type'),'password');
 await page.locator('[name=workspaceId]').fill('100');await page.locator('[name=ownerName]').fill('测试用户');
 await page.locator('#tapd-token').fill('synthetic-ui-first');await page.getByRole('button',{name:'保存凭据',exact:true}).click();
 await page.getByText('凭据已保存到本机。可直接查询候选任务。',{exact:true}).waitFor();
 assert.equal(await page.locator('#tapd-token').inputValue(),'');assert.equal(await page.locator('[name=workspaceId]').inputValue(),'100');assert.equal(await page.locator('[name=ownerName]').inputValue(),'测试用户');
 assert.equal(JSON.parse(await readFile(dir+'/credentials.json','utf8')).tapdAccessToken,'synthetic-ui-first');assert.equal((await stat(dir+'/credentials.json')).mode&0o777,0o600);
 await page.locator('#tapd-token').fill('synthetic-ui-second');await page.getByRole('button',{name:'保存凭据',exact:true}).click();await page.getByText('凭据已保存到本机。可直接查询候选任务。',{exact:true}).waitFor();assert.equal(JSON.parse(await readFile(dir+'/credentials.json','utf8')).tapdAccessToken,'synthetic-ui-second');
 await page.locator('#tapd-token').fill('invalid synthetic token');await page.getByRole('button',{name:'保存凭据',exact:true}).click();await page.getByRole('alert').filter({hasText:'有效令牌'}).waitFor();assert.equal(await page.locator('#tapd-token').inputValue(),'');assert.equal(JSON.parse(await readFile(dir+'/credentials.json','utf8')).tapdAccessToken,'synthetic-ui-second');
 await page.reload();await settings();await page.getByText('凭据已就绪',{exact:true}).waitFor();assert.ok(!(await page.content()).includes('synthetic-ui-second'));assert.equal(await page.locator('#tapd-token').inputValue(),'');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await stop();const envUrl=await serve({TAPD_ACCESS_TOKEN:'synthetic-env'});await page.goto(envUrl);await settings();assert.equal(await page.locator('#tapd-token').isDisabled(),false);assert.equal(await page.getByRole('button',{name:'保存凭据',exact:true}).isDisabled(),false);await page.getByText(/检测到环境变量 TAPD_ACCESS_TOKEN/).waitFor();await page.locator('#tapd-token').fill('synthetic-env-replacement');await page.getByRole('button',{name:'保存凭据',exact:true}).click();await page.getByText('凭据已保存到本机。可直接查询候选任务。',{exact:true}).waitFor();assert.equal(await page.locator('#tapd-token').inputValue(),'');const saved=JSON.parse(await readFile(dir+'/credentials.json','utf8'));assert.equal(saved.tapdAccessToken,'synthetic-env-replacement');assert.equal(saved.preferLocal,true);await page.reload();await settings();assert.equal(await page.locator('#tapd-token').isDisabled(),false);
 assert.deepEqual(errors,[]);console.log('PASS: UI save/replace, password cleared, drafts retained, error preserves credential, reload, 390px layout, environment replacement stays editable, no page errors');
}finally{await browser?.close();await stop();await rm(dir,{recursive:true,force:true});}

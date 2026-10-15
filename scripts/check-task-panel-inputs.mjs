import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BoardStore} from '../plugins/codex-task-panel/src/store.mjs';
import {createPanelServer} from '../plugins/codex-task-panel/servers/server.mjs';
import {loadBoardHtml} from '../plugins/codex-task-panel/src/ui-resource.mjs';
import {source} from '../plugins/codex-task-panel/tests/fixtures.mjs';
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url));
const {chromium}=require('playwright');
const dir=await mkdtemp(join(tmpdir(),'native-inputs-')),store=new BoardStore(':memory:');
store.configure({workspaceId:'100',ownerName:'示例',version:1});store.applyImport([source()],{runId:'seed'});
const {server,actions}=createPanelServer({store,dataDir:dir,env:{},credentials:async()=> 'synthetic-token',scmRead:async()=> '--task=1@tapd-100 --user=test',threads:{list:async()=>({items:[],nextCursor:null})},read:async()=>({identity:{id:'9',nick:'nick',name:'示例'},records:[source('2')],missingIds:[]})});
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('pluginTool',(name,args)=>actions.get(name)(args));
 await page.setContent('<iframe title="任务看板" style="width:100%;height:1050px"></iframe>');
 await page.evaluate(html=>{
  const iframe=document.querySelector('iframe');window.pushed=0;window.armed=false;window.toolCalls=[];
  window.pushSnapshot=async()=>{const result=await window.pluginTool('board_snapshot',{});iframe.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result},'*');window.pushed++;};
  window.addEventListener('message',async event=>{
   const msg=event.data;if(msg?.jsonrpc!=='2.0')return;
   if(msg.method==='test/input-focus'){if(window.armed){window.armed=false;await window.pushSnapshot();}return;}
   if(msg.id===undefined)return;if(msg.method==='tools/call')window.toolCalls.push(msg.params.name);
   const result=msg.method==='tools/call'?await window.pluginTool(msg.params.name,msg.params.arguments):{hostContext:{theme:'light'}};
   event.source.postMessage({jsonrpc:'2.0',id:msg.id,result},'*');
  });iframe.srcdoc=html;
 },await loadBoardHtml());
 const frame=page.frameLocator('iframe');await frame.locator('#content[aria-busy=false]').waitFor();
 await frame.locator('body').evaluate(el=>el.ownerDocument.addEventListener('focusin',()=>window.parent.postMessage({jsonrpc:'2.0',method:'test/input-focus'},'*'),true));
 const idle=()=>frame.locator('#content[aria-busy=false]').waitFor();
 async function click(selector){await frame.locator(selector).click();await idle();}
 async function type(selector,text){
  const input=frame.locator(selector);if(await input.evaluate(el=>el.ownerDocument.activeElement===el))await input.press('Tab');const queriesBefore=await page.evaluate(()=>window.toolCalls.filter(x=>x==='import_candidates').length);const before=await page.evaluate(()=>{window.armed=true;return window.pushed;});
  await input.click();await page.waitForFunction(n=>window.pushed>n,before);await frame.locator('body').evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await input.evaluate(el=>el.ownerDocument.activeElement===el),true,selector+' lost focus on host notification');
  await input.press(process.platform==='darwin'?'Meta+A':'Control+A');await input.press('Backspace');await input.pressSequentially(text);
  await page.evaluate(()=>window.pushSnapshot());await frame.locator('body').evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  if(selector==='[data-import-search]'){await page.waitForFunction(n=>window.toolCalls.filter(x=>x==='import_candidates').length>n,queriesBefore);await idle();}
  assert.equal(await input.inputValue(),text,selector+' lost draft');assert.equal(await input.evaluate(el=>el.ownerDocument.activeElement===el),true,selector+' lost typing focus');
  console.log('PASS: real click and keyboard under native host notifications: '+selector);
 }
 await click('[data-act=settings]');await click('[data-settings-tab=workflow]');const checkbox=frame.locator('[name=targets]').first();await checkbox.uncheck();await page.evaluate(()=>window.pushSnapshot());assert.equal(await checkbox.isChecked(),false);console.log('PASS: workflow checkbox retains unsaved selection');await click('[data-settings-tab=lanes]');await type('#new-lane','draft-lane');await type('[data-lane-name] >> nth=0','draft-existing-lane');
 await click('[data-settings-tab=source]');await type('[name=workspaceId]','123');await type('[name=ownerName]','draft-owner');await type('#tapd-token','synthetic-password-draft');
 await click('.app-header [data-act=board]');await type('[data-filter=search]','task');await type('[data-filter=search]','');store.applyImport([source('1',{title:'宿主更新后的任务',sourceUpdatedAt:2000})],{runId:'host-update'});await page.evaluate(()=>window.pushSnapshot());assert.equal(await frame.locator('[data-task]').textContent().then(t=>t.includes('宿主更新后的任务')),false);await frame.locator('h1').click();await frame.getByText('宿主更新后的任务',{exact:true}).waitFor();console.log('PASS: deferred host snapshot applies after editing ends');const select=frame.locator('[data-filter=account]');await select.click();await page.evaluate(()=>window.pushSnapshot());assert.equal(await select.evaluate(el=>el.ownerDocument.activeElement===el),true);await select.press('Escape');console.log('PASS: workspace select retains focus');
 await click('[data-task]');await click('[data-act=scm-fetch]');assert.equal(await frame.locator('[name=keyword]').inputValue(),'--task=1@tapd-100 --user=test');await type('[name=keyword]','--task=1@tapd-100 --user=override');await click('#scm-settings button[type=submit]');assert.equal(store.scmKeyword(store.snapshot().tasks[0].id),'--task=1@tapd-100 --user=override');console.log('PASS: TAPD keyword API button, draft focus and local persistence');await click('[data-act=new-dialog]');await type('#new-thread [name=title]','draft-title');await type('#new-thread [name=cwd]','/tmp');await click('[aria-label=关闭弹窗]');
 await click('[data-act=bind-dialog]');await type('#thread-search [name=query]','draft-search');await click('[aria-label=关闭弹窗]');
 await click('[data-act=import]');await click('[data-act=query]');await type('[data-import-search]','task');
 assert.deepEqual(errors,[]);console.log('PASS: all native task-panel text/password/search inputs retain focus and drafts');
}finally{await browser?.close();await server.close();store.close();await rm(dir,{recursive:true,force:true});}

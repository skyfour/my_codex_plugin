import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BoardStore} from '../plugins/codex-task-panel/src/store.mjs';
import {createPanelServer} from '../plugins/codex-task-panel/servers/server.mjs';
import {loadBoardHtml} from '../plugins/codex-task-panel/src/ui-resource.mjs';
import {source} from '../plugins/codex-task-panel/tests/fixtures.mjs';
import {auditSession,mountNative} from './ui-audit-helpers.mjs';
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const directory=await mkdtemp(join(tmpdir(),'board-project-ui-')),store=new BoardStore(':memory:');store.applyImport([source()],{runId:'seed'});
const projects=[{id:'one',nativeId:randomUUID(),title:'业务项目',roots:[directory,'/tmp'],cwd:directory,available:true},{id:'two',nativeId:randomUUID(),title:'另一个已有项目',roots:['/tmp'],cwd:'/tmp',available:true}];
let listFails=true,createFails=true,starts=0,failRefresh=false;const requests=[],rows=[];
const projectSource={list:async()=>{if(listFails)throw Error('PROJECTS_UNAVAILABLE');return {items:projects,selectedId:'one'};},resolve:async id=>{const p=projects.find(p=>p.id===id);if(!p)throw Error('PROJECT_UNAVAILABLE');return p;}};
const app=createPanelServer({store,dataDir:directory,env:{},projects:projectSource,threads:{list:async()=>({items:rows,nextCursor:null}),read:async id=>rows.find(t=>t.id===id),create:async(cwd,saved,title,project)=>{starts++;if(createFails)throw Error('CODEX_TIMEOUT');const t={id:randomUUID(),cwd,title,updatedAt:1000};assert.equal(project.id,'two');rows.push(t);saved(t);return t;}}});
let failBeforeStart=true,loseCreationResponse=false;
const create=app.actions.get('thread_create');app.actions.set('thread_create',async args=>{requests.push({...args});if(failBeforeStart)return {isError:true,content:[{type:'text',text:'尚未开始创建会话'}],structuredContent:{code:'CREATION_NOT_STARTED'}};const result=await create(args);if(loseCreationResponse&&!result.isError){loseCreationResponse=false;return {isError:true,content:[{type:'text',text:'创建响应丢失'}],structuredContent:{code:'CREATION_TIMEOUT'}};}return result;});
const linked=app.actions.get('task_threads');app.actions.set('task_threads',args=>failRefresh?{isError:true,content:[{type:'text',text:'synthetic refresh failure'}]}:linked(args));
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1100,height:900}}),audit=await auditSession(page,'task-panel-projects');
 const frame=await mountNative(page,await loadBoardHtml(),app.actions,'light',{'ui/open-link':[{isError:true}]}),idle=()=>frame.locator('#content[aria-busy=false]').waitFor();
 await page.evaluate(()=>{window.opened=[];window.hostMethods=[];window.addEventListener('message',event=>{if(event.data?.method)window.hostMethods.push(event.data.method);if(event.data?.method==='ui/open-link')window.opened.push(event.data.params.url);});});
 const click=async selector=>{await frame.locator(selector).click();await idle();};await idle();await click('[data-task]');
 await audit.check('project list errors retain title and support retry without loading recent chats',async()=>{
  await click('[data-act=new-dialog]');assert.match(await frame.locator('#session-dialog').textContent(),/项目列表加载失败/);
  await frame.locator('[name=title]').fill('保留的会话标题');listFails=false;await click('[data-act=project-retry]');
  assert.equal(await frame.locator('[name=title]').inputValue(),'保留的会话标题');assert.equal(await frame.locator('[name=projectId]').inputValue(),'one');
  assert.equal(await frame.locator('.project-roots .session-path').count(),2);assert.equal(await frame.locator('[name=cwd]').count(),0);
 });
 await audit.check('failure before creation keeps project and title editable',async()=>{
  await click('#new-thread button[type=submit]');assert.equal(starts,0);assert.equal(await frame.locator('[name=title]').getAttribute('readonly'),null);assert.equal(await frame.locator('[name=projectId]').isEnabled(),true);failBeforeStart=false;requests.length=0;
 });
 await audit.check('unknown creation retries reuse the same request and remain recoverable after closing',async()=>{
  await click('#new-thread button[type=submit]');assert.equal(starts,1);assert.equal(await frame.locator('[name=title]').getAttribute('readonly'),'');
  await click('#new-thread button[type=submit]');assert.equal(starts,1);assert.equal(requests[1].requestId,requests[0].requestId);
  listFails=true;await click('[aria-label=关闭弹窗]');await click('[data-act=new-dialog]');assert.equal(await frame.locator('#new-thread button[type=submit]').isEnabled(),true);await click('#new-thread button[type=submit]');assert.equal(starts,1);listFails=false;await click('[data-act=project-retry]');assert.equal(await frame.locator('[name=title]').inputValue(),'保留的会话标题');
  assert.equal(await frame.locator('[data-act=creation-reset]').isEnabled(),true);await click('[data-act=creation-bind-existing]');
  assert.equal(await frame.locator('#thread-search').isVisible(),true);await click('[aria-label=关闭弹窗]');await click('[data-act=new-dialog]');
 });
 await audit.check('explicit restart can select another project and a refresh failure cannot hide the created chat',async()=>{
  await click('[data-act=creation-reset]');assert.equal(await frame.locator('[name=title]').getAttribute('readonly'),null);
  await frame.locator('[name=projectId]').selectOption('two');assert.equal(await frame.locator('.project-roots .session-path').textContent(),'/tmp');
  createFails=false;failRefresh=true;await click('#new-thread button[type=submit]');assert.equal(starts,2);assert.notEqual(requests.at(-1).requestId,requests[0].requestId);
  assert.equal(requests.at(-1).projectId,'two');assert.equal(Object.hasOwn(requests.at(-1),'cwd'),false);
  assert.match(await frame.locator('.creation-result').textContent(),/已创建并绑定/);assert.equal((await page.evaluate(()=>window.opened)).length,1);
  const opened=new URL((await page.evaluate(()=>window.opened))[0]);assert.equal(opened.pathname,'/'+rows[0].id);assert.equal(opened.searchParams.get('prompt'),source().url);
  assert.match(await frame.locator('.creation-result').textContent(),/手动发送/);
  assert.match(await frame.locator('#error').textContent(),/宿主未能打开会话并填入草稿/);assert.match(await frame.locator('#error').textContent(),/复制任务背景并粘贴/);assert.equal(await frame.locator('.creation-result [data-act=copy-context]').isEnabled(),true);
  assert.equal((await page.evaluate(()=>window.hostMethods)).includes('ui/message'),false,'creating a chat must leave the link unsent');
  await click('.creation-result [data-thread-open]');assert.equal(new URL((await page.evaluate(()=>window.opened)).at(-1)).search,'','reopening a chat must preserve its existing composer draft');
  assert.equal(store.threads(store.snapshot().tasks[0].id).length,1);await click('[aria-label=关闭弹窗]');
 });
 await audit.check('recovering a lost creation response opens the same chat without replacing its draft',async()=>{
  failRefresh=false;await click('[data-act=new-dialog]');await frame.locator('[name=projectId]').selectOption('two');loseCreationResponse=true;
  await click('#new-thread button[type=submit]');const request=requests.at(-1);assert.equal(starts,3);assert.equal(await frame.locator('[name=title]').getAttribute('readonly'),'');
  await click('#new-thread button[type=submit]');assert.equal(starts,3);assert.equal(requests.at(-1).requestId,request.requestId);
  const opened=new URL((await page.evaluate(()=>window.opened)).at(-1));assert.equal(opened.pathname,'/'+rows[1].id);assert.equal(opened.search,'','recovering an existing chat must not prefill over an edited draft');
  assert.match(await frame.locator('.creation-result').textContent(),/保留原有输入框草稿/);assert.equal(store.threads(store.snapshot().tasks[0].id).length,2);await click('[aria-label=关闭弹窗]');
 });
 await audit.check('empty project list never offers a free-text directory or enabled create button',async()=>{
  projectSource.list=async()=>({items:[],selectedId:null});await click('[data-act=new-dialog]');assert.match(await frame.locator('#session-dialog').textContent(),/还没有可用的本机项目/);
  assert.equal(await frame.locator('#new-thread button[type=submit]').isDisabled(),true);assert.equal(await frame.locator('[name=cwd]').count(),0);
  projectSource.list=async()=>({items:projects,selectedId:'one'});await click('[data-act=project-retry]');await frame.locator('[name=title]').fill('在已有项目创建空会话');
  await frame.locator('#session-dialog').screenshot({path:join(audit.directory,'project-picker.png')});
 });
 await audit.finish();
}finally{await browser?.close();await app.server.close();store.close();await rm(directory,{recursive:true,force:true});}

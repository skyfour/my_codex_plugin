import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,html} from '../plugins/codex-local-review/servers/server.mjs';
import {mountNative,auditSession} from './ui-audit-helpers.mjs';

// All task context, Git repositories and writes are synthetic and disposable.
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const root=await realpath(await mkdtemp(join(tmpdir(),'review-task-keyword-'))),repos=[join(root,'alpha'),join(root,'beta')];
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:'pipe'}).trim();
for(const repo of repos){await mkdir(repo);git(repo,'init','-q','-b','main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');for(const name of ['demo.txt','other.txt'])await writeFile(join(repo,name),'before\n');git(repo,'add','.');git(repo,'commit','-qm','Initial fixture');for(const name of ['demo.txt','other.txt'])await writeFile(join(repo,name),'after\n');}
const tasks=[
 {id:'00000000-0000-4000-8000-000000000001',title:'Synthetic task A',keyword:'--task=101@tapd-100 --user=fixture Synthetic task A https://www.tapd.cn/100/s/101'},
 {id:'00000000-0000-4000-8000-000000000002',title:'Synthetic task B',keyword:'--story=202@tapd-100 --user=fixture Synthetic task B https://www.tapd.cn/100/s/202'},
 {id:'00000000-0000-4000-8000-000000000003',title:'Synthetic retry task',keyword:'--bug=303@tapd-100 --user=fixture'}
].map(t=>({...t,account:'Fixture',sourceId:t.id.slice(-3),state:'open'}));
const [a,b,c]=tasks;let heldKeyword=null,failRetry=true,omittedTaskId='',browser;
function gate(taskId){let entered,release,returned,timer;const value={taskId,started:new Promise((resolve,reject)=>{entered=()=>{clearTimeout(timer);resolve();};timer=setTimeout(()=>reject(Error('Expected keyword request did not reach its gate')),5000);}),released:new Promise(resolve=>release=resolve),returned:new Promise(resolve=>returned=resolve)};return {...value,enter:entered,release:()=>{clearTimeout(timer);release();},finish:returned};}
const app=await createServer({dir:join(root,'data'),taskContexts:{
 listTasks:async()=>({tasks:tasks.filter(t=>t.id!==omittedTaskId).map(t=>({...t,keyword:''})),notice:''}),
 getCommitContext:async taskId=>{const hold=heldKeyword?.taskId===taskId?heldKeyword:null;if(hold){hold.enter();await hold.released;hold.finish();}if(taskId===c.id&&failRetry){failRetry=false;throw Error('Synthetic TAPD context unavailable');}return {taskId,keyword:tasks.find(t=>t.id===taskId).keyword};}
}});
const projects=[];for(const repo of repos.toReversed())projects.push(await app.projects.open(repo));const project=name=>projects.find(p=>p.path===join(root,name));
const executions=[],actions={get(name){return async args=>{if(name==='commit_execute')executions.push(args);return app.actions.get(name)(args);};}};
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:950}}),audit=await auditSession(page,'review-task-keyword'),f=await mountNative(page,html(),actions,'dark');
 const editor=f.locator('#commitSummary'),row=f.locator('#commitKeywordRow'),apply=f.locator('#applyCommitKeyword'),composer=f.locator('#commitWorkspace');
 const idle=()=>page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.body?.getAttribute('aria-busy')==='false');
 const ready=async()=>{await idle();await f.locator('#commitTask:not([disabled])').waitFor();};
 const frames=()=>f.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const occurrences=(text,keyword)=>text.split('\n').filter(line=>line===keyword).length;
 async function loaded(task){await row.waitFor({state:'visible'});await f.locator('#commitKeywordText').filter({hasText:task.keyword}).waitFor();assert.equal(await f.locator('#commitKeywordText').textContent(),task.keyword);}
 async function select(task){await f.locator('#commitTask').selectOption(task?.id??'');if(task)await loaded(task);else await row.waitFor({state:'hidden'});}
 async function reach(node){for(let attempt=0;attempt<18;attempt++){const visible=await node.evaluate(node=>{const box=node.getBoundingClientRect(),bounds=node.closest('#commitWorkspace').getBoundingClientRect();return box.y>=bounds.y&&box.bottom<=bounds.bottom&&node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));});if(visible)return;const box=await node.boundingBox(),bounds=await composer.boundingBox();await page.mouse.move(bounds.x+bounds.width-5,bounds.y+bounds.height/2);await page.mouse.wheel(0,box.y<bounds.y?-120:120);await frames();}assert.fail('normal wheel scrolling must reach the commit control');}
 async function click(node){await reach(node);const box=await node.boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
 async function refresh(){await f.locator('#refreshCommit').click();await ready();}
 async function switchProject(name){await f.locator('#projectSelect').selectOption(project(name).id);await ready();}
 await ready();
 await audit.check('the workspace exposes the complete TAPD keyword and an apply action before staging',async()=>{
  await editor.fill('fix: keep my description\n\nExisting body');await f.locator('#commitTask').selectOption(a.id);await loaded(a);
  assert.equal(await row.count(),1,'the worktree needs a visible keyword row rather than only a collapsed preview');assert.equal(await apply.isEnabled(),true);assert.equal(await apply.textContent(),'应用到提交说明');assert.equal(await f.locator('#confirmCommit').isDisabled(),true);assert.equal(await f.locator('.commit-preview').getAttribute('open'),null);assert.equal(await f.locator('#commitMessage').textContent(),await editor.inputValue(),'the preview must not secretly append the selected task');await audit.screenshot('before-apply');
 });
 await audit.check('one click replaces the whole draft with the complete official keyword exactly once',async()=>{
  await editor.focus();await editor.evaluate(node=>node.setSelectionRange(5,9));await click(apply);assert.equal(await editor.inputValue(),a.keyword);assert.deepEqual(await editor.evaluate(node=>({focused:node===document.activeElement,start:node.selectionStart,end:node.selectionEnd})),{focused:true,start:a.keyword.length,end:a.keyword.length});assert.equal(await f.locator('#commitMessage').textContent(),a.keyword);assert.equal(await apply.isDisabled(),true);assert.equal(await apply.textContent(),'已应用');assert.equal(git(repos[0],'diff','--cached'),'');await audit.screenshot('applied');
 });
 await audit.check('manual keyword lines are recognized without taking ownership or deleting user text',async()=>{
  const manual='Manually written\n\n'+a.keyword;await editor.fill('Manually written');await editor.fill(manual);assert.equal(await apply.isEnabled(),true,'replacement remains available for a custom draft');assert.equal(occurrences(await f.locator('#commitMessage').textContent(),a.keyword),1);await select(b);assert.equal(await editor.inputValue(),manual);assert.equal(await f.locator('#commitMessage').textContent(),manual);await select(null);assert.equal(await editor.inputValue(),manual);
  const inline='Mention '+a.keyword+' inside a sentence';await editor.fill(inline);await select(a);assert.equal(await apply.isEnabled(),true,'a keyword inside prose is not the required standalone line');await click(apply);assert.equal(await editor.inputValue(),a.keyword);await select(null);assert.equal(await editor.inputValue(),a.keyword);
 });
 await audit.check('changing or removing the association preserves visible text until explicit replacement',async()=>{
  await editor.fill('Preserve this body');await select(a);await click(apply);await select(b);assert.equal(await editor.inputValue(),a.keyword);assert.equal(await f.locator('#commitMessage').textContent(),a.keyword);assert.match(await f.locator('#commitTaskHint').textContent(),/应用到提交说明/);await click(apply);assert.equal(await editor.inputValue(),b.keyword);assert.equal(occurrences(await f.locator('#commitMessage').textContent(),a.keyword),0);await select(null);assert.equal(await editor.inputValue(),b.keyword);
  await select(a);await click(apply);await editor.fill('Preserve this body\n\n'+a.keyword+' edited by user');await select(b);assert.equal(await editor.inputValue(),'Preserve this body\n\n'+a.keyword+' edited by user');await select(null);
 });
 await audit.check('a late keyword response cannot replace the latest association or draft',async()=>{
  await editor.fill('Race draft');const hold=gate(a.id);heldKeyword=hold;try{await f.locator('#commitTask').selectOption(a.id);await hold.started;await select(b);assert.equal(await editor.inputValue(),'Race draft');hold.release();await hold.returned;await frames();assert.equal(await f.locator('#commitTask').inputValue(),b.id);await loaded(b);assert.equal(await editor.inputValue(),'Race draft');}finally{hold.release();heldKeyword=null;}
 });
 await audit.check('keyword failure and retry preserve the editor and keep unsafe submission unavailable',async()=>{
  await editor.fill('Retry draft');await f.locator('#commitTask').selectOption(c.id);await f.locator('#retryKeyword').waitFor({state:'visible'});assert.match(await f.locator('#commitTaskHint').textContent(),/Synthetic TAPD/);assert.equal(await editor.inputValue(),'Retry draft');assert.equal(await row.isVisible(),false);assert.equal(await f.locator('#confirmCommit').isDisabled(),true);await f.locator('#retryKeyword').click();await loaded(c);assert.equal(await editor.inputValue(),'Retry draft');assert.equal(await apply.isEnabled(),true);
 });
 await audit.check('refresh and project round trips preserve the visible message and association',async()=>{
  await editor.fill('Alpha draft');await select(a);await click(apply);await refresh();await loaded(a);assert.equal(await editor.inputValue(),a.keyword);assert.equal(await apply.isDisabled(),true);await switchProject('beta');await editor.fill('Independent beta draft');await switchProject('alpha');await loaded(a);assert.equal(await editor.inputValue(),a.keyword);await select(null);assert.equal(await editor.inputValue(),a.keyword);await switchProject('beta');assert.equal(await editor.inputValue(),'Independent beta draft');await switchProject('alpha');
 });
 // Value: protects=refreshing away a selected task preserves its draft and clears the association;
 // fails_when=refresh deletes draft text or project restoration revives an unavailable task;
 // why_new=existing refresh fixtures always retain every task; seam=none;
 // no_claim=task-list changes use a synthetic provider, not the live TAPD service.
 await audit.check('a task removed by refresh leaves its draft intact and cannot return through project restoration',async()=>{
  await select(a);const draft='Keep the reviewed description\n\n'+a.keyword;await editor.fill(draft);omittedTaskId=a.id;
  try{
   await refresh();assert.equal(await editor.inputValue(),draft);assert.equal(await f.locator('#commitMessage').textContent(),draft);assert.equal(await f.locator('#commitTask').inputValue(),'');assert.equal(await f.locator(`#commitTask option[value="${a.id}"]`).count(),0);assert.equal(await row.isVisible(),false);
   await switchProject('beta');assert.equal(await editor.inputValue(),'Independent beta draft');await switchProject('alpha');assert.equal(await editor.inputValue(),draft);assert.equal(await f.locator('#commitTask').inputValue(),'');assert.equal(await row.isVisible(),false);
  }finally{omittedTaskId='';await refresh();}
  assert.equal(await editor.inputValue(),draft);assert.equal(await f.locator('#commitTask').inputValue(),'','a task becoming available again must not revive a cleared association');assert.equal(await f.locator(`#commitTask option[value="${a.id}"]`).count(),1);
 });
 await audit.check('a keyword response from another project cannot leak into the newly opened composer',async()=>{
  await editor.fill('Alpha pending draft');const hold=gate(a.id);heldKeyword=hold;try{await f.locator('#commitTask').selectOption(a.id);await hold.started;await switchProject('beta');assert.equal(await editor.inputValue(),'Independent beta draft');hold.release();await hold.returned;await frames();assert.equal(await row.isVisible(),false);assert.equal(await f.locator('#commitTask').inputValue(),'');assert.equal(await editor.inputValue(),'Independent beta draft');}finally{hold.release();heldKeyword=null;}await switchProject('alpha');await loaded(a);
 });
 await audit.check('replacement works over a full draft and submission requires a visible valid keyword',async()=>{
  git(repos[0],'add','demo.txt');await refresh();await loaded(a);await editor.fill('Valid staged draft');assert.equal(await f.locator('#confirmCommit').isDisabled(),true);assert.equal(await editor.getAttribute('maxlength'),'10000');const long='x'.repeat(10000);await editor.fill(long);assert.equal(await editor.inputValue(),long);assert.equal(await apply.isEnabled(),true);assert.equal(await f.locator('#confirmCommit').isDisabled(),true);assert.equal(await f.locator('#commitMessage').textContent(),long);await click(apply);assert.equal(await editor.inputValue(),a.keyword);assert.equal(await f.locator('#confirmCommit').isEnabled(),true);const spaced='  '+a.keyword+'\n\nAdditional details  ';await editor.fill(spaced);assert.equal(await f.locator('#commitMessage').textContent(),spaced.trim());assert.equal(await f.locator('#confirmCommit').isEnabled(),true,'keyword validation uses the same outer whitespace normalization as the final message');await editor.evaluate((node,text)=>{node.value=text;node.dispatchEvent(new Event('input',{bubbles:true}));},'x'.repeat(10000)+'\n'+a.keyword);assert.equal(await f.locator('#confirmCommit').isDisabled(),true);assert.match(await f.locator('#commitTaskHint').textContent(),/10000|10,000/);
 });
 // Value: protects=an associated staged commit accepts only a complete standalone keyword line;
 // fails_when=keyword validation changes from full-line equality to substring matching;
 // why_new=the existing inline-keyword case has no staged token and checks only Apply; seam=none;
 // no_claim=this checks the real composer boundary without executing another Git commit.
 await audit.check('a staged commit rejects an inline keyword and accepts the same keyword on its own line',async()=>{
  const confirm=f.locator('#confirmCommit'),valid='Reviewed body\n\n'+a.keyword+'\n\nAdditional details';assert.equal(git(repos[0],'diff','--cached','--name-only'),'demo.txt');await editor.fill(valid);assert.equal(await confirm.isEnabled(),true,'a real staged token and loaded keyword must be ready before testing rejection');
  const inline='Mention '+a.keyword+' inside a sentence';await editor.fill(inline);assert.equal(await f.locator('#commitMessage').textContent(),inline);assert.equal(await confirm.isDisabled(),true,'containing the complete keyword as a substring cannot authorize an associated commit');assert.equal(executions.length,0);
  await editor.fill(valid);assert.equal(await f.locator('#commitMessage').textContent(),valid);assert.equal(await confirm.isEnabled(),true,'moving the identical keyword to its own line restores submission');
 });
 await audit.check('the apply control is reachable in a narrow low-height worktree without replacing editor nodes',async()=>{
  await editor.fill('Narrow draft');await editor.evaluate(node=>window.keywordEditor=node);await page.setViewportSize({width:390,height:500});await click(apply);assert.equal(await editor.inputValue(),a.keyword);assert.equal(await editor.evaluate(node=>node===window.keywordEditor),true);assert.equal(await f.locator('body').evaluate(node=>node.scrollWidth<=node.clientWidth),true);await audit.screenshot('narrow-applied');await page.setViewportSize({width:1440,height:950});
 });
 await audit.check('a refreshed keyword for the same task replaces the old message rather than appending it',async()=>{
  const previous=a.keyword;await select(null);a.keyword+=' Updated task title';await select(a);assert.equal(await editor.inputValue(),previous);assert.equal(await f.locator('#commitMessage').textContent(),previous);assert.equal(await f.locator('#confirmCommit').isDisabled(),true);await click(apply);assert.equal(await editor.inputValue(),a.keyword);assert.equal(occurrences(await editor.inputValue(),previous),0);assert.equal(await f.locator('#confirmCommit').isEnabled(),true);
 });
 await audit.check('the real Git commit receives one keyword and leaves unstaged files alone',async()=>{
  await editor.fill('fix: explicit TAPD application');await click(apply);await editor.fill(a.keyword+'\n\nAdditional reviewed details');const expected=await editor.inputValue();await click(f.locator('#confirmCommit'));await ready();assert.equal(executions.length,1);assert.equal(executions[0].message,expected);assert.equal(executions[0].taskId,a.id);const message=git(repos[0],'log','-1','--format=%B');assert.equal(message,expected);assert.equal(occurrences(message,a.keyword),1);assert.equal(git(repos[0],'show','HEAD:demo.txt'),'after');assert.equal(git(repos[0],'show','HEAD:other.txt'),'before');assert.match(git(repos[0],'status','--porcelain'),/other\.txt/);assert.equal(await f.locator('#commitTask').inputValue(),a.id,'successful commits retain the task association for the next draft');assert.equal(await editor.inputValue(),'');await loaded(a);assert.equal(await apply.isEnabled(),true,'a new draft can apply the same task keyword without staged files');await click(apply);assert.equal(await editor.inputValue(),a.keyword);assert.equal(await f.locator('#confirmCommit').isDisabled(),true);
 });
 await audit.finish();
}finally{heldKeyword?.release();await browser?.close();await app.server.close();app.store.close();await rm(root,{recursive:true,force:true});}

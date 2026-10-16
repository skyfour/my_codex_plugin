import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,html} from '../plugins/codex-local-review/servers/server.mjs';
import {mountNative} from './ui-audit-helpers.mjs';

// Slow reads and real pointer events expose lost navigation that a click helper
// silently waiting for aria-busy=false would conceal. Git writes stay synthetic.
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const root=await realpath(await mkdtemp(join(tmpdir(),'review-fluency-'))),repos=[join(root,'alpha'),join(root,'beta'),join(root,'gamma')],names=['a.txt','b.txt','c.txt','d.txt'];
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
for(const [index,repo] of repos.entries()){
 await mkdir(repo);git(repo,'init','-q','-b','main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');
 const projectNames=index?names:names.filter(name=>name!=='b.txt');
 for(const name of projectNames)await writeFile(join(repo,name),Array.from({length:120},(_,i)=>`${index} ${name} before ${i+1}`).join('\n')+'\n');git(repo,'add','.');git(repo,'commit','-qm','initial');
 for(const name of projectNames)await writeFile(join(repo,name),Array.from({length:120},(_,i)=>`${index} ${name} ${i===19||i===99?'after':'before'} ${i+1}`).join('\n')+'\n');git(repo,'add','d.txt');
}
const taskId='00000000-0000-4000-8000-000000000001';
const app=await createServer({dir:join(root,'data'),taskContexts:{listTasks:async()=>({tasks:[{id:taskId,title:'Synthetic fixture task',account:'Fixture',sourceId:'fixture-1'}],notice:''})}});for(const repo of repos)await app.projects.open(repo);
const actions=new Map(app.actions),reads=[],checks=[],failures=[],errors=[],observations=[];
let browser,heldRead,heldCommit,heldOpen,heldChanges,heldExecute;
function holdFile(path){
 let release,entered;const gate={path,promise:new Promise(resolve=>{release=resolve;}),started:new Promise(resolve=>{entered=resolve;})};
 gate.release=()=>{if(heldRead===gate)heldRead=null;release();};gate.enter=entered;heldRead=gate;return gate;
}
actions.set('project_file',async args=>{reads.push({id:args.id,path:args.path,mode:args.mode,at:performance.now()});const gate=heldRead;if(gate?.path===args.path){gate.enter();await gate.promise;}return app.actions.get('project_file')(args);});
actions.set('commit_prepare',async args=>{const gate=heldCommit,result=await app.actions.get('commit_prepare')(args);if(gate){gate.calls.push(args);gate.enter();await gate.promise;}return result;});
actions.set('project_open',async args=>{const gate=heldOpen,result=await app.actions.get('project_open')(args);if(gate&&args.id===gate.id){gate.enter();await gate.promise;}return result;});
actions.set('project_changes',async args=>{const gate=heldChanges,result=await app.actions.get('project_changes')(args);if(gate&&args.id===gate.id){gate.enter();await gate.promise;}return result;});
actions.set('commit_execute',async args=>{const gate=heldExecute,result=await app.actions.get('commit_execute')(args);if(gate){gate.enter();await gate.promise;}return result;});
function responseGate(){let release,enter,timer;const gate={promise:new Promise(resolve=>{release=resolve;}),started:new Promise(resolve=>{enter=resolve;})};gate.enter=enter;gate.wait=async()=>{try{await Promise.race([gate.started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Expected RPC did not reach its response gate within 5 seconds')),5000);})]);}finally{clearTimeout(timer);}};gate.release=()=>{clearTimeout(timer);release();};return gate;}
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1500,height:950}}),directory=process.env.UI_AUDIT_DIR||'/tmp/codex-plugin-ui-audit';await mkdir(directory,{recursive:true});page.on('pageerror',error=>errors.push(error.message));
 const initialCommitGate=responseGate();initialCommitGate.calls=[];heldCommit=initialCommitGate;
 const f=await mountNative(page,html(),actions),idle=()=>page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.body.getAttribute('aria-busy')==='false');
 const project=name=>app.projects.list().find(p=>p.path===join(root,name));
 const state=()=>f.locator('body').evaluate(body=>{const d=body.ownerDocument;return {project:d.querySelector('#repoName')?.textContent,title:d.querySelector('#fileTitle')?.textContent,tab:d.querySelector('#detailTabs [aria-selected=true]')?.textContent,scope:d.querySelector('[data-scope][aria-pressed=true]')?.dataset.scope,focus:d.activeElement?.id||'',busy:body.getAttribute('aria-busy')};});
 async function check(name,work){const start=performance.now();try{await work();checks.push({name,ms:performance.now()-start});console.log('PASS '+name);}catch(error){failures.push({name,error:error.message,state:await state(),ms:performance.now()-start});console.log('FAIL '+name+': '+error.message);await page.screenshot({path:join(directory,`review-fluency-${failures.length}-failure.png`)});}}
 async function pointer(locator){await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();assert.ok(box&&box.width>0&&box.height>0,'pointer target exists');await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
 async function waitTitle(path,timeout=1200){await f.locator('#fileTitle').filter({hasText:path}).waitFor({timeout});assert.equal(await f.locator('#fileTitle').textContent(),path);assert.match(await f.locator('#code').textContent(),new RegExp(path.replace('.','\\.')));}
 await check('initial task and commit preparation does not block code navigation or a new draft',async()=>{
  try{
   await initialCommitGate.wait();await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.body.getAttribute('aria-busy')==='false',{},{timeout:5000});
   await f.locator('#files [data-path="a.txt"]').click();await waitTitle('a.txt',5000);await f.locator('#files [data-path="c.txt"]').click();await waitTitle('c.txt',5000);await f.getByRole('tab',{name:'Summary',exact:true}).click();
   await f.locator('#commitSummary').fill('Draft written before the task list arrives');assert.equal(await f.locator('#confirmCommit').isDisabled(),true,'there is no valid commit token until preparation returns');assert.equal(await f.locator('#commitTask').isDisabled(),true,'task selection waits for its first task list');assert.ok(initialCommitGate.calls.length>0);
  }finally{heldCommit=null;initialCommitGate.release();}
  await f.locator('#confirmCommit:not([disabled])').waitFor({timeout:5000});await f.locator(`#commitTask option[value="${taskId}"]`).waitFor({state:'attached',timeout:5000});assert.equal(await f.locator('#commitTask').isEnabled(),true);assert.equal(await f.locator('#commitSummary').inputValue(),'Draft written before the task list arrives');await f.getByRole('tab',{name:'Summary',exact:true}).click();
 });
 await idle();
 await f.locator('#projectSelect').selectOption(project('beta').id);await idle();

 await check('reselecting the current file does not reread it or flash another comparison',async()=>{
  await f.locator('#files [data-path="a.txt"]').click();await idle();const count=reads.filter(r=>r.path==='a.txt').length;
  await f.locator('#files [data-path="a.txt"]').click();await idle();assert.equal(reads.filter(r=>r.path==='a.txt').length,count,'same selected file must reuse its visible comparison');await waitTitle('a.txt');
 });
 for(let round=0;round<2;round++)await check(`the latest file click wins while an earlier read is slow (${round+1})`,async()=>{
  await f.locator('#files [data-path="a.txt"]').click();await idle();
  const gate=holdFile('b.txt');try{
   await f.locator('#files [data-path="b.txt"]').click();await gate.started;await pointer(f.locator('#files [data-path="c.txt"]'));
   await waitTitle('c.txt');assert.equal((await state()).tab,'M c.txt');
  }finally{gate.release();}
  await idle();await waitTitle('c.txt');assert.equal((await state()).tab,'M c.txt','late read must not restore the previous tab');
 });
 await check('project selection during a slow file read applies the last project choice',async()=>{
  await f.locator('#files [data-path="a.txt"]').click();await idle();
  const gate=holdFile('b.txt');try{
   await f.locator('#files [data-path="b.txt"]').click();await gate.started;await f.locator('#projectSelect').selectOption(project('alpha').id);
   await f.locator('#repoName').filter({hasText:'alpha'}).waitFor({timeout:1200});
  }finally{gate.release();}
  await idle();assert.equal((await state()).project,'alpha');const preview=f.locator('[data-summary-mode=unstaged] [data-summary-path="a.txt"]');await preview.locator('.diff-table').waitFor({timeout:5000});assert.equal(await preview.isVisible(),true);assert.match(await preview.textContent(),/0 a\.txt/,'late response must not install another project\'s contents');assert.doesNotMatch(await preview.textContent(),/1 a\.txt/);
 });
 await check('file navigation from the previous project is not applied to the project being opened',async()=>{
  await f.locator('#projectSelect').selectOption(project('beta').id);await idle();await f.locator('#files [data-path="a.txt"]').click();await idle();
  const gate=responseGate();gate.id=project('alpha').id;heldOpen=gate;const before=reads.length;
  try{await f.locator('#projectSelect').selectOption(gate.id);await gate.wait();assert.equal((await state()).project,'beta','the old project is still visible while project_open is pending');await pointer(f.locator('#files [data-path="b.txt"]'));}finally{heldOpen=null;gate.release();}
  await idle();assert.equal((await state()).project,'alpha');const foreignReads=reads.slice(before).filter(r=>r.id===gate.id&&r.path==='b.txt');observations.push({name:'cross-project-navigation',foreignReads,state:await state()});assert.deepEqual(foreignReads,[],'a queued old-project path must not be read from the newly opened project');assert.notEqual((await state()).title,'b.txt');
 });
 await check('old project navigation disappears before the new project changeset response',async()=>{
  await f.locator('#projectSelect').selectOption(project('beta').id);await idle();assert.equal(await f.locator('#files [data-path="b.txt"]').count(),1);const gate=responseGate();gate.id=project('alpha').id;heldChanges=gate;const before=reads.length;
  try{await f.locator('#projectSelect').selectOption(gate.id);await gate.wait();assert.equal((await state()).project,'alpha','project_open has returned before this gate');assert.equal(await f.locator('#files [data-path="b.txt"]').count(),0,'old project buttons must be removed synchronously before awaiting the new changeset');assert.equal(await f.locator('[data-summary-path="b.txt"]:visible').count(),0,'the old Summary cannot offer another project\'s actions');}finally{heldChanges=null;gate.release();}
  await idle();assert.deepEqual(reads.slice(before).filter(r=>r.id===gate.id&&r.path==='b.txt'),[],'old paths must never be requested from the new project');const preview=f.locator('[data-summary-mode=unstaged] [data-summary-path="a.txt"]');await preview.locator('.diff-table').waitFor({timeout:5000});assert.match(await preview.textContent(),/0 a\.txt/);
 });
 await check('the last project choice survives an earlier project opening response',async()=>{
  await f.locator('#projectSelect').selectOption(project('beta').id);await idle();const gate=responseGate();gate.id=project('alpha').id;heldOpen=gate;
  try{await f.locator('#projectSelect').selectOption(gate.id);await gate.wait();await f.locator('#projectSelect').selectOption(project('gamma').id);}finally{heldOpen=null;gate.release();}
  await f.locator('#repoName').filter({hasText:'gamma'}).waitFor({timeout:5000});await idle();assert.equal((await state()).project,'gamma');const preview=f.locator('[data-summary-mode=unstaged] [data-summary-path="a.txt"]');await preview.locator('.diff-table').waitFor({timeout:5000});assert.match(await preview.textContent(),/2 a\.txt/,'the final project supplies the visible contents');
 });
 await f.locator('#projectSelect').selectOption(project('beta').id);await idle();
 await check('fast scope selection during a slow read preserves the last navigation intent',async()=>{
  await f.locator('#files [data-path="a.txt"]').click();await idle();
  const gate=holdFile('b.txt');try{
   await f.locator('#files [data-path="b.txt"]').click();await gate.started;
   await pointer(f.locator('[data-scope=staged]'));await pointer(f.locator('[data-scope=unstaged]'));
   await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.querySelector('[data-scope=unstaged]')?.getAttribute('aria-pressed')==='true',{},{timeout:1200});
  }finally{gate.release();}
  await idle();assert.equal((await state()).scope,'unstaged');assert.equal(await f.locator('#files [data-path="d.txt"]').count(),0,'last scope controls the visible changeset');
 });
 await f.locator('[data-scope=working]').click();await idle();
 await check('filter typing retains focus and restores the file list without refresh',async()=>{
  await f.locator('#fileSearch').fill('c');await f.locator('#fileSearch').pressSequentially('.txt',{delay:15});assert.equal(await f.locator('#files [data-path]').count(),1);assert.equal(await f.locator('#fileSearch').inputValue(),'c.txt');assert.equal(await f.locator('#fileSearch').evaluate(e=>e.ownerDocument.activeElement===e),true);await f.locator('#fileSearch').fill('');assert.equal(await f.locator('#files [data-path]').count(),4);
 });
 await check('both hunks can be staged consecutively with the remaining hunk visible',async()=>{
  await f.getByRole('tab',{name:'Summary',exact:true}).click();const card=()=>f.locator('[data-summary-mode=unstaged] [data-summary-path="a.txt"]');await card().scrollIntoViewIfNeeded();await card().locator('.diff-table').waitFor();await card().locator('[data-hunk-operation=stage]').first().click();await idle();await card().locator('.diff-table').waitFor();assert.equal(await card().locator('[data-hunk-operation=stage]').count(),1);assert.equal(await card().locator('[data-hunk-operation=stage]').evaluate(e=>{const r=e.getBoundingClientRect(),c=e.closest('.detail-column').getBoundingClientRect();return r.top>=c.top&&r.bottom<=c.bottom;}),true,'the remaining hunk action is visible before the next click can auto-scroll');assert.match(git(repos[1],'show',':a.txt'),/after 20/);assert.doesNotMatch(git(repos[1],'show',':a.txt'),/after 100/);await card().locator('[data-hunk-operation=stage]').click();await idle();assert.equal(await card().count(),0);assert.match(git(repos[1],'show',':a.txt'),/after 100/);assert.equal(await f.getByRole('tab',{name:'Summary',exact:true}).getAttribute('aria-selected'),'true');
 });
 await check('slow commit preparation does not block Stage, reading, or the commit draft',async()=>{
  await f.getByRole('tab',{name:'Summary',exact:true}).click();const source=f.locator('[data-summary-mode=unstaged] [data-summary-path="b.txt"]'),next=f.locator('[data-summary-mode=unstaged] [data-summary-path="c.txt"]');await source.scrollIntoViewIfNeeded();await source.locator('.diff-table').waitFor();
  let release,enter,timer;const gate={calls:[],promise:new Promise(resolve=>{release=resolve;}),started:new Promise(resolve=>{enter=resolve;})};gate.enter=enter;gate.release=()=>{if(heldCommit===gate)heldCommit=null;release();};heldCommit=gate;
  try{
   await source.getByRole('button',{name:'Stage',exact:true}).click();
   await Promise.race([gate.started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Stage must start its commit preparation within 5 seconds')),5000);})]);clearTimeout(timer);
   assert.match(git(repos[1],'show',':b.txt'),/after 20/);assert.match(git(repos[1],'show',':b.txt'),/after 100/);
   await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.body.getAttribute('aria-busy')==='false',{},{timeout:5000});
   assert.equal(await source.count(),0,'Stage result must render while commit preparation is pending');await next.locator('.diff-table').waitFor({timeout:5000});assert.match(await next.textContent(),/1 c\.txt after 100/);
   assert.equal(await next.locator('.summary-file-header').evaluate(e=>{const r=e.getBoundingClientRect(),c=e.closest('.detail-column').getBoundingClientRect();return r.bottom>c.top&&r.top<c.bottom;}),true,'the next review file stays readable at the original Summary position');
   assert.ok(gate.calls.length>0,'the commit response is actually pending');assert.equal(gate.calls.every(args=>args.includeTasks===false),true,'index refresh reuses the task list already loaded');
   await f.locator('#commitSummary').fill('Draft typed while commit preparation is pending');assert.equal(await f.locator('#confirmCommit').isDisabled(),true,'a stale commit token cannot be submitted before refresh completes');
  }finally{clearTimeout(timer);gate.release();}
  await idle();await f.locator('#confirmCommit:not([disabled])').waitFor({timeout:5000});assert.match(await f.locator('#commitFiles').textContent(),/b\.txt/);assert.equal(await f.locator('#commitSummary').inputValue(),'Draft typed while commit preparation is pending');
 });
 await check('comment and commit drafts survive project round trips without refresh',async()=>{
  await f.locator('#files [data-path="b.txt"]').click();await idle();await f.locator('#code .number button:visible').first().click();await idle();await f.locator('#commentText').fill('Synthetic unsaved comment');
  await f.locator('#projectSelect').selectOption(project('alpha').id);await idle();await f.locator('#projectSelect').selectOption(project('beta').id);await idle();assert.equal(await f.locator('#commentText').inputValue(),'Synthetic unsaved comment');
  await f.locator('#liveView').click();await idle();await f.locator('#commitSummary').fill('Synthetic commit draft');await f.locator('#projectSelect').selectOption(project('alpha').id);await idle();await f.locator('#projectSelect').selectOption(project('beta').id);await idle();assert.equal(await f.locator('#commitSummary').inputValue(),'Synthetic commit draft');
 });
 await check('the submitted commit message is locked only while commit execution is in progress',async()=>{
  await f.locator('#commitSummary').fill('Synthetic commit completed by the fixture');await f.locator('#confirmCommit:not([disabled])').waitFor({timeout:5000});const gate=responseGate();heldExecute=gate;let disabledDuring;
  try{await f.locator('#confirmCommit').click();await gate.wait();assert.equal(git(repos[1],'log','-1','--format=%s'),'Synthetic commit completed by the fixture');disabledDuring=await f.locator('#commitSummary').isDisabled();if(!disabledDuring)await f.locator('#commitSummary').fill('Text typed after the commit request');}finally{heldExecute=null;gate.release();}
  await idle();observations.push({name:'commit-draft-lock',disabledDuring,after:await f.locator('#commitSummary').inputValue()});assert.equal(disabledDuring,true,'editing after commit_execute starts would otherwise be cleared by the success response');assert.equal(await f.locator('#commitSummary').isEnabled(),true,'Stage, reading, and later drafts stay editable outside actual commit execution');
 });
 await writeFile(join(directory,'review-fluency-results.json'),JSON.stringify({checks,failures,errors,reads,observations},null,2));assert.deepEqual(errors,[],'uncaught browser errors');assert.deepEqual(failures,[],'continuous interactions must preserve the last user intent');console.log(`review-fluency: ${checks.length} checks passed; artifacts ${directory}`);
}finally{heldRead?.release();heldCommit?.release();heldOpen?.release();heldChanges?.release();heldExecute?.release();await browser?.close();await app.server.close();app.store.close();await rm(root,{recursive:true,force:true});}

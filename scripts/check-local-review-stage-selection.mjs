import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,html} from '../plugins/codex-local-review/servers/server.mjs';
import {mountNative,auditSession} from './ui-audit-helpers.mjs';

// Only this synthetic repository is modified. Slow unrelated reads reproduce
// the changing Summary card heights seen while a staged file is revealed.
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const root=await mkdtemp(join(tmpdir(),'review-stage-selection-')),repo=join(root,'fixture');await mkdir(repo);
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
const names=Array.from({length:19},(_,i)=>`file-${String(i+1).padStart(2,'0')}.txt`),target=names[9];
const contents=prefix=>Array.from({length:100},(_,i)=>`${prefix} line ${i+1}: synthetic review content`).join('\n')+'\n';
for(const name of names)await writeFile(join(repo,name),contents('before'));git('add','.');git('commit','-qm','initial');
for(const name of names)await writeFile(join(repo,name),contents('after'));
const app=await createServer({dir:join(root,'data'),taskContexts:{listTasks:async()=>({tasks:[],notice:''})}});await app.projects.open(repo);
let browser,readGate,gateMutations=true,holdIndexResponse=false,indexResponseGate;
const observations=[],failures=[];
function beginReadGate(){
 const gate={waiting:0,finished:0,paths:new Set(),released:false};
 gate.promise=new Promise(resolve=>gate.release=()=>{gate.released=true;resolve();});
 return gate;
}
const actions=new Map(app.actions);
actions.set('git_index_change',async args=>{readGate=beginReadGate();if(!gateMutations)readGate.release();const result=await app.actions.get('git_index_change')(args);if(holdIndexResponse){indexResponseGate=beginReadGate();await indexResponseGate.promise;}return result;});
actions.set('project_file',async args=>{
 const gate=readGate;
 if(gate&&!gate.released&&args.path!==target){gate.waiting++;gate.paths.add(args.path);await gate.promise;gate.waiting--;gate.finished++;}
 return app.actions.get('project_file')(args);
});
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1550,height:1000}}),audit=await auditSession(page,'review-stage-selection'),f=await mountNative(page,html(),actions);
 const idle=()=>page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.body.getAttribute('aria-busy')==='false');
 const card=mode=>f.locator(`[data-summary-mode=${mode}] [data-summary-path="${target}"]`);
 const geometry=mode=>card(mode).locator('.summary-file-header').evaluate(header=>{const r=header.getBoundingClientRect(),column=header.closest('.detail-column'),c=column.getBoundingClientRect();return {top:r.top,bottom:r.bottom,columnTop:c.top,columnBottom:c.bottom,scrollTop:column.scrollTop,scrollHeight:column.scrollHeight,visible:r.top>=c.top&&r.bottom<=c.bottom};});
 await idle();
 for(const [operation,source,destination] of [['stage','unstaged','staged'],['unstage','staged','unstaged']]){
  await card(source).scrollIntoViewIfNeeded();await card(source).locator('.diff-table').waitFor();
  await card(source).getByRole('button',{name:operation==='stage'?'Stage':'Unstage',exact:true}).click();
  await page.waitForFunction(({path,mode})=>Boolean(document.querySelector('iframe')?.contentDocument.querySelector(`[data-summary-mode=${mode}] [data-summary-path="${path}"]`)),{path:target,mode:destination});
  // Let the initial reveal run before slower unrelated cards resolve. The
  // bounded fallback also permits an implementation that waits before focus.
  await page.waitForFunction(path=>{const d=document.querySelector('iframe')?.contentDocument;window.revealGateStart??=performance.now();return d?.activeElement?.closest('[data-summary-path]')?.dataset.summaryPath===path||performance.now()-window.revealGateStart>200;},target);
  const before=await geometry(destination);await audit.screenshot(`${operation}-before-delayed-reads`);
  readGate.release();
  await idle();await card(destination).locator('.diff-table').waitFor();
  await page.evaluate(()=>{window.stageLayoutSample=null;window.revealGateStart=null;});
  await page.waitForFunction(()=>{const d=document.querySelector('iframe')?.contentDocument,c=d?.querySelector('.detail-column');if(!c)return false;const sample=JSON.stringify([c.scrollTop,c.scrollHeight,[...d.querySelectorAll('[data-loading=true]')].length]);window.stageLayoutSample=window.stageLayoutSample||{};const s=window.stageLayoutSample;if(s.value!==sample){s.value=sample;s.since=performance.now();return false;}return performance.now()-s.since>500;});
  const after=await geometry(destination),observation={operation,target,before,after,delayedPaths:[...readGate.paths],waitingReads:readGate.waiting,finishedReads:readGate.finished};observations.push(observation);console.log(JSON.stringify(observation));await audit.screenshot(`${operation}-after-delayed-reads`);
  await audit.check(`${operation} changes only the clicked file and keeps Summary open`,async()=>{
   assert.equal(git('diff','--cached','--name-only'),operation==='stage'?target:'');
   if(operation==='stage'){assert.ok(readGate.paths.size>0,'Stage fixture must exercise delayed unrelated previews');assert.ok(readGate.finished>0,'Stage fixture must release those delayed previews');}
   assert.equal(await f.getByRole('tab',{name:'Summary',exact:true}).getAttribute('aria-selected'),'true');
   assert.equal(await f.locator('[data-scope=working]').getAttribute('aria-pressed'),'true');
  });
  try{await audit.check(`${operation} target header stays visible after unrelated Summary cards finish loading`,()=>assert.equal(after.visible,true,`${operation} target ${target} left the viewport after delayed cards resolved`));}catch(error){failures.push(error.message);}
 }
 gateMutations=false;
 for(const [operation,source,destination] of [['stage','unstaged','staged'],['unstage','staged','unstaged']]){
  await f.locator(`[data-scope=${source}]`).click();await idle();
  await f.locator(`#files [data-path="${target}"]`).click();await idle();
  await f.locator(operation==='stage'?'#stageFile':'#unstageFile').click();await idle();
  const selected={operation,scope:await f.locator('[data-scope][aria-pressed=true]').getAttribute('data-scope'),path:await f.locator('#fileTitle').textContent(),tab:await f.locator('#detailTabs [aria-selected=true]').textContent()};observations.push(selected);console.log(JSON.stringify(selected));
  try{await audit.check(`${operation} from a file tab follows the same path to its ${destination} comparison`,async()=>{
   assert.equal(selected.path,target,'index changes must not select an unrelated file');
   assert.equal(selected.tab,`${destination==='staged'?'S':'M'} ${target}`);
   assert.equal(await f.getByRole('tab',{name:'Summary',exact:true}).getAttribute('aria-selected'),'false');
   assert.equal(git('diff','--cached','--name-only'),operation==='stage'?target:'');
  });}catch(error){failures.push(error.message);}
 }
 gateMutations=true;
 await f.locator('[data-scope=working]').click();await idle();
 for(const [gesture,operation,source,destination] of [['wheel','stage','unstaged','staged'],['pointer','unstage','staged','unstaged']]){
  await card(source).scrollIntoViewIfNeeded();await card(source).locator('.diff-table').waitFor();
  // Simulate unrelated edits since those cards were cached. Their refreshed
  // previews must complete after the user's own navigation gesture.
  for(const name of names)if(name!==target)await writeFile(join(repo,name),contents(`after ${gesture}`));
  await card(source).getByRole('button',{name:operation==='stage'?'Stage':'Unstage',exact:true}).click();
  await page.waitForFunction(({path,mode})=>{const d=document.querySelector('iframe')?.contentDocument,e=d?.activeElement;return e?.closest('[data-summary-path]')?.dataset.summaryPath===path&&e?.closest('[data-summary-mode]')?.dataset.summaryMode===mode;},{path:target,mode:destination});
  assert.ok(readGate.waiting>0,'fixture must still have unrelated preview reads pending at the navigation gesture');
  if(gesture==='wheel'){
   const column=await f.locator('.detail-column').boundingBox(),start=await f.locator('.detail-column').evaluate(e=>e.scrollTop);
   await page.mouse.move(column.x+column.width/2,column.y+column.height/2);await page.mouse.wheel(0,-1000);
   await page.waitForFunction(start=>document.querySelector('iframe')?.contentDocument.querySelector('.detail-column').scrollTop<start-200,start);
  }else{
   await f.locator('[data-summary-mode=unstaged] > .summary-section-header h2').click();
  }
  const userPosition=await geometry(destination);assert.equal(userPosition.visible,false,'the real user gesture must move away from the Stage/Unstage target');
  readGate.release();await idle();await card(destination).locator('.diff-table').waitFor();
  await page.evaluate(()=>{window.stageLayoutSample=null;});
  await page.waitForFunction(()=>{const d=document.querySelector('iframe')?.contentDocument,c=d?.querySelector('.detail-column');if(!c)return false;const sample=JSON.stringify([c.scrollTop,c.scrollHeight,[...d.querySelectorAll('[data-loading=true]')].length]);window.stageLayoutSample=window.stageLayoutSample||{};const s=window.stageLayoutSample;if(s.value!==sample){s.value=sample;s.since=performance.now();return false;}return performance.now()-s.since>500;});
  const after=await geometry(destination),observation={gesture,operation,target,userPosition,after,delayedPaths:[...readGate.paths],waitingReads:readGate.waiting,finishedReads:readGate.finished};observations.push(observation);console.log(JSON.stringify(observation));await audit.screenshot(`${gesture}-keeps-user-position`);
  try{await audit.check(`${gesture} navigation overrides automatic Stage/Unstage target tracking`,async()=>{
   assert.equal(after.visible,false,'late preview loads must not pull the user back to the previous operation target');
   assert.equal(await f.getByRole('tab',{name:'Summary',exact:true}).getAttribute('aria-selected'),'true');
   assert.equal(git('diff','--cached','--name-only'),operation==='stage'?target:'');
  });}catch(error){failures.push(error.message);}
 }
 gateMutations=false;holdIndexResponse=true;
 await card('unstaged').scrollIntoViewIfNeeded();await card('unstaged').locator('.diff-table').waitFor();
 await card('unstaged').getByRole('button',{name:'Stage',exact:true}).click();
 // The real Git write has completed, but its RPC response is still pending.
 // Navigation during this interval must cancel the reveal scheduled later.
 await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.body.getAttribute('aria-busy')==='true');
 const started=Date.now();while(!indexResponseGate){assert.ok(Date.now()-started<5000,'fixture must receive git_index_change');await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(git('diff','--cached','--name-only'),target);
 const column=await f.locator('.detail-column').boundingBox(),start=await f.locator('.detail-column').evaluate(e=>e.scrollTop);
 await page.mouse.move(column.x+column.width/2,column.y+column.height/2);await page.mouse.wheel(0,-10000);
 await page.waitForFunction(start=>document.querySelector('iframe')?.contentDocument.querySelector('.detail-column').scrollTop<start-200,start);
 const during=await geometry('unstaged');assert.equal(during.visible,false,'early wheel must leave the source file before RPC response');
 indexResponseGate.release();await idle();
 await page.evaluate(()=>{window.stageLayoutSample=null;});
 await page.waitForFunction(()=>{const d=document.querySelector('iframe')?.contentDocument,c=d?.querySelector('.detail-column');if(!c)return false;const sample=JSON.stringify([c.scrollTop,c.scrollHeight,[...d.querySelectorAll('[data-loading=true]')].length]);window.stageLayoutSample=window.stageLayoutSample||{};const s=window.stageLayoutSample;if(s.value!==sample){s.value=sample;s.since=performance.now();return false;}return performance.now()-s.since>500;});
 const after=await geometry('staged'),focusedPath=await f.locator('body').evaluate(body=>body.ownerDocument.activeElement?.closest('[data-summary-path]')?.dataset.summaryPath||'');observations.push({gesture:'wheel-during-index-rpc',target,during,after,focusedPath});console.log(JSON.stringify(observations.at(-1)));await audit.screenshot('wheel-before-rpc-keeps-user-position');
 try{await audit.check('wheel while index RPC is pending cancels its later reveal',()=>{assert.equal(after.visible,false,'pending operation must not pull the user back after they navigate');assert.notEqual(focusedPath,target,'pending operation must not restore focus after user navigation');});}catch(error){failures.push(error.message);}
 await writeFile(join(audit.directory,'review-stage-selection-layout.json'),JSON.stringify({observations,failures},null,2));
 await audit.finish();assert.deepEqual(failures,[],'Stage/Unstage must preserve the target after asynchronous Summary layout changes');
}finally{readGate?.release();indexResponseGate?.release();await browser?.close();await app.server.close();app.store.close();await rm(root,{recursive:true,force:true});}

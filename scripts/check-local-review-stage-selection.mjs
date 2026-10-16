import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,html} from '../plugins/codex-local-review/servers/server.mjs';
import {mountNative,auditSession} from './ui-audit-helpers.mjs';

// Only this synthetic repository is modified. Summary operations retain the
// source review context; a single-file tab follows its own comparison side.
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const root=await mkdtemp(join(tmpdir(),'review-stage-selection-')),repo=join(root,'fixture');await mkdir(repo);
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
const names=Array.from({length:19},(_,i)=>`file-${String(i+1).padStart(2,'0')}.txt`),target=names[9];
const contents=prefix=>Array.from({length:100},(_,i)=>`${prefix} line ${i+1}: synthetic review content`).join('\n')+'\n';
for(const name of names)await writeFile(join(repo,name),contents('before'));git('add','.');git('commit','-qm','initial');
for(const name of names)await writeFile(join(repo,name),contents('after'));
// Unstage needs a remaining source-section neighbour, too.
git('add','--',names[18]);
const app=await createServer({dir:join(root,'data'),taskContexts:{listTasks:async()=>({tasks:[],notice:''})}});await app.projects.open(repo);
let browser,readGate,holdReads=true,holdIndexResponse=false,indexResponseGate;
const observations=[],slowPaths=new Set();
function gate(){const value={waiting:0,finished:0,paths:new Set(),released:false};value.promise=new Promise(resolve=>value.release=()=>{value.released=true;resolve();});return value;}
const actions=new Map(app.actions);
actions.set('git_index_change',async args=>{
 readGate=gate();if(!holdReads)readGate.release();
 const result=await app.actions.get('git_index_change')(args);
 if(holdIndexResponse){indexResponseGate=gate();await indexResponseGate.promise;}
 return result;
});
actions.set('project_file',async args=>{
 const current=readGate;
 if(current&&!current.released&&slowPaths.has(args.path)){current.waiting++;current.paths.add(args.path);await current.promise;current.waiting--;current.finished++;}
 return app.actions.get('project_file')(args);
});
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1550,height:1000}}),audit=await auditSession(page,'review-stage-selection'),f=await mountNative(page,html(),actions);
 const idle=()=>page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.body.getAttribute('aria-busy')==='false');
 const card=(mode,path=target)=>f.locator(`[data-summary-mode=${mode}] [data-summary-path="${path}"]`);
 const geometry=(mode,path=target)=>card(mode,path).locator('.summary-file-header').evaluate(header=>{const r=header.getBoundingClientRect(),column=header.closest('.detail-column'),c=column.getBoundingClientRect();return {top:r.top,bottom:r.bottom,columnTop:c.top,columnBottom:c.bottom,scrollTop:column.scrollTop,scrollHeight:column.scrollHeight,visible:r.top>=c.top&&r.bottom<=c.bottom};});
 const index=()=>git('diff','--cached','--name-only').split('\n').filter(Boolean).sort();
 const expectedIndex=(before,operation)=>[...new Set(operation==='stage'?[...before,target]:before.filter(path=>path!==target))].sort();
 async function settle(){
  await idle();await page.evaluate(()=>{window.stageLayoutSample=null;});
  await page.waitForFunction(()=>{const d=document.querySelector('iframe')?.contentDocument,c=d?.querySelector('.detail-column');if(!c)return false;const sample=JSON.stringify([c.scrollTop,c.scrollHeight,[...d.querySelectorAll('[data-loading=true]')].length]);const s=window.stageLayoutSample??={};if(s.value!==sample){s.value=sample;s.since=performance.now();return false;}return performance.now()-s.since>350;});
 }
 async function prepare(source,neighbour){
  // A real navigation click releases any earlier asynchronous anchor before
  // positioning the next fixture. Programmatic setup scrolling is not input.
  await f.getByRole('tab',{name:'Summary',exact:true}).click();await idle();
  await card(source,neighbour).locator('.summary-file-header').scrollIntoViewIfNeeded();await card(source,neighbour).locator('.diff-table').waitFor();
  await card(source).locator('.summary-file-header').scrollIntoViewIfNeeded();await card(source).locator('.diff-table').waitFor();await settle();
  await card(source).locator('.summary-file-header').scrollIntoViewIfNeeded();await settle();assert.equal((await geometry(source)).visible,true,'fixture must begin with its operated header in the viewport');
 }
 async function sampleStart(source,neighbour){
  await page.evaluate(({source,target,neighbour})=>{
   const d=document.querySelector('iframe').contentDocument,c=d.querySelector('.detail-column'),find=path=>d.querySelector(`[data-summary-mode=${source}] [data-summary-path="${path}"]`),node=find(neighbour),diff=node.querySelector('.diff-table');
   const data={source,target,neighbour,node,diff,frames:[],running:true,start:performance.now()};window.stageSampler=data;
   const snapshot=trigger=>{const current=find(neighbour),header=current?.querySelector('.summary-file-header'),r=header?.getBoundingClientRect(),viewport=c.getBoundingClientRect();data.frames.push({trigger,ms:performance.now()-data.start,scrollTop:c.scrollTop,cardCount:d.querySelectorAll('[data-summary-path]').length,sourcePresent:Boolean(find(target)),neighbourPresent:Boolean(current),sameCard:current===node,sameDiff:current?.querySelector('.diff-table')===diff,top:r?.top??null,visible:Boolean(r&&r.top>=viewport.top&&r.bottom<=viewport.bottom),busy:d.body.getAttribute('aria-busy')});};
   data.observer=new MutationObserver(()=>snapshot('mutation'));data.observer.observe(d.querySelector('#code'),{childList:true,subtree:true});
   const tick=()=>{if(!data.running)return;snapshot('frame');requestAnimationFrame(tick);};tick();
  },{source,target,neighbour});
 }
 async function sampleStop(){return page.evaluate(()=>{const data=window.stageSampler;data.running=false;data.observer.disconnect();return data.frames;});}
 async function pressure(source,label){
  slowPaths.clear();slowPaths.add(source==='unstaged'?names[8]:names[17]);
  for(const path of slowPaths)await writeFile(join(repo,path),contents(`after ${label}`));
 }
 async function waitReads(){const start=Date.now();while(!readGate?.waiting){assert.ok(Date.now()-start<5000,'fixture must exercise a delayed unrelated preview beside the source review context');await new Promise(resolve=>setTimeout(resolve,10));}}
 await idle();
 for(const [operation,source,destination,neighbour] of [['stage','unstaged','staged',names[10]],['unstage','staged','unstaged',names[18]]]){
  await prepare(source,neighbour);const before=await geometry(source),beforeIndex=index();await pressure(source,operation);await sampleStart(source,neighbour);
  await card(source).getByRole('button',{name:operation==='stage'?'Stage':'Unstage',exact:true}).click();
  await page.waitForFunction(({path,mode})=>!document.querySelector('iframe')?.contentDocument.querySelector(`[data-summary-mode=${mode}] [data-summary-path="${path}"]`),{path:target,mode:source});
  await waitReads();const pending=await geometry(source,neighbour);await audit.screenshot(`${operation}-pending-preview`);
  readGate.release();await settle();const after=await geometry(source,neighbour),frames=await sampleStop();
  observations.push({operation,source,destination,target,neighbour,before,pending,after,frames,delayedPaths:[...readGate.paths],finishedReads:readGate.finished});await audit.screenshot(`${operation}-source-context`);
  await writeFile(join(audit.directory,'review-stage-selection-layout.json'),JSON.stringify({observations},null,2));
  console.log(JSON.stringify({operation,source,neighbour,before,pending,after,frames:frames.length,offscreenPaintedFrames:frames.filter(frame=>frame.trigger==='frame'&&!frame.sourcePresent&&!frame.visible).length,delayedPaths:[...readGate.paths],finishedReads:readGate.finished}));
  await audit.check(`${operation} changes only the clicked file and keeps the working Summary`,async()=>{
   assert.deepEqual(index(),expectedIndex(beforeIndex,operation));
   assert.equal(await f.getByRole('tab',{name:'Summary',exact:true}).getAttribute('aria-selected'),'true');
   assert.equal(await f.locator('[data-scope=working]').getAttribute('aria-pressed'),'true');
   assert.equal(await card(destination).count(),1);assert.ok(readGate.finished>0);
  });
  await audit.check(`${operation} continues with the next file in its source review section`,async()=>{
   assert.equal(pending.visible,true,'source neighbour must be visible before delayed previews resolve');assert.equal(after.visible,true,'source neighbour must remain visible after delayed previews resolve');
   // The surface may add its standard 8px tab clearance when replacing a
   // sticky operated header; this must not become a section-sized jump.
   assert.ok(Math.abs(after.top-before.top)<=12,'source neighbour should replace the operated file at the same review position');
   const focus=await f.locator('body').evaluate(body=>{const e=body.ownerDocument.activeElement;return {path:e?.closest('[data-summary-path]')?.dataset.summaryPath,mode:e?.closest('[data-summary-mode]')?.dataset.summaryMode};});
   assert.notDeepEqual(focus,{path:target,mode:destination},'Summary must not move focus across sections to follow the operated path');
  });
  await audit.check(`${operation} has no intermediate blanking, replaced neighbour DOM or viewport jump`,()=>{
   const changed=frames.filter(frame=>!frame.sourcePresent),painted=changed.filter(frame=>frame.trigger==='frame');assert.ok(painted.length>1,'sample intermediate and settled frames after the source file disappears');
   assert.equal(frames.some(frame=>frame.cardCount===0),false,'Summary must never blank while refreshing');
   assert.equal(changed.some(frame=>!frame.neighbourPresent||!frame.sameCard||!frame.sameDiff),false,'unchanged neighbour and its loaded diff must retain DOM identity');
   assert.equal(painted.some(frame=>!frame.visible),false,'a final scroll correction cannot hide an intermediate jump');
   assert.ok(Math.max(...painted.map(frame=>Math.abs(frame.top-before.top)))<=12,'source review position must remain stable throughout asynchronous preview loading');
  });
 }
 holdReads=false;
 for(const [operation,source,destination] of [['stage','unstaged','staged'],['unstage','staged','unstaged']]){
  await f.locator(`[data-scope=${source}]`).click();await idle();await f.locator(`#files [data-path="${target}"]`).click();await idle();const before=index();
  await f.locator(operation==='stage'?'#stageFile':'#unstageFile').click();await idle();
  await audit.check(`${operation} from a file tab follows the same path to its ${destination} comparison`,async()=>{
   assert.equal(await f.locator('#fileTitle').textContent(),target);assert.equal(await f.locator('#detailTabs [aria-selected=true]').textContent(),`${destination==='staged'?'S':'M'} ${target}`);
   assert.equal(await f.getByRole('tab',{name:'Summary',exact:true}).getAttribute('aria-selected'),'false');assert.deepEqual(index(),expectedIndex(before,operation));
  });
 }
 holdReads=true;await f.locator('[data-scope=working]').click();await idle();
 for(const [gesture,operation,source,neighbour] of [['wheel','stage','unstaged',names[10]],['pointer','unstage','staged',names[18]]]){
  await prepare(source,neighbour);await pressure(source,gesture);const before=index();
  await card(source).getByRole('button',{name:operation==='stage'?'Stage':'Unstage',exact:true}).click();
  await page.waitForFunction(({mode,path})=>!document.querySelector('iframe')?.contentDocument.querySelector(`[data-summary-mode=${mode}] [data-summary-path="${path}"]`),{mode:source,path:target});await waitReads();
  if(gesture==='wheel'){
   const column=await f.locator('.detail-column').boundingBox(),start=await f.locator('.detail-column').evaluate(e=>e.scrollTop);await page.mouse.move(column.x+column.width/2,column.y+column.height/2);await page.mouse.wheel(0,-1000);
   await page.waitForFunction(start=>document.querySelector('iframe')?.contentDocument.querySelector('.detail-column').scrollTop<start-200,start);
  }else await f.locator('[data-summary-mode=unstaged] > .summary-section-header h2').click();
  const userPosition=await geometry(source,neighbour);assert.equal(userPosition.visible,false,'the real navigation gesture must leave the automatic source anchor');
  readGate.release();await settle();const after=await geometry(source,neighbour);observations.push({gesture,operation,source,neighbour,userPosition,after,delayedPaths:[...readGate.paths],finishedReads:readGate.finished});await audit.screenshot(`${gesture}-keeps-user-context`);
  await audit.check(`${gesture} navigation overrides source-context tracking during delayed previews`,async()=>{assert.equal(after.visible,false,'late previews must not pull the user back to the old source review position');assert.deepEqual(index(),expectedIndex(before,operation));});
 }
 holdReads=false;holdIndexResponse=true;
 await prepare('unstaged',names[10]);await card('unstaged').getByRole('button',{name:'Stage',exact:true}).click();
 const started=Date.now();while(!indexResponseGate){assert.ok(Date.now()-started<5000,'fixture must receive and hold the index RPC response');await new Promise(resolve=>setTimeout(resolve,10));}
 const column=await f.locator('.detail-column').boundingBox(),start=await f.locator('.detail-column').evaluate(e=>e.scrollTop);await page.mouse.move(column.x+column.width/2,column.y+column.height/2);await page.mouse.wheel(0,-10000);
 await page.waitForFunction(start=>document.querySelector('iframe')?.contentDocument.querySelector('.detail-column').scrollTop<start-200,start);
 // Wait for the real wheel to finish before measuring the manual position.
 await page.waitForTimeout(100);const manual=await f.locator('.detail-column').evaluate(e=>e.scrollTop);assert.equal((await geometry('unstaged')).visible,false);
 indexResponseGate.release();await settle();const after=await f.locator('.detail-column').evaluate(e=>e.scrollTop),focusedPath=await f.locator('body').evaluate(body=>body.ownerDocument.activeElement?.closest('[data-summary-path]')?.dataset.summaryPath||'');
 observations.push({gesture:'wheel-during-index-rpc',target,manual,after,focusedPath});await audit.screenshot('wheel-before-rpc-keeps-user-context');
 await audit.check('wheel while index RPC is pending cancels its later source-context restore',()=>{assert.ok(Math.abs(after-manual)<=3,'pending response must preserve the manual review position');assert.notEqual(focusedPath,target,'pending response must not restore the old operation focus');});
 holdIndexResponse=false;slowPaths.clear();
 // The operated file is last in this source section, so the preceding file
 // is the only remaining review context. Direct setup writes stay synthetic.
 git('restore','--staged','--source=HEAD','--',names[18]);git('add','--',names[8]);await f.locator('#refresh').click();await settle();
 await prepare('staged',names[8]);const predecessorBefore=await geometry('staged'),predecessorIndex=index();await sampleStart('staged',names[8]);
 await card('staged').getByRole('button',{name:'Unstage',exact:true}).click();await settle();const predecessorAfter=await geometry('staged',names[8]),predecessorFrames=await sampleStop();
 observations.push({case:'source-predecessor',before:predecessorBefore,after:predecessorAfter,frames:predecessorFrames});
 await audit.check('removing the last source file retains its previous review neighbour',()=>{
  assert.deepEqual(index(),expectedIndex(predecessorIndex,'unstage'));assert.equal(predecessorAfter.visible,true);assert.ok(Math.abs(predecessorAfter.top-predecessorBefore.top)<=12);
  const painted=predecessorFrames.filter(frame=>frame.trigger==='frame'&&!frame.sourcePresent);assert.ok(painted.length>1);assert.equal(painted.some(frame=>!frame.visible||!frame.sameCard||!frame.sameDiff),false);
 });
 // A search may leave no sibling in the source section. It must not turn
 // Summary into cross-section path following just because that path survives.
 await f.locator('#fileSearch').fill(target);await settle();await card('unstaged').locator('.summary-file-header').scrollIntoViewIfNeeded();await card('unstaged').locator('.diff-table').waitFor();await settle();
 const loneBefore=await f.locator('.detail-column').evaluate(e=>e.scrollTop),loneIndex=index();await card('unstaged').getByRole('button',{name:'Stage',exact:true}).click();await settle();
 const loneAfter=await f.locator('.detail-column').evaluate(e=>e.scrollTop),loneFocus=await f.locator('body').evaluate(body=>{const e=body.ownerDocument.activeElement;return {path:e?.closest('[data-summary-path]')?.dataset.summaryPath,mode:e?.closest('[data-summary-mode]')?.dataset.summaryMode};});
 observations.push({case:'no-source-neighbour',before:loneBefore,after:loneAfter,focus:loneFocus});
 await audit.check('a source section without neighbours preserves scroll without following its destination path',async()=>{
  assert.deepEqual(index(),expectedIndex(loneIndex,'stage'));assert.ok(Math.abs(loneAfter-loneBefore)<=3);assert.notDeepEqual(loneFocus,{path:target,mode:'staged'});
  assert.equal(await f.getByRole('tab',{name:'Summary',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await f.locator('[data-scope=working]').getAttribute('aria-pressed'),'true');
 });
 await writeFile(join(audit.directory,'review-stage-selection-layout.json'),JSON.stringify({observations},null,2));await audit.finish();
}finally{readGate?.release();indexResponseGate?.release();await browser?.close();await app.server.close();app.store.close();await rm(root,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createServer,html} from '../plugins/codex-local-review/servers/server.mjs';
import {mountNative,auditSession} from './ui-audit-helpers.mjs';

// All Git writes and measurements use a synthetic repository. Assertions use
// retained DOM and work counts; wall-clock timings are diagnostic, not gates.
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const root=await mkdtemp(join(tmpdir(),'review-performance-')),repo=join(root,'fixture');await mkdir(repo);
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
const names=Array.from({length:8},(_,i)=>`file-${String(i+1).padStart(2,'0')}.js`);
const contents=(path,prefix)=>Array.from({length:80},(_,i)=>`const value_${i} = '${path} ${prefix} ${i}'; // synthetic content`).join('\n')+'\n';
for(const name of names)await writeFile(join(repo,name),contents(name,'before'));git('add','.');git('commit','-qm','initial');
for(const name of names)await writeFile(join(repo,name),contents(name,'after'));
const app=await createServer({dir:join(root,'data'),taskContexts:{listTasks:async()=>({tasks:[],notice:''})}});await app.projects.open(repo);
let phase='boot',browser,previewGate;const calls=[],observations=[];
const actions=new Map([...app.actions].map(([name,fn])=>[name,async args=>{const start=performance.now(),label=phase;try{if(name==='project_file'&&args.path===names[6]&&previewGate&&!previewGate.released){previewGate.waiting=true;await previewGate.promise;}return await fn(args);}finally{calls.push({phase:label,name,path:args.path,ms:performance.now()-start});}}]));
const instrumentation=`<script>window.reviewPerf={diffCalls:0,highlights:0,longTasks:[]};const originalDiff=window.Diff.diffLines;window.Diff.diffLines=function(...args){window.reviewPerf.diffCalls++;return originalDiff.apply(this,args);};const originalHighlight=window.hljs.highlight;window.hljs.highlight=function(...args){window.reviewPerf.highlights++;return originalHighlight.apply(this,args);};new PerformanceObserver(list=>window.reviewPerf.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});window.clearReviewPerf=()=>{window.reviewPerf={diffCalls:0,highlights:0,longTasks:[]};};</script>`;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1550,height:1000}}),audit=await auditSession(page,'review-performance');
 const f=await mountNative(page,html().replace('<script type="module">',instrumentation+'<script type="module">'),actions);
 const idle=()=>page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.body.getAttribute('aria-busy')==='false');
 const settled=async()=>{await idle();await page.waitForFunction(()=>{const d=document.querySelector('iframe')?.contentDocument;if(d?.querySelector('[data-loading=true]'))return false;const value=JSON.stringify([d.querySelectorAll('.diff-table').length,d.querySelector('.detail-column')?.scrollHeight]);window.reviewLayoutSince??=performance.now();if(value!==window.reviewLayout){window.reviewLayout=value;window.reviewLayoutSince=performance.now();}return performance.now()-window.reviewLayoutSince>250;});};
 const card=path=>f.locator(`[data-summary-mode=unstaged] [data-summary-path="${path}"]`);
 const wheelTo=async path=>{const column=await f.locator('.detail-column').boundingBox(),delta=await card(path).evaluate(e=>e.getBoundingClientRect().top-e.closest('.detail-column').getBoundingClientRect().top-80);await page.mouse.move(column.x+column.width/2,column.y+column.height/2);await page.mouse.wheel(0,delta||1);};
 const measure=async(label,work)=>{phase=label;await f.locator('body').evaluate(()=>window.clearReviewPerf());const start=performance.now();await work();await settled();const observation={phase:label,ms:performance.now()-start,...await f.locator('body').evaluate(()=>window.reviewPerf),calls:calls.filter(c=>c.phase===label)};observations.push(observation);console.log(JSON.stringify(observation));return observation;};
 await settled();
 // Load the synthetic cards once, then retain the actual nodes as evidence.
 for(const path of names){await card(path).scrollIntoViewIfNeeded();await card(path).locator('.diff-table').waitFor();}await settled();
 await card(names[2]).scrollIntoViewIfNeeded();
 await f.locator('body').evaluate(()=>{window.savedSummaryNodes=new Map([...document.querySelectorAll('[data-summary-path]')].map(e=>[e.dataset.summaryPath,{card:e,table:e.querySelector('.diff-table')}]));window.savedSummaryScroll=document.querySelector('.detail-column').scrollTop;});
 await measure('open-file',async()=>{await f.locator(`#files [data-path="${names[2]}"]`).click();});
 const back=await measure('cached-summary-return',async()=>{await f.getByRole('tab',{name:'Summary',exact:true}).click();});
 await audit.check('cached Summary return retains every card and diff table without recomputing or highlighting',async()=>{
  assert.equal(await f.locator('body').evaluate(()=>[...window.savedSummaryNodes].every(([path,saved])=>{const card=[...document.querySelectorAll('[data-summary-path]')].find(e=>e.dataset.summaryPath===path);return card===saved.card&&card?.querySelector('.diff-table')===saved.table;})),true,'returning to cached Summary must retain the actual diff DOM');
  assert.equal(back.diffCalls,0,'cached Summary must not run diff calculation again');assert.equal(back.highlights,0,'cached Summary must not highlight every loaded file again');
  assert.ok(await f.locator('.detail-column').evaluate(e=>Math.abs(e.scrollTop-window.savedSummaryScroll)<2),'Summary returns to the prior scroll position');
 });
 const filtered=await measure('cached-summary-search',async()=>{await f.locator('#fileSearch').fill('file-04');await f.locator('#fileSearch').fill('');});
 await audit.check('search and clear reuse loaded Summary previews',async()=>{
  assert.equal(await f.locator('body').evaluate(()=>[...window.savedSummaryNodes].every(([path,saved])=>{const card=[...document.querySelectorAll('[data-summary-path]')].find(e=>e.dataset.summaryPath===path);return card===saved.card&&card?.querySelector('.diff-table')===saved.table;})),true,'search must not discard loaded preview DOM');
  assert.equal(filtered.diffCalls,0);assert.equal(filtered.highlights,0);assert.equal(filtered.calls.filter(c=>c.name==='project_file'||c.name==='git_hunks').length,0,'clearing a filter must not reread unchanged files');
 });
 await card(names[2]).scrollIntoViewIfNeeded();
 await f.locator('body').evaluate(()=>{window.untouchedTable=[...document.querySelectorAll('[data-summary-path]')].find(e=>e.dataset.summaryPath==='file-04.js').querySelector('.diff-table');});
 await measure('summary-stage',async()=>{await card(names[2]).getByRole('button',{name:'Stage',exact:true}).click();});
 await audit.check('Stage preserves untouched Summary diff DOM',async()=>{
  assert.equal(await card(names[3]).locator('.diff-table').evaluate(e=>e===window.untouchedTable),true,'staging another file must not rebuild this loaded diff');
  assert.equal(git('diff','--cached','--name-only'),names[2]);
 });
 await measure('file-roundtrip',async()=>{await f.locator(`#files [data-path="${names[3]}"]`).click();await idle();await f.getByRole('tab',{name:'Summary',exact:true}).click();});
 await audit.check('repeated file/Summary navigation retains untouched preview DOM',async()=>assert.equal(await card(names[3]).locator('.diff-table').evaluate(e=>e===window.untouchedTable),true));
 previewGate={released:false,waiting:false};previewGate.promise=new Promise(resolve=>previewGate.release=()=>{previewGate.released=true;resolve();});
 await writeFile(join(repo,names[6]),contents(names[6],'externally changed'));phase='pending-preview';
 await f.locator('#refresh').click();await idle();await wheelTo(names[6]);
 const gateStart=performance.now();while(!previewGate.waiting){assert.ok(performance.now()-gateStart<5000,'fixture must enter the delayed Summary read');await new Promise(resolve=>setTimeout(resolve,10));}
 await f.locator(`#files [data-path="${names[3]}"]`).click();await idle();previewGate.release();
 // Wait for both verified file reads to finish while Summary is detached.
 const readStart=performance.now();while(calls.filter(c=>c.phase==='pending-preview'&&c.name==='project_file'&&c.path===names[6]).length<2){assert.ok(performance.now()-readStart<5000,'detached Summary read must finish its verification');await new Promise(resolve=>setTimeout(resolve,10));}
 await measure('return-after-detached-read',async()=>{await f.getByRole('tab',{name:'Summary',exact:true}).click();});
 await audit.check('a preview finishing while Summary is detached renders on return',async()=>{await wheelTo(names[6]);await card(names[6]).locator('.diff-table').waitFor();assert.equal(await card(names[6]).locator('.summary-loading').count(),0);});
 await wheelTo(names[7]);await card(names[7]).locator('.diff-table').waitFor();await settled();
 await wheelTo(names[0]);
 await f.locator('body').evaluate(()=>{window.offscreenLayoutTable=[...document.querySelectorAll('[data-summary-path]')].find(e=>e.dataset.summaryPath==='file-08.js').querySelector('.diff-table');});
 await measure('summary-layout-visible-first',async()=>{await f.locator('#unifiedView').click();});
 await audit.check('layout changes update nearby cards without repainting every offscreen cached table',async()=>{
  await card(names[0]).locator('.diff-table.unified').waitFor();
  assert.equal(await card(names[7]).locator('.diff-table').evaluate(e=>e===window.offscreenLayoutTable),true,'offscreen cached tables must defer layout repaint');
 });
 await wheelTo(names[7]);await card(names[7]).locator('.diff-table.unified').waitFor();
 await audit.check('deferred cached tables adopt the current layout when scrolled into view',async()=>assert.equal(await card(names[7]).locator('.diff-table').evaluate(e=>e!==window.offscreenLayoutTable),true));
 await writeFile(join(audit.directory,'review-performance-measurements.json'),JSON.stringify({fixture:{files:names.length,lines:80},observations},null,2));await audit.finish();
}finally{previewGate?.release();await browser?.close();await app.server.close();app.store.close();await rm(root,{recursive:true,force:true});}

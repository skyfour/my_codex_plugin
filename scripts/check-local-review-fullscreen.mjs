import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,html} from '../plugins/codex-local-review/servers/server.mjs';
import {mountNative,auditSession} from './ui-audit-helpers.mjs';

// Historical commits, drafts and delayed writes all use this disposable repo.
// Long lines force a real wrapping change when the review pane grows wider.
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const root=await mkdtemp(join(tmpdir(),'review-fullscreen-')),repo=join(root,'fixture');await mkdir(repo);
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
const names=['a.txt','b.txt','c.txt'],content=(name,revision)=>Array.from({length:140},(_,i)=>`${name} ${revision} line ${String(i+1).padStart(3,'0')} ${'synthetic review context '.repeat(8)}`).join('\n')+'\n';
for(const name of names)await writeFile(join(repo,name),content(name,'before'));git('add','.');git('commit','-qm','initial fixture');
for(const name of names)await writeFile(join(repo,name),content(name,'reviewed commit'));git('add','.');git('commit','-qm','Historical review target');const target=git('rev-parse','HEAD');
await writeFile(join(repo,'later.txt'),'A later commit must not become the selected review.\n');git('add','.');git('commit','-qm','Later unrelated commit');
const app=await createServer({dir:join(root,'data'),taskContexts:{listTasks:async()=>({tasks:[],notice:''})}});await app.projects.open(repo);
const calls=[];let browser,heldUpdate;
const actions=new Map([...app.actions].map(([name,fn])=>[name,async args=>{calls.push({name,args});const gate=heldUpdate;if(name==='review_update'&&gate){gate.enter();await gate.promise;}return fn(args);} ]));
const instrumentation=`<script>window.fullscreenDiffCalls=0;const originalDiff=window.Diff.diffLines;window.Diff.diffLines=function(...args){window.fullscreenDiffCalls++;return originalDiff.apply(this,args);};</script>`;
function responseGate(){let enter,release,timer;const gate={promise:new Promise(resolve=>release=resolve),started:new Promise(resolve=>enter=resolve)};gate.enter=enter;gate.release=()=>release();gate.wait=async()=>{try{await Promise.race([gate.started,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Expected delayed update did not start')),5000))]);}finally{clearTimeout(timer);}};return gate;}
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1500,height:950}}),audit=await auditSession(page,'review-fullscreen');
 const f=await mountNative(page,html().replace('<script type="module">',instrumentation+'<script type="module">'),actions);
 const idle=()=>page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.body.getAttribute('aria-busy')==='false');
 const settled=async()=>{await idle();await page.waitForFunction(()=>{const d=document.querySelector('iframe')?.contentDocument;if(!d||d.querySelector('[data-loading=true]'))return false;const value=JSON.stringify([d.querySelector('.detail-column')?.scrollHeight,d.querySelector('#code')?.scrollHeight,d.querySelectorAll('.diff-table').length]);if(value!==window.fullscreenLayout){window.fullscreenLayout=value;window.fullscreenLayoutSince=performance.now();}return performance.now()-window.fullscreenLayoutSince>150;});};
 const toggle=f.locator('#reviewFullscreen'),isFull=()=>f.locator('body').evaluate(e=>e.classList.contains('review-fullscreen'));
 // Locator.click (including trial) can scroll the outer code column before
 // clicking a sticky header inside its scroll-padding. A user clicks the
 // visible button directly, so retain all anchor assertions and hit-test it.
 async function clickToggle({trial=false,timeout=1500}={}){await toggle.waitFor({state:'visible',timeout});assert.equal(await toggle.isEnabled(),true);const box=await toggle.boundingBox();assert.equal(await toggle.evaluate(node=>{const r=node.getBoundingClientRect(),hit=node.ownerDocument.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return node===hit||node.contains(hit);}),true,'fullscreen toggle receives pointer events at its current visible position');if(!trial)await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}

 const card=path=>f.locator(`[data-summary-path="${path}"]`);
 const selectedSha=()=>f.locator('#commits [aria-current=true]').getAttribute('data-sha');
 async function assertExpanded(){const bounds=await f.locator('.detail-column').boundingBox(),size=page.viewportSize();assert.ok(Math.abs(bounds.x)<2&&Math.abs(bounds.y)<2,'review starts at the viewport origin');assert.ok(Math.abs(bounds.width-size.width)<2,'review fills the viewport width');assert.ok(Math.abs(bounds.height-(size.height-26))<2,'status bar keeps its 26px row');for(const selector of ['.topbar','#projectTabs','#gitCommandBar','.projects-column','.files-column'])assert.equal(await f.locator(selector).isVisible(),false,selector+' is hidden in fullscreen');assert.equal(await f.locator('.statusbar').isVisible(),true);await clickToggle({trial:true,timeout:1500});}
 async function snapshotNodes(){return f.locator('body').evaluate(()=>{window.fullscreenNodes=[...document.querySelectorAll('[data-summary-path]')].map(card=>({card,table:card.querySelector('.diff-table')}));return window.fullscreenDiffCalls;});}
 async function assertNodes(diffCalls){assert.equal(await f.locator('body').evaluate(()=>window.fullscreenNodes.every(({card,table})=>card.isConnected&&card.querySelector('.diff-table')===table)),true,'toggle retains loaded card and table DOM');assert.equal(await f.locator('body').evaluate(()=>window.fullscreenDiffCalls),diffCalls,'toggle does not repeat diff calculation');}
 async function anchorLine(row,scrollSelector){
  await row.evaluate(e=>e.scrollIntoView({block:'center'}));await settled();
  await row.evaluate((e,selector)=>{const scroll=document.querySelector(selector),top=scroll.getBoundingClientRect().top,visibleTop=selector==='.detail-column'?Math.max(top,document.querySelector('#detailTabs').getBoundingClientRect().bottom,e.closest('[data-summary-path]').querySelector('.summary-file-header').getBoundingClientRect().bottom):top;scroll.scrollTop+=e.getBoundingClientRect().top-visibleTop-2;},scrollSelector);
  await settled();return row.evaluate((e,selector)=>({top:e.getBoundingClientRect().top-document.querySelector(selector).getBoundingClientRect().top,height:e.getBoundingClientRect().height,text:e.textContent}),scrollSelector);
 }
 async function assertLine(row,selector,before){const after=await row.evaluate((e,selector)=>({top:e.getBoundingClientRect().top-document.querySelector(selector).getBoundingClientRect().top,height:e.getBoundingClientRect().height,text:e.textContent}),selector);assert.equal(after.text,before.text);assert.ok(Math.abs(after.top-before.top)<=2,`same code line remains at its review position (${before.top} → ${after.top})`);return after;}
 await idle();
 await audit.check('fullscreen review is an accessible control outside the difference tablist',async()=>{await toggle.waitFor({state:'visible',timeout:1500});assert.equal(await toggle.getAttribute('aria-pressed'),'false');assert.equal(await toggle.evaluate(e=>Boolean(e.closest('[role=tablist]'))),false);assert.match(await toggle.textContent(),/全屏审阅/);await clickToggle({trial:true});});
 await f.locator('#commitsTab').click();await idle();await f.locator(`#commits [data-sha="${target}"]`).click();await idle();
 for(const path of names){await card(path).scrollIntoViewIfNeeded();await card(path).locator('.diff-table').waitFor();}await settled();
 await audit.check('historical commit Summary expands to the viewport and exits without changing commit or loaded DOM',async()=>{
  assert.equal(await selectedSha(),target);const diffCalls=await snapshotNodes(),beforeCalls=calls.length;
  await clickToggle();await settled();assert.equal(await isFull(),true);assert.equal(await toggle.getAttribute('aria-pressed'),'true');assert.match(await toggle.textContent(),/退出全屏/);await assertExpanded();assert.equal(await selectedSha(),target);await assertNodes(diffCalls);
  await clickToggle();await settled();assert.equal(await isFull(),false);assert.equal(await selectedSha(),target);await assertNodes(diffCalls);assert.equal(calls.length,beforeCalls,'layout toggles do not send tool RPCs');
 });
 await audit.check('Summary preserves the visible code-line anchor while longer lines rewrap',async()=>{
  const row=card('b.txt').locator('tr[data-row="70"]'),before=await anchorLine(row,'.detail-column');const diffCalls=await snapshotNodes(),beforeCalls=calls.length;
  await clickToggle();await settled();const expanded=await assertLine(row,'.detail-column',before);assert.ok(expanded.height<before.height,'fixture must actually change wrapped line height');await assertExpanded();await assertNodes(diffCalls);await audit.screenshot('historical-summary-expanded');
  await page.keyboard.press('Escape');await settled();assert.equal(await isFull(),false);await assertLine(row,'.detail-column',before);await assertNodes(diffCalls);assert.equal(await selectedSha(),target);assert.equal(calls.length,beforeCalls);
 });
 await audit.check('fullscreen supports Summary, file tabs and next-file navigation within the chosen historical commit',async()=>{
  await clickToggle();await f.getByRole('tab',{name:'· b.txt',exact:true}).click();await idle();assert.equal(await f.locator('#fileTitle').textContent(),'b.txt');assert.equal(await isFull(),true);
  await f.locator('#nextFile').click();await idle();assert.equal(await f.locator('#fileTitle').textContent(),'c.txt');assert.equal(await isFull(),true);assert.equal(await selectedSha(),target);
  await f.getByRole('tab',{name:'Summary',exact:true}).click();await settled();assert.equal(await f.getByRole('tab',{name:'Summary',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await isFull(),true);assert.equal(await selectedSha(),target);await assertExpanded();await clickToggle();await settled();
 });
 await audit.check('file review preserves its scroll, reviewed state and unsaved comment through fullscreen',async()=>{
  await f.getByRole('tab',{name:'· b.txt',exact:true}).click();await idle();await f.locator('#reviewed').check();await idle();assert.equal(await f.locator('#reviewed').isChecked(),true);
  await f.locator('#code .number button').first().click();await idle();await f.locator('#commentText').fill('Unsaved fullscreen review draft');await f.locator('#severity').selectOption('issue');
  const row=f.locator('#code tr[data-row="70"]'),before=await anchorLine(row,'#code'),beforeCalls=calls.length;
  await f.locator('body').evaluate(()=>window.fullscreenFileTable=document.querySelector('#code .diff-table'));
  await clickToggle();await settled();await assertExpanded();await assertLine(row,'#code',before);
  await clickToggle();await settled();await assertLine(row,'#code',before);assert.equal(await f.locator('#commentText').inputValue(),'Unsaved fullscreen review draft');assert.equal(await f.locator('#severity').inputValue(),'issue');assert.equal(await f.locator('#reviewed').isChecked(),true);assert.equal(await f.locator('#fileTitle').textContent(),'b.txt');assert.equal(await selectedSha(),target);assert.equal(await f.locator('#code .diff-table').evaluate(e=>e===window.fullscreenFileTable),true);assert.equal(calls.length,beforeCalls,'toggling cannot save or reload an unsaved review');
 });
 await audit.check('unwrapped code returns to its horizontal position after fullscreen clamps its right edge',async()=>{
  await f.locator('#wrapCode').uncheck();await settled();const view=f.locator('#code .diff-view');await view.evaluate(e=>e.scrollLeft=e.scrollWidth);const before=await view.evaluate(e=>e.scrollLeft);assert.ok(before>1000,'fixture has a substantial horizontal overflow');
  await clickToggle();await settled();assert.ok(await view.evaluate(e=>e.scrollLeft)<before-100,'expanding the pane really clamps its horizontal scroll range');await clickToggle();await settled();assert.ok(Math.abs(await view.evaluate(e=>e.scrollLeft)-before)<=1,'exiting restores the original right-edge position');
 });
 await audit.check('a horizontal scroll made inside fullscreen takes precedence on exit',async()=>{
  const view=f.locator('#code .diff-view');await view.evaluate(e=>e.scrollLeft=e.scrollWidth);await clickToggle();await settled();const expanded=await view.evaluate(e=>e.scrollLeft),box=await f.locator('#code').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+Math.min(40,box.height/2));await page.mouse.wheel(-350,0);
  await page.waitForFunction(left=>document.querySelector('iframe').contentDocument.querySelector('#code .diff-view').scrollLeft<left-100,expanded);await page.waitForTimeout(80);const manual=await view.evaluate(e=>e.scrollLeft);await clickToggle();await settled();assert.ok(Math.abs(await view.evaluate(e=>e.scrollLeft)-manual)<=1,'user horizontal navigation must survive exit instead of restoring the old position');await f.locator('#wrapCode').check();await settled();
 });
 await audit.check('Escape closes an active dialog before leaving fullscreen review',async()=>{
  await clickToggle();await f.locator('#export').click();await f.locator('#exportPanel[open]').waitFor();await page.keyboard.press('Escape');await f.locator('#exportPanel').waitFor({state:'hidden'});assert.equal(await isFull(),true,'dialog Escape must not also exit fullscreen');await page.keyboard.press('Escape');await settled();assert.equal(await isFull(),false);
 });
 await audit.check('fullscreen remains possible to exit while a review write is pending',async()=>{
  await clickToggle();heldUpdate=responseGate();const gate=heldUpdate;try{await f.locator('#reviewed').uncheck();await gate.wait();assert.equal(await f.locator('body').getAttribute('aria-busy'),'true');await clickToggle({timeout:1500});assert.equal(await isFull(),false,'exit is immediate while the write remains blocked');assert.equal(await f.locator('body').getAttribute('aria-busy'),'true');}finally{heldUpdate=null;gate.release();}await idle();assert.equal(await f.locator('#commentText').inputValue(),'Unsaved fullscreen review draft');
 });
 await audit.check('a dark host-theme notification preserves fullscreen layout and reachable exit',async()=>{
  await clickToggle();await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'dark'}},'*'));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('iframe').contentDocument.documentElement).colorScheme==='dark');await assertExpanded();assert.equal(await selectedSha(),target);assert.equal(await f.locator('#commentText').inputValue(),'Unsaved fullscreen review draft');await audit.screenshot('historical-file-dark-expanded');await clickToggle();await settled();assert.equal(await isFull(),false);assert.equal(await f.locator('html').evaluate(e=>getComputedStyle(e).colorScheme),'dark');
 });
 for(const size of [{width:620,height:500},{width:390,height:500}])await audit.check(`fullscreen entry and exit remain reachable in a ${size.width}×${size.height} panel`,async()=>{
  await page.setViewportSize(size);await settled();await clickToggle({timeout:2000});await settled();await assertExpanded();assert.equal(await f.locator('#fileTitle').textContent(),'b.txt');await audit.screenshot(`narrow-${size.width}`);await page.keyboard.press('Escape');await settled();assert.equal(await isFull(),false);await clickToggle({trial:true,timeout:1500});
 });
 await audit.finish();
}finally{heldUpdate?.release();await browser?.close();await app.server.close();app.store.close();await rm(root,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,html} from '../plugins/codex-local-review/servers/server.mjs';
import {mountNative,auditSession} from './ui-audit-helpers.mjs';

// Clipboard contents and repositories are synthetic; no user data is read.
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const root=await mkdtemp(join(tmpdir(),'review-copy-')),repo=join(root,'fixture');await mkdir(repo);
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:'pipe'}).trim();
git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
await writeFile(join(repo,'demo.txt'),Array.from({length:180},(_,i)=>`before ${i}\n`).join(''));git('add','.');git('commit','-qm','copy: initial fixture');
const first=git('rev-parse','HEAD'),message='copy: 完整提交说明\n\nBody with "quotes", <markup> and \\slashes.\n\n--story=123@tapd-456 --user=fixture\n';
await writeFile(join(root,'message'),message);await writeFile(join(repo,'demo.txt'),Array.from({length:180},(_,i)=>`after ${i}\n`).join(''));git('add','.');git('commit','--cleanup=verbatim','-q','-F',join(root,'message'));const full=git('rev-parse','HEAD');
const emptyMessage='copy: empty commit\n\nAn empty commit still has a complete message.\n';await writeFile(join(root,'message'),emptyMessage);git('commit','--allow-empty','--cleanup=verbatim','-q','-F',join(root,'message'));const empty=git('rev-parse','HEAD');
const tasks=[
 {id:'00000000-0000-4000-8000-000000000001',title:'Synthetic copy task A',keyword:'--task=101@tapd-100 --user=fixture Synthetic copy task A https://www.tapd.cn/100/s/101'},
 {id:'00000000-0000-4000-8000-000000000002',title:'Synthetic copy task B',keyword:'--story=202@tapd-100 --user=fixture Synthetic copy task B https://www.tapd.cn/100/s/202'}
].map(t=>({...t,account:'Fixture',sourceId:t.id.slice(-3),state:'open'}));
const [a,b]=tasks,mutations=[],writeTools=new Set(['commit_execute','git_index_change','git_hunk_apply','git_operation_execute','review_stage']);
const app=await createServer({dir:join(root,'data'),taskContexts:{listTasks:async()=>({tasks:tasks.map(t=>({...t,keyword:''})),notice:''}),getCommitContext:async taskId=>({taskId,keyword:tasks.find(t=>t.id===taskId).keyword})}});await app.projects.open(repo);let browser;
let messageErrorTarget='';const messageError='完整提交信息超过 8 MiB 上限，仍可查看差异，请在 Git 中手动复制。';
const actions={get(name){return async args=>{if(writeTools.has(name))mutations.push({name,args});const result=await app.actions.get(name)(args);if(name==='project_changes'&&args.mode==='commit'&&args.target===messageErrorTarget){delete result.structuredContent.commitMessage;result.structuredContent.commitMessageError=messageError;}return result;};}};
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:950}}),page=await context.newPage(),audit=await auditSession(page,'review-copy'),f=await mountNative(page,html(),actions,'dark');
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(page.url()).origin});
 const idle=()=>page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.body?.getAttribute('aria-busy')==='false');
 const copyMessage=()=>f.locator('[data-copy-commit-message]'),copyHash=()=>f.locator('[data-copy-commit-hash]');
 const content=()=>f.locator('body').evaluate(()=>window.copyAudit.readText());
 const choose=async sha=>{await f.locator(`#commits [data-sha="${sha}"]`).click();await idle();await f.getByRole('button',{name:'复制提交内容',exact:true}).waitFor({state:'visible'});};
 async function revealCopy(node){if(await node.getAttribute('role')==='menuitem'&&!await node.isVisible()){const trigger=node.locator('..').locator('..').locator('[data-copy-menu-trigger]');await click(trigger);}}
 async function click(node){await revealCopy(node);const box=await node.boundingBox();assert.ok(box,'copy action is visible');await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
 const copied=node=>node.evaluate(node=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Copy did not report success')),5000),done=()=>{if(node.dataset.copyState==='success'){clearTimeout(timer);resolve();}else if(node.dataset.copyState==='error'){clearTimeout(timer);reject(Error('Copy reported failure'));}else requestAnimationFrame(done);};done();}));
 const snapshot=()=>f.locator('body').evaluate(()=>{const active=document.activeElement;return {active:active.id,value:active.value,start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection,selection:window.getSelection().toString(),scrolls:['commits','code'].map(id=>[id,document.getElementById(id).scrollLeft,document.getElementById(id).scrollTop]),column:document.querySelector('.detail-column').scrollTop,window:[scrollX,scrollY],textareas:document.querySelectorAll('textarea').length};});
 await idle();await f.locator('body').evaluate(()=>{
  window.copyAudit={nativeAttempts:0,fallbackAttempts:0,writeText:navigator.clipboard.writeText.bind(navigator.clipboard),readText:navigator.clipboard.readText.bind(navigator.clipboard),execCommand:document.execCommand.bind(document)};
  Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.copyAudit.nativeAttempts++;await window.copyAudit.writeText(text);}});
  document.execCommand=command=>{window.copyAudit.fallbackAttempts++;return window.copyAudit.execCommand(command);};
 });
 await f.locator('#commitsTab').click();await idle();await choose(full);
 await audit.check('history copies the full raw commit message including body and final newline through the Clipboard API',async()=>{
  const b=copyMessage();assert.equal(await b.getAttribute('aria-label'),'复制完整提交信息');assert.equal(await b.getAttribute('title'),'复制完整提交信息');assert.equal(await b.locator('svg').count(),0,'menu choices use explicit text');await click(b);await copied(b);assert.equal(await content(),message);assert.equal(await f.locator('#status').textContent(),'已复制完整提交信息');assert.deepEqual(await f.locator('body').evaluate(()=>[window.copyAudit.nativeAttempts,window.copyAudit.fallbackAttempts]),[1,0]);await audit.screenshot('complete-message');
 });
 await audit.check('the hash action copies every SHA character and supports keyboard activation',async()=>{
  const b=copyHash();assert.equal(await b.getAttribute('aria-label'),'复制完整提交哈希');await revealCopy(b);await b.focus();await b.press('Enter');await copied(b);assert.equal(await content(),full);assert.equal(full.length,40);assert.deepEqual(await f.locator('body').evaluate(()=>[window.copyAudit.nativeAttempts,window.copyAudit.fallbackAttempts]),[2,0]);
 });
 await audit.check('a denied Clipboard API falls back to real copy while preserving input focus, selection and scroll',async()=>{
  await f.locator('body').evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{window.copyAudit.nativeAttempts++;throw Error('Synthetic host policy denial');}}});});
  await f.locator('[data-review-summary] .diff-table').waitFor();const input=f.locator('#commitSearch');await input.fill('copy');await input.focus();await input.evaluate(node=>{node.setSelectionRange(1,3,'backward');document.querySelector('.detail-column').scrollTop=20;});await revealCopy(copyMessage());const before=await snapshot();assert.ok(before.column>0,'the scroll restoration check needs a nonzero reading position');await click(copyMessage());await copied(copyMessage());assert.equal(await content(),message);assert.deepEqual(await snapshot(),before);assert.deepEqual(await f.locator('body').evaluate(()=>[window.copyAudit.nativeAttempts,window.copyAudit.fallbackAttempts]),[3,1]);
 });
 await audit.check('an unavailable Clipboard API preserves a DOM text selection when legacy copy succeeds',async()=>{
  await f.locator('body').evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});const text=document.querySelector('.summary-commit-meta h2').firstChild,range=document.createRange();range.setStart(text,1);range.setEnd(text,6);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await revealCopy(copyHash());const before=await snapshot();await click(copyHash());await copied(copyHash());assert.equal(await content(),full);assert.deepEqual(await snapshot(),before);assert.equal(await f.locator('body').evaluate(()=>window.copyAudit.fallbackAttempts),2);
 });
 await audit.check('clipboard denial never reports success and leaves existing clipboard contents and editing state intact',async()=>{
  await f.locator('body').evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Synthetic denial');}}});document.execCommand=()=>false;});const input=f.locator('#commitSearch');await input.focus();await input.evaluate(node=>node.setSelectionRange(0,2));await revealCopy(copyMessage());const before=await snapshot();await click(copyMessage());await f.locator('[data-copy-commit-message][data-copy-state=error]').waitFor({state:'attached'});assert.equal(await content(),full);assert.deepEqual(await snapshot(),before);assert.match(await f.locator('#status.error').textContent(),/复制失败/);assert.match(await copyMessage().getAttribute('title'),/复制失败/);assert.equal(await copyMessage().textContent(),'完整提交信息','a failed menu choice keeps its explicit label');await audit.screenshot('copy-denied');
 });
 await f.locator('body').evaluate(()=>{delete navigator.clipboard;document.execCommand=window.copyAudit.execCommand;});await f.locator('#commitSearch').fill('');
 await audit.check('switching historical commits refreshes the message and hash payloads without truncation',async()=>{
  await choose(first);await click(copyMessage());await copied(copyMessage());assert.equal(await content(),'copy: initial fixture\n');await click(copyHash());await copied(copyHash());assert.equal(await content(),first);
  // A range refresh returns title-only records; retain the selected immutable commit's lazy message.
  await copyMessage().evaluate(node=>window.historyCopyButton=node);await f.locator('#historyMode').selectOption('all');await idle();assert.equal(await copyMessage().evaluate(node=>node===window.historyCopyButton),true);await click(copyMessage());await copied(copyMessage());assert.equal(await content(),'copy: initial fixture\n');
  await f.locator('#historyMode').selectOption('current');await idle();await f.locator('#wrapCode').uncheck();assert.equal(await copyMessage().isEnabled(),true);await click(copyMessage());await copied(copyMessage());assert.equal(await content(),'copy: initial fixture\n');await f.locator('#wrapCode').check();
 });
 await audit.check('empty commits retain message and hash copy actions',async()=>{
  await choose(empty);await click(copyMessage());await copied(copyMessage());assert.equal(await content(),emptyMessage);await click(copyHash());await copied(copyHash());assert.equal(await content(),empty);
 });
 // Value: protects=an unreadable commit message disables its copy action without blocking hash copy or the diff;
 // fails_when=message-read errors hide the diff, allow empty copying, or leak into another commit;
 // why_new=existing history copy fixtures always return a readable full message; seam=none;
 // no_claim=the response error is injected here; the backend oversized-message limit is covered separately.
 await audit.check('a commit-message read error preserves its diff and hash copy and recovers on refresh',async()=>{
  messageErrorTarget=full;
  try{
   await choose(full);assert.equal(await copyMessage().isDisabled(),true);assert.equal(await copyMessage().getAttribute('title'),messageError);assert.equal(await copyHash().isEnabled(),true);
   await click(copyHash());await copied(copyHash());assert.equal(await content(),full);const table=f.locator('[data-summary-path="demo.txt"] .diff-table');await table.waitFor({state:'visible'});assert.match(await table.textContent(),/after 0/,'message-read failure must leave real file differences readable');
  }finally{messageErrorTarget='';}
  await f.locator('#refresh').click();await idle();assert.equal(await copyMessage().isEnabled(),true,'refreshing the same commit must restore message copying after the read error clears');assert.equal(await copyMessage().getAttribute('title'),'复制完整提交信息');await click(copyMessage());await copied(copyMessage());assert.equal(await content(),message);
  await choose(first);assert.equal(await copyMessage().isEnabled(),true);assert.equal(await copyMessage().getAttribute('title'),'复制完整提交信息');await click(copyMessage());await copied(copyMessage());assert.equal(await content(),'copy: initial fixture\n');await choose(empty);
 });
 // Value: protects=an unfinished clipboard write ignores repeated activation and permits a later copy;
 // fails_when=the copy-in-progress guard is removed or reset before the clipboard promise settles;
 // why_new=existing clipboard checks wait for each copy to finish before another activation; seam=none;
 // no_claim=the native clipboard write is real, while its completion delay is controlled by this fixture.
 await audit.check('repeated activation during a pending native clipboard write issues one copy and later copying still works',async()=>{
  await f.locator('body').evaluate(()=>{
   let release;const completion=new Promise(resolve=>release=resolve),previous=navigator.clipboard.writeText;
   window.copyAudit.delayedCalls=0;window.copyAudit.delayedEntered=false;window.copyAudit.releaseDelayed=release;window.copyAudit.restoreDelayed=()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:previous});
   Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.copyAudit.delayedCalls++;await window.copyAudit.writeText(text);window.copyAudit.delayedEntered=true;await completion;}});
  });
  const b=copyMessage();
  try{
   await click(b);await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow.copyAudit?.delayedEntered===true,{},{timeout:5000});assert.equal(await b.getAttribute('aria-busy'),'true');
   await click(b);await click(b);assert.equal(await f.locator('body').evaluate(()=>window.copyAudit.delayedCalls),1,'pending copy must not dispatch another native clipboard write');assert.equal(await b.getAttribute('aria-busy'),'true');
   await f.locator('body').evaluate(()=>window.copyAudit.releaseDelayed());await copied(b);assert.equal(await content(),emptyMessage);assert.equal(await b.getAttribute('aria-busy'),null);
   await click(b);await copied(b);assert.equal(await f.locator('body').evaluate(()=>window.copyAudit.delayedCalls),2,'completion must release the guard for the next copy');assert.equal(await content(),emptyMessage);
  }finally{await f.locator('body').evaluate(()=>{window.copyAudit.releaseDelayed();window.copyAudit.restoreDelayed();});}
 });
 await audit.check('copy dropdown has named options, keyboard navigation, outside dismissal and one trigger',async()=>{
  const trigger=f.getByRole('button',{name:'复制提交内容',exact:true});assert.equal(await f.locator('.summary-commit-actions> .copy-control').count(),1);await f.locator('#reviewFullscreen').click();await trigger.focus();await trigger.press('ArrowDown');assert.equal(await trigger.getAttribute('aria-expanded'),'true');assert.equal(await copyMessage().evaluate(node=>node===document.activeElement),true);await copyMessage().press('ArrowDown');assert.equal(await copyHash().evaluate(node=>node===document.activeElement),true);await copyHash().press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);assert.equal(await f.locator('body').evaluate(node=>node.classList.contains('review-fullscreen')),true,'Escape closes only the menu first');await trigger.press('Escape');assert.equal(await f.locator('body').evaluate(node=>node.classList.contains('review-fullscreen')),false);await click(trigger);await audit.screenshot('copy-menu-open');await f.locator('#commitSearch').click();assert.equal(await trigger.getAttribute('aria-expanded'),'false');await choose(full);await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'light'}},'*'));await click(trigger);await audit.screenshot('copy-menu-light');await f.locator('#commitSearch').click();await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'dark'}},'*'));await choose(empty);
 });
 await audit.check('copy controls remain reachable in a narrow panel without horizontal overflow',async()=>{
  await page.setViewportSize({width:390,height:650});assert.equal(await f.locator('body').evaluate(node=>node.scrollWidth<=node.clientWidth),true);await revealCopy(copyMessage());await copyMessage().click({trial:true});await copyHash().click({trial:true});await click(copyMessage());await copied(copyMessage());assert.equal(await content(),emptyMessage);await audit.screenshot('narrow');
 });
 await page.setViewportSize({width:1440,height:950});await f.locator('#changesTab').click();await idle();await f.locator('#commitTask:not([disabled])').waitFor();
 const editor=f.locator('#commitSummary'),composer=f.locator('#commitWorkspace'),keyword=f.locator('#copyCommitKeyword'),preview=f.locator('#copyCommitMessage'),apply=f.locator('#applyCommitKeyword');
 const frames=()=>f.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 async function reach(node){
  if(await node.getAttribute('role')==='menuitem'){const trigger=node.locator('..').locator('..').locator('[data-copy-menu-trigger]');await reach(trigger);await revealCopy(node);return;}
  await node.waitFor({state:'visible'});
  for(let attempt=0;attempt<20;attempt++){
   const visible=await node.evaluate(node=>{const box=node.getBoundingClientRect(),bounds=node.closest('#commitWorkspace').getBoundingClientRect();return box.y>=bounds.y&&box.bottom<=bounds.bottom&&node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));});if(visible)return;
   const box=await node.boundingBox(),bounds=await composer.boundingBox();await page.mouse.move(bounds.x+bounds.width-5,bounds.y+bounds.height/2);await page.mouse.wheel(0,box.y<bounds.y?-100:100);await frames();
  }
  assert.fail('normal wheel scrolling must reach the composer copy control');
 }
 const selectTask=async task=>{await reach(f.locator('#commitTask'));await f.locator('#commitTask').selectOption(task?.id??'');if(task){await f.locator('#commitKeywordRow').waitFor({state:'visible'});await f.locator('#commitKeywordText').filter({hasText:task.keyword}).waitFor();assert.equal(await f.locator('#commitKeywordText').textContent(),task.keyword);}else await f.locator('#commitKeywordRow').waitFor({state:'hidden'});};
 const editorSnapshot=()=>editor.evaluate(node=>({same:node===window.copyEditor,focused:node===document.activeElement,value:node.value,start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection,ownScroll:[node.scrollLeft,node.scrollTop],composerScroll:[document.getElementById('commitWorkspace').scrollLeft,document.getElementById('commitWorkspace').scrollTop],columnScroll:document.querySelector('.detail-column').scrollTop}));
 async function copyComposer(node,expected){await reach(node);await editor.evaluate(node=>{node.focus({preventScroll:true});node.setSelectionRange(4,12,'backward');});const before=await editorSnapshot();await click(node);await copied(node);assert.equal(await content(),expected);assert.deepEqual(await editorSnapshot(),before);return before;}
 await editor.evaluate(node=>window.copyEditor=node);
 await audit.check('composer copy actions hide unavailable keywords and disable empty final messages',async()=>{
  assert.equal(await composer.isVisible(),true);assert.equal(await f.locator('#commitKeywordRow').isVisible(),false);assert.equal(await keyword.isVisible(),false);assert.equal(await keyword.isDisabled(),true);assert.equal(await preview.isDisabled(),true);await editor.fill(' \n ');assert.equal(await preview.isDisabled(),true);assert.equal(await f.locator('#commitMessage').textContent(),'');await editor.fill('Existing manual draft');
 });
 await audit.check('copying the complete current TAPD keyword preserves the editor and performs no Stage or commit',async()=>{
  await selectTask(a);assert.equal(await keyword.getAttribute('aria-label'),'复制 TAPD 关键字');assert.equal(await keyword.isEnabled(),true);await copyComposer(keyword,a.keyword);assert.equal(await editor.inputValue(),'Existing manual draft');assert.equal(git('diff','--cached'),'');assert.deepEqual(mutations,[]);await audit.screenshot('composer-keyword-dark');
 });
 await audit.check('the final preview copy uses the edited multiline message and preserves textarea selection and scroll',async()=>{
  await page.setViewportSize({width:1440,height:800});await reach(apply);await click(apply);assert.equal(await editor.inputValue(),a.keyword);const text='  '+a.keyword+'\n\nBody line one\nBody line two\n\n  ';await editor.fill(text);await reach(f.locator('.commit-preview summary'));await click(f.locator('.commit-preview summary'));assert.equal(await preview.isVisible(),false,'copy choices stay collapsed until the menu opens');assert.equal(await f.locator('#commitMessage').textContent(),text.trim());const before=await copyComposer(preview,text.trim());assert.equal(await composer.locator('[data-copy-menu-trigger]').isVisible(),true,'copy stays available in the composer heading');assert.deepEqual(mutations,[]);await audit.screenshot('composer-preview-dark');
 });
 await audit.check('task switches and draft edits are copied from the latest getter values without replacing controls',async()=>{
  const oldDraft=await editor.inputValue();await keyword.evaluate(node=>window.keywordCopyButton=node);await preview.evaluate(node=>window.previewCopyButton=node);await selectTask(b);assert.equal(await editor.inputValue(),oldDraft);await copyComposer(keyword,b.keyword);await editor.fill('\n '+b.keyword+'\n\nChanged body after the first copy\n ');const expected=(await editor.inputValue()).trim();await copyComposer(preview,expected);assert.equal(await keyword.evaluate(node=>node===window.keywordCopyButton),true);assert.equal(await preview.evaluate(node=>node===window.previewCopyButton),true);assert.equal(await editor.evaluate(node=>node===window.copyEditor),true);assert.deepEqual(mutations,[]);
 });
 await audit.check('composer keyword and preview copy remain reachable in the light theme',async()=>{
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'light'}},'*'));await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.documentElement.style.colorScheme==='light');await copyComposer(keyword,b.keyword);await copyComposer(preview,(await editor.inputValue()).trim());await audit.screenshot('composer-preview-light');await selectTask(null);assert.equal(await keyword.isVisible(),false);await editor.fill(' \n ');assert.equal(await preview.isDisabled(),true);assert.deepEqual(mutations,[]);assert.equal(git('diff','--cached'),'');assert.equal(git('rev-parse','HEAD'),empty);
 });
 await audit.finish();
}finally{await browser?.close();await app.server.close();app.store.close();await rm(root,{recursive:true,force:true});}

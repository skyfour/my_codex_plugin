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
const actions={get(name){return async args=>{if(writeTools.has(name))mutations.push({name,args});return app.actions.get(name)(args);};}};
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:950}}),page=await context.newPage(),audit=await auditSession(page,'review-copy'),f=await mountNative(page,html(),actions,'dark');
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(page.url()).origin});
 const idle=()=>page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.body?.getAttribute('aria-busy')==='false');
 const copyMessage=()=>f.locator('[data-copy-commit-message]'),copyHash=()=>f.locator('[data-copy-commit-hash]');
 const content=()=>f.locator('body').evaluate(()=>window.copyAudit.readText());
 const choose=async sha=>{await f.locator(`#commits [data-sha="${sha}"]`).click();await idle();await copyMessage().waitFor({state:'visible'});};
 async function click(node){const box=await node.boundingBox();assert.ok(box,'copy action is visible');await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
 const copied=node=>node.evaluate(node=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Copy did not report success')),5000),done=()=>{if(node.dataset.copyState==='success'){clearTimeout(timer);resolve();}else if(node.dataset.copyState==='error'){clearTimeout(timer);reject(Error('Copy reported failure'));}else requestAnimationFrame(done);};done();}));
 const snapshot=()=>f.locator('body').evaluate(()=>{const active=document.activeElement;return {active:active.id,value:active.value,start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection,selection:window.getSelection().toString(),scrolls:['commits','code'].map(id=>[id,document.getElementById(id).scrollLeft,document.getElementById(id).scrollTop]),column:document.querySelector('.detail-column').scrollTop,window:[scrollX,scrollY],textareas:document.querySelectorAll('textarea').length};});
 await idle();await f.locator('body').evaluate(()=>{
  window.copyAudit={nativeAttempts:0,fallbackAttempts:0,writeText:navigator.clipboard.writeText.bind(navigator.clipboard),readText:navigator.clipboard.readText.bind(navigator.clipboard),execCommand:document.execCommand.bind(document)};
  Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.copyAudit.nativeAttempts++;await window.copyAudit.writeText(text);}});
  document.execCommand=command=>{window.copyAudit.fallbackAttempts++;return window.copyAudit.execCommand(command);};
 });
 await f.locator('#commitsTab').click();await idle();await choose(full);
 await audit.check('history copies the full raw commit message including body and final newline through the Clipboard API',async()=>{
  const b=copyMessage();assert.equal(await b.getAttribute('aria-label'),'复制完整提交信息');assert.equal(await b.getAttribute('title'),'复制完整提交信息');assert.equal(await b.locator('svg[aria-hidden=true]').count(),1);await click(b);await copied(b);assert.equal(await content(),message);assert.equal(await f.locator('#status').textContent(),'已复制完整提交信息');assert.deepEqual(await f.locator('body').evaluate(()=>[window.copyAudit.nativeAttempts,window.copyAudit.fallbackAttempts]),[1,0]);await audit.screenshot('complete-message');
 });
 await audit.check('the hash action copies every SHA character and supports keyboard activation',async()=>{
  const b=copyHash();assert.equal(await b.getAttribute('aria-label'),'复制完整提交哈希');await b.focus();await b.press('Enter');await copied(b);assert.equal(await content(),full);assert.equal(full.length,40);assert.deepEqual(await f.locator('body').evaluate(()=>[window.copyAudit.nativeAttempts,window.copyAudit.fallbackAttempts]),[2,0]);
 });
 await audit.check('a denied Clipboard API falls back to real copy while preserving input focus, selection and scroll',async()=>{
  await f.locator('body').evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{window.copyAudit.nativeAttempts++;throw Error('Synthetic host policy denial');}}});});
  await f.locator('[data-review-summary] .diff-table').waitFor();const input=f.locator('#commitSearch');await input.fill('copy');await input.focus();await input.evaluate(node=>{node.setSelectionRange(1,3,'backward');document.querySelector('.detail-column').scrollTop=20;});const before=await snapshot();assert.ok(before.column>0,'the scroll restoration check needs a nonzero reading position');await click(copyMessage());await copied(copyMessage());assert.equal(await content(),message);assert.deepEqual(await snapshot(),before);assert.deepEqual(await f.locator('body').evaluate(()=>[window.copyAudit.nativeAttempts,window.copyAudit.fallbackAttempts]),[3,1]);
 });
 await audit.check('an unavailable Clipboard API preserves a DOM text selection when legacy copy succeeds',async()=>{
  await f.locator('body').evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});const text=document.querySelector('.summary-commit-meta h2').firstChild,range=document.createRange();range.setStart(text,1);range.setEnd(text,6);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});const before=await snapshot();await click(copyHash());await copied(copyHash());assert.equal(await content(),full);assert.deepEqual(await snapshot(),before);assert.equal(await f.locator('body').evaluate(()=>window.copyAudit.fallbackAttempts),2);
 });
 await audit.check('clipboard denial never reports success and leaves existing clipboard contents and editing state intact',async()=>{
  await f.locator('body').evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Synthetic denial');}}});document.execCommand=()=>false;});const input=f.locator('#commitSearch');await input.focus();await input.evaluate(node=>node.setSelectionRange(0,2));const before=await snapshot();await click(copyMessage());await f.locator('[data-copy-commit-message][data-copy-state=error]').waitFor();assert.equal(await content(),full);assert.deepEqual(await snapshot(),before);assert.match(await f.locator('#status.error').textContent(),/复制失败/);assert.match(await copyMessage().getAttribute('title'),/复制失败/);assert.equal(await copyMessage().locator('rect').count(),1,'failure must show the copy icon, not a success tick');await audit.screenshot('copy-denied');
 });
 await f.locator('body').evaluate(()=>{delete navigator.clipboard;document.execCommand=window.copyAudit.execCommand;});await f.locator('#commitSearch').fill('');
 await audit.check('switching historical commits refreshes the message and hash payloads without truncation',async()=>{
  await choose(first);await click(copyMessage());await copied(copyMessage());assert.equal(await content(),'copy: initial fixture\n');await click(copyHash());await copied(copyHash());assert.equal(await content(),first);
 });
 await audit.check('empty commits retain message and hash copy actions',async()=>{
  await choose(empty);await click(copyMessage());await copied(copyMessage());assert.equal(await content(),emptyMessage);await click(copyHash());await copied(copyHash());assert.equal(await content(),empty);
 });
 await audit.check('copy controls remain reachable in a narrow panel without horizontal overflow',async()=>{
  await page.setViewportSize({width:390,height:650});assert.equal(await f.locator('body').evaluate(node=>node.scrollWidth<=node.clientWidth),true);await copyMessage().click({trial:true});await copyHash().click({trial:true});await click(copyMessage());await copied(copyMessage());assert.equal(await content(),emptyMessage);await audit.screenshot('narrow');
 });
 await page.setViewportSize({width:1440,height:950});await f.locator('#changesTab').click();await idle();await f.locator('#commitTask:not([disabled])').waitFor();
 const editor=f.locator('#commitSummary'),composer=f.locator('#commitWorkspace'),keyword=f.locator('#copyCommitKeyword'),preview=f.locator('#copyCommitMessage'),apply=f.locator('#applyCommitKeyword');
 const frames=()=>f.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 async function reach(node){
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
  await page.setViewportSize({width:1440,height:800});await reach(apply);await click(apply);assert.equal(await editor.inputValue(),a.keyword);const text='  '+a.keyword+'\n\nBody line one\nBody line two\n\n  ';await editor.fill(text);await reach(f.locator('.commit-preview summary'));await click(f.locator('.commit-preview summary'));await preview.waitFor({state:'visible'});assert.equal(await f.locator('#commitMessage').textContent(),text.trim());const before=await copyComposer(preview,text.trim());assert.ok(before.composerScroll[1]>0,'preview copy must exercise a scrolled composer');assert.deepEqual(mutations,[]);await audit.screenshot('composer-preview-dark');
 });
 await audit.check('task switches and draft edits are copied from the latest getter values without replacing controls',async()=>{
  const oldDraft=await editor.inputValue();await keyword.evaluate(node=>window.keywordCopyButton=node);await preview.evaluate(node=>window.previewCopyButton=node);await selectTask(b);assert.equal(await editor.inputValue(),oldDraft);await copyComposer(keyword,b.keyword);await editor.fill('\n '+b.keyword+'\n\nChanged body after the first copy\n ');const expected=(await editor.inputValue()).trim();await copyComposer(preview,expected);assert.equal(await keyword.evaluate(node=>node===window.keywordCopyButton),true);assert.equal(await preview.evaluate(node=>node===window.previewCopyButton),true);assert.equal(await editor.evaluate(node=>node===window.copyEditor),true);assert.deepEqual(mutations,[]);
 });
 await audit.check('composer keyword and preview copy remain reachable in the light theme',async()=>{
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'light'}},'*'));await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.documentElement.style.colorScheme==='light');await copyComposer(keyword,b.keyword);await copyComposer(preview,(await editor.inputValue()).trim());await audit.screenshot('composer-preview-light');await selectTask(null);assert.equal(await keyword.isVisible(),false);await editor.fill(' \n ');assert.equal(await preview.isDisabled(),true);assert.deepEqual(mutations,[]);assert.equal(git('diff','--cached'),'');assert.equal(git('rev-parse','HEAD'),empty);
 });
 await audit.finish();
}finally{await browser?.close();await app.server.close();app.store.close();await rm(root,{recursive:true,force:true});}

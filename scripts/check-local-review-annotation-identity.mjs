import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer,html} from '../plugins/codex-local-review/servers/server.mjs';
import {auditSession,mountNative} from './ui-audit-helpers.mjs';

const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const root=await realpath(await mkdtemp(join(tmpdir(),'review-annotation-identity-'))),repo=join(root,'repo');
await mkdir(repo);
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:'pipe'}).trim();
const base='base one\nbase two\nbase three\n',staged='base one\nstaged two\nstaged three\n',working='base one\nunstaged two\nstaged three\nwork only fourth\n';
git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
await writeFile(join(repo,'same.txt'),base);git('add','.');git('commit','-qm','base');
await writeFile(join(repo,'same.txt'),staged);git('add','.');await writeFile(join(repo,'same.txt'),working);
const instance=await createServer({dir:join(root,'data'),taskContexts:{listTasks:async()=>({tasks:[],notice:''})}});
await instance.projects.open(repo);let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1550,height:1000}}),audit=await auditSession(page,'review-annotation-identity');
 const f=await mountNative(page,html(),instance.actions),idle=()=>page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.body.getAttribute('aria-busy')==='false');
 const card=mode=>f.locator(`[data-summary-mode="${mode}"] [data-summary-path="same.txt"]`);
 const loaded=async mode=>{await card(mode).scrollIntoViewIfNeeded();await card(mode).locator('[data-comment-side="after"][data-comment-line="2"]').waitFor();};
 await idle();let stagedId;
 await audit.check('stale Summary rejects old line identity without creating a snapshot',async()=>{
  await loaded('unstaged');await loaded('staged');
  await writeFile(join(repo,'same.txt'),'EXTERNAL replacement\nnew second line\n');
  await card('unstaged').getByRole('button',{name:'新代码第 2 行添加评论',exact:true}).click();await idle();
  assert.match(await f.locator('#status').textContent(),/文件在查看后发生了变化/);
  assert.equal(instance.store.list().length,0);assert.equal(await f.locator('#commentForm').isVisible(),false);
  assert.equal(await f.locator('.detail-column').getAttribute('data-detail-view'),'summary');
 });
 await audit.check('staged annotation binds old-side line to HEAD and the index snapshot',async()=>{
  await writeFile(join(repo,'same.txt'),working);await f.locator('#refresh').click();await idle();await loaded('staged');await loaded('unstaged');
  await card('staged').getByRole('button',{name:'旧代码第 2 行添加评论',exact:true}).click();await idle();
  assert.equal(await f.locator('.detail-column').getAttribute('data-detail-view'),'summary');
  assert.equal(await f.locator('#commentForm').evaluate(el=>Boolean(el.closest('.annotation-row'))),true);
  await f.locator('#commentText').fill('staged snapshot old line two');await f.getByRole('button',{name:'保存批注',exact:true}).click();await idle();
  const saved=instance.store.get(instance.store.list()[0].id);stagedId=saved.id;
  assert.equal(saved.mode,'staged');assert.equal(saved.files[0].before,base);assert.equal(saved.files[0].after,staged);
  assert.deepEqual(saved.comments.map(({side,line,text})=>({side,line,text})),[{side:'before',line:2,text:'staged snapshot old line two'}]);
  assert.match(await card('staged').locator('.inline-comment').textContent(),/staged snapshot old line two/);
 });
 await audit.check('unstaged annotation binds new-side line to worktree and preserves the staged snapshot',async()=>{
  await f.locator('#liveView').click();await idle();await loaded('unstaged');await loaded('staged');
  await card('unstaged').getByRole('button',{name:'新代码第 4 行添加评论',exact:true}).click();await idle();
  await f.locator('#commentText').fill('unstaged snapshot new line four');await f.getByRole('button',{name:'保存批注',exact:true}).click();await idle();
  const saved=instance.store.list().map(r=>instance.store.get(r.id)).find(r=>r.id!==stagedId);
  assert.equal(saved.mode,'unstaged');assert.equal(saved.files[0].before,staged);assert.equal(saved.files[0].after,working);
  assert.deepEqual(saved.comments.map(({side,line,text})=>({side,line,text})),[{side:'after',line:4,text:'unstaged snapshot new line four'}]);
  const previous=instance.store.get(stagedId);assert.equal(previous.files[0].before,base);assert.equal(previous.files[0].after,staged);assert.equal(previous.comments.length,1);
  assert.match(await card('unstaged').locator('.inline-comment').textContent(),/unstaged snapshot new line four/);
 });
 await audit.screenshot('unstaged');await audit.finish();
}finally{await browser?.close();await instance.server.close();instance.store.close();await rm(root,{recursive:true,force:true});}

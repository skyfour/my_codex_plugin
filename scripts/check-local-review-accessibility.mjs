import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,html} from '../plugins/codex-local-review/servers/server.mjs';
import {auditSession,mountNative} from './ui-audit-helpers.mjs';
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const root=await mkdtemp(join(tmpdir(),'review-a11y-')),repo=join(root,'项目名称很长的审查工作区');await mkdir(repo);
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');await writeFile(join(repo,'demo.txt'),'before\n');git('add','.');git('commit','-qm','initial');git('branch','feature');await writeFile(join(repo,'demo.txt'),'after\n');
let pickerCalls=0,browser;const app=await createServer({dir:join(root,'data'),picker:async()=>{pickerCalls++;return [repo];},taskContexts:{listTasks:async()=>({tasks:[],notice:''})}});await app.projects.open(repo);
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:950}}),audit=await auditSession(page,'review');
 const calls=[],observedActions={get(name){return args=>{calls.push(name);return app.actions.get(name)(args);};}};
 const f=await mountNative(page,html(),observedActions,'light'),idle=()=>page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument.body.getAttribute('aria-busy')==='false');await idle();await audit.screenshot('before');
 await audit.check('branch comparison is visibly distinct from branch switching',async()=>{assert.equal(await f.locator('#branchesSection h2').textContent(),'分支比较');});
 await audit.check('global shortcuts cannot stack dialogs or change projects',async()=>{await f.locator('#settings').click();await f.locator('#settingsDialog[open]').waitFor();await f.locator('#fileLimit').focus();const commands=()=>calls.filter(name=>['project_pick','project_open','project_changes','review_open'].includes(name)).length;const before=pickerCalls,beforeCalls=commands();for(const key of ['o','p','r'])await page.keyboard.press((process.platform==='darwin'?'Meta+':'Control+')+key);await f.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await idle();assert.equal(pickerCalls,before);assert.equal(commands(),beforeCalls,'no project command from a dialog shortcut');assert.equal(await f.locator('dialog[open]').count(),1);assert.equal(await f.locator('#settingsDialog').isVisible(),true);await page.keyboard.press('Escape');await f.locator('dialog[open]').waitFor({state:'hidden'});});
 for(const size of [{width:1440,height:950},{width:820,height:600},{width:620,height:500},{width:390,height:700}]){
  await page.setViewportSize(size);await audit.screenshot(`before-${size.width}`);await audit.check(`workbench fits ${size.width}x${size.height}`,async()=>{assert.equal(await f.locator('.statusbar').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),true);await audit.controls(f.locator('.topbar'),`topbar ${size.width}`);await audit.controls(f.locator('#gitCommandBar'),`git commands ${size.width}`);await audit.controls(f.locator('.files-column'),`files ${size.width}`);await audit.controls(f.locator('.detail-column'),`diff and commit ${size.width}`);});
  for(const selector of ['#settings','#switchBranch','#pullOptions','#pushOptions','#quickOpen']){await f.locator(selector).click();const surface=f.locator(selector==='#switchBranch'?'#branchPopover':'dialog[open]');await surface.waitFor({state:'visible'});if(selector==='#switchBranch')assert.equal(await f.locator('dialog[open]').count(),0,'branch switching stays nonmodal');await audit.controls(surface,`${selector} ${size.width}`);await page.keyboard.press('Escape');await surface.waitFor({state:'hidden'});}
 }
 await audit.finish();
}finally{await browser?.close();await app.server.close();app.store.close();await rm(root,{recursive:true,force:true});}

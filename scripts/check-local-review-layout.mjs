import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,html} from '../plugins/codex-local-review/servers/server.mjs';
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url)),{chromium}=require('playwright');
const root=await realpath(await mkdtemp(join(tmpdir(),'review-layout-'))),project=join(root,'codemao-study-with-a-long-project-name');await mkdir(project);
const git=(...args)=>execFileSync('git',['-C',project,...args],{encoding:'utf8'}).trim();git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','UI fixture');
await writeFile(join(project,'example.ts'),'export const total = (price: number) => price;\n');git('add','.');git('commit','-qm','Initial');git('switch','-qc','feat/202609-multibrower-with-a-very-long-branch-name');
const instance=await createServer({dir:join(root,'data'),picker:async()=>[project]});await instance.projects.open(project);let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1800,height:1040},timezoneId:'Asia/Shanghai'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.exposeFunction('pluginTool',(name,args)=>instance.actions.get(name)(args));
 async function mount(theme){await page.setContent('<style>body{margin:0}</style><iframe style="display:block;width:100%;height:100vh;border:0"></iframe>');await page.evaluate(({html,theme})=>{window.addEventListener('message',async e=>{const m=e.data;if(e.source!==document.querySelector('iframe').contentWindow||m?.jsonrpc!=='2.0'||m.id===undefined)return;const result=m.method==='tools/call'?await window.pluginTool(m.params.name,m.params.arguments):{hostContext:{theme}};e.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');});document.querySelector('iframe').srcdoc=html;},{html:html(),theme});}
 const f=page.frameLocator('iframe');async function idle(){await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.body?.getAttribute('aria-busy')==='false');assert.equal(await f.locator('#status').textContent(),'就绪');}
 await mount('light');await idle();assert.equal(await f.locator('.empty-state h2').textContent(),'工作区干净');assert.equal(await f.locator('.diff-toolbar').isVisible(),false);assert.equal(await f.locator('.file-toolbar').isVisible(),false);assert.equal(await f.locator('#saveReview').isVisible(),false);
 assert.equal(await f.locator('#branchName').getAttribute('title'),'feat/202609-multibrower-with-a-very-long-branch-name');assert.equal(await f.locator('#repoName').getAttribute('title'),'codemao-study-with-a-long-project-name');
 for(const width of [1800,1024,600,390]){await page.setViewportSize({width,height:1040});await page.screenshot({path:`/Users/skyfour/work/business/exports/local-review-polish-clean-${width}.png`});assert.equal(await f.locator('#openProject').isVisible(),true);assert.equal(await f.locator('#projectSelect').isVisible(),true);assert.equal(await f.locator('body').evaluate(e=>e.scrollWidth<=e.clientWidth),true);}
 await page.setViewportSize({width:1440,height:940});await f.getByRole('button',{name:'浏览提交历史',exact:true}).click();await idle();assert.equal(await f.locator('.diff-toolbar').isVisible(),true);assert.equal(await f.locator('.file-toolbar').isVisible(),true);await page.screenshot({path:'/Users/skyfour/work/business/exports/local-review-polish-diff-light.png'});
 await f.locator('#changesTab').click();await idle();assert.equal(await f.locator('.empty-state h2').textContent(),'工作区干净');await writeFile(join(project,'example.ts'),'export const total = (price: number) => price * 2;\n');await f.getByRole('button',{name:'刷新项目',exact:true}).click();await idle();assert.equal(await f.locator('.diff-toolbar').isVisible(),true);assert.equal(await f.locator('.empty-state').count(),0);
 await mount('dark');await idle();assert.equal(await f.locator('#reviewDate').textContent(),'实时查看 · 未保存');await page.screenshot({path:'/Users/skyfour/work/business/exports/local-review-polish-diff-dark.png'});assert.deepEqual(errors,[]);console.log('PASS: clean-workspace empty state, hidden inactive controls, long-name tooltips, refresh recovery, light/dark screenshots');
}finally{await browser?.close();await instance.server.close();instance.store.close();await rm(root,{recursive:true,force:true});}

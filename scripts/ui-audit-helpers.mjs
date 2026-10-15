import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';

// Only synthetic fixtures are mounted by the callers. Artifacts stay outside Git.
export async function auditSession(page,name){
 const directory=process.env.UI_AUDIT_DIR||'/tmp/codex-plugin-ui-audit';await mkdir(directory,{recursive:true});
 const checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
 async function check(label,work){try{await work();checks.push(label);console.log('PASS '+label);}catch(error){await screenshot('failure');await writeFile(join(directory,`${name}-failure.json`),JSON.stringify({checks,failed:label,error:error.message},null,2));throw error;}}
 async function screenshot(label){await page.screenshot({path:join(directory,`${name}-${label}.png`),fullPage:true});}
 async function controls(root,label){
  await root.waitFor({state:'visible'});
  const nodes=root.locator('button,input:not([type=hidden]),select,textarea,summary,a[href],[contenteditable=true]');let tested=0;
  for(let i=0;i<await nodes.count();i++){
   const node=nodes.nth(i);if(!await node.isVisible()||!await node.isEnabled())continue;
   await node.scrollIntoViewIfNeeded();await node.click({trial:true,timeout:2500});
   const hiddenScroll=await node.evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement){if(parent.scrollTop>1&&getComputedStyle(parent).overflowY==='hidden')return parent.id||parent.className;}return '';});
   assert.equal(hiddenScroll,'',`${label}: control needs scrolling an overflow:hidden parent (${hiddenScroll})`);tested++;
  }
  assert.ok(tested>0,`${label}: no enabled control was exercised`);checks.push(`${label}: ${tested} visible enabled controls receive pointer events`);console.log(`PASS ${label}: ${tested} pointer targets`);return tested;
 }
 async function finish(){assert.deepEqual(errors,[],'uncaught browser errors');await writeFile(join(directory,`${name}-results.json`),JSON.stringify({checks,errors},null,2));console.log(`${name}: ${checks.length} checks passed; artifacts ${directory}`);}
 return {check,screenshot,controls,finish,directory};
}

export async function mountNative(page,html,actions,theme='light'){
 // localhost gives srcdoc the same secure-context APIs as the desktop host.
 const host=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Isolated MCP host</title>');});
 await new Promise((resolve,reject)=>{host.once('error',reject);host.listen(0,'127.0.0.1',resolve);});page.once('close',()=>{host.closeAllConnections();host.close();});
 await page.goto(`http://127.0.0.1:${host.address().port}`);
 await page.exposeFunction('pluginTool',(name,args)=>actions.get(name)(args));
 await page.setContent('<style>html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style><iframe title="Plugin test host"></iframe>');
 await page.evaluate(({html,theme})=>{
  window.addEventListener('message',async event=>{
   const message=event.data;if(event.source!==document.querySelector('iframe').contentWindow||message?.jsonrpc!=='2.0'||message.id===undefined)return;
   try{const result=message.method==='tools/call'?await window.pluginTool(message.params.name,message.params.arguments):{hostContext:{theme}};event.source.postMessage({jsonrpc:'2.0',id:message.id,result},'*');}
   catch(error){event.source.postMessage({jsonrpc:'2.0',id:message.id,error:{message:error.message}},'*');}
  });document.querySelector('iframe').srcdoc=html;
 },{html,theme});
 return page.frameLocator('iframe');
}

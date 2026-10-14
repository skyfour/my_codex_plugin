import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadBoardHtml} from '../plugins/codex-task-panel/src/ui-resource.mjs';
// Reuse the browser-test dependency already locked by the API Client package.
const require=createRequire(new URL('../plugins/codex-api-client/package.json',import.meta.url));
const {chromium}=require('playwright');
const html=await loadBoardHtml();
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const dropRefresh of [true,false]){
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<iframe title="任务看板"></iframe>');
  await page.evaluate(({html,dropRefresh})=>{
   window.calls=[];
   window.addEventListener('message',event=>{
    const message=event.data;if(message?.jsonrpc!=='2.0'||message.id===undefined)return;
    let result={hostContext:{theme:'light'}};
    if(message.method==='tools/call'){
     const name=message.params.name;window.calls.push(name);
     if(name==='board_snapshot'){
      if(dropRefresh&&window.calls.filter(x=>x===name).length>1)return;
      result={structuredContent:{lanes:[],tasks:[],config:{version:1,workspaceId:'100',ownerName:'示例'},credentialReady:true,workflow:{transitions:[]}}};
     }else result={isError:true,content:[{type:'text',text:'测试服务不可用，请重试。'}]};
    }
    event.source.postMessage({jsonrpc:'2.0',id:message.id,result},'*');
   });
   document.querySelector('iframe').srcdoc=html;
  },{html,dropRefresh});
  const frame=page.frameLocator('iframe');
  await frame.locator('#content[aria-busy=false]').waitFor();
  await frame.locator('[data-act=import]').click();
  await frame.locator('#task-panel[data-view=import] #content[aria-busy=false]').waitFor({timeout:1500});
  assert.deepEqual(await page.evaluate(()=>window.calls),['board_snapshot'],'Opening import must not wait for another host request');
  await frame.locator('[data-act=query]').click();
  await frame.locator('#error').filter({hasText:'测试服务不可用'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls),['board_snapshot','import_preview'],'TAPD is queried only after an explicit query click');
  assert.equal(await frame.locator('[data-act=query]').isEnabled(),true);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log(`PASS: native MCP import navigation (host refresh ${dropRefresh?'unresponsive':'responsive'}), explicit query and error recovery`);
 }
}finally{await browser.close();}

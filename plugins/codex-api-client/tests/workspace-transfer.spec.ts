import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function api(page:Page,name:string,args:any={}){return page.evaluate(async({name,args})=>{const r=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-API-Token':(window as any).__DEV_TOKEN__},body:JSON.stringify(args)});const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));return value;},{name,args});}
test('whole-workspace download and file import preserve drafts environments globals and API scripts',async({page})=>{
 await page.goto('http://127.0.0.1:47891');
 const name='迁移-'+test.info().testId,envName='环境-'+test.info().testId;
 const events=[{listen:'prerequest',script:{exec:['console.log("before-import");']}},{listen:'test',script:{exec:['pm.test("after-import",()=>pm.response.to.have.status(200));']}}];
 const original=await api(page,'api_document_put',{kind:'collection',revision:0,data:{info:{name},event:events,item:[{name:'迁移接口',event:events,request:{url:'{{host}}/before',method:'GET'}}]}});
 await api(page,'api_document_put',{kind:'environment',revision:0,data:{name:envName,values:[{key:'host',value:'http://127.0.0.1:47892'}]}});
 const workspace=await api(page,'api_workspace_state');await api(page,'api_document_put',{kind:'globals',revision:workspace.globals?.revision||0,data:{values:[...(workspace.globals?.data.values||[]).filter((v:any)=>v.key!=='shared'),{key:'shared',value:'shared'}]}});
 await page.getByLabel('刷新工作区').click();const tree=page.locator('.collection').filter({has:page.locator('.collection-head').getByRole('button',{name,exact:true})});await tree.getByRole('button',{name:'迁移接口',exact:true}).click();await page.getByLabel('URL',{exact:true}).fill('{{host}}/draft-restored');
 await page.getByRole('button',{name:'导出全部',exact:true}).click();await expect(page.getByRole('dialog',{name:'导出工作区备份'})).toContainText('脚本');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出备份',exact:true}).click();const download=await pending;expect(download.suggestedFilename()).toMatch(/^api-client-workspace-.*\.json$/);const backup=JSON.parse(await readFile((await download.path())!,'utf8'));
 expect(backup.collections.find((c:any)=>c.info.name===name).item[0].request.url).toBe('{{host}}/draft-restored');expect(backup.environments.some((e:any)=>e.name===envName)).toBe(true);expect(backup.globals.values.find((v:any)=>v.key==='shared').value).toBe('shared');
 const before=await api(page,'api_workspace_state');await page.getByRole('button',{name:'导入',exact:true}).click();await page.getByLabel('选择导入文件').setInputFiles({name:'workspace.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await expect(page.getByLabel('导入预览')).toContainText('工作区备份');await expect(page.getByLabel('导入预览')).toContainText(name);
 let calls=0;await page.route('**/api/api_import',async route=>{calls++;await route.continue();});await page.getByRole('button',{name:'确认导入',exact:true}).dblclick();await expect(page.getByRole('button',{name:'已导入',exact:true})).toBeDisabled();expect(calls).toBe(1);await page.getByRole('dialog',{name:'导入请求'}).locator('footer').getByRole('button',{name:'关闭',exact:true}).click();
 const after=await api(page,'api_workspace_state');expect(after.collections.length).toBe(before.collections.length*2);expect(after.environments.length).toBe(before.environments.length*2);
 const restored=after.collections.find((c:any)=>c.data.info.name===name+'（导入）');expect(restored.data.event).toEqual(events);expect(restored.data.item[0].event).toEqual(events);expect(restored.id).not.toBe(original.id);
 const restoredTree=page.locator('.collection').filter({has:page.locator('.collection-head').getByRole('button',{name:restored.data.info.name,exact:true})});await restoredTree.getByRole('button',{name:'迁移接口',exact:true}).click();await page.getByRole('button',{name:'选择环境',exact:true}).click();await page.getByRole('option').filter({hasText:envName+'（导入）'}).click();await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText('运行完成',{exact:true})).toBeVisible({timeout:15000});await expect(page.getByTestId('response-body')).toContainText('/draft-restored');await page.locator('.response-tools').getByRole('button',{name:/断言/}).click();await expect(page.getByText('after-import',{exact:true})).toHaveCount(2);await expect(page.getByText('通过',{exact:true})).toHaveCount(2);
 await page.getByRole('button',{name:'导出全部',exact:true}).click();await page.screenshot({path:'/tmp/api-workspace-export-preview.png'});
});

test('failed draft save prevents workspace download and delayed preview cannot replace newer input',async({page})=>{
 await page.goto('http://127.0.0.1:47891');await page.getByRole('button',{name:'＋ 新建集合',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('未保存草稿');
 let downloads=0;page.on('download',()=>downloads++);await page.route('**/api/api_document_put',route=>route.fulfill({status:409,json:{error:'CONFLICT: 模拟另一个会话更新'}}));
 await page.getByRole('button',{name:'导出全部',exact:true}).click();await page.getByRole('button',{name:'导出备份',exact:true}).click();await expect(page.locator('.modal-error')).toContainText('CONFLICT');expect(downloads).toBe(0);await page.keyboard.press('Escape');await page.unroute('**/api/api_document_put');
 await page.getByRole('button',{name:'导入',exact:true}).click();let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),observed=new Promise<void>(r=>started=r);
 await page.route('**/api/api_import_preview',async route=>{if(route.request().postDataJSON().text.includes('旧预览')){started();await gate;}await route.continue();});
 const bundle=(name:string)=>JSON.stringify({format:'codex-api-client-workspace',version:1,collections:[{info:{name},item:[]}],environments:[],globals:null});
 await page.getByLabel('导入内容').fill(bundle('旧预览'));await observed;await page.getByLabel('导入内容').fill(bundle('新预览'));await expect(page.getByLabel('导入预览')).toContainText('新预览');release();await expect(page.getByLabel('导入预览')).not.toContainText('旧预览');
});

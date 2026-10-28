import {test,expect,type Page} from '@playwright/test';
import {auditSession} from '../../../scripts/ui-audit-helpers.mjs';
async function fixture(page:Page){
 await page.goto('http://127.0.0.1:47891');await expect(page.getByText('本地工作区',{exact:true})).toBeAttached();
 const name='设计审查-'+test.info().testId;
 await page.getByRole('button',{name:'导入',exact:true}).click();await page.getByLabel('导入内容').fill(JSON.stringify({info:{name,schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},item:[{name:'账户文件夹',item:[{name:'示例请求',request:{method:'POST',url:'http://127.0.0.1:47892/audit'}}]},{name:'无关请求',request:{method:'GET',url:'http://127.0.0.1:47892/should-not-run'}},{name:'其他文件夹',item:[{name:'其他请求',request:{method:'GET',url:'http://127.0.0.1:47892/other-folder'}}]}]}));await page.getByRole('button',{name:'确认导入',exact:true}).click();
 const tree=page.locator('.collection').filter({has:page.locator('.collection-head').getByRole('button',{name,exact:true})});return tree;
}
test('runner labels match collection folder and request targets',async({page})=>{
 const audit=await auditSession(page,'api-runner'),tree=await fixture(page);
 await tree.getByRole('button',{name:'账户文件夹',exact:true}).click();await audit.screenshot('before-folder');
 await expect(page.getByRole('button',{name:'运行文件夹',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'运行文件夹',exact:true}).click();const dialog=page.getByRole('dialog',{name:'运行文件夹'});await expect(dialog).toContainText('账户文件夹');await audit.controls(dialog,'folder runner');
 await dialog.getByRole('button',{name:'开始运行',exact:true}).click();await expect(page.getByText('运行完成',{exact:true})).toBeVisible();await expect(page.getByTestId('response-body')).toContainText('/audit');await expect(page.getByLabel('选择响应')).toHaveCount(0);
 await tree.getByRole('button',{name:'示例请求',exact:true}).click();await page.getByLabel('更多操作').click();await page.getByRole('button',{name:'请求运行选项',exact:true}).click();await expect(page.getByRole('dialog',{name:'运行请求'})).toContainText('示例请求');await page.getByRole('button',{name:'开始运行',exact:true}).click();await expect(page.getByText('运行完成',{exact:true})).toBeVisible();await expect(page.getByLabel('选择响应')).toHaveCount(0);await expect(page.getByTestId('response-body')).toContainText('/audit');await audit.finish();
});
test('method rows scripts Cookie and uploaded import controls perform their actions',async({page})=>{
 const tree=await fixture(page);await tree.getByRole('button',{name:'示例请求',exact:true}).click();
 const nav=(name:string)=>page.locator('.editor-nav').getByRole('button',{name,exact:true});
 await nav('请求头').click();await page.getByRole('button',{name:'＋ 添加一行',exact:true}).click();await page.getByLabel('名称 1',{exact:true}).fill('X-Audit');await page.getByLabel('值 1',{exact:true}).fill('disabled-value');await page.getByLabel('启用 X-Audit').uncheck();
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText('运行完成',{exact:true})).toBeVisible();await expect(page.getByTestId('response-body')).not.toContainText('disabled-value');await page.getByLabel('删除行 1').click();await expect(page.locator('.kv-row')).toHaveCount(0);
 for(const method of ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']){await page.getByLabel('请求方法').selectOption(method);const started=page.waitForResponse(r=>r.url().endsWith('/api/api_run_start'));const completed=page.waitForResponse(async r=>{if(!r.url().endsWith('/api/api_run_result'))return false;const value=await r.json(),runId=(await(await started).json()).runId;return value.id===runId&&value.status==='completed';});await page.getByRole('button',{name:'发送',exact:true}).click();await completed;await expect(page.getByText('运行完成',{exact:true})).toBeVisible();await expect(page.getByText('200 OK',{exact:true})).toBeVisible();if(method!=='HEAD')await expect(page.getByTestId('response-body')).toContainText(`"method": "${method}"`);}
 await nav('脚本').click();await page.getByRole('button',{name:'响应后',exact:true}).click();await page.getByRole('button',{name:'插入示例',exact:true}).click();await expect(page.getByTestId('script-editor')).toContainText('pm.test');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'管理 Cookie'}).click();await page.getByLabel('Cookie 域筛选').fill('audit-cookie.test');await page.getByRole('button',{name:'编辑此域',exact:true}).click();await expect(page.getByRole('heading',{name:'audit-cookie.test'})).toBeVisible();await page.getByRole('button',{name:'清空所选域',exact:true}).click();await page.getByRole('button',{name:'保存 Cookie'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'导入',exact:true}).click();await page.getByRole('dialog',{name:'导入请求'}).getByLabel('选择导入文件',{exact:true}).setInputFiles({name:'audit.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({name:'文件导入的环境',values:[]}))});await expect(page.getByLabel('导入内容')).toHaveValue(/文件导入的环境/);await page.getByRole('button',{name:'确认导入',exact:true}).click();await expect(page.getByRole('button',{name:'选择环境'})).toContainText('文件导入的环境');
});
for(const size of [{width:1440,height:950},{width:820,height:600},{width:620,height:500}])test(`all modal and editor controls receive pointer at ${size.width}x${size.height}`,async({page})=>{
 await page.setViewportSize(size);const tree=await fixture(page),audit=await auditSession(page,`api-${size.width}`);await tree.getByRole('button',{name:'示例请求',exact:true}).click();
 for(const theme of ['light','dark']){
  if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByLabel('切换主题').click();
  await audit.screenshot(`${theme}-before`);expect(await page.locator('.app-shell').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight)).toBe(true);
  for(const name of ['参数','认证','请求头','请求体','脚本']){await page.locator('.editor-nav').getByRole('button',{name,exact:true}).click();await audit.controls(page.locator('.request-pane'),`${name} ${theme}`);}
  const started=page.waitForResponse(r=>r.url().endsWith('/api/api_run_start'));const completed=page.waitForResponse(async r=>{if(!r.url().endsWith('/api/api_run_result'))return false;const value=await r.json(),runId=(await(await started).json()).runId;return value.id===runId&&value.status==='completed';});await page.getByRole('button',{name:'发送',exact:true}).click();await completed;await expect(page.getByText('运行完成',{exact:true})).toBeVisible();await audit.controls(page.locator('.response-pane'),`response ${theme}`);
  await page.getByRole('button',{name:'设置',exact:true}).click();const dialog=page.getByRole('dialog',{name:'请求设置'});
  for(const name of ['常规','代理','证书','高级 JSON']){await dialog.getByRole('tab',{name,exact:true}).click();if(name==='代理')await dialog.getByRole('switch',{name:'使用 HTTP 代理'}).check();if(name==='证书'){await dialog.getByRole('button',{name:'添加客户端证书'}).click();await dialog.getByLabel('证书名称 1').fill('示例证书');}await audit.controls(dialog,`settings ${name} ${theme}`);}
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'导入',exact:true}).click();await audit.controls(page.getByRole('dialog',{name:'导入请求'}),`import ${theme}`);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'选择环境'}).click();await audit.controls(page.getByRole('dialog',{name:'环境选择'}),`environment ${theme}`);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'管理 Cookie'}).click();await audit.controls(page.getByRole('dialog',{name:'Cookie 管理'}),`cookies ${theme}`);await page.keyboard.press('Escape');
 }
 await audit.finish();
});

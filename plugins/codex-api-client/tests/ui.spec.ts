import { test, expect } from '@playwright/test';

test('create request, edit scripts, send locally and inspect response and assertions', async ({page})=>{
  await page.goto('http://127.0.0.1:47891');
  await expect(page.getByText('本地工作区',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'新建集合',exact:true}).click();
  await page.getByLabel('名称',{exact:true}).fill('UI 测试集合');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('button',{name:'新建请求',exact:true}).click();
  await page.getByLabel('URL',{exact:true}).fill('http://127.0.0.1:47892/echo?from=ui');
  await page.getByRole('button',{name:'脚本',exact:true}).click();
  await page.getByRole('button',{name:'响应后',exact:true}).click();
  const editor=page.locator('[data-testid="script-editor"] .cm-content');
  await editor.fill('pm.test("状态正确", () => pm.response.to.have.status(200));');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByText('200 OK',{exact:true})).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:/断言/}).click();
  await expect(page.getByText('状态正确',{exact:true})).toBeVisible();
  await expect(page.getByText('通过',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'正文',exact:true}).click();
  await expect(page.getByTestId('response-body')).toContainText('/echo?from=ui');
  await page.getByRole('button',{name:'请求前',exact:true}).click();
  await page.getByRole('button',{name:'响应后',exact:true}).click();
  await expect(page.getByText('未保存',{exact:true})).toHaveCount(0);
  await page.screenshot({path:'docs/preview.png',fullPage:true});
  await page.reload();
  await expect(page.getByRole('button',{name:'UI 测试集合',exact:true})).toBeVisible();
});

test('environment import, variable table, theme and keyboard save work',async({page})=>{
  await page.goto('http://127.0.0.1:47891');
  await page.getByRole('button',{name:'导入',exact:true}).click();
  await page.getByLabel('导入内容').fill(JSON.stringify({name:'UI 环境',values:[{key:'baseUrl',value:'http://127.0.0.1:47892'}]}));
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await page.getByRole('button',{name:'选择环境',exact:true}).click();
  await page.getByRole('button',{name:'编辑环境 UI 环境',exact:true}).click();
  await expect(page.locator('input[value="baseUrl"]')).toBeVisible();
  await page.getByRole('button',{name:'切换主题'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',/dark|light/);
  await page.getByLabel('值 1',{exact:true}).fill('http://127.0.0.1:47892/updated');
  await page.keyboard.press(process.platform==='darwin'?'Meta+s':'Control+s');
  await expect(page.getByText('已保存',{exact:true})).toBeVisible();
});

test('typing during an asynchronous save remains dirty and can be saved afterwards',async({page})=>{
  await page.goto('http://127.0.0.1:47891');
  await page.getByRole('button',{name:'＋ 新建集合',exact:true}).click();
  await page.getByLabel('名称',{exact:true}).fill('第一次编辑');
  let release:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r;});
  let started:()=>void=()=>{};const observed=new Promise<void>(r=>{started=r;});
  await page.route('**/api/api_document_put',async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response});});
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await observed;
  await page.getByLabel('名称',{exact:true}).fill('保存期间继续编辑');
  release();
  await expect(page.getByText('已保存',{exact:true})).toBeVisible();
  await expect(page.getByLabel('名称',{exact:true})).toHaveValue('保存期间继续编辑');
  await expect(page.getByText('未保存',{exact:true})).toBeVisible();
  await page.unroute('**/api/api_document_put');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByRole('button',{name:'保存期间继续编辑',exact:true})).toBeVisible();
});

test('settings and Cookie editors retain their opening revision across background refreshes',async({page})=>{
  await page.goto('http://127.0.0.1:47891');
  await expect(page.getByText('本地工作区',{exact:true})).toBeVisible();
  const put=async(kind:string,data:any)=>page.evaluate(async({kind,data})=>{
    const headers={'Content-Type':'application/json','X-API-Token':(window as any).__DEV_TOKEN__};
    const state=await(await fetch('/api/api_workspace_state',{method:'POST',headers,body:'{}'})).json();
    return(await fetch('/api/api_document_put',{method:'POST',headers,body:JSON.stringify({kind,id:'default',revision:state[kind]?.revision||0,data})})).json();
  },{kind,data});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await put('settings',{requestTimeout:12345});
  await page.waitForResponse(r=>r.url().endsWith('/api/api_workspace_state'));
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(page.locator('.modal-error')).toBeVisible();
  await page.getByRole('button',{name:'管理 Cookie',exact:true}).click();
  await put('cookies',{cookies:[]});
  await page.waitForResponse(r=>r.url().endsWith('/api/api_workspace_state'));
  await page.getByRole('button',{name:'保存 Cookie',exact:true}).click();
  await expect(page.locator('.modal-error')).toBeVisible();
});

test('settings form edits seconds, keeps advanced fields and persists after reopening',async({page})=>{
  await page.goto('http://127.0.0.1:47891');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'请求设置'});
  await expect(dialog.getByLabel('请求超时')).toBeVisible();
  await dialog.getByRole('tab',{name:'高级 JSON',exact:true}).click();
  await dialog.locator('.cm-content').fill(JSON.stringify({requestTimeout:30000,scriptTimeout:5000,runTimeout:120000,strictSSL:true,followRedirects:true,delay:0,customSetting:'preserve-me'}));
  await dialog.getByRole('tab',{name:'常规',exact:true}).click();
  await page.screenshot({path:'docs/settings-preview.png',fullPage:true});
  await dialog.getByLabel('请求超时').fill('8.5');
  await dialog.getByLabel('脚本超时').fill('2');
  await dialog.getByLabel('运行超时').fill('60');
  await dialog.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(dialog.getByLabel('请求超时')).toHaveValue('8.5');
  await dialog.getByRole('tab',{name:'高级 JSON',exact:true}).click();
  await expect(dialog.locator('.cm-content')).toContainText('preserve-me');
  await expect(dialog.locator('.cm-content')).toContainText('8500');
  await dialog.locator('.cm-content').fill('{invalid');
  await expect(dialog.getByRole('alert')).toContainText('JSON');
  await expect(dialog.getByRole('button',{name:'保存设置',exact:true})).toBeDisabled();
});

test('proxy and certificate forms validate input and allow selected certificate paths on save',async({page})=>{
  await page.goto('http://127.0.0.1:47891');
  const originalSettings=await page.evaluate(async()=>{
    const headers={'Content-Type':'application/json','X-API-Token':(window as any).__DEV_TOKEN__};
    return (await(await fetch('/api/api_workspace_state',{method:'POST',headers,body:'{}'})).json()).settings?.data||{};
  });
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'请求设置'});
  await dialog.getByRole('tab',{name:'代理',exact:true}).click();
  await dialog.getByRole('switch',{name:'使用 HTTP 代理'}).check();
  await dialog.getByLabel('代理地址').fill('https://invalid.test');
  await dialog.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('http://');
  await dialog.getByLabel('代理地址').fill('http://127.0.0.1:7890');
  await dialog.getByRole('tab',{name:'证书',exact:true}).click();
  await dialog.getByLabel('CA 证书路径').fill('/tmp/api-client-ca.pem');
  await dialog.getByRole('button',{name:'添加客户端证书',exact:true}).click();
  await dialog.getByLabel('证书名称 1').fill('本地 API');
  await dialog.getByLabel('匹配地址 1').fill('https://localhost:8443/*');
  await dialog.getByLabel('证书文件 1').fill('/tmp/api-client-cert.pem');
  await dialog.getByLabel('私钥文件 1').fill('/tmp/api-client-key.pem');
  await dialog.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await dialog.getByRole('tab',{name:'高级 JSON',exact:true}).click();
  const stored=await page.evaluate(async()=>{
    const headers={'Content-Type':'application/json','X-API-Token':(window as any).__DEV_TOKEN__};
    return (await(await fetch('/api/api_workspace_state',{method:'POST',headers,body:'{}'})).json()).settings.data;
  });
  expect(stored.proxy).toBe('http://127.0.0.1:7890');
  expect(stored.allowedFiles).toEqual(expect.arrayContaining(['/tmp/api-client-ca.pem','/tmp/api-client-cert.pem','/tmp/api-client-key.pem']));
  expect(stored.certificates[0].name).toBe('本地 API');
  // This fixture is shared: restore networking settings before later request tests.
  await page.evaluate(async data=>{
    const headers={'Content-Type':'application/json','X-API-Token':(window as any).__DEV_TOKEN__};
    const state=await(await fetch('/api/api_workspace_state',{method:'POST',headers,body:'{}'})).json();
    const response=await fetch('/api/api_document_put',{method:'POST',headers,body:JSON.stringify({kind:'settings',id:'default',revision:state.settings.revision,data})});
    if(!response.ok)throw new Error('Failed to restore fixture settings');
  },originalSettings);
});


test('settings adapt to narrow panels and dark theme',async({page})=>{
  await page.setViewportSize({width:620,height:820});
  await page.goto('http://127.0.0.1:47891');
  await expect(page.getByText('本地工作区',{exact:true})).toBeAttached();
  await page.getByRole('button',{name:'切换主题'}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'请求设置'});
  await expect(dialog.getByRole('button',{name:'保存设置',exact:true})).toBeVisible();
  await expect(dialog.getByRole('tab',{name:'证书',exact:true})).toBeVisible();
  const bounds=await dialog.boundingBox();expect(bounds!.width).toBeLessThan(620);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:'docs/settings-narrow-dark.png',fullPage:true});
});


test('top-left environment picker switches request values, previews variables and persists selection',async({page})=>{
  await page.goto('http://127.0.0.1:47891');
  await expect(page.locator('.side-nav').getByRole('button',{name:'环境',exact:true})).toHaveCount(0);
  for(const stage of ['开发环境','测试环境']){
    await page.getByRole('button',{name:'选择环境',exact:true}).click();
    await page.getByRole('button',{name:'导入环境',exact:true}).click();
    await page.getByLabel('导入内容').fill(JSON.stringify({name:stage,values:[{key:'baseUrl',value:'http://127.0.0.1:47892'},{key:'stage',value:stage}]}));
    await page.getByRole('button',{name:'确认导入',exact:true}).click();
    await expect(page.getByRole('button',{name:'选择环境',exact:true})).toContainText(stage);
  }
  await page.getByRole('button',{name:'选择环境',exact:true}).click();
  await page.getByLabel('搜索环境').fill('开发');
  await expect(page.getByRole('option',{name:/测试环境/})).toHaveCount(0);
  await page.getByLabel('搜索环境').press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'选择环境',exact:true})).toContainText('开发环境');
  await page.getByRole('button',{name:'查看环境变量',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'变量预览'})).toContainText('baseUrl');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'查看环境变量',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'＋ 新建集合',exact:true}).click();
  await page.getByRole('button',{name:'新建请求',exact:true}).click();
  await page.getByLabel('URL',{exact:true}).fill('{{baseUrl}}/echo?stage={{stage}}');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByTestId('response-body')).toContainText(encodeURIComponent('开发环境'),{timeout:15000});
  await page.getByRole('button',{name:'选择环境',exact:true}).click();
  await page.getByRole('option',{name:/测试环境/}).click();
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByTestId('response-body')).toContainText(encodeURIComponent('测试环境'),{timeout:15000});
  await page.getByRole('button',{name:'选择环境',exact:true}).click();
  await page.screenshot({path:'docs/environment-picker.png',fullPage:true});
  await page.reload();
  await expect(page.getByRole('button',{name:'选择环境',exact:true})).toContainText('测试环境');
  await page.getByRole('button',{name:'选择环境',exact:true}).click();
  await page.getByRole('button',{name:'编辑环境 开发环境',exact:true}).click();
  await expect(page.getByLabel('名称',{exact:true})).toHaveValue('开发环境');
  await expect(page.getByRole('button',{name:'选择环境',exact:true})).toContainText('测试环境');
});

test('environment creation, globals, sensitive preview, deletion and narrow dark layout work',async({page})=>{
  await page.goto('http://127.0.0.1:47891');
  await page.getByRole('button',{name:'选择环境',exact:true}).click();
  await page.getByRole('button',{name:'＋ 新建环境',exact:true}).click();
  await expect(page.getByRole('button',{name:'选择环境',exact:true})).toContainText('新环境');
  await page.getByLabel('名称',{exact:true}).fill('临时环境');
  await page.getByRole('button',{name:'＋ 添加一行',exact:true}).click();
  await page.getByLabel('名称 1',{exact:true}).fill('apiToken');
  await page.getByLabel('类型 1',{exact:true}).selectOption('secret');
  await page.getByLabel('值 1',{exact:true}).fill('fixture-secret');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('button',{name:'查看环境变量',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'变量预览'});
  await expect(preview).toContainText('敏感');
  await expect(preview).not.toContainText('fixture-secret');
  await expect(preview).toContainText('••••••••');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'选择环境',exact:true}).click();
  await page.getByRole('button',{name:/全局变量/}).click();
  await expect(page.getByLabel('名称',{exact:true})).toHaveValue('全局变量');
  await page.getByRole('button',{name:'选择环境',exact:true}).click();
  await page.getByRole('button',{name:'编辑环境 临时环境',exact:true}).click();
  await page.getByRole('button',{name:'更多操作',exact:true}).click();
  await page.getByRole('button',{name:'删除',exact:true}).click();
  await page.getByRole('button',{name:'确认',exact:true}).click();
  await expect(page.getByRole('button',{name:'选择环境',exact:true})).toContainText('无环境');
  await page.setViewportSize({width:620,height:820});
  await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await page.getByRole('button',{name:'选择环境',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'环境选择'});
  await expect(picker).toBeVisible();
  const box=await picker.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(620);
  await page.screenshot({path:'docs/environment-picker-narrow-dark.png',fullPage:true});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'选择环境',exact:true})).toBeFocused();
});

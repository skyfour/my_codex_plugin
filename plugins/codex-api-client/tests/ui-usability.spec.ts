import {test,expect,type Page} from '@playwright/test';
const base='http://127.0.0.1:47891',echo='http://127.0.0.1:47892';
async function api(page:Page,name:string,args:any={}){return page.evaluate(async({name,args})=>{const r=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-API-Token':(window as any).__DEV_TOKEN__},body:JSON.stringify(args)});if(!r.ok)throw Error(await r.text());return r.json();},{name,args});}
async function fixture(page:Page){await page.goto(base);await expect(page.getByText('本地工作区',{exact:true})).toBeAttached();const {document:doc}=await api(page,'api_import',{text:JSON.stringify({info:{name:'易用性-'+test.info().testId},item:[{name:'账户目录',item:[{name:'登录接口',request:{method:'POST',url:echo+'/login'}}]},{name:'查询用户',request:{method:'GET',url:echo+'/users'}}]})});await page.getByLabel('刷新工作区').click();const tree=page.locator('.collection').filter({has:page.locator('.collection-head').getByRole('button',{name:doc.data.info.name,exact:true})});await tree.getByRole('button',{name:'登录接口',exact:true}).click();return {doc,tree};}
const nav=(page:Page,label:string)=>page.locator('.editor-nav').getByRole('button',{name:label,exact:true});

test('direct table entry keeps focus, Enter adds a row, and the tail never persists',async({page})=>{
 const {doc}=await fixture(page);await nav(page,'请求头').click();await expect(page.locator('.kv-row')).toHaveCount(0);
 await page.getByLabel('名称 1',{exact:true}).pressSequentially('X-Direct');await expect(page.getByLabel('名称 1',{exact:true})).toBeFocused();await page.getByLabel('值 1',{exact:true}).fill('kept');await page.getByLabel('值 1',{exact:true}).press('Enter');await expect(page.getByLabel('名称 2',{exact:true})).toBeFocused();
 await page.getByLabel('名称 2',{exact:true}).fill('X-Second');await page.getByLabel('值 2',{exact:true}).fill('also-kept');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('未保存',{exact:true})).toHaveCount(0);
 const saved=await api(page,'api_document_get',{kind:'collection',id:doc.id});expect(saved.data.item[0].item[0].request.header.map((r:any)=>r.key)).toEqual(['X-Direct','X-Second']);
 await page.getByRole('button',{name:'＋ 添加一行',exact:true}).click();await expect(page.getByLabel('名称 3',{exact:true})).toBeFocused();await page.getByLabel('删除行 3').focus();await page.keyboard.press('Enter');await expect(page.locator('.kv-row')).toHaveCount(2);await page.getByLabel('值 2',{exact:true}).dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(page.locator('.kv-row')).toHaveCount(2);
});

test('tree search reveals matching descendants without changing saved collapse or request drafts',async({page})=>{
 const {tree}=await fixture(page);await page.getByLabel('URL',{exact:true}).fill(echo+'/unsaved');await tree.getByLabel('收起 账户目录',{exact:true}).click();
 await page.getByLabel('搜索集合和请求').fill('/login');await expect(tree.getByRole('button',{name:'登录接口',exact:true})).toBeVisible();await expect(tree.getByRole('button',{name:'查询用户',exact:true})).toHaveCount(0);
 await page.getByLabel('清空集合搜索').click();await expect(tree.getByRole('button',{name:'登录接口',exact:true})).toBeHidden();await expect(tree.getByRole('button',{name:'查询用户',exact:true})).toBeVisible();await expect(page.getByLabel('URL',{exact:true})).toHaveValue(echo+'/unsaved');
 await page.getByLabel('搜索集合和请求').fill('no-such-api');await expect(page.getByText('没有匹配的集合或请求',{exact:true})).toBeVisible();await page.getByLabel('搜索集合和请求').press('Escape');await expect(page.getByLabel('搜索集合和请求')).toHaveValue('');
});

test('request tabs remember editor page and script stage independently',async({page})=>{
 const {tree}=await fixture(page);await nav(page,'脚本').click();await page.getByRole('button',{name:'响应后',exact:true}).click();await page.getByTestId('script-editor').locator('.cm-content').fill('console.log("remember me");');
 await tree.getByRole('button',{name:'查询用户',exact:true}).click();await nav(page,'认证').click();await tree.getByRole('button',{name:'登录接口',exact:true}).click();await expect(nav(page,'脚本')).toHaveClass(/active/);await expect(page.getByRole('button',{name:'响应后',exact:true})).toHaveClass(/active/);await expect(page.getByTestId('script-editor')).toContainText('remember me');
 await page.locator('.request-tabs').getByRole('button',{name:'GET 查询用户',exact:true}).click();await expect(nav(page,'认证')).toHaveClass(/active/);await page.getByLabel('关闭 查询用户',{exact:true}).click();await page.getByRole('dialog',{name:'确认操作'}).getByRole('button',{name:'确认',exact:true}).click();await expect(nav(page,'脚本')).toHaveClass(/active/);await expect(page.getByRole('button',{name:'响应后',exact:true})).toHaveClass(/active/);
});

test('send shortcut starts once and is blocked while a dialog is open',async({page})=>{
 await fixture(page);let starts=0;page.on('request',r=>{if(r.url().endsWith('/api/api_run_start'))starts++;});await page.getByLabel('URL',{exact:true}).focus();await page.keyboard.press('Control+Enter');await expect(page.getByText('运行完成',{exact:true})).toBeVisible();expect(starts).toBe(1);
 await page.getByRole('button',{name:'导入',exact:true}).click();await page.getByLabel('导入内容').fill('{}');await page.keyboard.press('Control+Enter');await page.keyboard.press('Escape');await expect(page.getByLabel('URL',{exact:true})).toBeVisible();expect(starts).toBe(1);
});

test('sidebar collapse expands the editor and search shortcut restores navigation at narrow widths',async({page})=>{
 const {tree}=await fixture(page);await page.setViewportSize({width:620,height:700});const before=(await page.getByLabel('URL',{exact:true}).boundingBox())!.width;await page.getByLabel('收起集合侧栏').click();await expect(page.locator('.sidebar')).toBeHidden();await expect.poll(async()=>(await page.getByLabel('URL',{exact:true}).boundingBox())!.width).toBeGreaterThan(before+100);
 await page.keyboard.press('Control+k');await expect(page.getByLabel('搜索集合和请求')).toBeFocused();await expect(tree).toBeVisible();await page.getByLabel('搜索集合和请求').fill('登录');await expect(tree.getByRole('button',{name:'登录接口',exact:true})).toBeVisible();
});

test('current environment opens directly and creating a request works in an empty workspace',async({page})=>{
 await page.goto(base);const state=await api(page,'api_workspace_state');for(const doc of state.collections)await api(page,'api_document_delete',{kind:'collection',id:doc.id,revision:doc.revision});await page.getByLabel('刷新工作区').click();await page.getByLabel('新建请求标签').click();await expect(page.getByLabel('URL',{exact:true})).toBeVisible();await expect(page.getByLabel('名称',{exact:true})).toHaveValue('新请求');
 const {document:env}=await api(page,'api_import',{text:JSON.stringify({name:'直达环境',values:[{key:'baseUrl',value:echo}]})});await page.getByLabel('刷新工作区').click();await page.getByRole('button',{name:'选择环境'}).click();await page.getByRole('option',{name:/直达环境/}).click();await page.getByLabel('编辑当前环境').click();await expect(page.getByLabel('名称',{exact:true})).toHaveValue(env.data.name);await expect(page.getByLabel('名称 1',{exact:true})).toHaveValue('baseUrl');
});

test('method arrows keep reserved space and keyboard focus frames the whole tree row',async({page})=>{
 const {tree}=await fixture(page);await page.setViewportSize({width:620,height:700});for(const theme of ['light','dark']){const metrics=await page.getByLabel('请求方法').evaluate(el=>({appearance:getComputedStyle(el).appearance,arrow:getComputedStyle(el).backgroundImage,padding:parseFloat(getComputedStyle(el).paddingRight),width:el.getBoundingClientRect().width}));expect(metrics.appearance).toBe('none');expect(metrics.arrow).not.toBe('none');expect(metrics.padding).toBeGreaterThanOrEqual(28);expect(metrics.width).toBeGreaterThanOrEqual(100);await page.getByLabel('切换主题').click();}
 const name=tree.getByRole('button',{name:'登录接口',exact:true});await name.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(name).toBeFocused();await expect(name).toHaveCSS('outline-style','none');await expect(name.locator('..')).toHaveCSS('outline-style','solid');
});

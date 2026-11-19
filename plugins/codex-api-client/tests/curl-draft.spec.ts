import {test,expect,type Page} from '@playwright/test';

const preview='http://127.0.0.1:47891';
const fixture='http://127.0.0.1:47892';
const accept='application/json, text/plain, */*';

async function api(page:Page,name:string,args:Record<string,unknown>={}){
  return page.evaluate(async({name,args})=>{
    const response=await fetch('/api/'+name,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-API-Token':(window as Window & {__DEV_TOKEN__:string}).__DEV_TOKEN__},
      body:JSON.stringify(args)
    });
    const result=await response.json();
    if(!response.ok)throw Error(JSON.stringify(result));
    return result;
  },{name,args});
}

async function workspace(page:Page){
  return (await api(page,'api_workspace_state')).collections;
}

async function importCurl(page:Page,path:string){
  await page.getByRole('button',{name:'导入',exact:true}).click();
  await page.getByLabel('导入内容').fill(`curl '${fixture}${path}' -H 'Accept: ${accept}'`);
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByLabel('URL',{exact:true})).toHaveValue(fixture+path);
  await expect(page.getByRole('dialog',{name:'导入请求'})).toHaveCount(0);
}

test('cURL import sends as a draft and only creates a collection on explicit save',async({page})=>{
  await page.goto(preview);
  await expect(page.getByText('本地工作区',{exact:true})).toBeVisible();
  const before=await workspace(page);
  const showHeaders=page.getByRole('button',{name:'请求头',exact:true});
  const response=page.getByTestId('response-body');

  await importCurl(page,'/curl-draft-new');
  await expect(page.locator('.collection')).toHaveCount(before.length);
  expect(await workspace(page)).toEqual(before);
  await showHeaders.click();
  await expect(page.getByLabel('名称 1',{exact:true})).toHaveValue('Accept');
  await expect(page.getByLabel('值 1',{exact:true})).toHaveValue(accept);
  await expect(page.getByRole('checkbox',{name:'启用 Accept',exact:true})).toBeChecked();

  await expect(response).toHaveCount(0);
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(response).toContainText('/curl-draft-new',{timeout:15000});
  await expect(response).toContainText(accept);
  expect(await workspace(page)).toEqual(before);

  const requestName='试发后保存的请求';
  const collectionName='cURL 临时请求新建集合';
  await page.getByLabel('名称',{exact:true}).fill(requestName);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  const save=page.getByRole('dialog',{name:'保存请求'});
  await save.getByRole('combobox',{name:'目标集合',exact:true}).selectOption({label:'新建集合'});
  await save.getByLabel('集合名称',{exact:true}).fill(collectionName);
  const confirmSave=save.getByRole('button',{name:'确认保存',exact:true});
  await page.route('**/api/api_document_put',route=>
    route.request().postDataJSON().data?.info?.name===collectionName
      ?route.fulfill({status:409,json:{error:'CONFLICT: 模拟首次保存失败'}})
      :route.continue()
  );
  await confirmSave.click();
  await expect(page.locator('.modal-error')).toContainText('模拟首次保存失败');
  await expect(save).toBeVisible();
  await expect(response).toContainText('/curl-draft-new');
  expect(await workspace(page)).toEqual(before);

  await page.unroute('**/api/api_document_put');
  await confirmSave.click();
  await expect(save).toHaveCount(0);
  await expect(page.locator('.collection').getByRole('button',{name:requestName,exact:true})).toBeVisible();
  await expect(page.getByLabel('URL',{exact:true})).toHaveValue(fixture+'/curl-draft-new');
  await expect(response).toContainText('/curl-draft-new');
  const after=await workspace(page);
  expect(after).toHaveLength(before.length+1);
  const saved=after.find((doc:any)=>doc.data.info.name===collectionName);
  expect(saved?.data.item).toHaveLength(1);
  expect(saved.data.item[0]).toMatchObject({
    name:requestName,
    request:{url:fixture+'/curl-draft-new',header:[{key:'Accept',value:accept}]}
  });
});

test('keyboard save adds the cURL draft to the selected existing folder',async({page})=>{
  await page.goto(preview);
  const collectionName='cURL 临时请求已有集合';
  const collection=await api(page,'api_document_put',{
    kind:'collection',
    id:'new',
    revision:0,
    data:{info:{name:collectionName},item:[{name:'接收文件夹',item:[]},{name:'保留的原请求',request:{method:'GET',url:fixture+'/original'}}]}
  });
  await page.getByLabel('刷新工作区').click();
  await expect(page.locator('.collection-head').getByRole('button',{name:collectionName,exact:true})).toBeVisible();
  const before=await workspace(page);

  await importCurl(page,'/curl-draft-existing');
  const requestName='保存到已有文件夹的请求';
  await page.getByLabel('名称',{exact:true}).fill(requestName);
  await expect(page.locator('.collection').getByRole('button',{name:requestName,exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const response=page.getByTestId('response-body');
  await expect(response).toContainText('/curl-draft-existing',{timeout:15000});
  expect(await workspace(page)).toEqual(before);
  await page.keyboard.press(process.platform==='darwin'?'Meta+s':'Control+s');
  const save=page.getByRole('dialog',{name:'保存请求'});
  await save.getByRole('combobox',{name:'目标集合',exact:true}).selectOption({label:collectionName});
  await save.getByRole('combobox',{name:'目标文件夹',exact:true}).selectOption({label:'接收文件夹'});
  await save.getByRole('button',{name:'确认保存',exact:true}).click();

  await expect(save).toHaveCount(0);
  await expect(page.locator('.collection').getByRole('button',{name:requestName,exact:true})).toBeVisible();
  await expect(page.locator('.request-tab')).toHaveCount(1);
  await expect(response).toContainText('/curl-draft-existing');
  const after=await workspace(page);
  expect(after).toHaveLength(before.length);
  expect(after.find((doc:any)=>doc.id===collection.id)?.data.item).toMatchObject([
    {name:'接收文件夹',item:[{name:requestName,request:{url:fixture+'/curl-draft-existing'}}]},
    {name:'保留的原请求',request:{url:fixture+'/original'}}
  ]);
});

test('closing an imported cURL draft confirms discard without writing a collection',async({page})=>{
  await page.goto(preview);
  await expect(page.getByText('本地工作区',{exact:true})).toBeVisible();
  const before=await workspace(page);
  await importCurl(page,'/curl-draft-discard');
  const close=page.locator('.request-tab').getByRole('button',{name:/^关闭 /});
  const confirm=page.getByRole('dialog',{name:'确认操作'});

  await close.click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button',{name:'保留内容',exact:true}).click();
  await expect(page.getByLabel('URL',{exact:true})).toHaveValue(fixture+'/curl-draft-discard');
  await close.click();
  await confirm.getByRole('button',{name:'确认',exact:true}).click();

  await expect(close).toHaveCount(0);
  await expect(page.getByLabel('URL',{exact:true})).toHaveCount(0);
  expect(await workspace(page)).toEqual(before);
});

test('malformed cURL Accept stays visible but disabled and is not sent',async({page})=>{
  await page.goto(preview);
  await expect(page.getByText('本地工作区',{exact:true})).toBeVisible();
  const before=await workspace(page);
  const path='/curl-draft-malformed';
  const invalidAccept='application/json, text/plain, /';
  await page.getByRole('button',{name:'导入',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'导入请求'});
  await dialog.getByLabel('导入内容').fill(`curl '${fixture}${path}' -H 'Accept: ${invalidAccept}'`);
  await expect(dialog.getByLabel('导入预览').locator('.warning')).toContainText(/Accept/i);
  await dialog.getByRole('button',{name:'确认导入',exact:true}).click();

  await expect(page.getByLabel('URL',{exact:true})).toHaveValue(fixture+path);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText:/Accept/i})).toBeVisible();
  await page.getByRole('button',{name:'请求头',exact:true}).click();
  await expect(page.getByLabel('名称 1',{exact:true})).toHaveValue('Accept');
  await expect(page.getByLabel('值 1',{exact:true})).toHaveValue(invalidAccept);
  await expect(page.getByRole('checkbox',{name:'启用 Accept',exact:true})).not.toBeChecked();

  await page.getByRole('button',{name:'发送',exact:true}).click();
  const response=page.getByTestId('response-body');
  await expect(response).toContainText(path,{timeout:15000});
  await expect(response).not.toContainText(invalidAccept);
  expect(await workspace(page)).toEqual(before);
});

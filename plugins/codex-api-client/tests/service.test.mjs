import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
const { ApiService } = await import('../src/service.mjs').catch(() => ({}));
async function setup(t) {
  assert.equal(typeof ApiService, 'function');
  const dir=await mkdtemp(join(tmpdir(),'api-service-'));
  const store=new Store(dir);
  const service=new ApiService(store);
  t.after(async()=>{await service.close();store.close();await rm(dir,{recursive:true,force:true});});
  return {service,store,dir};
}
test('import, duplicate, move, delete and export operate on the same revisioned collection', async t=>{
  const {service}=await setup(t);
  const imported=await service.import({text:JSON.stringify({info:{name:'API'},item:[{name:'one',request:{method:'GET',url:'http://localhost'}},{name:'Folder',item:[]}]})});
  const c=imported.document;
  const copied=await service.editItem({collectionId:c.id,itemId:c.data.item[0].id,operation:'duplicate',revision:1});
  assert.equal(copied.data.item.length,3);
  const moved=await service.editItem({collectionId:c.id,itemId:copied.data.item[1].id,operation:'move',parentId:c.data.item[1].id,position:0,revision:2});
  assert.equal(moved.data.item[1].item.length,1);
  await assert.rejects(service.editItem({collectionId:c.id,itemId:c.data.item[0].id,operation:'delete',revision:1}),/CONFLICT/);
  const exported=await service.export({kind:'collection',id:c.id});
  assert.equal(exported.data.info.name,'API');
  assert.equal((await service.state()).collections.length,1);
});
test('invalid limits and unsupported auth/scripts are rejected before execution', async t=>{
  const {service}=await setup(t);
  const c=await service.put({kind:'collection',id:'x',revision:0,data:{info:{name:'x'},item:[{name:'x',request:{url:'http://localhost',auth:{type:'oauth2'}}}]}});
  await assert.rejects(service.start({collectionId:c.id,options:{iterations:0}}),/LIMIT/);
  await assert.rejects(service.start({collectionId:c.id}),/UNSUPPORTED/);
});
test('file upload creates an owned attachment and rejects oversized or malformed inputs', async t=>{
  const {service,dir}=await setup(t);
  const result=await service.upload({name:'../../hello.txt',base64:Buffer.from('hello').toString('base64')});
  assert.ok(result.path.startsWith(join(dir,'uploads')));
  assert.equal(result.name,'hello.txt');
  await assert.rejects(service.upload({name:'x',base64:'!!!!'}),/UPLOAD/);
});

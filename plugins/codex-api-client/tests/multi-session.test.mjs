import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {Store} from '../src/store.mjs';
import {ApiService} from '../src/service.mjs';
test('another session can cancel an active run through shared SQLite',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'api-multi-')),a=new Store(dir),b=new Store(dir),owner=new ApiService(a),other=new ApiService(b);
  const server=http.createServer((req,res)=>setTimeout(()=>res.end('late'),3000));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();server.close();await owner.close();await other.close();a.close();b.close();await rm(dir,{recursive:true,force:true});});
  const c=await owner.put({kind:'collection',id:'c',revision:0,data:{info:{name:'Cancel'},item:[{name:'slow',request:{url:`http://127.0.0.1:${server.address().port}`,method:'GET'}}]}});
  const run=await owner.start({collectionId:c.id});await other.cancel({runId:run.runId});
  let result;for(let i=0;i<100;i++){result=await other.result({runId:run.runId});if(result.status!=='running')break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(result.status,'cancelled');
});

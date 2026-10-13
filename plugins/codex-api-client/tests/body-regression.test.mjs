// Regression: ISSUE-007 — inactive cached bodies must not be sent or read as files.
// Found by /qa on 2026-10-12. Report: docs/qa-2026-10-12.md
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {executeCollection} from '../src/execution.mjs';
test('disabled body sends nothing and inactive multipart paths are never opened',async t=>{
  const server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);res.end(Buffer.concat(chunks));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${server.address().port}`;
  for(const [body,expected] of [[{mode:'none',disabled:true,raw:'must not send',formdata:[{key:'file',type:'file',src:'/missing/inactive-file'}]},''],[{mode:'raw',raw:'active body',formdata:[{key:'file',type:'file',src:'/missing/inactive-file'}]},'active body']]){
    const result=await executeCollection({collection:{info:{name:'Body modes'},item:[{id:'body',name:'body',request:{method:'POST',url,body}}]}});
    assert.equal(result.status,'completed',JSON.stringify(result.errors));assert.equal(result.responses[0].body,expected);
  }
});

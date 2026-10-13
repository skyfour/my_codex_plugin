import test from 'node:test';
import assert from 'node:assert/strict';
import {readTapd} from '../src/tapd.mjs';
const now=Date.parse('2026-10-09T12:00:00Z');
const input={token:'synthetic-token',workspaceId:'100',ownerName:'示例'};
const identity={id:'9',nick:'nick',name:'示例'};
const task=(overrides={})=>({Task:{id:'1',workspace_id:'100',name:'任务',description:'<p>完整原文</p>',creator:'创建人',modified:'2026-10-09 19:00:00',owner:'nick;other',status:'open',...overrides}});
const response=data=>new Response(JSON.stringify({status:1,data}),{headers:{'content-type':'application/json'}});
test('reads only fixed GET endpoints and preserves full source text and large IDs',async()=>{
 const calls=[];const result=await readTapd(input,{now:()=>now,fetchImpl:async(url,options)=>{calls.push(url);assert.equal(options.method,'GET');assert.equal(url.origin,'https://api.tapd.cn');assert.equal(options.redirect,'error');return response(url.pathname==='/users/info'?identity:[task({id:'12345678901234567890',description:'内容'.repeat(50000)})]);}});
 assert.equal(result.records[0].body.length,100000);assert.equal(result.records[0].sourceId,'12345678901234567890');assert.ok(!JSON.stringify(result).includes(input.token));assert.equal(calls.length,2);
});
test('rejects identity or exact owner mismatch',async()=>{
 await assert.rejects(readTapd(input,{now:()=>now,fetchImpl:async url=>response(url.pathname==='/users/info'?{...identity,name:'别的人'}:[])}),/TAPD_IDENTITY_MISMATCH/);
 await assert.rejects(readTapd(input,{now:()=>now,fetchImpl:async url=>response(url.pathname==='/users/info'?identity:[task({owner:'nickname'})])}),/TAPD_SCOPE_MISMATCH/);
});
test('known tasks are individually checked for completion or reassignment',async()=>{
 const r=await readTapd({...input,knownIds:['1']},{now:()=>now,fetchImpl:async url=>response(url.pathname==='/users/info'?identity:url.searchParams.has('id')?[task({status:'done',owner:'other'})]:[])});
 assert.equal(r.records[0].sourceState,'done');assert.deepEqual(r.missingIds,[]);
});
test('failed API responses and rate limits never leak raw response or token',async()=>{
 await assert.rejects(readTapd(input,{now:()=>now,fetchImpl:async()=>new Response('remote-secret',{status:429})}),error=>error.message==='TAPD_RATE_LIMITED'&&!String(error).includes('remote-secret'));
 await assert.rejects(readTapd(input,{now:()=>now,fetchImpl:async()=>response(null)}),/TAPD_RESPONSE_INVALID/);
});

import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createDbxServer,UI_URI} from '../servers/server.mjs';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function fixture(t,overrides={}){
  const home=await mkdtemp(join(tmpdir(),'dbx-server-test-'));
  const calls={ensure:0,update:0,latest:0,backend:0,closed:0,proxyClosed:0},status={phase:'ready',currentVersion:'0.6.52'};
  const runtime={home,baseUrl:'http://127.0.0.1:54224',status:async()=>({...status}),ensure:async()=>{calls.ensure++;return {...status};},update:async()=>{calls.update++;return {...status,currentVersion:'0.6.53'};},latest:async()=>{calls.latest++;return {version:'0.6.53'};},token:async()=>{throw Error('fake backend must not read secret');},...overrides.runtime};
  const official={name:'dbx_query',description:'Official SQL execution policy',inputSchema:{type:'object',properties:{sql:{type:'string'}},required:['sql']},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false},_meta:{policy:'official-review-required'}};
  const forwarded=[];
  const backend={listTools:async()=>({tools:[official,{...official,name:'dbx_codex_update',description:'must not override adapter'}]}),callTool:async params=>{forwarded.push(params);return {isError:true,content:[{type:'text',text:'Official approval required'}],structuredContent:{code:'DBX_POLICY_DENIED',approval:{required:true}},_meta:{policyRevision:'r42'}};},close:async()=>{calls.closed++;},...overrides.backend};
  const app=await createDbxServer({runtime,proxyFactory:async({upstream})=>{assert.equal(upstream,runtime.baseUrl);return {origin:'http://127.0.0.1:54321',url:'http://127.0.0.1:54321/capability/',close:async()=>{calls.proxyClosed++;}};},backendFactory:async()=>{calls.backend++;return backend;},clipboard:async text=>({copied:text==='copy me'})});
  const client=new Client({name:'dbx-server-test',version:'1.0.0'}),[clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  await app.server.connect(serverTransport);await client.connect(clientTransport);
  t.after(async()=>{await app.close();await client.close();await rm(home,{recursive:true,force:true});});
  return {app,client,runtime,status,calls,official,forwarded};
}
async function jobFinished(app){for(let index=0;index<200;index++){const view=await app.view();if(view.job?.phase!=='running')return view;await delay(5);}throw Error('asynchronous Docker job did not settle');}

// Do not block progress polling on a second Docker inspect while the same runtime is busy.
test('sidebar starts forbid downloads and expose live progress without another Docker status call',async t=>{
  const gate=deferred();let options;
  const f=await fixture(t,{runtime:{ensure:value=>{options=value;value?.onProgress?.({stage:'compatibility',message:'正在检查官方界面'});return gate.promise;},status:async()=>{throw Error('status must not run during the active job');}}});
  try {
    await f.client.callTool({name:'dbx_codex_start',arguments:{}});
    assert.equal(options.allowDownload,false);
    const view=await f.app.view();assert.equal(view.job.phase,'running');assert.equal(view.job.progress.stage,'compatibility');
    assert.equal(view.job.progress.message,'正在检查官方界面');
  }finally{gate.resolve({phase:'ready',currentVersion:'0.6.52'});}
});

test('official MCP declarations, approval denial and all request arguments pass through without policy changes',async t=>{
  const f=await fixture(t);
  const initial=await f.client.listTools();assert.ok(!initial.tools.some(tool=>tool.name==='dbx_query'));
  const params={name:'dbx_query',arguments:{sql:'DELETE FROM test WHERE id = 1',approvalToken:'explicit-user-token'},_meta:{progressToken:'query-progress'}};
  const result=await f.client.callTool(params);
  assert.deepEqual(f.forwarded,[params]);
  assert.deepEqual(result,{isError:true,content:[{type:'text',text:'Official approval required'}],structuredContent:{code:'DBX_POLICY_DENIED',approval:{required:true}},_meta:{policyRevision:'r42'}});
  const listed=await f.client.listTools();assert.deepEqual(listed.tools.find(tool=>tool.name==='dbx_query'),f.official);
  assert.equal(listed.tools.filter(tool=>tool.name==='dbx_codex_update').length,1);
  assert.deepEqual(listed.tools.find(tool=>tool.name==='dbx_codex_update')._meta.ui.visibility,['app']);
  assert.equal(f.calls.backend,1);
});

test('opening and rendering the sidebar do not eagerly start or update Docker or connect database tools',async t=>{
  const f=await fixture(t);
  const result=await f.client.callTool({name:'dbx_codex_open',arguments:{}});
  assert.deepEqual(result.structuredContent,{name:'DBX',architecture:'official-docker-web'});
  const page=(await f.client.readResource({uri:UI_URI})).contents[0];
  assert.deepEqual(page._meta.ui.csp.frameDomains,['http://127.0.0.1:54321']);
  assert.equal(f.calls.backend,0);assert.equal(f.calls.ensure,0);assert.equal(f.calls.update,0);
  const invalid=await f.client.callTool({name:'dbx_codex_update',arguments:{unrecognized:true}});
  assert.equal(invalid.isError,true);assert.equal(f.calls.update,0);
});

test('start returns a pending job promptly and repeated starts or updates share the same in-flight operation',async t=>{
  const gate=deferred();let executions=0;
  const f=await fixture(t,{runtime:{ensure:()=>{executions++;return gate.promise;}}});
  const started=(await f.client.callTool({name:'dbx_codex_start',arguments:{}})).structuredContent.job;
  assert.equal(started.phase,'running');assert.equal(started.kind,'ensure');
  const duplicate=(await f.client.callTool({name:'dbx_codex_update',arguments:{}})).structuredContent.job;
  assert.equal(duplicate.startedAt,started.startedAt);assert.equal(duplicate.kind,'ensure');
  assert.equal(executions,1);assert.equal(f.calls.update,0);
  gate.resolve({phase:'ready',currentVersion:'0.6.52'});
  const finished=await jobFinished(f.app);assert.equal(finished.job.phase,'complete');assert.equal(finished.job.result.currentVersion,'0.6.52');
});

test('asynchronous start rejection remains visible and update can be retried afterwards',async t=>{
  let first=true;
  const f=await fixture(t,{runtime:{ensure:async()=>{throw Error('Docker unavailable');},update:async()=>{if(first){first=false;throw Error('Registry temporarily unavailable');}return {phase:'ready',currentVersion:'0.6.53'};}}});
  await f.client.callTool({name:'dbx_codex_start',arguments:{}});
  let value=await jobFinished(f.app);assert.equal(value.job.phase,'failed');assert.equal(value.job.error,'Docker unavailable');
  await f.client.callTool({name:'dbx_codex_update',arguments:{}});
  value=await jobFinished(f.app);assert.equal(value.job.phase,'failed');assert.equal(value.job.error,'Registry temporarily unavailable');
  await f.client.callTool({name:'dbx_codex_update',arguments:{}});
  value=await jobFinished(f.app);assert.equal(value.job.phase,'complete');assert.equal(value.job.result.currentVersion,'0.6.53');
});

test('checking official stable metadata never starts or replaces the service and survives fetch errors',async t=>{
  const f=await fixture(t);
  const result=await f.client.callTool({name:'dbx_codex_check_update',arguments:{}});
  assert.deepEqual(result.structuredContent.latest,{version:'0.6.53'});
  assert.equal(f.calls.latest,1);assert.equal(f.calls.ensure,0);assert.equal(f.calls.update,0);
  f.runtime.latest=async()=>{throw Error('GitHub unavailable');};
  const failed=await f.client.callTool({name:'dbx_codex_check_update',arguments:{}});
  assert.equal(failed.isError,true);assert.match(failed.content[0].text,/GitHub unavailable/);
});

test('an official database error is not replaced by a success-shaped adapter response',async t=>{
  const f=await fixture(t,{backend:{callTool:async()=>({isError:true,content:[{type:'text',text:'Read-only database'}],structuredContent:{code:'READ_ONLY'}})}});
  const result=await f.client.callTool({name:'dbx_query',arguments:{sql:'UPDATE t SET a=1'}});
  assert.equal(result.isError,true);assert.equal(result.structuredContent.code,'READ_ONLY');
  const unknown=await f.client.callTool({name:'not_an_official_tool',arguments:{}});
  assert.equal(unknown.isError,true);assert.equal(unknown.structuredContent.code,'DBX_OPERATION_FAILED');
});


test('a stale backend connection cannot publish tools or serve database calls during an update',async t=>{
  const listing=deferred(),updating=deferred();
  const f=await fixture(t,{runtime:{update:()=>updating.promise},backend:{listTools:()=>listing.promise}});
  // Status starts an official MCP connection whose listTools is still pending.
  await f.client.callTool({name:'dbx_codex_status',arguments:{}});
  assert.equal(f.calls.backend,1);
  await f.client.callTool({name:'dbx_codex_update',arguments:{}});
  listing.resolve({tools:[f.official]});
  for(let index=0;index<50&&f.calls.closed===0;index++)await delay(1);
  const view=await f.app.view();
  assert.equal(view.job.phase,'running');assert.equal(view.mcpReady,false);
  assert.equal(f.calls.closed,1,'stale official MCP client must close');
  assert.ok(!(await f.client.listTools()).tools.some(tool=>tool.name==='dbx_query'));
  const blocked=await f.client.callTool({name:'dbx_query',arguments:{sql:'SELECT 1'}});
  assert.equal(blocked.isError,true);assert.match(blocked.content[0].text,/正在启动或更新/);
  assert.deepEqual(f.forwarded,[]);
  updating.resolve({phase:'ready',currentVersion:'0.6.53'});
  await jobFinished(f.app);
});

test('a runtime-reported update failure remains failed even when rollback restores the old service',async t=>{
  const failure={phase:'error',rolledBack:true,servicePhase:'ready',currentVersion:'0.6.52',message:'更新失败，已恢复原版本与升级前的数据和密钥。'};
  const f=await fixture(t,{runtime:{update:async()=>failure}});
  await f.client.callTool({name:'dbx_codex_update',arguments:{}});
  const value=await jobFinished(f.app);
  assert.equal(value.job.phase,'failed');assert.deepEqual(value.job.result,failure);
  assert.equal(value.job.error,failure.message);
  assert.equal(value.mcpReady,false);
});

test('normal shutdown waits for an in-flight Docker operation to settle and closes only once',async t=>{
  const gate=deferred();const f=await fixture(t,{runtime:{update:()=>gate.promise}});
  await f.client.callTool({name:'dbx_codex_update',arguments:{}});
  const closing=f.app.close();await delay(5);assert.equal(f.calls.proxyClosed,0);
  gate.resolve({phase:'ready',currentVersion:'0.6.53'});await closing;await f.app.close();
  assert.equal(f.calls.proxyClosed,1);assert.equal(f.calls.backend,0);
});

test('an incompatible first install cannot become usable just because its HTTP API is healthy',async t=>{
  const failure={phase:'error',code:'WEB_COMPATIBILITY',message:'官方工作台未通过嵌入兼容检查'};
  const f=await fixture(t,{runtime:{ensure:async()=>failure}});
  await f.client.callTool({name:'dbx_codex_start',arguments:{}});
  const value=await jobFinished(f.app);assert.equal(value.phase,'error');assert.equal(value.message,failure.message);
  const status=await f.client.callTool({name:'dbx_codex_status',arguments:{}});assert.equal(status.structuredContent.mcpReady,false);
  const blocked=await f.client.callTool({name:'dbx_query',arguments:{sql:'SELECT 1'}});assert.equal(blocked.isError,true);assert.equal(f.calls.backend,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('plugin starts over stdio, exposes app and document tools, returns real persisted revisions', async t=>{
  const dir=await mkdtemp(join(tmpdir(),'api-mcp-'));
  const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-sqlite','src/server.mjs'],env:{PATH:process.env.PATH,HOME:process.env.HOME,CODEX_API_CLIENT_DATA_DIR:dir},stderr:'pipe'});
  const client=new Client({name:'acceptance',version:'1.0.0'});
  t.after(async()=>{await client.close();await rm(dir,{recursive:true,force:true});});
  await client.connect(transport);
  const tools=await client.listTools();
  assert.ok(tools.tools.some(t=>t.name==='api_client_open'&&t._meta.ui.resourceUri));
  assert.ok(tools.tools.some(t=>t.name==='api_run_start'));
  const created=await client.callTool({name:'api_document_put',arguments:{kind:'environment',id:'dev',revision:0,data:{name:'Dev',values:[{key:'baseUrl',value:'http://localhost'}]}}});
  assert.equal(created.isError,undefined);
  assert.equal(created.structuredContent.revision,1);
  const conflict=await client.callTool({name:'api_document_put',arguments:{kind:'environment',id:'dev',revision:0,data:{name:'Stale',values:[]}}});
  assert.equal(conflict.isError,true);
  assert.match(conflict.content[0].text,/CONFLICT/);
  const result=await client.callTool({name:'api_client_open',arguments:{}});
  assert.equal(result.structuredContent.environments[0].data.name,'Dev');
});

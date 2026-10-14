import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {URI} from '../servers/server.mjs';
const dir=await mkdtemp(join(tmpdir(),'local-review-smoke-'));
const client=new Client({name:'test',version:'1.0.0'});
try{await client.connect(new StdioClientTransport({command:process.execPath,args:['--experimental-sqlite','servers/server.mjs'],env:{...process.env,LOCAL_REVIEW_HOME:dir},stderr:'pipe'}));const {tools}=await client.listTools();assert.equal(tools.length,5);const open=tools.find(t=>t.name==='review_open');assert.equal(open._meta.ui.resourceUri,URI);assert.ok(open.icons[0].src.startsWith('data:image/svg+xml'));const resource=await client.readResource({uri:URI});assert.match(resource.contents[0].text,/创建审查快照/);assert.ok(!resource.contents[0].text.includes('<!-- SCRIPT -->'));const result=await client.callTool({name:'review_open',arguments:{}});assert.deepEqual(result.structuredContent.reviews,[]);console.log('真实 stdio MCP、侧栏入口、内联 UI 通过');}finally{await client.close();await rm(dir,{recursive:true,force:true});}

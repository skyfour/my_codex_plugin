import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createPanelServer,BOARD_URI} from '../servers/server.mjs';
import {BoardStore} from '../src/store.mjs';
import {source} from './fixtures.mjs';

test('MCP exposes sidebar resource, separates board summaries from full details and hides commit from model',async()=>{
 const store=new BoardStore(':memory:');store.applyImport([source()],{runId:'seed'});
 const {server}=createPanelServer({store,credentials:async()=>null});const client=new Client({name:'test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{const listed=await client.listTools();const open=listed.tools.find(t=>t.name==='board_open');assert.deepEqual(open.icons.map(i=>i.theme),[undefined]);assert.ok(open.icons.every(i=>i.mimeType==='image/svg+xml'&&i.src.startsWith('data:image/svg+xml;base64,')));const fallback=Buffer.from(open.icons[0].src.split(',')[1],'base64').toString();
   assert.equal(fallback,readFileSync(new URL('../assets/icon-sidebar.svg',import.meta.url),'utf8'));
   assert.match(fallback,/stroke="currentColor"/);assert.match(fallback,/fill="none"/);
   assert.doesNotMatch(fallback,/#[0-9a-f]{3,8}\b/i,'sidebar must inherit the host color');
   assert.equal(open.title,'任务看板');assert.equal(open.annotations.title,'任务看板');assert.equal(open._meta.ui.resourceUri,BOARD_URI);assert.equal(open._meta['openai/ui'].entrypoints[0].type,'global');
   assert.deepEqual(listed.tools.find(t=>t.name==='import_commit')._meta.ui.visibility,['app']);
   for(const name of ['thread_bind','thread_unbind','thread_create','workflow_update']){const tool=listed.tools.find(t=>t.name===name);assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool.annotations.readOnlyHint,false);}
   const board=await client.callTool({name:'board_open',arguments:{}});assert.equal(board.structuredContent.tasks[0].body,undefined);
   const [first,second,,last]=board.structuredContent.lanes,task=board.structuredContent.tasks[0];
   const denied=await client.callTool({name:'card_move',arguments:{id:task.id,laneId:last.id,version:task.version}});assert.equal(denied.isError,true);assert.equal(denied.structuredContent.code,'TRANSITION_NOT_ALLOWED');
   const edited=await client.callTool({name:'workflow_update',arguments:{fromLaneId:first.id,toLaneIds:[second.id,last.id],version:board.structuredContent.workflow.version}});assert.equal(edited.isError,undefined);assert.equal(edited.structuredContent.tasks[0].body,undefined);
   const moved=await client.callTool({name:'card_move',arguments:{id:task.id,laneId:last.id,version:task.version}});assert.equal(moved.structuredContent.tasks[0].laneId,last.id);
   const detail=await client.callTool({name:'task_get',arguments:{id:board.structuredContent.tasks[0].id}});assert.equal(detail.structuredContent.task.body,'<p>完整原文</p>');
   const resource=await client.readResource({uri:BOARD_URI});assert.ok(resource.contents[0].text.includes('ui/initialize'));assert.ok(resource.contents[0].text.includes('DOMPurify'));assert.ok(!resource.contents[0].text.includes('<!-- APP_'));
 }finally{await client.close();await server.close();store.close();}
});
test('MCP reports missing credentials without exposing any secret',async()=>{
 const store=new BoardStore(':memory:');store.configure({workspaceId:'100',ownerName:'示例',version:1});const {server}=createPanelServer({store,credentials:async()=>null});const client=new Client({name:'test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{const r=await client.callTool({name:'import_preview',arguments:{}});assert.equal(r.isError,true);assert.match(r.content[0].text,/凭据/);}finally{await client.close();await server.close();store.close();}
});

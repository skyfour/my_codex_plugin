import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskContextProvider} from '../src/task-context-provider.mjs';
const taskId='00000000-0000-4000-8000-000000000001';
test('review ACL translates public task DTO and requests context only from provider',async()=>{
 const calls=[];const provider=new TaskContextProvider({request:async(name,args)=>{calls.push({name,args});return name==='task_context_list'?{contractVersion:1,tasks:[{taskId,title:'Test',source:{workspaceId:'100',objectId:'111001'},state:'open',keyword:''}]}:{contractVersion:1,taskId,title:'Test',keyword:'--task=1@tapd-100'};}});
 assert.deepEqual(await provider.listTasks(),{tasks:[{id:taskId,title:'Test',account:'100',sourceId:'111001',state:'open',keyword:''}],notice:''});
 assert.deepEqual(await provider.getCommitContext(taskId),{taskId,keyword:'--task=1@tapd-100'});
 assert.deepEqual(calls,[{name:'task_context_list',args:{}},{name:'task_commit_context',args:{taskId}}]);
});
test('missing or incompatible provider leaves ordinary Git composer available',async()=>{
 for(const result of [{contractVersion:2,tasks:[]},{contractVersion:1,tasks:[{}]}]) {
  const provider=new TaskContextProvider({request:async()=>result});const data=await provider.listTasks();assert.deepEqual(data.tasks,[]);assert.match(data.notice,/不兼容/);
 }
 const data=await new TaskContextProvider({env:{CODEX_HOME:'/nonexistent-task-context-test'}}).listTasks();assert.deepEqual(data.tasks,[]);assert.match(data.notice,/尚未注册/);
});
test('consumer rejects wrong task, blank keyword, control characters and oversize payload',async()=>{
 for(const patch of [{taskId:'00000000-0000-4000-8000-000000000002'},{keyword:''},{keyword:'x\ny'},{keyword:'x'.repeat(2049)},{contractVersion:2}]) {
  const provider=new TaskContextProvider({request:async()=>({contractVersion:1,taskId,title:'Test',keyword:'valid',...patch})});await assert.rejects(provider.getCommitContext(taskId),/上下文/);
 }
});

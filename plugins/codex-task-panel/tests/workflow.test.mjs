import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BoardStore} from '../src/store.mjs';
const source={provider:'tapd',account:'100',resourceType:'tasks',sourceId:'1',sourceUpdatedAt:1000,title:'工作流验证',body:'原文',owner:'nick',sender:'创建人',sourceState:'open',url:'https://www.tapd.cn/100/prong/tasks/view/1'};
const edit=(s,from,to)=>s.updateWorkflow({fromLaneId:from,toLaneIds:to,version:s.workflow().version});
const move=(s,id,laneId)=>s.moveCard({id,laneId,version:s.getTask(id).version});
test('workflow blocks jumps atomically, allows custom reopening and same-lane sorting',()=>{
 const s=new BoardStore(':memory:');try{const [a,b,c,d]=s.snapshot().lanes;s.applyImport([source],{runId:'seed'});const id=s.snapshot().tasks[0].id,before=s.snapshot();
 assert.throws(()=>move(s,id,d.id),/TRANSITION_NOT_ALLOWED/);assert.deepEqual(s.snapshot(),before);
 move(s,id,b.id);assert.throws(()=>move(s,id,a.id),/TRANSITION_NOT_ALLOWED/);
 edit(s,b.id,[a.id,d.id]);move(s,id,d.id);edit(s,d.id,[a.id]);move(s,id,a.id);move(s,id,a.id);
 edit(s,a.id,[]);assert.throws(()=>move(s,id,b.id),/TRANSITION_NOT_ALLOWED/);move(s,id,a.id);
 }finally{s.close();}
});
test('rules validate targets and versions, survive lane rename/reorder, cascade on deletion',()=>{
 const s=new BoardStore(':memory:');try{let [a,b]=s.snapshot().lanes;const before=s.snapshot();
 for(const targets of [[a.id],[b.id,b.id],['missing']])assert.throws(()=>edit(s,a.id,targets),/INVALID_WORKFLOW/);
 assert.deepEqual(s.snapshot(),before);edit(s,a.id,[b.id]);assert.throws(()=>s.updateWorkflow({fromLaneId:a.id,toLaneIds:[],version:before.workflow.version}),/VERSION_CONFLICT/);
 const rules=s.workflow();s.renameLane(a.id,'待排期',a.version);s.reorderLanes(s.snapshot().lanes.reverse());assert.deepEqual(s.workflow(),rules);
 const stale=s.workflow().version;s.createLane('待评审');const added=s.snapshot().lanes.at(-1);assert.ok(!s.workflow().transitions.some(t=>t.fromLaneId===added.id||t.toLaneId===added.id));
 assert.throws(()=>s.updateWorkflow({fromLaneId:a.id,toLaneIds:[],version:stale}),/VERSION_CONFLICT/);
 edit(s,a.id,[added.id]);s.deleteLane(added.id,added.version);assert.ok(!s.workflow().transitions.some(t=>t.fromLaneId===added.id||t.toLaneId===added.id));
 }finally{s.close();}
});
test('schema 2 upgrades without moving tasks or losing links and custom rules persist',()=>{
 const dir=mkdtempSync(join(tmpdir(),'panel-flow-')),path=join(dir,'board.sqlite');let s=new BoardStore(path);try{
 s.applyImport([source],{runId:'seed'});const id=s.snapshot().tasks[0].id,lanes=s.snapshot().lanes;move(s,id,lanes[1].id);s.bindThreads(id,[{id:'chat',title:'关联',cwd:'/tmp'}]);const task=s.getTask(id);
 s.db.exec("DROP TABLE workflow_transitions; DELETE FROM meta WHERE key='workflow_version'; UPDATE meta SET value=2 WHERE key='schema'");s.close();s=new BoardStore(path);
 assert.deepEqual(s.getTask(id),task);assert.equal(s.threads(id).length,1);assert.equal(s.workflow().transitions.length,3);edit(s,lanes[1].id,[lanes[0].id]);const rules=s.workflow();s.close();s=new BoardStore(path);assert.deepEqual(s.workflow(),rules);move(s,id,lanes[0].id);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

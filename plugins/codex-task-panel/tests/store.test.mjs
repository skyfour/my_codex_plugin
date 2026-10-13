import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BoardStore} from '../src/store.mjs';

export const source = (id='1', overrides={}) => ({provider:'tapd', account:'100', resourceType:'tasks', sourceId:id,
  sourceUpdatedAt:1000, title:`任务 ${id}`, body:'<p>完整原文</p>', sender:'创建人',
  url:`https://www.tapd.cn/100/prong/tasks/view/${id}`, sourceState:'open', owner:'nick', ...overrides});

test('imports into first lane and persists custom lanes across restart', () => {
  const dir=mkdtempSync(join(tmpdir(),'task-panel-'));const path=join(dir,'board.sqlite');
  try {let store=new BoardStore(path);const lane=store.snapshot().lanes[0];store.renameLane(lane.id,'待排期',lane.version);
    store.applyImport([source()],{runId:'r1'});store.close();store=new BoardStore(path);
    assert.equal(store.snapshot().lanes[0].name,'待排期');assert.equal(store.snapshot().tasks[0].body,'<p>完整原文</p>');
    assert.equal(store.snapshot().tasks[0].laneId,lane.id);store.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('moves within and across lanes and rejects stale card versions',()=>{
  const s=new BoardStore(':memory:');s.applyImport([source('1'),source('2'),source('3')],{runId:'r1'});
  const snap=s.snapshot(),[a,b,c]=snap.tasks, target=snap.lanes[1];
  s.moveCard({id:c.id,laneId:a.laneId,beforeId:a.id,version:c.version});
  assert.equal(s.snapshot().tasks[0].id,c.id);
  const bv=s.getTask(b.id).version;s.moveCard({id:b.id,laneId:target.id,version:bv});
  assert.equal(s.getTask(b.id).laneId,target.id);
  assert.throws(()=>s.moveCard({id:b.id,laneId:a.laneId,version:bv}),/VERSION_CONFLICT/);s.close();
});
test('source updates preserve local lane and position; older versions never replace content',()=>{
  const s=new BoardStore(':memory:');s.applyImport([source()],{runId:'r1'});const t=s.snapshot().tasks[0];
  for(const lane of s.snapshot().lanes.slice(1,3))s.moveCard({id:t.id,laneId:lane.id,version:s.getTask(t.id).version});const before=s.getTask(t.id);
  s.applyImport([source('1',{sourceUpdatedAt:2000,body:'新全文',sourceState:'done'})],{runId:'r2'});
  const after=s.getTask(t.id);assert.equal(after.laneId,before.laneId);assert.equal(after.position,before.position);assert.equal(after.body,'新全文');
  assert.throws(()=>s.applyImport([source('1',{body:'旧正文'})],{runId:'r3'}),/SOURCE_VERSION_CONFLICT/);s.close();
});
test('rejects occupied-lane deletion, duplicate names and removal of last lane',()=>{
  const s=new BoardStore(':memory:');s.applyImport([source()],{runId:'r1'});const lanes=s.snapshot().lanes;
  assert.throws(()=>s.deleteLane(lanes[0].id,lanes[0].version),/LANE_NOT_EMPTY/);
  assert.throws(()=>s.createLane(lanes[0].name),/LANE_NAME_EXISTS/);
  for(const l of lanes.slice(1))s.deleteLane(l.id,l.version);
  s.moveCard({id:s.snapshot().tasks[0].id,laneId:lanes[0].id,version:s.snapshot().tasks[0].version});
  assert.equal(s.snapshot().lanes.length,1);s.close();
});
test('entire import rolls back when any source conflicts and records no successful run',()=>{
  const s=new BoardStore(':memory:');s.applyImport([source('1')],{runId:'r1'});
  assert.throws(()=>s.applyImport([source('2'),source('1',{body:'same timestamp changed'})],{runId:'r2'}),/SOURCE_VERSION_CONFLICT/);
  assert.equal(s.snapshot().tasks.length,1);assert.equal(s.history().length,1);s.close();
});
test('source configuration changes retain board and reject stale settings revisions',()=>{
  const s=new BoardStore(':memory:');const config=s.config();s.configure({workspaceId:'100',ownerName:'示例用户',version:config.version});
  assert.throws(()=>s.configure({workspaceId:'200',ownerName:'示例用户',version:config.version}),/VERSION_CONFLICT/);s.close();
});

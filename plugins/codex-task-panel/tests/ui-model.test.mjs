import test from 'node:test';
import assert from 'node:assert/strict';
import {canTransition,escapeHtml,sourceLink,filterTasks,selectedCounts} from '../ui/app.mjs';
test('escapes task text and restricts original link to verified TAPD path',()=>{
 assert.equal(escapeHtml('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
 const task={account:'100',sourceId:'1',url:'https://www.tapd.cn/100/prong/tasks/view/1'};assert.equal(sourceLink(task),task.url);
 for(const url of ['javascript:alert(1)','https://evil.example/','https://user@www.tapd.cn/100/prong/tasks/view/1'])assert.equal(sourceLink({...task,url}),'');
});
test('board filters never modify original task order or local status',()=>{
 const tasks=[{title:'修复',sourceId:'1',owner:'nick',account:'100',laneId:'doing'},{title:'文档',sourceId:'2',owner:'other',account:'200',laneId:'todo'}];
 assert.equal(filterTasks(tasks,{search:'修复',account:'100',owner:'nick'}).length,1);assert.equal(tasks[0].laneId,'doing');assert.equal(tasks.length,2);
});
test('selection totals count selected IDs including hidden pages only once',()=>{
 const items=[{sourceId:'1',action:'create'},{sourceId:'2',action:'update'}];
 assert.deepEqual(selectedCounts(['1','2','1'],items),{total:2,created:1,updated:1});
});

test('workflow UI permits only configured directional edges and same-state sorting',()=>{const w={transitions:[{fromLaneId:'a',toLaneId:'c'}]};assert.equal(canTransition(w,'a','c'),true);assert.equal(canTransition(w,'c','a'),false);assert.equal(canTransition(w,'a','b'),false);assert.equal(canTransition(w,'a','a'),true);assert.equal(canTransition(undefined,'a','c'),false);});

import test from 'node:test';import assert from 'node:assert/strict';import {diffLines} from 'diff';import {alignedRows,diffEntries,changeBlocks} from '../ui/diff.mjs';
test('insertions align following lines and preserve real comment line numbers',()=>{const r=alignedRows('a\nb\nc\n','a\nnew\nb\nc\n',diffLines);assert.equal(r[1].old,null);assert.equal(r[1].new,2);assert.equal(r[2].old,2);assert.equal(r[2].new,3);assert.equal(r[2].type,'context');});
test('deletion, replacements, empty file and missing trailing newline',()=>{const r=alignedRows('a\nb\nc\n','a\nx\n',diffLines);assert.equal(r[1].before,'b');assert.equal(r[1].after,'x');assert.equal(r[2].new,null);assert.deepEqual(alignedRows('','',diffLines),[]);assert.equal(alignedRows('x','x\n',diffLines)[0].type,'change');});
test('condensed context can expand without changing anchors',()=>{const before=Array.from({length:100},(_,i)=>String(i)).join('\n'),after=before.replace('\n50\n','\nchanged\n'),rows=alignedRows(before,after,diffLines),view=diffEntries(rows);assert.equal(view.filter(x=>x.fold).length,2);assert.equal(view.find(x=>x.type==='change').new,51);const fold=view[0],expanded=new Set(Array.from({length:fold.end-fold.start},(_,i)=>fold.start+i));assert.ok(diffEntries(rows,{expanded}).length>view.length);assert.equal(diffEntries(rows,{full:true}).length,100);});

test('human-readable locations describe additions, deletions and line ranges without patch markers',()=>{
 for(const [before,after,expected] of [['a\n','a\nb\n','新增 1 · 修改前：无对应行 → 修改后：第 2 行'],['a\nb\n','a\n','删除 1 · 修改前：第 2 行 → 修改后：无对应行'],['a\nb\nc\n','a\nx\ny\n','修改 1 · 修改前：第 2–3 行 → 修改后：第 2–3 行']]){
  const blocks=changeBlocks(alignedRows(before,after,diffLines));assert.equal(blocks.length,1);assert.equal(blocks[0].label,expected);assert.ok(!blocks[0].label.includes('@@'));
 }
 const blocks=changeBlocks(alignedRows('a\nb\nc\nd\ne\n','a\nx\nc\nd\ny\n',diffLines));assert.equal(blocks.length,2);assert.match(blocks[1].label,/修改 2/);assert.deepEqual(changeBlocks(alignedRows('same','same',diffLines)),[]);
});

import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm,realpath,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {snapshot} from '../src/review.mjs';import {stageReviewedFile} from '../src/review-stage.mjs';
async function fixture(t,{mode='working',commit=true}={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'review-stage-')));t.after(()=>rm(root,{recursive:true,force:true}));const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');const write=value=>writeFile(join(root,'file.txt'),value);
 if(commit){await write('original');git('add','.');git('commit','-qm','initial');}await write('reviewed');await writeFile(join(root,'other.txt'),'leave unstaged');const review=await snapshot({project:root,mode,selection:['file.txt']});review.files[0].reviewed=true;const project={path:root,isGit:true};const stage=patch=>stageReviewedFile({project,review,path:'file.txt',version:review.version,...patch});return {root,git,write,project,review,stage};
}
for(const mode of ['working','unstaged'])test(`Stage exact reviewed ${mode} file only; preserve snapshot, unrelated edits and HEAD`,async t=>{
 const f=await fixture(t,{mode}),head=f.git('rev-parse','HEAD'),before=JSON.stringify(f.review);assert.equal(f.git('diff','--cached'),'');await f.stage();assert.equal(f.git('show',':file.txt'),'reviewed');assert.equal(f.git('rev-parse','HEAD'),head);assert.match(f.git('status','--porcelain'),/\?\? other.txt/);assert.equal(JSON.stringify(f.review),before);assert.equal(await readFile(join(f.root,'file.txt'),'utf8'),'reviewed');
});
test('changed contents, stale review decisions, unreviewed files and historical scopes cannot Stage',async t=>{
 const f=await fixture(t);await f.write('changed after review');await assert.rejects(f.stage(),/变化/);assert.equal(f.git('diff','--cached'),'');await f.write('reviewed');await assert.rejects(f.stage({version:99}),/记录已更新/);f.review.files[0].reviewed=false;await assert.rejects(f.stage(),/先审阅/);f.review.files[0].reviewed=true;
 for(const mode of ['commit','commits','staged','files']){f.review.mode=mode;await assert.rejects(f.stage(),/只有工作区/);}assert.equal(f.git('diff','--cached'),'');
});
test('wrong project and changed index comparison base cannot Stage',async t=>{
 const f=await fixture(t,{mode:'unstaged'});await assert.rejects(f.stage({project:{path:join(f.root,'another'),isGit:true}}),/不匹配/);
 await f.write('different index');f.git('add','file.txt');await f.write('reviewed');await assert.rejects(f.stage(),/比较基线已变化/);assert.equal(f.git('show',':file.txt'),'different index');
});
test('reviewed first commit can Stage without creating a commit',async t=>{
 const f=await fixture(t,{commit:false});await f.stage();assert.equal(f.git('show',':file.txt'),'reviewed');assert.throws(()=>f.git('rev-parse','--verify','HEAD'));
});

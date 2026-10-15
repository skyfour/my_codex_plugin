import {createHash} from 'node:crypto';
import {lstat,realpath} from 'node:fs/promises';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {git,indexState} from './git-index.mjs';
import {withGitWrite} from './git-lock.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function patchFor(root,path,mode){
 const state=await indexState(root),record=state.files.find(f=>f.path===path);if(!record)return {hunks:[],notice:'文件改动已变化，请刷新'};
 const parent=await realpath(dirname(join(state.root,path))),rel=relative(state.root,parent);if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw Error('文件目录已移出当前仓库');
 if(record.unmerged||record.submodule)return {hunks:[],notice:'冲突或子模块暂不支持局部操作'};
 try{const s=await lstat(join(state.root,path));if(s.isSymbolicLink()||!s.isFile())return {hunks:[],notice:'此类型请使用文件级操作'};}catch(e){if(e.code!=='ENOENT')throw e;}
 if(mode==='working'){if(record.canStage&&record.canUnstage)return {hunks:[],notice:'此文件部分暂存，请切换到未暂存或已暂存范围进行改动块操作'};mode=record.canStage?'unstaged':'staged';}
 if(!['staged','unstaged'].includes(mode))throw Error('当前范围不支持改动块操作');
 let patch='';
 if(record.status==='??'){
  if(mode==='staged')return {hunks:[],notice:''};
  try{patch=await git(state.root,['diff','--no-index','--no-ext-diff','--no-textconv','--no-renames','--unified=3','--','/dev/null',path]);}catch(e){if(e.code===1&&e.stdout)patch=e.stdout;else throw e;}
 }else patch=await git(state.root,['diff',...(mode==='staged'?['--cached']:[]),'--no-ext-diff','--no-textconv','--no-renames','--unified=3','--',path]);
 const lines=patch.match(/[^\n]*\n|[^\n]+$/g)??[],starts=[];for(let i=0;i<lines.length;i++)if(/^@@ -\d/.test(lines[i]))starts.push(i);
 const header=lines.slice(0,starts[0]??lines.length).join(''),hunks=starts.map((start,i)=>{const text=lines.slice(start,starts[i+1]??lines.length).join(''),match=text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);if(!match)throw Error('Git 改动块格式无效');return {id:hash(text),oldStart:Number(match[1]),oldCount:Number(match[2]??1),newStart:Number(match[3]),newCount:Number(match[4]??1),patch:header+text};});
 return {hunks,mode,token:hash([state.head,record.fingerprint,patch,mode]),notice:hunks.length?'':'空文件、二进制或仅属性变更请使用文件级操作'};
}
export async function fileHunks(root,args){const result=await patchFor(root,args.path,args.mode);return {...result,hunks:result.hunks.map(({patch,...h})=>h)};}
export async function applyHunk(root,{path,mode,operation,token,hunkId}){return withGitWrite(root,async()=>{
 const current=await patchFor(root,path,mode);if(current.token!==token)throw Error('文件或暂存区在查看后发生变化，请刷新');const hunk=current.hunks.find(h=>h.id===hunkId);if(!hunk)throw Error('改动块已变化，请刷新');
 if(!((current.mode==='unstaged'&&['stage','discard'].includes(operation))||(current.mode==='staged'&&operation==='unstage')))throw Error('当前范围不支持此改动块操作');
 const flags=operation==='stage'?['--cached']:operation==='unstage'?['--cached','--reverse']:['--reverse'];
 try{await git(root,['apply','--check',...flags,'--whitespace=nowarn','-'],{input:hunk.patch});await git(root,['apply',...flags,'--whitespace=nowarn','-'],{input:hunk.patch});}catch{throw Error('补丁未确认应用，请刷新核对文件与暂存区后重试');}
 return {operation,path};
});}

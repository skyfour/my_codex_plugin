import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),conflicts=new Set(['DD','AU','UD','UA','DU','AA','UU']);
function environment(){const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];return {...env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};}
export async function git(root,args){return (await exec('git',['--literal-pathspecs','-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000,env:environment()})).stdout;}
function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function checkPath(root,path){const rel=relative(root,resolve(root,path));if(!path||isAbsolute(path)||rel!==path||rel==='..'||rel.startsWith('../')||path.includes('\0')||path.split('/').some(p=>p.toLowerCase()==='.git'))throw Error('只能操作当前仓库中的具体文件');}
export async function indexState(root){
 root=await realpath(root);const top=await realpath((await git(root,['rev-parse','--show-toplevel'])).trim());if(root!==top)throw Error('请重新打开仓库根目录');
 const head=(await git(root,['rev-parse','--verify','HEAD']).catch(()=>'' )).trim();
 const raw=await git(root,['status','--porcelain=v1','-z','--no-renames','--untracked-files=all']);
 const indexRaw=await git(root,['ls-files','--stage','-z']);const index=new Map();
 for(const record of indexRaw.split('\0').filter(Boolean)){const tab=record.indexOf('\t'),path=record.slice(tab+1);index.set(path,(index.get(path)??[]).concat(record.slice(0,tab)));}
 const files=[];
 for(const entry of raw.split('\0').filter(Boolean)){
  const path=entry.slice(3),status=entry.slice(0,2);checkPath(root,path);let info=null;
  try{const s=await lstat(resolve(root,path),{bigint:true});info=[s.mode,s.size,s.ino,s.mtimeNs,s.ctimeNs].map(String);}catch(e){if(e.code!=='ENOENT')throw e;}
  const unmerged=conflicts.has(status),submodule=(index.get(path)??[]).some(s=>s.startsWith('160000 '));
  files.push({path,status,canStage:!unmerged&&!submodule&&(status==='??'||status[1]!==' '&&status[1]!=='?'),canUnstage:!unmerged&&!submodule&&status!=='??'&&status[0]!==' ',fingerprint:hash([head,status,index.get(path)??[],info]),unmerged,submodule});
 }
 return {root,head,files};
}
export async function changeIndex(root,{operation,files}){
 if(!['stage','unstage'].includes(operation)||!Array.isArray(files)||!files.length||files.length>300)throw Error('请选择 1–300 个文件');
 const state=await indexState(root),available=new Map(state.files.map(f=>[f.path,f])),seen=new Set();
 for(const item of files){checkPath(state.root,item.path);if(seen.has(item.path))throw Error('不能重复选择同一个文件');seen.add(item.path);const current=available.get(item.path);
  if(!current||current.fingerprint!==item.fingerprint)throw Error('文件或暂存状态在查看后发生变化，请刷新后重试');
  if(current.unmerged)throw Error('文件存在未解决的合并冲突，请先解决冲突');if(current.submodule)throw Error('暂不支持子模块的 Stage / Unstage');
  if(!(operation==='stage'?current.canStage:current.canUnstage))throw Error(operation==='stage'?'所选文件没有可暂存的改动':'所选文件没有已暂存的改动');
  // Git records a final symlink itself; parent symlinks may not escape the repository.
  try{const parent=await realpath(dirname(resolve(state.root,item.path)));const rel=relative(state.root,parent);if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw Error('文件目录已移出当前仓库');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const paths=files.map(f=>f.path);
 const args=operation==='stage'?['add','--all','--',...paths]:state.head?['restore','--staged',`--source=${state.head}`,'--',...paths]:['rm','--cached','--force','--ignore-unmatch','--',...paths];
 try{await git(state.root,args);}catch(e){const message=String(e.stderr??e.message);if(message.includes('index.lock'))throw Error('Git 暂存区正被其他操作占用，请稍后重试');throw Error(`Git ${operation==='stage'?'暂存':'取消暂存'}失败：${message.trim().slice(0,500)}`);}
 return {operation,count:paths.length};
}

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,realpath,stat,mkdir,chmod} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const exec=promisify(execFile),LIMIT=1024*1024;
async function git(root,args){return (await exec('git',['-c','core.fsmonitor=false','-c','diff.external=','-C',root,...args],{encoding:'utf8',maxBuffer:12*LIMIT,timeout:15000,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}})).stdout;}
function bounded(root,path){const full=resolve(root,path),rel=relative(root,full);if(isAbsolute(rel)||rel==='..'||rel.startsWith('../'))throw Error('文件必须位于项目目录内');return full;}
async function disk(root,path,allowMissing=false){const full=bounded(root,path);let actual;try{actual=await realpath(full);}catch(e){if(e.code==='ENOENT'&&allowMissing)return '';throw e;}bounded(root,actual);const s=await stat(actual);if(!s.isFile())throw Error(`不是普通文件：${path}`);if(s.size>LIMIT)throw Error(`文件超过 1 MiB：${path}`);return readFile(actual,'utf8');}
async function revision(root,ref){if(!ref||ref.startsWith('-'))throw Error('请输入有效的本地提交或分支');return (await git(root,['rev-parse','--verify','--end-of-options',`${ref}^{commit}`])).trim();}
async function indexBlob(root,path){const entries=(await git(root,['ls-files','--stage','-z','--',path])).split('\0').filter(Boolean).map(s=>{const i=s.indexOf('\t');return {header:s.slice(0,i).split(' '),path:s.slice(i+1)};}).filter(e=>e.path===path);if(!entries.length)return '';const entry=entries.find(e=>e.header[2]==='0');if(!entry)throw Error(`文件有未解决的合并冲突，请先解决或使用指定文件模式：${path}`);if(entry.header[0]==='160000')throw Error(`暂不支持子模块差异：${path}`);return git(root,['show',`:${path}`]);}
async function blob(root,ref,path){const exists=await git(root,['ls-tree','-z',ref,'--',path]);if(!exists)return '';return git(root,['show',`${ref}:${path}`]);}
export async function snapshot({project,mode='working',base='HEAD',target='HEAD',paths=[]}){
 const root=await realpath(resolve(project));if(!(await stat(root)).isDirectory())throw Error('项目路径不是目录');
 let files=[],beforeRef=null,afterRef=null;
 if(mode==='files'){if(!paths.length)throw Error('请填写至少一个相对文件路径');files=[...new Set(paths)];}
 else{
  const top=(await git(root,['rev-parse','--show-toplevel'])).trim();if(await realpath(top)!==root)throw Error('请填写 Git 仓库根目录');
  if(mode==='commits'){beforeRef=await revision(root,base);afterRef=await revision(root,target);files=(await git(root,['diff','--no-ext-diff','--no-textconv','--no-renames','--name-only','-z',beforeRef,afterRef,'--'])).split('\0').filter(Boolean);}
  else{
   try{beforeRef=await revision(root,'HEAD');}catch{if((await git(root,['rev-list','--all','--count'])).trim()!=='0')throw Error('无法读取 HEAD');}
   const args=['diff','--no-ext-diff','--no-textconv','--no-renames','--name-only','-z'];
   if(mode==='staged')args.push('--cached');else if(mode!=='unstaged'&&mode!=='working')throw Error('不支持的审查范围');
   if(mode==='working'&&beforeRef)args.push(beforeRef);
   args.push('--');files=(await git(root,args)).split('\0').filter(Boolean);
   if(mode==='working'){if(!beforeRef)files.push(...(await git(root,['ls-files','-z'])).split('\0').filter(Boolean));files.push(...(await git(root,['ls-files','--others','--exclude-standard','-z'])).split('\0').filter(Boolean));}
   if(mode==='unstaged')beforeRef=':';
  }
 }
 files=[...new Set(files)];if(files.length>300)throw Error('超过 300 个文件，请缩小范围');
 const result=[];let size=0;
 for(const path of files){bounded(root,path);let before='';
  if(mode==='unstaged')before=await indexBlob(root,path);
  else if(beforeRef)before=await blob(root,beforeRef,path);
  let after;if(afterRef)after=await blob(root,afterRef,path);else if(mode==='staged')after=await indexBlob(root,path);else after=await disk(root,path,mode!=='files');
  if(Buffer.byteLength(before)>LIMIT||Buffer.byteLength(after)>LIMIT)throw Error(`文件超过 1 MiB：${path}`);
  size+=Buffer.byteLength(before)+Buffer.byteLength(after);if(size>10*LIMIT)throw Error('快照超过 10 MiB，请缩小范围');
  result.push({path,before,after,binary:before.includes('\0')||after.includes('\0'),reviewed:false});
 }
 return {id:randomUUID(),project:root,mode,base:beforeRef,target:afterRef,createdAt:new Date().toISOString(),version:1,files:result,comments:[]};
}
export class ReviewStore{
 static async open(dir){await mkdir(dir,{recursive:true,mode:0o700});const file=join(dir,'reviews.sqlite');const store=new ReviewStore(file);await chmod(file,0o600);return store;}
 constructor(file){this.db=new DatabaseSync(file);this.db.exec('CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL)');}
 close(){this.db.close();}
 list(){return this.db.prepare('SELECT data FROM reviews ORDER BY rowid DESC LIMIT 100').all().map(x=>{const r=JSON.parse(x.data);return {id:r.id,project:r.project,mode:r.mode,createdAt:r.createdAt,count:r.files.length,reviewed:r.files.filter(f=>f.reviewed).length};});}
 get(id){const row=this.db.prepare('SELECT data FROM reviews WHERE id=?').get(id);if(!row)throw Error('审查记录不存在');return JSON.parse(row.data);}
 add(r){this.db.prepare('INSERT INTO reviews VALUES (?,?)').run(r.id,JSON.stringify(r));return r;}
 update({id,version,path,reviewed,comment,deleteComment}){const r=this.get(id),old=JSON.stringify(r);if(r.version!==version)throw Error('记录已更新，请重新打开后再保存');const f=r.files.find(f=>f.path===path);if(!f)throw Error('文件不存在');if(reviewed!==undefined)f.reviewed=reviewed;
 if(comment){const text=comment.text?.trim();if(!text||text.length>10000)throw Error('评论需为 1–10000 个字符');if(!['before','after'].includes(comment.side))throw Error('评论位置无效');const lines=f[comment.side].split('\n').length;if(!Number.isInteger(comment.line)||comment.line<1||comment.line>lines||f.binary)throw Error('评论行号无效');if(!['note','issue','blocking'].includes(comment.severity))throw Error('评论类型无效');r.comments.push({...comment,text,id:randomUUID(),path});}
 if(deleteComment){if(!r.comments.some(c=>c.id===deleteComment&&c.path===path))throw Error('评论不存在');r.comments=r.comments.filter(c=>c.id!==deleteComment);}
 r.version++;const changed=this.db.prepare('UPDATE reviews SET data=? WHERE id=? AND data=?').run(JSON.stringify(r),id,old);if(changed.changes!==1)throw Error('记录已更新，请重试');return r;
 }
}
export function markdown(r){return [`# 本地代码审查`, `项目：${r.project}`,`创建：${r.createdAt}`,`范围：${r.mode}；基线：${r.base??'无'}；目标：${r.target??'本地快照'}`,...r.files.flatMap(f=>[`\n## ${f.path}`,`状态：${f.reviewed?'已审阅':'未审阅'}`,...r.comments.filter(c=>c.path===f.path).map(c=>`\n- [${c.severity}] ${c.side==='before'?'旧代码':'新代码'}第 ${c.line} 行\n\n${c.text}`)])].join('\n\n');}

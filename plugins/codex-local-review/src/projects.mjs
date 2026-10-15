import {readdir,realpath,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function gitRead(root,args){return (await exec('git',['-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:15000,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}})).stdout;}
export async function normalizeProject(input){
 if(!input?.trim())throw Error('请选择项目文件夹');
 const expanded=input==='~'?homedir():input.startsWith('~/')?join(homedir(),input.slice(2)):input;
 let path;try{path=await realpath(resolve(expanded));if(!(await stat(path)).isDirectory())throw Error('目录无效');}catch{throw Error('文件夹不存在或无法访问，请重新选择');}
 let isGit=false;
 try{path=await realpath((await gitRead(path,['rev-parse','--show-toplevel'])).trim());isGit=true;}catch{/* Ordinary folders are supported without Git. */}
 return {path,name:basename(path)||path,isGit};
}
export class Projects{
 constructor(store){this.db=store.db;this.store=store;this.db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  if(!this.preference('projectsMigrated')){for(const r of store.list().reverse()){const old=this.byPath(r.project);const project=old??{id:randomUUID(),path:r.project,name:basename(r.project),pinned:false,openedAt:r.createdAt,state:{}};project.state={...project.state,lastReview:r.id};this.put(project);}this.preference('projectsMigrated',true);}
 }
 preference(key,value){if(value===undefined){const row=this.db.prepare('SELECT value FROM preferences WHERE key=?').get(key);return row?JSON.parse(row.value):null;}this.db.prepare('INSERT INTO preferences VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
 put(p){this.db.prepare('INSERT INTO projects VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,data=excluded.data').run(p.id,p.path,JSON.stringify(p));return p;}
 byPath(path){const row=this.db.prepare('SELECT data FROM projects WHERE path=?').get(path);return row?JSON.parse(row.data):null;}
 get(id){const row=this.db.prepare('SELECT data FROM projects WHERE id=?').get(id);if(!row)throw Error('项目不存在，请重新打开文件夹');return JSON.parse(row.data);}
 list(){return this.db.prepare('SELECT data FROM projects').all().map(r=>JSON.parse(r.data)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.openedAt.localeCompare(a.openedAt));}
 async open(path){const normalized=await normalizeProject(path),old=this.byPath(normalized.path);const p=this.put({...old,...normalized,id:old?.id??randomUUID(),pinned:old?.pinned??false,opened:true,state:old?.state??{},openedAt:new Date().toISOString()});this.preference('activeProject',p.id);return p;}
 update(id,patch){const p=this.get(id);if(patch.pinned!==undefined)p.pinned=patch.pinned;if(patch.state)p.state={...p.state,...patch.state};return this.put(p);}
 forget(id){this.get(id);this.db.prepare('DELETE FROM projects WHERE id=?').run(id);if(this.preference('activeProject')===id)this.preference('activeProject',null);}
 closeProject(id){const p=this.get(id);this.put({...p,opened:false});if(this.preference('activeProject')===id)this.preference('activeProject',this.list().find(p=>p.opened!==false)?.id??null);}
 async inspect(p){
  if(!p.isGit)return {branch:'文件夹',branches:[],commits:[]};
  const branch=(await gitRead(p.path,['symbolic-ref','--short','-q','HEAD']).catch(()=> '分离 HEAD')).trim();
  const branches=(await gitRead(p.path,['for-each-ref','--format=%(refname:short)%00%(objectname)','refs/heads','refs/remotes'])).trim().split('\n').filter(Boolean).slice(0,200).map(s=>{const [name,sha]=s.split('\0');return {name,sha};});
  // No HEAD yet is a valid repository; other log errors remain visible.
  let commits=[];const heads=await gitRead(p.path,['rev-list','--all','--count']);
  if(heads.trim()!=='0'){const values=(await gitRead(p.path,['log','--all','-100','-z','--date=iso-strict','--format=%H%x00%P%x00%an%x00%aI%x00%s'])).split('\0');for(let i=0;i+4<values.length;i+=5){commits.push({sha:values[i],parents:values[i+1].split(' ').filter(Boolean),author:values[i+2],date:values[i+3],title:values[i+4]});}}
  return {branch,branches,commits};
 }
}
export async function browseFolders(path=homedir()){
 const expanded=path==='~'?homedir():path.startsWith('~/')?join(homedir(),path.slice(2)):path;const root=await realpath(resolve(expanded));if(!(await stat(root)).isDirectory())throw Error('请选择文件夹');
 const entries=await readdir(root,{withFileTypes:true});const folders=entries.filter(e=>e.isDirectory()&&!e.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name));
 return {path:root,parent:dirname(root)===root?null:dirname(root),folders:folders.slice(0,500).map(e=>({name:e.name,path:join(root,e.name)})),truncated:folders.length>500};
}
export async function discoverProjects(path){
 const root=await realpath(path),found=[];let visited=0,truncated=false;
 async function walk(dir,depth){if(++visited>1200||found.length>=100){truncated=true;return;}try{await stat(join(dir,'.git'));found.push(await normalizeProject(dir));return;}catch{}
 if(depth===3)return;let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}for(const e of entries){if(e.isDirectory()&&!e.name.startsWith('.')&&!['node_modules','vendor','dist','build','Library'].includes(e.name))await walk(join(dir,e.name),depth+1);if(truncated)break;}}
 await walk(root,0);return {projects:found,truncated};
}
export const PICKER_SCRIPT=`ObjC.import('Cocoa');
const app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
app.activateIgnoringOtherApps(true);
const panel = $.NSOpenPanel.openPanel;
panel.title = '打开本地项目';
panel.message = '选择一个或多个项目文件夹';
panel.canChooseFiles = false;
panel.canChooseDirectories = true;
panel.allowsMultipleSelection = true;
panel.prompt = '打开项目';
if (panel.runModal === $.NSModalResponseOK) {
 const urls = panel.URLs; const paths = [];
 for (let i = 0; i < urls.count; i++) paths.push(ObjC.unwrap(urls.objectAtIndex(i).path));
 JSON.stringify(paths);
} else { '[]'; }`;
let picking=false;
export async function pickFolders(){
 if(process.platform!=='darwin')throw Error('当前系统请使用“浏览文件夹”打开项目');
 if(picking)throw Error('文件夹选择窗口已打开，请完成选择');picking=true;
 try{const {stdout}=await exec('/usr/bin/osascript',['-l','JavaScript','-e',PICKER_SCRIPT],{timeout:180000,maxBuffer:65536});const paths=JSON.parse(stdout.trim()||'[]');if(!Array.isArray(paths)||!paths.every(p=>typeof p==='string'))throw Error();return paths;}catch{throw Error('系统文件夹窗口未完成，请使用“浏览文件夹”继续');}finally{picking=false;}
}
export async function projectFiles(project,subpath=''){
 const root=project.path,dir=await realpath(resolve(root,subpath));if(dir!==root&&!dir.startsWith(root+'/'))throw Error('只能浏览当前项目内的文件');
 const entries=await readdir(dir,{withFileTypes:true});return {directory:dir.slice(root.length+1),entries:entries.filter(e=>!e.name.startsWith('.')&&e.name!=='node_modules').sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name)).slice(0,500).map(e=>({name:e.name,path:join(dir,e.name).slice(root.length+1),directory:e.isDirectory(),symlink:e.isSymbolicLink()})),truncated:entries.length>500};
}

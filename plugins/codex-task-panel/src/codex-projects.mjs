import {readFile,stat,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,isAbsolute,resolve} from 'node:path';
import {withCodex} from './codex-client.mjs';

const validPath=p=>typeof p==='string'&&isAbsolute(p)&&p.length<=4096&&!/[\x00-\x1f]/.test(p);
const rootsOf=p=>Array.isArray(p)&&p.every(validPath)?[...new Set(p)]:[];
const sameRoots=(a,b)=>a.length===b.length&&a.every((p,i)=>p===b[i]);

// Desktop state supplies visible projects/order; app-server supplies their native IDs.
// Read only these project fields. Never edit desktop state or infer projects from chats.
export class CodexProjects {
 constructor({codeHome=process.env.CODEX_HOME??join(homedir(),'.codex'),connect=fn=>withCodex(fn,{experimentalApi:true})}={}){this.codeHome=codeHome;this.connect=connect;}
 async list(){
  try{
   const native=await this.connect(async call=>{
    const items=[],seen=new Set();let cursor;
    for(let page=0;page<50;page++){
     const result=await call('project/list',{limit:100,sortKey:'position',...(cursor?{cursor}:{})});
     if(!Array.isArray(result.data))throw Error();items.push(...result.data);
     if(!result.nextCursor)return items;
     if(typeof result.nextCursor!=='string'||seen.has(result.nextCursor))throw Error();
     cursor=result.nextCursor;seen.add(cursor);
    }
    throw Error();
   });
   let state=null;
   try{state=JSON.parse(await readFile(join(this.codeHome,'.codex-global-state.json'),'utf8'));}
   catch(e){if(e.code!=='ENOENT')throw e;}
   const byId=new Map(native.filter(p=>p&&typeof p.id==='string'&&Array.isArray(p.roots)).map(p=>[p.id,p]));
   const canonical=await realpath(this.codeHome).catch(()=>resolve(this.codeHome));
   const maps=state?.['app-server-project-id-by-legacy-project-id-by-host'];
   const mapping=maps?.['local:'+this.codeHome]??maps?.['local:'+canonical]??{};
   let rows;
   if(state&&Object.hasOwn(state,'local-projects')){
    const projects=state['local-projects'];if(!projects||typeof projects!=='object'||Array.isArray(projects))throw Error();
    const order=Array.isArray(state['project-order'])?state['project-order']:[];
    rows=[...new Set([...order,...Object.keys(projects)])].filter(id=>Object.hasOwn(projects,id)).map(id=>{
     const p=projects[id],roots=rootsOf(p?.rootPaths);
     const match=byId.get(mapping[id])??[...byId.values()].find(n=>sameRoots(rootsOf(n.roots.map(r=>r.path)),roots));
     return {id,title:String(p?.name||'未命名项目').slice(0,512),roots,nativeId:match?.id??null};
    });
   }else rows=[...byId.values()].map(p=>({id:p.id,title:String(p.name||'未命名项目').slice(0,512),roots:rootsOf(p.roots.map(r=>r.path)),nativeId:p.id}));
   const items=await Promise.all(rows.map(async p=>{
    const pathsValid=p.roots.length>0&&(await Promise.all(p.roots.map(path=>stat(path).then(s=>s.isDirectory(),()=>false)))).every(Boolean);
    return {...p,cwd:p.roots[0]??'',available:Boolean(p.nativeId)&&pathsValid,unavailableReason:!p.nativeId?'项目尚未同步到 Codex，请重新打开 Codex 后刷新。':!pathsValid?'项目目录已不存在或无法访问。':''};
   }));
   const selected=state?.['selected-project'];
   return {items,selectedId:selected?.type==='local'&&items.some(p=>p.id===selected.projectId&&p.available)?selected.projectId:null};
  }catch{throw new Error('PROJECTS_UNAVAILABLE');}
 }
 async resolve(id){const project=(await this.list()).items.find(p=>p.id===id);if(!project?.available)throw new Error('PROJECT_UNAVAILABLE');return project;}
}

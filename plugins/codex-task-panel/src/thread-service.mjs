import {stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {CodexThreads} from './codex-client.mjs';
export class ThreadService {
 constructor(store,provider=new CodexThreads()){this.store=store;this.provider=provider;}
 candidates(args){return this.provider.list(args);}
 async linked(taskId){const rows=this.store.threads(taskId);if(!rows.length)return [];if(this.provider.inspect){try{const current=await this.provider.inspect(rows.map(t=>t.id));return rows.map(row=>({...row,...current.find(t=>t.id===row.id)}));}catch{return rows.map(row=>({...row,available:false}));}}return Promise.all(rows.map(async row=>{try{return {...row,...await this.provider.read(row.id),available:true};}catch{return {...row,available:false};}}));}
 async bind(taskId,ids){this.store.getTask(taskId);const unique=[...new Set(ids)],threads=this.provider.inspect?await this.provider.inspect(unique):await Promise.all(unique.map(id=>this.provider.read(id)));if(threads.some(t=>t.available===false)||threads.some((t,i)=>t.id!==unique[i]))throw new Error('THREAD_UNAVAILABLE');this.store.bindThreads(taskId,threads);return this.store.threads(taskId);}
 async create({taskId,requestId,title,cwd}){
  let prior=this.store.creation(requestId);
  if(prior&&(prior.task_id!==taskId||prior.title!==title||prior.cwd!==cwd))throw new Error('CONFIRMATION_REUSED');
  if(!prior){
   if(!isAbsolute(cwd)||/[\x00-\x1f]/.test(cwd)||!await stat(cwd).then(s=>s.isDirectory(),()=>false))throw new Error('INVALID_CWD');
   this.store.reserveCreation(requestId,taskId,title,cwd);
   try{const thread=await this.provider.create(cwd,t=>this.store.saveCreation(requestId,t),title);this.store.saveCreation(requestId,thread);}catch(e){prior=this.store.creation(requestId);if(!prior.thread){if(e.thread)return {thread:e.thread,bound:false};throw e;}}
   prior=this.store.creation(requestId);
  }
  if(!prior.thread)throw new Error('CREATION_UNKNOWN');
  try{this.store.bindThreads(taskId,[prior.thread]);return {thread:prior.thread,bound:true};}
  catch{return {thread:prior.thread,bound:false};}
 }
}

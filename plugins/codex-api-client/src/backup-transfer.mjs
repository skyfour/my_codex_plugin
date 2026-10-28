import {randomUUID} from 'node:crypto';
import {mkdirSync,rmSync,writeFileSync,appendFileSync,readFileSync,openSync,readSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {BACKUP_LIMIT} from './backup.mjs';
export const CHUNK_LIMIT=1024*1024;
export class BackupTransfer {
 constructor(backup){
  this.backup=backup;this.sessions=new Map();this.directory=join(backup.store.directory,'backup-transfer');
  // Only incomplete transfer files live here; committed attachments and recovery snapshots live elsewhere.
  rmSync(this.directory,{recursive:true,force:true});mkdirSync(this.directory,{recursive:true,mode:0o700});
 }
 remove(id){const s=this.sessions.get(id);if(s){rmSync(s.path,{force:true});if(s.previewId)this.backup.sessions.delete(s.previewId);}this.sessions.delete(id);}
 prune(){for(const [id,s]of this.sessions)if(Date.now()-s.touched>900000)this.remove(id);}
 stage(operation,bytes,extra={}){const transferId=randomUUID(),path=join(this.directory,transferId);writeFileSync(path,bytes,{mode:0o600});this.sessions.set(transferId,{operation,path,size:bytes.length,touched:Date.now(),...extra});return {transferId,size:bytes.length,chunkSize:CHUNK_LIMIT};}
 async start({operation,password,includeHistory=false,mode='merge',context}){
  this.prune();if(this.sessions.size>=8)throw new Error('BACKUP_LIMIT: 同时最多 8 个传输');if(!password)throw new Error('BACKUP_PASSWORD_REQUIRED');
  return this.stage(operation,operation==='export'?await this.backup.export(password,includeHistory,context):Buffer.alloc(0),{password,mode,context});
 }
 chunk({transferId,offset=0,base64}){
  this.prune();const s=this.sessions.get(transferId);if(!s)throw new Error('BACKUP_SESSION_EXPIRED');s.touched=Date.now();
  if(!Number.isSafeInteger(offset)||offset<0||offset>s.size)throw new Error('BACKUP_OFFSET');
  if(s.operation==='export'){
   if(base64!==undefined)throw new Error('BACKUP_OPERATION');const chunk=Buffer.alloc(Math.min(CHUNK_LIMIT,s.size-offset)),fd=openSync(s.path,'r');try{readSync(fd,chunk,0,chunk.length,offset);}finally{closeSync(fd);}
   return {offset,base64:chunk.toString('base64'),nextOffset:offset+chunk.length,done:offset+chunk.length===s.size};
  }
  if(s.previewId)throw new Error('BACKUP_ALREADY_PREVIEWED');
  if(offset!==s.size||typeof base64!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw new Error('BACKUP_OFFSET');
  const chunk=Buffer.from(base64,'base64');if(chunk.length>CHUNK_LIMIT||chunk.length+s.size>BACKUP_LIMIT)throw new Error('BACKUP_LIMIT');appendFileSync(s.path,chunk);s.size+=chunk.length;return {nextOffset:s.size};
 }
 async finish({transferId,decisions}){
  this.prune();const s=this.sessions.get(transferId);if(!s)throw new Error('BACKUP_SESSION_EXPIRED');s.touched=Date.now();
  if(s.previewId){const result=await this.backup.restore(s.previewId,decisions);this.remove(transferId);if(result.snapshot){const snapshot=this.stage('export',result.snapshot);return {...result,snapshot:undefined,snapshotTransferId:snapshot.transferId,snapshotSize:snapshot.size};}return result;}
  if(s.operation==='export'){this.remove(transferId);return {complete:true};}
  const preview=await this.backup.preview(readFileSync(s.path),s.password,s.mode,s.context);s.previewId=preview.transferId;s.password=undefined;return {...preview,transferId};
 }
 cancel({transferId}){this.remove(transferId);return {cancelled:true};}
 close(){for(const id of this.sessions.keys())this.remove(id);this.backup.close();}
}

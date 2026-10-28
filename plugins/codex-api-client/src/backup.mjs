import {validateDocument,validateHistory} from './document-validation.mjs';
import {uniqueName} from './workspace-transfer.mjs';
import {randomBytes,randomUUID,scryptSync,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {writeFileSync,mkdirSync,rmSync,realpathSync,statSync,readdirSync,openSync,fstatSync,readSync,closeSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
export const BACKUP_LIMIT=256*1024*1024,FILE_LIMIT=20*1024*1024;
const PLAIN_LIMIT=Math.floor(BACKUP_LIMIT*0.74);
const kdf={N:32768,r:8,p:1},prefs=['requestTimeout','scriptTimeout','runTimeout','strictSSL','followRedirects','delay','proxy','proxyCredentials','noProxy','caFile','certificates','maxResponseSize','selectedEnvironment','ui'];
const fail=()=>{throw new Error('BACKUP_INVALID: 备份无效、密码错误或超过限制');};
export function encryptArchive(data,password){if(typeof password!=='string'||!password.length)fail();const plain=Buffer.from(JSON.stringify(data));if(plain.length>PLAIN_LIMIT)fail();const salt=randomBytes(16),nonce=randomBytes(12),key=scryptSync(password,salt,32,{...kdf,maxmem:64*1024*1024}),cipher=createCipheriv('aes-256-gcm',key,nonce);const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);key.fill(0);return Buffer.from(JSON.stringify({format:'codex-api-client-encrypted',version:1,kdf,salt:salt.toString('base64'),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));}
export function decryptArchive(bytes,password){try{if(bytes.length>BACKUP_LIMIT)fail();const e=JSON.parse(bytes);if(e.format!=='codex-api-client-encrypted'||e.version!==1||JSON.stringify(e.kdf)!==JSON.stringify(kdf))fail();const salt=Buffer.from(e.salt,'base64'),nonce=Buffer.from(e.nonce,'base64'),tag=Buffer.from(e.tag,'base64');if(salt.length!==16||nonce.length!==12||tag.length!==16)fail();const key=scryptSync(password,salt,32,{...kdf,maxmem:64*1024*1024}),decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAuthTag(tag);const plain=Buffer.concat([decipher.update(Buffer.from(e.ciphertext,'base64')),decipher.final()]);key.fill(0);if(plain.length>BACKUP_LIMIT)fail();return JSON.parse(plain);}catch{fail();}}
function walk(value,fn){if(Array.isArray(value))return value.map(v=>walk(v,fn));if(!value||typeof value!=='object')return typeof value==='string'?fn(value):value;return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='secretRef').map(([k,v])=>[k,walk(v,fn)]));}
const settings=data=>Object.fromEntries(prefs.filter(k=>k in data).map(k=>[k,k==='ui'?Object.fromEntries(Object.entries(data.ui||{}).filter(([p,v])=>['theme','sidebarOpen','responseTab'].includes(p)&&['string','boolean'].includes(typeof v))):data[k]]));
// Decision IDs are opaque JSON tuples, so names containing separators never collide.
const cookieIdentity=c=>[String(c.domain||'').toLowerCase().replace(/^\./,''),c.path||'/',c.key];
const decisionId=(kind,key)=>JSON.stringify([kind,...(Array.isArray(key)?key:[key])]);
const settingEntries=data=>Object.entries(settings(data)).flatMap(([key,value])=>key==='ui'?Object.entries(value).map(([name,v])=>['ui.'+name,v]):[[key,value]]);
function applySetting(target,key,value){if(key.startsWith('ui.'))target.ui={...target.ui,[key.slice(3)]:value};else target[key]=value;}
function conflictRows(kind,local,backup){
 const row=(key,left,right,extra={})=>({id:decisionId(kind,key),kind,key:Array.isArray(key)?key[2]:key,...extra,default:'local',local:'masked',backup:'masked',changed:JSON.stringify(walk(left,v=>v))!==JSON.stringify(walk(right,v=>v))});
 if(kind==='settings'){const source=new Map(settingEntries(local));return settingEntries(backup).map(([key,value])=>({...row(key,source.get(key),value),localPresent:source.has(key)}));}
 const key=kind==='globals'?v=>v.key:cookieIdentity,identity=v=>JSON.stringify(key(v)),live=new Map((kind==='globals'?local.values:local.cookies).map(v=>[identity(v),v]));
 return (kind==='globals'?backup.values:backup.cookies).filter(v=>live.has(identity(v))).map(v=>row(key(v),live.get(identity(v)),v,kind==='cookies'?{domain:cookieIdentity(v)[0],path:cookieIdentity(v)[1]}:{}));
}
function mergeSingleton(kind,local,backup,decisions,files){
 const chosen=key=>(decisions[decisionId(kind,key)]??decisions[kind]??'local')==='backup';
 if(kind==='settings'){const result=structuredClone(local);for(const [key,value]of settingEntries(backup))if(chosen(key))applySetting(result,key,value);result.allowedFiles=[...new Set([...(local.allowedFiles||[]),...files])];return result;}
 const field=kind==='globals'?'values':'cookies',key=kind==='globals'?v=>v.key:cookieIdentity,identity=v=>JSON.stringify(key(v));
 const incoming=new Map(backup[field].map(v=>[identity(v),v])),seen=new Set();
 const values=local[field].map(v=>{const id=identity(v);seen.add(id);return incoming.has(id)&&chosen(key(v))?incoming.get(id):v;});
 for(const v of backup[field])if(!seen.has(identity(v))){seen.add(identity(v));values.push(v);}
 return {...local,[field]:values};
}
// Only these Postman/network schema locations denote machine files. A business value
// equal to a path or document ID must remain byte-for-byte unchanged.
function visitAttachmentLocations(kind,data,map){
 const network=data=>{if(!data)return;field(data,'caFile');for(const certificate of data.certificates||[])for(const key of ['cert','key','pfx']){if(certificate[key]&&typeof certificate[key]==='object')field(certificate[key],'src');else field(certificate,key);}};
 const field=(object,key)=>{if(!object||!(key in object))return;const value=object[key];if(Array.isArray(value))object[key]=value.map(v=>typeof v==='string'&&v?map(v):v);else if(typeof value==='string'&&value)object[key]=map(value);};
 if(kind==='collection'){
  const visit=node=>{
   network(node['x-codex-api-client']?.network);
   const protocol=node.request?.['x-codex-api-client']?.protocol;
   for(const entry of protocol?.protoFiles||[])field(entry,'path');
   for(const key of ['caFile','certFile','keyFile'])field(protocol?.tls,key);
   const body=node.request?.body;
   if(body){field(body.file,'src');for(const part of body.formdata||[])if(part.type==='file')field(part,'src');}
   for(const child of node.item||[])visit(child);
  };visit(data);
 }
 if(kind==='settings'){
  field(data,'caFile');
  for(const certificate of data.certificates||[])for(const key of ['cert','key','pfx']){
   if(certificate[key]&&typeof certificate[key]==='object')field(certificate[key],'src');else field(certificate,key);
  }
 }
}
function restoreDocumentData(document,paths,mapping){
 const data=walk(document.data,v=>v);
 visitAttachmentLocations(document.kind,data,path=>paths.get(path)||path);
 if(document.kind==='settings'&&typeof data.selectedEnvironment==='string')data.selectedEnvironment=mapping.get(data.selectedEnvironment)||data.selectedEnvironment;
 return data;
}
function restoreHistory(history,mapping,mode){
 return history.map(original=>{
  const run=structuredClone(original);
  if(mode!=='replace')run.id=randomUUID();
  for(const field of ['collectionId','environmentId'])if(typeof run[field]==='string')run[field]=mapping.get(run[field])||run[field];
  return run;
 });
}
export class BackupService {
 constructor(store){this.store=store;this.sessions=new Map();this.directory=join(store.directory,'backup-files');mkdirSync(this.directory,{recursive:true,mode:0o700});const rows=store.db.prepare('SELECT data FROM documents').all();for(const name of readdirSync(this.directory)){const path=join(this.directory,name);if(statSync(path).isDirectory()&&!rows.some(r=>r.data.includes(path)))rmSync(path,{recursive:true,force:true});}}
 async capture(includeHistory=false,context){
  const documents=[],files=[],paths=new Map(),attachments=[];
  for(const row of this.store.db.prepare('SELECT * FROM documents').all()){
   const document=await this.store.view(row,{reveal:true});
   documents.push({kind:row.kind,id:row.id,data:row.kind==='settings'?settings(document.data):document.data});
  }
  if(context){
   let document=documents.find(d=>d.kind==='settings');
   if(!document){document={kind:'settings',id:'default',data:{}};documents.push(document);}
   document.data={...document.data,...settings(context)};
  }
  const allowed=new Set((JSON.parse(this.store.row('settings','default')?.data||'{}').allowedFiles||[]).map(p=>resolve(p)));
  const root=realpathSync(this.store.directory);
  const captureFile=original=>{
   const path=realpathSync(original);
   if(!(path.startsWith(root+'/uploads/')||path.startsWith(root+'/backup-files/')||allowed.has(path)))throw new Error('BACKUP_FILE_DENIED: 附件未被允许读取');
   if(!paths.has(path)){
    const stat=statSync(path);
    if(files.length>=1000||!stat.isFile()||stat.size>FILE_LIMIT)fail();
    const id=randomUUID(),file={id,name:basename(path),sha256:'0'.repeat(64),base64:''};
    files.push(file);attachments.push({path,size:stat.size,file});
    paths.set(path,'backup-file:'+id);
   }
   return paths.get(path);
  };
  for(const document of documents)visitAttachmentLocations(document.kind,document.data,captureFile);
  const archive={version:1,documents:walk(documents,v=>v),files,history:includeHistory?this.store.listRuns():[]};
  // Empty payloads retain exact JSON overhead; base64 adds four ASCII bytes per three source bytes.
  let bytes=Buffer.byteLength(JSON.stringify(archive));
  for(const {size} of attachments)bytes+=4*Math.ceil(size/3);
  if(bytes>PLAIN_LIMIT)fail();
  for(const {path,size,file} of attachments){
   const fd=openSync(path,'r');
   try{
    if(fstatSync(fd).size!==size)fail();
    const data=Buffer.alloc(size);let offset=0;
    while(offset<size){const read=readSync(fd,data,offset,size-offset,offset);if(!read)fail();offset+=read;}
    // Bound reads even if a file grows after stat; reject truncation or an extra byte.
    if(readSync(fd,Buffer.alloc(1),0,1,size))fail();
    file.sha256=createHash('sha256').update(data).digest('hex');file.base64=data.toString('base64');
   }finally{closeSync(fd);}
  }
  return archive;
 }
 async export(password,includeHistory=false,context){return encryptArchive(await this.capture(includeHistory,context),password);}
 async preview(bytes,password,mode='merge',context){const archive=decryptArchive(bytes,password);this.validate(archive);const transferId=randomUUID();this.sessions.set(transferId,{archive,password,mode,context,touched:Date.now()});const counts=kind=>archive.documents.filter(d=>d.kind===kind).length;return {transferId,collectionCount:counts('collection'),environmentCount:counts('environment'),credentialCount:JSON.stringify(archive).match(/"type":"secret"/g)?.length||0,fileCount:archive.files.length,cookieCount:archive.documents.find(d=>d.kind==='cookies')?.data.cookies?.length||0,conflicts:(await Promise.all(archive.documents.filter(d=>['globals','settings','cookies'].includes(d.kind)&&this.store.row(d.kind,'default')).map(async d=>conflictRows(d.kind,(await this.store.get(d.kind,'default',{reveal:true})).data,d.data)))).flat(),mode};}
 validate(archive){
  try{
  if(!archive||typeof archive!=='object')fail();
  if(archive.version!==1||!Array.isArray(archive.documents)||archive.documents.length>5000||!Array.isArray(archive.files)||archive.files.length>1000)fail();
  const ids=new Set(),referenced=new Set(),documents=new Set();
  try{validateHistory(archive.history??[]);}catch{fail();}
  for(const file of archive.files){
   if(!/^[\da-f-]{36}$/.test(file.id)||ids.has(file.id)||typeof file.name!=='string'||file.name!==basename(file.name)||file.name==='..'||file.name.includes('\\'))fail();
   ids.add(file.id);
   const bytes=Buffer.from(file.base64,'base64');
   if(bytes.length>FILE_LIMIT||createHash('sha256').update(bytes).digest('hex')!==file.sha256)fail();
  }
  for(const document of archive.documents){
   if(typeof document.id!=='string'||!document.id||document.id.length>200)fail();
   if(!['collection','environment','globals','settings','cookies'].includes(document.kind)||!document.data||typeof document.data!=='object')fail();
   const identity=JSON.stringify([document.kind,document.id]);
   if(documents.has(identity)||(['globals','settings','cookies'].includes(document.kind)&&document.id!=='default'))fail();
   documents.add(identity);
   try{validateDocument(document.kind,document.data);}catch{fail();}
   visitAttachmentLocations(document.kind,document.data,path=>{
    if(!path.startsWith('backup-file:')||!ids.has(path.slice(12)))fail();
    referenced.add(path.slice(12));return path;
   });
  }
  if(ids.size!==referenced.size)fail();
  }catch{fail();}
 }
 async restore(id,decisions={}){
  const session=this.sessions.get(id);
  if(!session||Date.now()-session.touched>900000)fail();
  const {archive,mode,password,context}=session;
  this.validate(archive);
  // This identity precedes both snapshot capture and any asynchronous secret preparation.
  // Store verifies it under BEGIN IMMEDIATE before replacement can delete a row.
  const expectedWorkspaceIdentity=mode==='replace'?this.store.workspaceIdentity():undefined;
  const folder=join(this.directory,randomUUID()),paths=new Map();
  mkdirSync(folder,{mode:0o700});
  let snapshot,snapshotPath;
  try{
   if(mode==='replace'){
    snapshot=await this.export(password,true,context);
    snapshotPath=join(this.directory,'recovery-'+randomUUID()+'.backup');
    writeFileSync(snapshotPath,snapshot,{mode:0o600});
   }
   for(const file of archive.files){
    const path=join(folder,file.id);
    writeFileSync(path,Buffer.from(file.base64,'base64'),{mode:0o600});
    paths.set('backup-file:'+file.id,path);
   }
   const names={
    collection:new Set((await this.store.list('collection')).map(d=>d.data.info?.name)),
    environment:new Set((await this.store.list('environment')).map(d=>d.data.name)),
   };
   const mapping=new Map(archive.documents.filter(d=>['collection','environment'].includes(d.kind)).map(d=>[d.id,mode==='replace'?d.id:randomUUID()]));
   const entries=[];
   for(const document of archive.documents){
    const {kind}=document,id=mapping.get(document.id)||'default';
    let data=restoreDocumentData(document,paths,mapping);
    const live=this.store.row(kind,id);
    if(mode!=='replace'&&kind==='collection')data.info.name=uniqueName(data.info.name,names.collection);
    if(mode!=='replace'&&kind==='environment')data.name=uniqueName(data.name,names.environment);
    if(kind==='settings')data={...settings(data),allowedFiles:[...paths.values()]};
    if(mode!=='replace'&&['globals','settings','cookies'].includes(kind)&&live){
     const local=(await this.store.get(kind,id,{reveal:true})).data;
     data=mergeSingleton(kind,local,data,decisions,paths.values());
    }
    entries.push({kind,id,data,expectedRevision:live?.revision||0});
   }
   if(paths.size&&!entries.some(d=>d.kind==='settings')){
    const live=await this.store.get('settings','default',{reveal:true});
    entries.push({kind:'settings',id:'default',data:{...live?.data,allowedFiles:[...new Set([...(live?.data.allowedFiles||[]),...paths.values()])]},expectedRevision:live?.revision||0});
   }
   const history=restoreHistory(archive.history||[],mapping,mode);
   await this.store.putMany(entries,{replace:mode==='replace',history,expectedWorkspaceIdentity});
   this.sessions.delete(id);
   return {restored:true,documentCount:entries.length,snapshotCreated:!!snapshot,snapshot};
  }catch(error){
   rmSync(folder,{recursive:true,force:true});
   if(snapshotPath)rmSync(snapshotPath,{force:true});
   throw error;
  }
 }
 close(){this.sessions.clear();}
}

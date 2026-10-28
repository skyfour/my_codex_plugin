import {BackupService} from './backup.mjs';
import {BackupTransfer} from './backup-transfer.mjs';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { executeCollection } from './execution.mjs';
import { normalizeCollection, findItem, moveItem, duplicateItem, selectCollection } from './collections.mjs';
import { importDocument, exportCurl, parseData, warningsFor } from './formats.mjs';
import { isSecret, redact, transformSecrets } from './secrets.mjs';
import {WORKSPACE_FORMAT,TRANSFER_LIMIT,workspacePreview,portableData,sanitizedPortableData,portableSettings,uniqueName,parseWorkspace} from './workspace-transfer.mjs';

export const DEFAULT_SETTINGS = { requestTimeout:30000, scriptTimeout:5000, runTimeout:120000, strictSSL:true, followRedirects:true, delay:0 };
const kinds = ['collection','environment','globals','settings','cookies'];
const assertKind = kind => { if (!kinds.includes(kind)) throw new Error('INVALID_KIND'); };
const summary = run => ({ id:run.id,status:run.status,name:run.name,createdAt:run.createdAt,completedAt:run.completedAt,responses:run.responses.length,passed:run.assertions.filter(a=>!a.error&&!a.skipped).length,failed:run.assertions.filter(a=>a.error).length,errors:run.errors.length });
const json = v => JSON.stringify(v);

export class ApiService {
  constructor(store) { this.store=store; this.active=new Map(); this.backups=new BackupTransfer(new BackupService(store)); }
  backupStart(args){return this.backups.start(args);}
  backupChunk(args){return this.backups.chunk(args);}
  backupFinish(args){return this.backups.finish(args);}
  backupCancel(args){return this.backups.cancel(args);}
  async state() {
    const [collections,environments,globals,settings,cookies]=await Promise.all(['collection','environment','globals','settings','cookies'].map(k=>this.store.list(k)));
    return {collections,environments,globals:globals[0]||null,settings:settings[0]||null,cookies:cookies[0]||null,history:this.store.listRuns().map(summary),defaults:DEFAULT_SETTINGS};
  }
  async get({kind,id}) { assertKind(kind); const d=await this.store.get(kind,id); if(!d) throw new Error('NOT_FOUND'); return d; }
  async put({kind,id,data,revision=0}) {
    assertKind(kind);
    if(['globals','settings','cookies'].includes(kind)) {
      if(id&&id!=='default')throw new Error('INVALID_ID: 此文档 id 固定为 default');
      id='default';
    } else id||=randomUUID();
    if (!data || typeof data!=='object'||Array.isArray(data)) throw new Error('INVALID_DOCUMENT');
    if (kind==='collection') data=normalizeCollection(data);
    if (['environment','globals'].includes(kind) && !Array.isArray(data.values)) throw new Error('INVALID_VARIABLES');
    if(['environment','globals'].includes(kind))data={...data,values:data.values.map(v=>({...v,disabled:v.disabled??v.enabled===false}))};
    if (kind==='settings') validateOptions({...DEFAULT_SETTINGS,...data});
    if(kind==='cookies'&&(!Array.isArray(data.cookies)||data.cookies.some(c=>!c||typeof c.key!=='string'||(typeof c.value!=='string'&&!c.secretRef))))throw new Error('INVALID_COOKIES');
    return this.store.put(kind,id,data,revision);
  }
  async remove({kind,id,revision}) { assertKind(kind); return this.store.remove(kind,id,revision); }
  async import({text,localFiles}) {
    const {kind,data,warnings}=await importDocument(text,{localFiles});
    if(kind==='workspace')return this.importWorkspace(data);
    return {document:await this.put({kind,data}),warnings};
  }
  async previewImport({text,localFiles}) {
    const imported=await importDocument(text,{localFiles});
    if(imported.kind==='workspace')return {...workspacePreview(imported.data),warnings:imported.warnings};
    return {kind:imported.kind,collectionCount:imported.kind==='collection'?1:0,environmentCount:imported.kind==='environment'?1:0,warnings:imported.warnings,...(imported.kind==='collection'?collectionPreview(imported.data):{})};
  }
  async exportWorkspace() {
    const collections=await this.store.list('collection'),environments=await this.store.list('environment');
    const data={format:WORKSPACE_FORMAT,version:1,createdAt:new Date().toISOString(),collections:[],environments:[],globals:null};
    // Export the captured document snapshots, without resolving credentials from Keychain.
    data.collections=await Promise.all(collections.map(c=>sanitizedPortableData(c.data)));
    data.environments=await Promise.all(environments.map(e=>sanitizedPortableData(e.data)));
    const globals=await this.store.get('globals','default');if(globals)data.globals=await sanitizedPortableData(globals.data);
    const settings=await this.store.get('settings','default');if(settings)data.settings=await sanitizedPortableData(portableSettings(settings.data));
    parseWorkspace(data);
    if(Buffer.byteLength(JSON.stringify(data,null,2),'utf8')>TRANSFER_LIMIT)throw new Error('EXPORT_LIMIT: 工作区备份超过 20 MB');
    return {data,name:'api-client-workspace-'+new Date().toISOString().slice(0,10)+'.json',warnings:['已标记的敏感变量仅保留名称；Cookie 值、历史、证书和附件文件不包含；文件需重新选择。脚本中的硬编码秘密需自行检查。']};
  }
  async importWorkspace(data) {
    const entries=[],warnings=[],collections=await this.store.list('collection'),environments=await this.store.list('environment');
    for(const [kind,items,existing] of [['collection',data.collections,collections],['environment',data.environments,environments]]){
      const names=new Set(existing.map(d=>kind==='collection'?d.data.info.name:d.data.name));
      for(const original of items){
        const copy=await portableData(original);
        if(kind==='collection'){
          copy.info.name=uniqueName(copy.info.name,names);
          warnings.push(...warningsFor(copy));
        }else {copy.name=uniqueName(copy.name,names);delete copy.id;copy.values=copy.values.map(v=>({...v,disabled:v.disabled??v.enabled===false}));}
        entries.push({kind,id:randomUUID(),data:copy,expectedRevision:0});
      }
    }
    if(data.globals){
      const live=await this.store.get('globals','default'),merged=structuredClone(live?.data||{values:[]}),names=new Set(merged.values.map(v=>v.key));
      for(const variable of (await portableData(data.globals)).values){
        if(names.has(variable.key)){warnings.push('全局变量 '+variable.key+' 已存在，保留本机值');continue;}
        names.add(variable.key);merged.values.push({...variable,disabled:variable.disabled??variable.enabled===false});
      }
      if(!live||merged.values.length!==live.data.values.length)entries.push({kind:'globals',id:'default',data:merged,expectedRevision:live?.revision||0});
    }
    if(data.settings&&!this.store.row('settings','default')){const settings=await sanitizedPortableData(portableSettings(data.settings));validateOptions({...DEFAULT_SETTINGS,...settings});entries.push({kind:'settings',id:'default',data:settings,expectedRevision:0});}
    const documents=await this.store.putMany(entries);
    return {documents,warnings:[...new Set(warnings)],...workspacePreview(data)};
  }
  async export({kind,id,format='postman',itemId}) {
    assertKind(kind);
    const data=await sanitizedPortableData(await this.store.export(kind,id));
    if(format==='curl') {
      const found=findItem(data,itemId),item=found?.item; if(!item?.request) throw new Error('NOT_FOUND');
      const inherited=[data,...found.parents].map(p=>p.auth).filter(Boolean).at(-1);
      return {text:exportCurl(item,inherited),name:item.name+'.sh',warnings:['cURL 不包含脚本、环境变量解析和工作区 Cookie；敏感变量值已排除。']};
    }
    const warnings=[];
    const scan=root=>{for(const item of root.item||[])if(item.item){if(item.variable?.length)warnings.push('文件夹变量为本插件扩展，原生 Postman 中需改写为文件夹前置脚本。');scan(item);}};
    if(kind==='collection')scan(data);
    return {data,name:(data.info?.name||data.name||kind)+'.json',warnings:[...new Set(warnings)]};
  }
  async editItem({collectionId,itemId,operation,parentId,position=0,item,revision}) {
    const doc=await this.get({kind:'collection',id:collectionId}); let data=doc.data;
    if(doc.revision!==revision) throw new Error('CONFLICT: 集合已更新，请重新加载');
    if(operation==='move') data=moveItem(data,itemId,parentId,position);
    else if(operation==='duplicate') data=duplicateItem(data,itemId);
    else if(operation==='delete') { const f=findItem(data,itemId);if(!f)throw new Error('NOT_FOUND');f.parent.item.splice(f.index,1); }
    else if(operation==='upsert') {
      if(!item?.name)throw new Error('INVALID_ITEM: 需要名称');
      const f=itemId?findItem(data,itemId):null;
      if(f) f.parent.item[f.index]={...item,id:f.item.id};
      else { const parent=parentId?findItem(data,parentId)?.item:data; if(!parent?.item)throw new Error('NOT_FOUND');parent.item.splice(position,0,{...item,id:randomUUID()}); }
    } else throw new Error('INVALID_OPERATION');
    return this.put({kind:'collection',id:collectionId,data,revision});
  }
  async upload({name,base64}) {
    if(typeof base64!=='string'||base64.length>28*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)||base64.length%4)throw new Error('UPLOAD: 无效文件或超过 20 MB');
    const bytes=Buffer.from(base64,'base64');if(bytes.length>20*1024*1024)throw new Error('UPLOAD: 超过 20 MB');
    const directory=join(this.store.directory,'uploads');await mkdir(directory,{recursive:true,mode:0o700});
    name=basename(name);const path=join(directory,randomUUID()+'-'+name.replace(/[^\p{L}\p{N}._-]/gu,'_'));
    await writeFile(path,bytes,{mode:0o600});return {path,name,size:bytes.length};
  }
  async graphqlIntrospect({collectionId,itemId,environmentId}) {
    return this.start({collectionId,itemId,environmentId},true);
  }
  async start({collectionId,itemId,environmentId,data=[],dataText,dataFormat='json',options={}},introspect=false) {
    const settings=(await this.store.get('settings','default'))?.data||{};
    options={...DEFAULT_SETTINGS,...settings,...options};validateOptions(options);
    if(this.active.size>=4)throw new Error('RUN_LIMIT: 同时最多运行 4 个集合');
    const collectionDoc=await this.store.get('collection',collectionId,{reveal:true});if(!collectionDoc)throw new Error('NOT_FOUND');
    const environmentDoc=environmentId?await this.store.get('environment',environmentId,{reveal:true}):null;
    if(environmentId&&!environmentDoc)throw new Error('NOT_FOUND: 环境不存在');
    const globalsDoc=await this.store.get('globals','default',{reveal:true});
    const cookiesDoc=await this.store.get('cookies','default',{reveal:true});
    const collection=selectCollection(collectionDoc.data,itemId), warnings=warningsFor(collection);
    options.singleRequest=!!(itemId&&findItem(collectionDoc.data,itemId)?.item.request);
    if(introspect){
      const item=findItem(collection,itemId)?.item;
      if(!item?.request||item.request.body?.mode!=='graphql')throw new Error('GRAPHQL: 请先选择并保存 GraphQL 请求');
      item.request={...item.request,method:'POST',body:{mode:'graphql',graphql:{query:INTROSPECTION_QUERY,variables:'{}',operationName:'IntrospectionQuery'}}};
    }
    if(warnings.length)throw new Error('UNSUPPORTED: '+warnings.join('；'));
    if(dataText!==undefined)data=parseData(dataText,dataFormat);
    if(!Array.isArray(data)||data.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('DATA: 需要对象数组');
    if(data.length>1000)throw new Error('RUN_LIMIT: 数据最多 1000 行');
    const uploads=join(this.store.directory,'uploads');
    const owned=(await readdir(uploads).catch(()=>[])).map(p=>join(uploads,p));
    options.allowedFiles=[...owned,...(options.allowedFiles||[])].map(p=>resolve(p));
    const secretValues=[];
    for(const d of [collectionDoc,environmentDoc,globalsDoc,cookiesDoc])if(d)await transformSecrets(d.data,v=>{secretValues.push(v.value);return v;});
    // Scripts receive the actual values, without implementation-specific Keychain references.
    const secretKeys={environment:[],globals:[],collectionVariables:[]};
    for(const [doc,scope]of [[environmentDoc,'environment'],[globalsDoc,'globals'],[collectionDoc,'collectionVariables']])if(doc)await transformSecrets(doc.data,v=>{secretKeys[scope].push(v.key);return v;});
    const resolved=async d=>transformSecrets(d||{},v=>{delete v.secretRef;v.type='string';delete v.sensitive;return v;});
    const input={collection:await resolved(collection),environment:await resolved(environmentDoc?.data),globals:await resolved(globalsDoc?.data),cookies:await resolved(cookiesDoc?.data),data,options,secretKeys};
    const run={id:randomUUID(),status:'running',name:collection.info.name,collectionId,itemId,environmentId,createdAt:new Date().toISOString(),responses:[],assertions:[],logs:[],errors:[],variableChanges:[]};
    const controller=new AbortController();this.store.saveRun(run);
    const cancellationPoll=setInterval(()=>{if(this.store.isCancelled(run.id))controller.abort();},200);
    const completion=executeCollection(input,{signal:controller.signal,onEvent:event=>{
      if(event.type==='secrets'){secretValues.push(...event.value);return;}
      const key={response:'responses',assertion:'assertions',log:'logs',error:'errors'}[event.type];
      if(key)run[key].push(sanitize(event.value,secretValues));
      if(event.type==='progress')run.progress=event.value;
      // A response can introduce a secret before its post-response script assigns it.
      // Persist only progress until all script variable changes have been collected.
      this.store.saveRun({...run,responses:[],assertions:[],logs:[],errors:[],progress:{completedRequests:run.responses.length}});
    }}).then(async result=>{
      const additional=[];
      try {
        await this.persistScope('environment',environmentId,environmentDoc,result.environment?.values,run,additional);
        await this.persistScope('globals','default',globalsDoc,result.globals?.values,run,additional);
        await this.persistScope('collection',collectionId,collectionDoc,result.collectionVariables,run,additional);
        if(result.cookies) {
          additional.push(...(result.cookies.cookies||[]).map(c=>c.value));
          try { await this.store.put('cookies','default',result.cookies,cookiesDoc?.revision||0); }
          catch(error){run.errors.push({message:'COOKIE_CONFLICT: Cookie 在运行期间更新，本次结果未覆盖；'+error.message});}
        }
      } catch(error){run.errors.push({message:'PERSIST: '+error.message});}
      secretValues.push(...additional);
      const persistenceErrors=run.errors.filter(e=>/^(PERSIST|VARIABLE_CONFLICT|COOKIE_CONFLICT)/.test(e.message));
      Object.assign(run,result,{errors:[...result.errors,...persistenceErrors],completedAt:new Date().toISOString()});
      delete run.environment;delete run.globals;delete run.collectionVariables;delete run.cookies;
      if(persistenceErrors.length&&run.status==='completed')run.status='failed';
      this.store.saveRun(sanitize(run,secretValues));this.active.delete(run.id);
    }).catch(error=>{run.status='failed';run.errors.push({message:error.message});this.store.saveRun(sanitize(run,secretValues));this.active.delete(run.id);}).finally(()=>clearInterval(cancellationPoll));
    this.active.set(run.id,{controller,completion});return {runId:run.id,status:'running'};
  }
  async persistScope(kind,id,original,values,run,secretValues) {
    if(!id||!values)return;
    const field=kind==='collection'?'variable':'values';
    const before=original?.data[field]||[];
    const current=await this.store.get(kind,id,{reveal:true});
    if(original&&!current){run.errors.push({message:`VARIABLE_CONFLICT: ${kind} 已删除`});return;}
    const merged=structuredClone(current?.data||{name:kind,values:[]});merged[field]||=[];
    let changed=false;
    for(const key of new Set([...before,...values].map(v=>v.key))) {
      const old=before.find(v=>v.key===key),next=values.find(v=>v.key===key);
      if(json(old?.value)===json(next?.value)&&Boolean(old)===Boolean(next))continue;
      const live=merged[field].find(v=>v.key===key);
      if(isSecret(old)||isSecret(live))secretValues.push(old?.value,live?.value,next?.value);
      const metadata=v=>v?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='secretRef')):v;
      if(json(metadata(live))!==json(metadata(old))){run.errors.push({message:`VARIABLE_CONFLICT: ${kind}.${key} 在运行期间更新`});continue;}
      const index=merged[field].findIndex(v=>v.key===key);
      if(index>=0)merged[field].splice(index,1);
      const updated=next?{...old,...next}:null;
      if(updated&&isSecret(old)){updated.type='secret';secretValues.push(updated.value);delete updated.secretRef;}
      if(updated)merged[field].push(updated);
      run.variableChanges.push({scope:kind,key,before:old?.value,after:updated?.value});changed=true;
    }
    if(changed)await this.store.put(kind,id,merged,current?.revision||0);
  }
  async result({runId,includeBodies=false}) {
    const run=this.store.getRun(runId);if(!run)throw new Error('NOT_FOUND: 运行不存在');
    if(!includeBodies)run.responses=run.responses.map(({body,bodyBase64,...r})=>r);
    return run;
  }
  async cancel({runId}) {
    const own=this.active.get(runId);
    const run=this.store.getRun(runId);if(!run)throw new Error('NOT_FOUND');
    if(run.status!=='running')return this.result({runId});
    this.store.requestCancel(runId);
    if(own){own.controller.abort();await own.completion;}
    return this.result({runId});
  }
  async close() { this.backups.close(); for(const {controller}of this.active.values())controller.abort();await Promise.allSettled([...this.active.values()].map(a=>a.completion)); }
}
function sanitize(value,secrets) {
  const encoded=[];
  const credentials=v=>{
    if(Array.isArray(v))return v.map(credentials);
    if(!v||typeof v!=='object')return v;
    const copy=Object.fromEntries(Object.entries(v).map(([k,x])=>[k,credentials(x)]));
    if(/^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(String(v.key||''))&&typeof v.value==='string') {
      encoded.push(v.value);
      if(/^Basic /i.test(v.value))encoded.push(v.value.slice(6));
      copy.value='••••••••';
    }
    for(const k of Object.keys(copy))if(/^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(k)&&typeof v[k]==='string'){encoded.push(v[k]);copy[k]='••••••••';}
    return copy;
  };
  const protectedValue=credentials(value);
  secrets=[...secrets,...encoded];
  const clean=redact(protectedValue,secrets);
  const fix=r=>{
    if(r.bodyBase64){let text=Buffer.from(r.bodyBase64,'base64').toString('latin1');for(const s of secrets.filter(Boolean))text=text.split(Buffer.from(String(s)).toString('latin1')).join('[REDACTED]');r.bodyBase64=Buffer.from(text,'latin1').toString('base64');}
  };
  if(clean.responses)clean.responses.forEach(fix);else fix(clean);
  return clean;
}
export function validateOptions(options) {
  for(const [key,min,max]of [['requestTimeout',1,300000],['scriptTimeout',1,60000],['runTimeout',100,600000],['iterations',1,1000],['delay',0,60000],['maxResponseSize',1,20*1024*1024]]) {
    if(options[key]!==undefined&&(!Number.isInteger(options[key])||options[key]<min||options[key]>max))throw new Error(`LIMIT: ${key} 必须是 ${min}–${max} 的整数`);
  }
  if(options.proxy){
    if(!/^http:\/\//.test(options.proxy))throw new Error('PROXY: 首版仅支持 HTTP 代理 URL');
    const proxy=new URL(options.proxy);if(proxy.username||proxy.password)throw new Error('PROXY: 首版不支持带凭据的代理 URL');
  }
}

function collectionPreview(data){const requests=root=>(root.item||[]).flatMap(i=>i.item?requests(i):[i.request]);const all=requests(data);const auths=root=>[root.auth?.type,root.request?.auth?.type,...(root.item||[]).flatMap(auths)].filter(Boolean);return {requestCount:all.length,collections:[{name:data.info.name,requestCount:all.length}],servers:[...new Set(all.map(r=>(typeof r?.url==='string'?r.url:r?.url?.raw||'').replace(/\{\{([^}]+)\}\}/g,(match,key)=>data.variable?.find(v=>v.key===key&&!v.disabled)?.value??match)))].slice(0,20),auth:[...new Set(auths(data))]};}

const INTROSPECTION_QUERY=`query IntrospectionQuery {
 __schema { queryType { name } mutationType { name } subscriptionType { name }
 types { kind name description fields(includeDeprecated: true) { name description args { name description type { ...TypeRef } } type { ...TypeRef } } inputFields { name type { ...TypeRef } } enumValues { name } }
 }
}
fragment TypeRef on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }
`;

import {validateOptions,AUTH_FIELDS} from './auth.mjs';
import {compatibilityMode} from './collections.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const check=condition=>{if(!condition)throw Error('INVALID_DOCUMENT');};
const optional=(v,key,type)=>check(v[key]===undefined||typeof v[key]===type);
function rows(values){
 check(Array.isArray(values));
 for(const value of values){check(object(value)&&typeof value.key==='string');optional(value,'disabled','boolean');optional(value,'enabled','boolean');optional(value,'type','string');}
}
function auth(value){
 if(value===undefined||value===null)return;
 check(object(value));optional(value,'type','string');
 for(const key of Object.keys(AUTH_FIELDS))if(value[key]!==undefined)rows(value[key]);
}
export function validateSettings(data){
 check(object(data));validateOptions(data);
 if(data.proxy!==null)optional(data,'proxy','string');
 for(const key of ['caFile','selectedEnvironment'])optional(data,key,'string');
 if(data.allowedFiles!==undefined)check(Array.isArray(data.allowedFiles)&&data.allowedFiles.every(v=>typeof v==='string'));
 if(data.certificates!==undefined){check(Array.isArray(data.certificates));for(const c of data.certificates){check(object(c));if(c.matches!==undefined)check(Array.isArray(c.matches)&&c.matches.every(v=>typeof v==='string'));for(const key of ['key','cert','pfx'])if(c[key]!==undefined)check(typeof c[key]==='string'||(object(c[key])&&typeof c[key].src==='string'));}}
 if(data.ui!==undefined){check(object(data.ui));if(data.ui.theme!==undefined)check(['light','dark'].includes(data.ui.theme));optional(data.ui,'sidebarOpen','boolean');if(data.ui.responseTab!==undefined)check(['正文','响应头','Cookie','断言','日志','变量变化'].includes(data.ui.responseTab));}
}
// Structural checks never normalize or rekey archived Postman IDs/unknown fields.
export function validateDocument(kind,data){
 check(object(data));
 if(kind==='settings')return validateSettings(data);
 if(kind==='environment'||kind==='globals'){optional(data,'name','string');rows(data.values);return;}
 if(kind==='cookies'){
  check(Array.isArray(data.cookies));const seen=new Set();
  for(const c of data.cookies){
   check(object(c)&&typeof c.key==='string'&&typeof c.value==='string');
   for(const key of ['domain','path','sameSite','expires','creation','lastAccessed'])optional(c,key,'string');
   for(const key of ['secure','httpOnly','hostOnly','pathIsDefault'])optional(c,key,'boolean');
   if(c.expires!==undefined)check(c.expires==='Infinity'||Number.isFinite(Date.parse(c.expires)));
   if(c.path!==undefined)check(c.path.startsWith('/'));
   if(c.sameSite!==undefined)check(['strict','lax','none'].includes(c.sameSite));
   const id=JSON.stringify([String(c.domain||'').toLowerCase().replace(/^\./,''),c.path||'/',c.key]);check(!seen.has(id));seen.add(id);
  }return;
 }
 check(kind==='collection'&&object(data.info)&&typeof data.info.name==='string'&&Array.isArray(data.item));
 const ids=new Set();let count=0;
 const visit=(node,depth=0)=>{
  check(object(node)&&depth<=100&&++count<=100000);
  if(node.id!==undefined){check(typeof node.id==='string'&&node.id.length>0&&!ids.has(node.id));ids.add(node.id);}
  optional(node,'name','string');if(node.variable!==undefined)rows(node.variable);
  auth(node.auth);
  if(node.event!==undefined){check(Array.isArray(node.event));for(const event of node.event){check(object(event)&&typeof event.listen==='string');if(event.script!==undefined){check(object(event.script));const exec=event.script.exec;check(exec===undefined||typeof exec==='string'||(Array.isArray(exec)&&exec.every(v=>typeof v==='string')));}}}
  if(node['x-codex-api-client']?.network!==undefined)validateSettings(node['x-codex-api-client'].network);
  if(node.request!==undefined){
   check(typeof node.request==='string'||object(node.request));
   if(object(node.request)){const r=node.request;auth(r.auth);optional(r,'method','string');check(r.url===undefined||typeof r.url==='string'||object(r.url));if(r.header!==undefined&&typeof r.header!=='string')rows(r.header);if(object(r.url)&&r.url.query!==undefined)rows(r.url.query);
    if(r.body!==undefined){check(object(r.body));for(const field of ['formdata','urlencoded'])if(r.body[field]!==undefined)rows(r.body[field]);if(r.body.file!==undefined)check(object(r.body.file));}
    const protocol=r['x-codex-api-client']?.protocol;if(protocol!==undefined){check(object(protocol));if(protocol.protoFiles!==undefined){check(Array.isArray(protocol.protoFiles));for(const entry of protocol.protoFiles)check(object(entry)&&typeof entry.path==='string'&&typeof entry.name==='string');}if(protocol.tls!==undefined)check(object(protocol.tls));}
   }
  }
  if(node.item!==undefined){check(Array.isArray(node.item));for(const child of node.item)visit(child,depth+1);}
 };
 visit(data);compatibilityMode(data);
}
export function validateHistory(history){
 check(Array.isArray(history)&&history.length<=100);const ids=new Set();
 for(const run of history){
  check(object(run)&&typeof run.id==='string'&&run.id.length>0&&run.id.length<=200&&!ids.has(run.id));ids.add(run.id);
  for(const key of ['collectionId','environmentId','name','createdAt','completedAt'])optional(run,key,'string');
  check(['completed','failed','cancelled','running'].includes(run.status));
  for(const key of ['responses','assertions','errors','logs'])check(Array.isArray(run[key])&&run[key].every(object));
  if(run.variableChanges!==undefined)check(Array.isArray(run.variableChanges)&&run.variableChanges.every(object));
  for(const response of run.responses||[]){
   for(const key of ['body','bodyBase64','status','itemId','name'])optional(response,key,'string');
   for(const key of ['code','time'])optional(response,key,'number');
   if(response.headers!==undefined)rows(response.headers);
   if(response.cookies!==undefined)check(Array.isArray(response.cookies)&&response.cookies.every(object));
  }
  for(const log of run.logs||[]){optional(log,'level','string');check(Array.isArray(log.messages));}
  for(const assertion of run.assertions||[])optional(assertion,'name','string');
  for(const error of run.errors||[])optional(error,'message','string');
 }
}

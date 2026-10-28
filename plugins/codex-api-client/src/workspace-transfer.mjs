import {markCredentials} from './auth.mjs';
import {normalizeCollection,flattenRequests} from './collections.mjs';
import {transformSecrets} from './secrets.mjs';
export const WORKSPACE_FORMAT='codex-api-client-workspace';
export const TRANSFER_LIMIT=20*1024*1024;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error('IMPORT: '+message);};
function variables(value){
  if(!object(value)||!Array.isArray(value.values)||value.values.some(v=>!object(v)||typeof v.key!=='string'))fail('环境或全局变量格式错误');
}
function collection(value,depth=0){
  if(depth>64||!object(value)||!Array.isArray(value.item))fail('集合目录格式错误或层级过深');
  for(const item of value.item){
    if(!object(item)||typeof item.name!=='string')fail('请求或文件夹格式错误');
    if('item' in item)collection(item,depth+1);
    else if(!object(item.request))fail('请求配置格式错误');
  }
}
export function parseWorkspace(data){
  if(data.version!==1)fail('不支持此工作区备份版本');
  for(const field of ['collections','environments'])if(!Array.isArray(data[field])||data[field].length>1000)fail('集合或环境列表格式错误（最多 1000 个）');
  for(const c of data.collections){if(!object(c)||!object(c.info)||typeof c.info.name!=='string'||!c.info.name.trim())fail('集合缺少名称');collection(c);}
  for(const env of data.environments){variables(env);if(typeof env.name!=='string'||!env.name.trim())fail('环境缺少名称');}
  if(data.globals!==null&&data.globals!==undefined)variables(data.globals);
  return {kind:'workspace',data:{...data,collections:data.collections.map(normalizeCollection)},warnings:[]};
}
export function workspacePreview(data){
  const collections=data.collections.map(c=>({name:c.info.name,requestCount:flattenRequests(c).length}));
  return {kind:'workspace',collections,collectionCount:collections.length,requestCount:collections.reduce((n,c)=>n+c.requestCount,0),environmentCount:data.environments.length,globalCount:data.globals?.values.length||0};
}
export const portableData=data=>transformSecrets(data,v=>{delete v.secretRef;return {...v,value:''};});
export function uniqueName(name,names){let candidate=name,index=1;while(names.has(candidate))candidate=name+'（导入'+(index++===1?'':index-1)+'）';names.add(candidate);return candidate;}
// Postman authorizers store credential entries under schema-specific parameter names.
// In particular apikey.key is the public header/query name; apikey.value is the credential.
const authSecrets={
 basic:['password'],bearer:['token'],digest:['password'],apikey:['value'],
 oauth1:['consumerSecret','tokenSecret','token'],oauth2:['accessToken','refreshToken','clientSecret','password'],
 awsv4:['secretKey','sessionToken'],hawk:['authKey'],ntlm:['password'],
 edgegrid:['clientSecret','clientToken','accessToken'],jwt:['secret','privateKey'],asap:['privateKey'],
};
export async function sanitizedPortableData(data){
 const clean=await portableData(markCredentials(data));
 const visit=(value,parent='')=>{
  if(Array.isArray(value))return value.map(v=>visit(v,parent));
  if(!value||typeof value!=='object')return value;
  const out={};
  for(const [key,v]of Object.entries(value)){
   if(key==='secretRef')continue;
   if(key==='value'&&(/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(value.key||'')||authSecrets[parent]?.includes(value.key))){out[key]='';continue;}
   if(typeof v==='string'&&/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(v)){out[key]='';continue;}
   if(['url','raw'].includes(key)&&typeof v==='string'&&/^https?:\/\//i.test(v)){
    try{const url=new URL(v);if(url.username||url.password){url.username='';url.password='';out[key]=url.toString();continue;}}catch{}
   }
   if(/^(password|clientSecret|privateKey|passphrase|accessToken|refreshToken)$/i.test(key)){out[key]='';continue;}
   if(key==='proxy'&&typeof v==='string'){
    try{const url=new URL(v);url.username='';url.password='';out[key]=url.toString();}catch{out[key]='';}continue;
   }
   out[key]=visit(v,key);
  }
  return out;
 };
 return visit(clean);
}

export const portableSettings=data=>Object.fromEntries(['requestTimeout','scriptTimeout','runTimeout','strictSSL','followRedirects','delay','maxResponseSize','proxy','noProxy','proxyCredentials','ui'].filter(k=>k in data).map(k=>[k,data[k]]));

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
// Structured credential fields are sensitive even when an imported collection omitted type=secret.
export async function sanitizedPortableData(data){
 const clean=await portableData(data);
 const visit=(value,parent='')=>{if(Array.isArray(value))return value.map(v=>visit(v,parent));if(!value||typeof value!=='object')return value;const out={};for(const [k,v]of Object.entries(value)){if(k==='secretRef')continue;if(k==='value'&&/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(value.key||'')){out[k]='';continue;}if(typeof v==='string'&&/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(v)){out[k]='';continue;}if(['url','raw'].includes(k)&&typeof v==='string'&&/^https?:\/\//i.test(v)){try{const u=new URL(v);if(u.username||u.password){u.username='';u.password='';out[k]=u.toString();continue;}}catch{}}if((parent==='auth'||['basic','bearer','digest','oauth1','oauth2','awsv4','hawk','ntlm','edgegrid','jwt','asap'].includes(parent))&&k==='value'&&/password|token|secret|key|signature|credential/i.test(value.key||'')){out[k]='';continue;}if(/^(password|clientSecret|privateKey|passphrase|accessToken|refreshToken)$/i.test(k)){out[k]='';continue;}if(k==='proxy'&&typeof v==='string'){try{const u=new URL(v);u.username='';u.password='';out[k]=u.toString();}catch{out[k]='';}continue;}out[k]=visit(v,k);}return out;};return visit(clean);
}

export const portableSettings=data=>Object.fromEntries(['requestTimeout','scriptTimeout','runTimeout','strictSSL','followRedirects','delay','maxResponseSize','proxy','ui'].filter(k=>k in data).map(k=>[k,data[k]]));

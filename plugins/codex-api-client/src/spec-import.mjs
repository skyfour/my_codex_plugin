import sdk from 'postman-collection';
import converter from 'openapi-to-postmanv2';
import {parseDocument} from 'yaml';
import {posix} from 'node:path';
import {normalizeCollection} from './collections.mjs';
const LIMIT=20*1024*1024;
export function parseSpecText(text){
  if(text.trim().startsWith('{'))return JSON.parse(text);
  const doc=parseDocument(text,{uniqueKeys:true});
  if(doc.errors.length)throw new Error('IMPORT: '+doc.errors[0].message);
  return doc.toJS({maxAliasCount:50});
}
function refFile(from,raw){
 if(/^[\/\\]|[:\\?%\x00-\x1f]/.test(raw))throw new Error('REF: 不允许远程、绝对路径或编码路径');
 return localName(posix.join(posix.dirname(from),raw));
}
function localName(name){
 if(typeof name!=='string'||!name||/^[\/\\]|[:\\?%\x00-\x1f]/.test(name)||posix.normalize(name).startsWith('../'))throw new Error('REF: 仅允许用户提供的相对本地文件名');
 return posix.normalize(name);
}
// Resolve exclusively from text passed by the caller. The converter never sees an external ref.
export function bundleLocalRefs(main,localFiles={}){
 const docs=new Map([['',main]]);let bytes=0;
 if(!localFiles||typeof localFiles!=='object'||Array.isArray(localFiles)||Object.keys(localFiles).length>100)throw new Error('REF: 本地依赖文件最多 100 个');
 for(const [name,text]of Object.entries(localFiles)){
  const key=localName(name);if(docs.has(key)||typeof text!=='string')throw new Error('REF: 本地文件名重复或内容无效');
  bytes+=Buffer.byteLength(text);if(bytes>LIMIT)throw new Error('REF: 本地依赖文件超过 20 MB');docs.set(key,parseSpecText(text));
 }
 let visited=0;
 const inspect=(v,file='',seen=new Set())=>{
  if(!v||typeof v!=='object')return;
  if(++visited>100000)throw new Error('REF: 文档过于复杂');
  if(seen.has(v))throw new Error('REF: YAML 循环别名不受支持');seen.add(v);
  if('$ref'in v){if(typeof v.$ref!=='string')throw new Error('REF: 引用必须是字符串');const raw=v.$ref.split('#')[0];if(raw)refFile(file,raw);}
  for(const child of Object.values(v))inspect(child,file,seen);seen.delete(v);
 };
 for(const [file,doc] of docs)inspect(doc,file);
 let expanded=0;
 const resolve=(v,file='',chain=[],depth=0)=>{
  if(++expanded>100000||depth>100)throw new Error('REF: 引用展开超过限制');
  if(!v||typeof v!=='object')return v;
  if(Array.isArray(v))return v.map(c=>resolve(c,file,chain,depth+1));
  if('$ref'in v){
   const [raw,fragment='',extra]=v.$ref.split('#');if(extra!==undefined)throw new Error('REF: 无效片段');
   const target=raw?refFile(file,raw):file;
   if(!docs.has(target))throw new Error('REF: 请补充本地依赖文件 '+target);
   // Main-document internal references are safe for the official converter, including recursive schemas.
   if(!raw&&!file)return Object.fromEntries(Object.entries(v).map(([k,c])=>[k,k==='$ref'?c:resolve(c,file,chain,depth+1)]));
   const marker=target+'#'+fragment;if(chain.includes(marker))throw new Error('REF: 外部文件存在循环引用，请提供合并后的规范');
   let node=docs.get(target);
   if(fragment){if(!fragment.startsWith('/'))throw new Error('REF: 仅支持 JSON Pointer 片段');for(const part of fragment.slice(1).split('/')){const key=decodeURIComponent(part).replace(/~1/g,'/').replace(/~0/g,'~');if(!node||typeof node!=='object'||!Object.hasOwn(node,key))throw new Error('REF: 找不到引用 '+marker);node=node[key];}}
   const value=resolve(node,target,[...chain,marker],depth+1);
   const siblings=Object.fromEntries(Object.entries(v).filter(([k])=>k!=='$ref').map(([k,c])=>[k,resolve(c,file,chain,depth+1)]));
   return Object.keys(siblings).length?{...value,...siblings}:value;
  }
  return Object.fromEntries(Object.entries(v).map(([k,c])=>[k,resolve(c,file,chain,depth+1)]));
 };
 const bundled=resolve(main);
 // Resolve main refs pointing to a subtree that contained an external ref too.
 inspect(bundled);return bundled;
}
export async function importOpenApi(data,options={}){
 const bundled=bundleLocalRefs(data,options.localFiles);
 const result=await new Promise((resolve,reject)=>converter.convert({type:'json',data:bundled},{requestParametersResolution:'Example',exampleParametersResolution:'Example',schemaFaker:false},(error,value)=>error?reject(new Error('IMPORT: '+error.message)):resolve(value)));
 if(!result.result||!result.output?.[0]?.data)throw new Error('IMPORT: '+(result.reason||'OpenAPI 转换失败'));
 const collection=normalizeCollection(result.output[0].data,{imported:true});
 const addRaw=root=>{if(root.request?.url&&typeof root.request.url==='object'&&!root.request.url.raw)root.request.url.raw=new sdk.Url(root.request.url).toString();for(const item of root.item||[])addRaw(item);};addRaw(collection);
 return {kind:'collection',data:collection,warnings:['OpenAPI/Swagger 已转换为请求模板；示例、认证继承与服务器变量请在预览后检查。回调、链接、Webhook、响应校验规则不会自动执行。原始规范的厂商扩展不等同于 Postman 请求字段。']};
}
export function importHar(data){
 if(!Array.isArray(data.log?.entries)||!data.log.entries.length)throw new Error('IMPORT: HAR 不包含请求');
 const warnings=new Set(['HAR 只导入请求；响应内容、时序、缓存及浏览器连接状态不导入。Cookie/认证可能包含秘密，请检查后保存。']);
 const item=data.log.entries.map((entry,index)=>{
  const r=entry.request;if(!r||typeof r.url!=='string'||typeof r.method!=='string')throw new Error('IMPORT: HAR 请求格式无效');
  const request={method:r.method,url:r.url,header:(r.headers||[]).map(h=>({key:h.name,value:h.value}))};
  if(r.cookies?.length&&!request.header.some(h=>h.key.toLowerCase()==='cookie'))request.header.push({key:'Cookie',value:r.cookies.map(c=>c.name+'='+c.value).join('; ')});
  const body=r.postData;
  if(body){
   if(body.mimeType&&!request.header.some(h=>h.key.toLowerCase()==='content-type'))request.header.push({key:'Content-Type',value:body.mimeType});
   if(typeof body.text==='string')request.body={mode:'raw',raw:body.text};
   else if(Array.isArray(body.params)){
    if(body.params.some(p=>p.fileName))throw new Error('UNSUPPORTED: HAR 文件上传不含文件内容，请重新选择本地附件');
    const mode=body.mimeType?.startsWith('multipart/form-data')?'formdata':'urlencoded';
    request.body={mode,[mode]:body.params.map(p=>({key:p.name,value:p.value??'',...(mode==='formdata'?{type:'text'}:{})}))};
    if(mode==='formdata')request.header=request.header.filter(h=>h.key.toLowerCase()!=='content-type');
   }else warnings.add('HAR postData 未包含可重放的 text/params，请补充请求体。');
  }
  return {name:`${index+1}. ${r.method} ${r.url}`,request};
 });
 return {kind:'collection',data:normalizeCollection({info:{name:'HAR 导入'},item},{imported:true}),warnings:[...warnings]};
}

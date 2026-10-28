import {authProblem} from './auth.mjs';
import {parseSpecText,importOpenApi,importHar} from './spec-import.mjs';
import { parse as shellParse } from 'shell-quote';
import { parse as csvParse } from 'csv-parse/sync';
import { normalizeCollection } from './collections.mjs';
import {WORKSPACE_FORMAT,TRANSFER_LIMIT,parseWorkspace} from './workspace-transfer.mjs';

export function warningsFor(value) {
  const warnings = new Set();
  function visit(v) {
    if (!v || typeof v !== 'object') return;
    if (v.auth?.type && authProblem(v.auth)) warnings.add(authProblem(v.auth));
    if (v.script) {
      const script = [].concat(v.script.exec || []).join('\n');
      if (/pm\.(vault|require)\b/.test(script)) warnings.add('脚本使用 Vault 或云脚本包，首版不支持');
    }
    if (v.request?.url && /^(ws|wss|grpc):/i.test(typeof v.request.url === 'string' ? v.request.url : v.request.url.raw || '')) warnings.add('只支持 HTTP/HTTPS 协议');
    for (const child of Object.values(v)) if (typeof child === 'object') visit(child);
  }
  visit(value); return [...warnings];
}
export function importDocument(text,options={}) {
  if(Buffer.byteLength(text,'utf8')>TRANSFER_LIMIT)throw new Error('IMPORT: 文件超过 20 MB');
  text = text.trim();
  if (text.startsWith('curl ')) return { kind: 'collection', data: normalizeCollection({ info: { name: 'cURL 导入' }, item: [curlRequest(text)] },{imported:true}), warnings: [] };
  const data = parseSpecText(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('IMPORT: 需要集合或环境对象');
  if(data.format===WORKSPACE_FORMAT)return parseWorkspace(data);
  if (data.info && Array.isArray(data.item)) {
    if (data.info.schema && !/collection\/v2\.1\.0\//.test(data.info.schema)) throw new Error('IMPORT: 只支持 Postman Collection v2.1');
    return { kind: 'collection', data: normalizeCollection(data,{imported:true}), warnings: [...warningsFor(data),...folderWarnings(data)] };
  }
  if (Array.isArray(data.values)) return { kind: 'environment', data, warnings: [] };
  // Existing formats own their discriminators, even when unknown fields resemble another format.
  const openapiVersion = typeof data.openapi === 'string' && /^3\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(data.openapi);
  if (openapiVersion || data.swagger === '2.0') return importOpenApi(data,options).then(result=>({...result,warnings:[...result.warnings,...warningsFor(result.data)]}));
  const harLog = data.log && typeof data.log === 'object' && !Array.isArray(data.log)
    && Array.isArray(data.log.entries) && (data.log.version === undefined || ['1.1','1.2'].includes(data.log.version));
  if (harLog) return importHar(data);
  throw new Error('IMPORT: 无法识别 Postman Collection v2.1、环境、OpenAPI/Swagger 或 HAR 文件');
}
function curlRequest(text) {
  const tokens = shellParse(text.replace(/\\\r?\n/g, ' '), key => '$' + key);
  if (tokens.some(t => typeof t !== 'string')) throw new Error('SHELL: 不允许管道、重定向或复合命令');
  const req = { method: 'GET', url: '', header: [] };
  let explicitMethod = false, getData = false;
  const body = [];
  for (let i = 1; i < tokens.length; i++) {
    let t = tokens[i], val;
    if(/^-[XHudAebF].+/.test(t)){val=t.slice(2);t=t.slice(0,2);}
    if (t.startsWith('--') && t.includes('=')) { const at = t.indexOf('='); val = t.slice(at+1); t = t.slice(0,at); }
    const next = () => { const v = val ?? tokens[++i]; if (v === undefined) throw new Error('IMPORT: 参数缺少值'); return v; };
    if (t === '-X' || t === '--request') { req.method = next().toUpperCase(); explicitMethod = true; }
    else if(t==='-G'||t==='--get')getData=true;
    else if(t==='-A'||t==='--user-agent')req.header.push({key:'User-Agent',value:next()});
    else if(t==='-e'||t==='--referer'){const value=next();if(value.endsWith(';auto'))throw new Error('UNSUPPORTED: cURL 自动 Referer');req.header.push({key:'Referer',value});}
    else if(t==='--data-urlencode'){const value=next(),at=value.indexOf('=');if((at<0&&value.includes('@'))||value.startsWith('@'))throw new Error('UNSUPPORTED: cURL data-urlencode 文件读取');body.push(at<0?encodeURIComponent(value):value.slice(0,at)+'='+encodeURIComponent(value.slice(at+1)));if(!explicitMethod)req.method='POST';}
    else if (t === '--url') req.url = next();
    else if (t === '-H' || t === '--header') { const h = next(), at = h.indexOf(':'); if (at < 1) throw new Error('IMPORT: Header 格式错误'); req.header.push({ key: h.slice(0,at), value: h.slice(at+1).trim() }); }
    else if (t === '-u' || t === '--user') { const [username, ...password] = next().split(':'); req.auth = { type: 'basic', basic: [{ key: 'username', value: username }, { key: 'password', value: password.join(':') }] }; }
    else if (['-d','--data','--data-raw','--data-binary','--json'].includes(t)) {
      const v = next();
      if (t !== '--data-raw' && v.startsWith('@')) req.body = { mode: 'file', file: { src: v.slice(1) } };
      else body.push(v);
      if (t === '--json') req.header.push({ key:'Content-Type', value:'application/json' },{key:'Accept',value:'application/json'});
      if (!explicitMethod) req.method = 'POST';
    }
    else if (t === '-F' || t === '--form') {
      const v = next(), at = v.indexOf('='); if (at < 1) throw new Error('IMPORT: 表单格式错误');
      req.body ||= { mode: 'formdata', formdata: [] };
      if (req.body.mode !== 'formdata') throw new Error('IMPORT: 不允许混合请求体');
      const key = v.slice(0,at), value = v.slice(at+1);
      if(/;(type|filename)=/.test(value)||value.startsWith('<'))throw new Error('UNSUPPORTED: cURL form 特殊元数据');
      req.body.formdata.push(value.startsWith('@') ? { key, type: 'file', src: value.slice(1) } : { key, type: 'text', value });
      if (!explicitMethod) req.method = 'POST';
    }
    else if (t === '-b' || t === '--cookie') {const cookie=next();if(!cookie.includes('='))throw new Error('UNSUPPORTED: cURL Cookie 文件');req.header.push({key:'Cookie',value:cookie});}
    else if (t === '-I' || t === '--head') { req.method = 'HEAD'; explicitMethod = true; }
    else if (!['-s','--silent','-S','--show-error'].includes(t)) {
      if (t.startsWith('-')) throw new Error(`UNSUPPORTED: cURL 参数 ${t}`);
      if (req.url) throw new Error('IMPORT: 只支持单个 URL'); req.url = t;
    }
  }
  if(!req.url)throw new Error('IMPORT: 缺少 URL');
  if(getData){if(req.body)throw new Error('UNSUPPORTED: cURL GET 文件或表单请求体');if(body.length){const hash=req.url.indexOf('#'),fragment=hash<0?'':req.url.slice(hash);if(hash>=0)req.url=req.url.slice(0,hash);req.url+=(req.url.includes('?')?'&':'?')+body.join('&')+fragment;body.length=0;}if(!explicitMethod)req.method='GET';}
  if (body.length) { if (req.body) throw new Error('IMPORT: 不允许混合请求体'); req.body = { mode: 'raw', raw: body.join('&') }; }
  if(req.body&&req.body.mode!=='formdata'&&!req.header.some(h=>h.key.toLowerCase()==='content-type'))req.header.push({key:'Content-Type',value:'application/x-www-form-urlencoded'});
  if (!req.url) throw new Error('IMPORT: 缺少 URL');
  return { name: req.url, request: req };
}
export function exportCurl(item, inheritedAuth) {
  const r = item.request, auth=r.auth||inheritedAuth;
  let url=typeof r.url === 'string' ? r.url : r.url.raw || '';
  const headers=(r.header||[]).filter(h=>!h.disabled).map(h=>({...h}));
  const attrs=Object.fromEntries((auth?.[auth.type]||[]).map(v=>[v.key,v.value]));
  const parts = ['curl', '-X', r.method || 'GET'];
  if(auth?.type==='basic')parts.push('--user',`${attrs.username||''}:${attrs.password||''}`);
  if(auth?.type==='bearer')headers.push({key:'Authorization',value:'Bearer '+(attrs.token||'')});
  if(auth?.type==='apikey') {
    if(attrs.in==='query')url+=(url.includes('?')?'&':'?')+encodeURIComponent(attrs.key||'')+'='+encodeURIComponent(attrs.value||'');
    else headers.push({key:attrs.key||'',value:attrs.value||''});
  }
  if(auth?.type&&!['noauth','basic','bearer','apikey'].includes(auth.type))throw new Error('UNSUPPORTED: cURL 无法导出此认证');
  parts.push(url);
  const language=r.body?.options?.raw?.language;
  const contentType=r.body?.mode==='urlencoded'?'application/x-www-form-urlencoded':({json:'application/json',xml:'application/xml',text:'text/plain',html:'text/html',javascript:'application/javascript'})[language];
  if(contentType&&!headers.some(h=>h.key.toLowerCase()==='content-type'))headers.push({key:'Content-Type',value:contentType});
  for (const h of headers) parts.push('-H', `${h.key}: ${h.value}`);
  if(r.body?.mode==='graphql'){
    const g=r.body.graphql||{};let variables=g.variables;try{if(typeof variables==='string')variables=JSON.parse(variables||'{}');}catch{throw new Error('GRAPHQL: cURL 导出需要有效变量 JSON');}
    if(!headers.some(h=>h.key.toLowerCase()==='content-type'))parts.push('-H','Content-Type: application/json');
    parts.push('--data-raw',JSON.stringify({query:g.query||'',variables:variables||{},...(g.operationName?{operationName:g.operationName}:{})}));
  }
  if (r.body?.mode === 'raw') parts.push('--data-raw', r.body.raw || '');
  if (r.body?.mode === 'urlencoded') parts.push('--data-raw', (r.body.urlencoded || []).filter(v=>!v.disabled).map(v=>`${encodeURIComponent(v.key)}=${encodeURIComponent(v.value)}`).join('&'));
  if (r.body?.mode === 'file') parts.push('--data-binary', '@'+r.body.file.src);
  for (const f of r.body?.formdata || []) if (!f.disabled) parts.push('-F', `${f.key}=${f.type === 'file' ? '@'+f.src : f.value}`);
  return 'curl '+parts.slice(1).map(v=>"'"+String(v).replaceAll("'","'\\''")+"'").join(' ');
}
export function parseData(text, format = 'json') {
  const rows = !text?.trim() ? [] : format === 'csv' ? csvParse(text, { columns: true, skip_empty_lines: true, bom: true }) : JSON.parse(text);
  if (!Array.isArray(rows) || rows.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw new Error('DATA: 运行数据必须是对象数组');
  return rows;
}

function folderWarnings(data){const check=root=>(root.item||[]).some(i=>i.item&&((i.variable||[]).length||check(i)));return check(data)?['集合包含文件夹变量：严格模式忽略这些变量；扩展模式将它们作为临时变量，优先于运行数据。']:[];}

import runtime from 'postman-runtime';
import sdk from 'postman-collection';
import request from 'postman-request';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { realpathSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { CookieJar } = require('@postman/tough-cookie');
const errorJSON = err => err ? { name: err.name || 'Error', message: err.message || String(err) } : undefined;
const send = (type, value) => { if (process.connected) process.send({ type, value }); };
process.on('uncaughtException', error => { send('error', errorJSON(error)); send('done', { status: 'failed' }); });

process.once('message', input => {
  try { run(input); } catch (error) { send('error', errorJSON(error)); send('done',{status:'failed'}); }
});

function run({ collection, environment = {}, globals = {}, cookies, data = [], options = {}, secretKeys = {} }) {
  // Postman v2.1 has no native folder-variable scope. Expose our folder variables
  // as temporary variables, restoring the previous local scope between items.
  const folderScopes={};
  const visitScopes=(root,inherited=[])=>{
    const scope=root.item&&root!==collection?[...inherited,...(root.variable||[])]:inherited;
    for(const item of root.item||[])if(item.item)visitScopes(item,scope);else folderScopes[item.id]=scope;
  };
  visitScopes(collection);
  if(Object.values(folderScopes).some(v=>v.length)){
    collection=structuredClone(collection);
    collection.event=[{listen:'prerequest',script:{type:'text/javascript',exec:[
      `const __scopes=${JSON.stringify(folderScopes)};`,
      'const __slot="__codex_api_client_folder_scope";',
      'const __prior=pm.variables.get(__slot)||{};',
      'Object.keys(__prior).forEach(k=>{if(__prior[k].exists)pm.variables.set(k,__prior[k].value);else pm.variables.unset(k);});',
      'const __saved={};',
      'const __locals=Object.fromEntries((pm.variables.toJSON().values||[]).filter(v=>!v.disabled).map(v=>[v.key,v.value]));',
      '(__scopes[pm.info.requestId]||[]).filter(v=>!v.disabled).forEach(v=>{if(!Object.prototype.hasOwnProperty.call(__saved,v.key))__saved[v.key]={exists:Object.prototype.hasOwnProperty.call(__locals,v.key),value:__locals[v.key]};pm.variables.set(v.key,pm.variables.replaceIn(String(v.value??"")));});',
      'pm.variables.set(__slot,__saved);'
    ]}},...(collection.event||[])];
  }
  const c = new sdk.Collection(collection), env = new sdk.VariableScope(environment), globalScope = new sdk.VariableScope(globals);
  const jar = cookies?.cookies ? CookieJar.deserializeSync(cookies) : request.jar();
  jar.allowProgrammaticAccess = () => true;
  const allowed = new Set((options.allowedFiles || []).map(p => realpathSync(p)));
  const permit = p => {
    if (!allowed.has(realpathSync(p))) throw new Error('FILE_ACCESS: 请先选择文件或在 allowedFiles 中明确允许该路径');
  };
  const checkFiles = root => {
    if (!root.request?.body?.disabled && root.request?.body?.mode === 'file' && root.request.body.file?.src) permit(root.request.body.file.src);
    for (const field of !root.request?.body?.disabled && root.request?.body?.mode === 'formdata' ? root.request.body.formdata || [] : []) if (field.type === 'file' && !field.disabled && field.src) {
      for (const path of [].concat(field.src)) permit(path);
    }
    for (const item of root.item || []) checkFiles(item);
  };
  checkFiles(collection);
  const fileResolver = {
    stat(path, cb) { try { permit(path); fs.stat(path, cb); } catch (error) { cb(error); } },
    readFile(path, ...args) { try { permit(path); fs.readFile(path, ...args); } catch (error) { args.at(-1)(error); } },
    createReadStream(path, ...args) { permit(path); return fs.createReadStream(path, ...args); },
  };
  let hasErrors = false;
  const reportError = (error, cursor, item) => {
    if (error) { hasErrors = true; send('error', { ...errorJSON(error), cursor, itemId:item?.id }); }
  };
  const scriptsDone = (error, cursor, results, item) => {
    reportError(error, cursor, item);
    for (const r of results || []) {
      reportError(r.error, cursor, item);
      const values=[];
      for(const [scope,keys]of Object.entries(secretKeys))for(const key of keys){const value=r.result?.[scope]?.get?.(key);if(value!==undefined)values.push(String(value));}
      if(values.length)send('secrets',values);
    }
  };
  const config = {
    timeout: { request: options.requestTimeout ?? 30000, script: options.scriptTimeout ?? 5000 },
    environment: env, globals: globalScope,
    data, iterationCount: options.iterations ?? Math.max(1,data.length),
    delay: { item: options.delay ?? 0 },
    stopOnFailure: options.stopOnFailure ?? false,
    fileResolver,
    requester: {
      cookieJar:jar, strictSSL: options.strictSSL !== false,
      followRedirects: options.followRedirects !== false, maxRedirects:10,
      maxResponseSize: options.maxResponseSize ?? 10*1024*1024,
      extendedRootCA:options.caFile,
      implicitTraceHeader:false, implicitCacheControl:false,
    },
    certificates: new sdk.CertificateList({}, options.certificates || []),
    proxies: new sdk.ProxyConfigList({}, options.proxy ? [{match:'http+https://*:*/*',host:new URL(options.proxy).hostname,port:Number(new URL(options.proxy).port)||8080,tunnel:true}] : []),
  };
  if (options.caFile) permit(options.caFile);
  new runtime.Runner().run(c, config, (error, active) => {
    if (error) { reportError(error); return send('done',{status:'failed'}); }
    active.start({
      beforeItem(error,cursor,item) { reportError(error,cursor,item); send('progress',{cursor,itemId:item.id,name:item.name}); },
      prerequest:scriptsDone, test:scriptsDone,
      exception(cursor,error) { reportError(error,cursor); },
      assertion(cursor,assertions) {
        for (const a of assertions) {if(a.error)hasErrors=true;send('assertion',{ name:a.name, skipped:a.skipped, error:errorJSON(a.error), cursor });}
      },
      console(cursor,level,...messages) { send('log',{cursor,level,messages}); },
      request(error,cursor,response,sent,item,cookies) {
        reportError(error,cursor,item);
        if (response) send('response', {
          itemId:item?.id, name:item?.name, cursor, code:response.code, status:response.status,
          time:response.responseTime, size:response.size(), headers:response.headers.toJSON(),
          cookies:(cookies || []).map(v=>v.toJSON?.()||v),
          body:response.stream?.toString('utf8') || response.text(),
          bodyBase64:response.stream?.toString('base64') || '',
          request:{method:sent.method,url:sent.url.toString(),headers:sent.headers.toJSON()},
        });
      },
      done(error) {
        reportError(error);
        send('done',{
          status:hasErrors?'failed':'completed',environment:env.toJSON(),globals:globalScope.toJSON(),
          collectionVariables:c.variables.toJSON(), cookies:jar.serializeSync(),
        });
      },
    });
  });
}

import {materializeNetwork,networkOf,authProblem,validateOptions} from './auth.mjs';
import {compatibilityMode,findItem,selectCollection} from './collections.mjs';
import runtime from 'postman-runtime';
import {javascriptLanguage} from '@codemirror/lang-javascript';
import sdk from 'postman-collection';
import request from 'postman-request';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import { realpathSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { CookieJar } = require('@postman/tough-cookie');
const errorJSON = err => err ? { name: err.name || 'Error', message: err.message || String(err) } : undefined;
const send = (type, value) => { if (process.connected) process.send({ type, value }); };
process.on('uncaughtException', error => { send('error', errorJSON(error)); send('done', { status: 'failed' }); });

process.once('message', input => {
  try { run(input); } catch (error) { send('error', errorJSON(error)); send('done',{status:'failed'}); }
});

function run({ collection, environment = {}, globals = {}, cookies, data = [], options = {}, secretKeys = {}, collectionSecretKeys = {}, workspace = [] }) {
  collection.info={...collection.info,_postman_id:collection.info?._postman_id||randomUUID()};
  workspace=workspace.map(v=>({...v,info:{...v.info,_postman_id:v.info?._postman_id||randomUUID()}}));
  const prepareScopes=input=>{
    let collection=structuredClone(input);
    const profiles=root=>{if(root.request){const network=networkOf(root);for(const key of ['strictSSL','followRedirects'])if(network[key]!==undefined)root.protocolProfileBehavior={...root.protocolProfileBehavior,[key]:network[key]};}for(const child of root.item||[])profiles(child);};profiles(collection);
    // Postman v2.1 has no native folder-variable scope. Expose our folder variables
    // as temporary variables, restoring the previous local scope between items.
    const folderScopes={};
    const visitScopes=(root,inherited=[])=>{
      const scope=root.item&&root!==collection?[...inherited,...(root.variable||[])]:inherited;
      for(const item of root.item||[])if(item.item)visitScopes(item,scope);else folderScopes[item.id]=scope;
    };
    if(compatibilityMode(collection)==='extended')visitScopes(collection);
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
    return collection;
  };
  collection=prepareScopes(collection);
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
    }
  };
  const preparedScripts=new WeakSet();
  const prepareScript=script=>{
    if(preparedScripts.has(script))return;
    const source=script.toSource()||'';
    let offset=0;
    // Keep directive prologues (including strict mode) and hashbangs intact.
    for(let node=javascriptLanguage.parser.parse(source).topNode.firstChild;node;node=node.nextSibling){
      if(['LineComment','BlockComment','Hashbang'].includes(node.name)){offset=node.to;continue;}
      if(node.name!=='ExpressionStatement'||node.firstChild?.name!=='String')break;
      offset=node.to;
    }
    const prelude=';[pm.environment,pm.globals,pm.collectionVariables].forEach(scope=>{scope.mutations.autoCompact=false;});';
    script.exec=[source.slice(0,offset)+'\n'+prelude+'\n'+source.slice(offset)];
    preparedScripts.add(script);
  };
  const sensitiveCollectionKeys=new Set(secretKeys.collectionVariables||[]);
  const captureSecrets=result=>{
    const values=[];
    for(const [scope,keys]of Object.entries({...secretKeys,collectionVariables:[...sensitiveCollectionKeys]})){
      for(const key of keys){const value=result?.[scope]?.get?.(key);if(value!==undefined)values.push(String(value));}
      result?.[scope]?.mutations?.applyOn({applyMutation(operation,key,value){if(keys.includes(key)&&value!==undefined)values.push(String(value));}});
    }
    if(values.length)send('secrets',values);
  };
  const proxiesFor=o=>new sdk.ProxyConfigList({},o.proxy?[{match:'http+https://*:*/*',host:new URL(o.proxy).hostname,port:Number(new URL(o.proxy).port)||80,protocol:'http',tunnel:true,authenticate:!!(o.proxyUsername||o.proxyPassword),username:o.proxyUsername,password:o.proxyPassword,bypass:o.noProxy||[]}]:[]);
  let nestedCalls=0;
  const home=workspace.find(v=>collection.info?._postman_id&&v.info?._postman_id===collection.info?._postman_id)||collection;
  const resolverFor=current=>function(id,context,cb){
      try{
        if(++nestedCalls>20)throw Error('RUN_REQUEST_CALL_LIMIT: 最多 20 次嵌套调用');
        const own=findItem(current,id)?.item.request?current:null;
        const matches=own?[own]:workspace.filter(v=>findItem(v,id)?.item.request);
        if(matches.length!==1)throw Error(matches.length?'RUN_REQUEST_AMBIGUOUS: 请求 ID 存在多个副本':'RUN_REQUEST_NOT_FOUND: 工作区请求不存在');
        const selected=prepareScopes(selectCollection(matches[0],id));
        const inspect=root=>{if(root.request)validateOptions({...options,...networkOf(root)});if(root.request?.['x-codex-api-client']?.protocol)throw Error('PROTOCOL_RUN_UNSUPPORTED');for(const child of root.item||[])inspect(child);};inspect(selected);checkFiles(selected);
        cb(null,selected);
      }catch(error){cb(error);}
    };
  const config = {
    maxInvokableNestedRequests:4,
    script:{requestResolver:resolverFor(home)},
    disableSNR: options.singleRequest === true,
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
    proxies: proxiesFor(options),ignoreProxyEnvironmentVariables:true,
  };
  if (options.caFile) permit(options.caFile);
  // Worker-local native seam: nested Run.start does not inherit root lifecycle hooks.
  const nativeRun=runtime.Runner.prototype.run;
  runtime.Runner.prototype.run=function(source,runOptions,callback){
    const raw=source.toJSON(),original=[home,...workspace].find(v=>v.info._postman_id===raw.info._postman_id)||raw;
    // Native nested scopes propagate mutations back; retain sensitivity from every executed collection.
    for(const key of collectionSecretKeys[original.info._postman_id]||[])sensitiveCollectionKeys.add(key);
    return nativeRun.call(this,source,{...runOptions,script:{...runOptions.script,requestResolver:resolverFor(original)},requester:{...runOptions.requester}},(error,active)=>{
      if(error)return callback(error);
      active.options={...active.options};
      let baseRequester;
      const nativeStart=active.start;
      active.start=function(callbacks){
        return nativeStart.call(this,{...callbacks,
          beforeScript(error,cursor,script,...rest){
            prepareScript(script);
            send('scriptStart',{id:script._lastExecutionId});
            callbacks.beforeScript?.(error,cursor,script,...rest);
          },
          script(error,cursor,result,script,...rest){
            captureSecrets(result);
            // Missing scope snapshots cannot certify that dynamic values were captured.
            if(result?.collectionVariables&&result?.environment&&result?.globals)send('scriptEnd',{id:script._lastExecutionId});
            callbacks.script?.(error,cursor,result,script,...rest);
          },
          item(error,cursor,item,visualizer,...rest){
            if(visualizer?.error)reportError(visualizer.error,cursor,item);
            if(visualizer?.processedTemplate)send('visualizer',{itemId:item.id,html:visualizer.processedTemplate});
            callbacks.item?.(error,cursor,item,visualizer,...rest);
          },
          beforeItem(error,cursor,item){
            try{
              if(!baseRequester){active.requester.options={...active.requester.options};baseRequester={...active.requester.options};}
              const o=materializeNetwork({...options,...networkOf(findItem(original,item.id)?.item)});
              if(o.caFile)permit(o.caFile);
              for(const cert of o.certificates||[])for(const field of ['cert','key','pfx'])if(cert[field]?.src)permit(cert[field].src);
              active.options.proxies=proxiesFor(o);active.options.certificates=new sdk.CertificateList({},o.certificates||[]);
              Object.assign(active.requester.options,baseRequester,{timeout:o.requestTimeout,strictSSL:o.strictSSL!==false,followRedirects:o.followRedirects!==false,ignoreProxyEnvironmentVariables:true,extendedRootCA:o.caFile?fs.readFileSync(o.caFile):undefined});
            }catch(problem){throw problem;}
            callbacks.beforeItem?.(error,cursor,item);
          },
          beforeRequest(error,cursor,sent,item,aborter){
            const problem=authProblem(sent.auth?.toJSON?.());
            if(problem){reportError(new Error(problem),cursor,item);aborter.abort();return;}
            callbacks.beforeRequest?.(error,cursor,sent,item,aborter);
          }
        });
      };
      callback(null,active);
    });
  };
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
        const auth=sent?.auth?.toJSON?.(),type=auth?.type,params=Object.fromEntries((auth?.[type]||[]).map(v=>[v.key,v.value]));
        const secretQuery=type==='jwt'?[params.queryParamKey||'token']:type==='oauth2'?['access_token']:type==='apikey'&&params.in==='query'?[params.key]:type==='awsv4'?['X-Amz-Signature','X-Amz-Security-Token']:type==='oauth1'?['oauth_signature','oauth_token']:[];
        const querySecrets=secretQuery.map(key=>sent.url.query.get(key)).filter(Boolean);if(querySecrets.length)send('secrets',querySecrets);
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
          collectionVariables:c.variables.toJSON().map(v=>sensitiveCollectionKeys.has(v.key)?{...v,type:'secret'}:v), cookies:jar.serializeSync(),
        });
      },
    });
  });
}

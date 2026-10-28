import grpc from '@grpc/grpc-js';
import loader from '@grpc/proto-loader';
import protobuf from 'protobufjs';
import {GrpcReflection} from 'grpc-js-reflection-client';
import {posix} from 'node:path';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const options={keepCase:true,longs:String,enums:String,defaults:true,oneofs:true};
// Parse only the uploaded logical file map: protobuf never gets a filesystem fetcher.
export function grpcDefinition(files,entry){
 const root=new protobuf.Root(),loaded=new Set();
 const visit=name=>{if(loaded.has(name))return;if(!files.has(name))throw Error('PROTOCOL_PROTO_DEPENDENCY_MISSING');loaded.add(name);const parsed=protobuf.parse(files.get(name),root,{keepCase:true});for(const dependency of [...parsed.imports||[],...parsed.weakImports||[]]){const sibling=posix.normalize(posix.join(posix.dirname(name),dependency));visit(files.has(dependency)?dependency:sibling);}};
 try{visit(entry);root.resolveAll();return root.toJSON();}catch{throw Error('PROTOCOL_PROTO_INVALID: 文件或依赖缺失');}
}
const metadataOf=c=>{const m=new grpc.Metadata();for(const [key,value]of Object.entries(c.headers||{}))m.set(key.toLowerCase(),String(value));for(const row of c.metadata||[])if(!row.disabled)m.set(row.key,row.key.endsWith('-bin')?Buffer.from(row.value,'base64'):String(row.value));return m;};
export function grpcAdapterCore(c,h){
 const address=new URL(c.url).host,secure=new URL(c.url).protocol==='grpcs:';
 const credentials=secure?grpc.credentials.createSsl(c.tlsBytes?.ca,c.tlsBytes?.key,c.tlsBytes?.cert):grpc.credentials.createInsecure();
 let stopped=false;
 const channelOptions={'grpc.max_receive_message_length':1024*1024,'grpc.max_send_message_length':1024*1024,'grpc.enable_http_proxy':0,'grpc.enable_retries':0,'grpc.use_local_subchannel_pool':1};
 const client=new grpc.Client(address,credentials,channelOptions),metadata=metadataOf(c);let reflection,call,current,serial=0;
 const close=()=>{if(stopped)return;stopped=true;call?.cancel();client.close();reflection?.client?.close();};h.signal.addEventListener('abort',close,{once:true});
 const definitions=new Map();
 (async()=>{let definition=c.definition?loader.fromJSON(c.definition,options):undefined;if(c.reflection){reflection=new GrpcReflection(address,credentials,channelOptions);
  // shortcut: pinned reflection client 1.4.1 private channel; revisit when public close is added.
  if(typeof reflection.client?.close!=='function')throw Error('PROTOCOL_REFLECTION_CLEANUP_UNSUPPORTED');const services=await reflection.listServices('*',metadata,{deadline:Date.now()+(c.connectTimeout||30000)});definition={};for(const service of services.filter(s=>!s.startsWith('grpc.reflection.'))){if(stopped)return;Object.assign(definition,(await reflection.getDescriptorBySymbol(service,metadata,{deadline:Date.now()+(c.connectTimeout||30000)})).getPackageDefinition(options));}reflection.client?.close();}
  if(stopped)return;for(const value of Object.values(definition||{}))if(value&&typeof value==='object')for(const method of Object.values(value))if(method?.path&&method.requestSerialize)definitions.set(method.path,method);
  if(!definitions.size)throw Error();await new Promise((res,rej)=>client.waitForReady(Date.now()+(c.connectTimeout||30000),e=>e?rej(e):res()));if(stopped)return;
  h.emit('methods',[...definitions.values()].map(m=>({path:m.path,requestStream:m.requestStream,responseStream:m.responseStream,requestType:{format:m.requestType.format,type:m.requestType.type},responseType:{format:m.responseType.format,type:m.responseType.type}})));h.open();
 })().catch(()=>{if(!stopped)h.fail('PROTOCOL_GRPC_CONNECT_FAILED');});
 return {close,async action(action,p={}){
  if(action==='cancel'){call?.cancel();call=null;current=null;return;}
  if(action==='write'||action==='end'){if(!call||!current?.requestStream)throw Error('PROTOCOL_GRPC_NO_WRITABLE_STREAM');if(action==='end'){call.end();return;}if(!p.message||typeof p.message!=='object'||Array.isArray(p.message))throw Error('PROTOCOL_PAYLOAD_INVALID');if(call.writableLength>=16)throw Error('PROTOCOL_QUEUE_LIMIT');call.write(p.message);return;}
  if(action!=='call')throw Error('PROTOCOL_ACTION_UNSUPPORTED');if(call)throw Error('PROTOCOL_GRPC_CALL_ACTIVE');const m=definitions.get(p.method);if(!m)throw Error('PROTOCOL_GRPC_METHOD_INVALID');if(!m.requestStream&&(!p.message||typeof p.message!=='object'||Array.isArray(p.message)))throw Error('PROTOCOL_PAYLOAD_INVALID');
  const id=++serial,opts={deadline:Date.now()+(c.operationTimeout||5000)},result=(error,message)=>{if(error)h.emit('rpcError',{id,code:error.code});else h.emit('message',{id,message});};let rpc;
  if(m.requestStream&&m.responseStream)rpc=client.makeBidiStreamRequest(m.path,m.requestSerialize,m.responseDeserialize,metadata,opts);
  else if(m.requestStream)rpc=client.makeClientStreamRequest(m.path,m.requestSerialize,m.responseDeserialize,metadata,opts,result);
  else if(m.responseStream)rpc=client.makeServerStreamRequest(m.path,m.requestSerialize,m.responseDeserialize,p.message,metadata,opts);
  else rpc=client.makeUnaryRequest(m.path,m.requestSerialize,m.responseDeserialize,p.message,metadata,opts,result);
  call=rpc;current=m;rpc.on('metadata',v=>h.emit('metadata',{id,values:v.getMap()}));rpc.on('status',status=>{h.emit('rpcStatus',{id,code:status.code,metadata:status.metadata.getMap()});if(call===rpc){call=null;current=null;}});rpc.on('error',e=>h.emit('rpcError',{id,code:e.code}));if(m.responseStream)rpc.on('data',message=>h.emit('message',{id,message}));h.emit('call',{id,method:m.path});
 }};
}

// A fixed owned process makes even grpc-js pre-connect sockets cancellable.
export function grpcAdapter(c,h){
 const child=fork(fileURLToPath(new URL('./protocol-grpc-worker.mjs',import.meta.url)),[],{serialization:'advanced',execArgv:['--max-old-space-size=128'],env:Object.fromEntries(['PATH','HOME','TMPDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),stdio:['ignore','ignore','ignore','ipc']});
 let stopped=false,serial=0,closing;const pending=new Map();
 const exited=new Promise(resolve=>child.once('close',resolve));
 const close=()=>{if(stopped)return closing;stopped=true;for(const {reject,timer}of pending.values()){clearTimeout(timer);reject(Error('PROTOCOL_CANCELLED'));}pending.clear();child.kill('SIGKILL');closing=exited;return closing;};
 h.signal.addEventListener('abort',close,{once:true});
 child.on('error',()=>{if(!stopped)h.fail('PROTOCOL_GRPC_WORKER_FAILED');});child.on('exit',()=>{if(!stopped)h.fail('PROTOCOL_GRPC_WORKER_EXIT');});
 child.on('message',message=>{if(stopped)return;if(message.kind==='event'){h.emit(message.type,message.data);return;}if(message.kind==='open'){h.open();return;}if(message.kind==='fail'){h.fail('PROTOCOL_GRPC_CONNECT_FAILED');return;}if(message.kind==='reply'){const operation=pending.get(message.id);if(!operation)return;pending.delete(message.id);clearTimeout(operation.timer);message.error?operation.reject(Error(/^PROTOCOL_[A-Z_]+$/.test(message.error)?message.error:'PROTOCOL_GRPC_OPERATION_FAILED')):operation.resolve();}});
 child.send({kind:'connect',config:{...c,secrets:undefined}},error=>{if(error&&!stopped)h.fail('PROTOCOL_GRPC_WORKER_FAILED');});
 return {pid:child.pid,close,action(action,payload){if(stopped)return Promise.reject(Error('PROTOCOL_CANCELLED'));if(pending.size>=16)return Promise.reject(Error('PROTOCOL_QUEUE_LIMIT'));return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('PROTOCOL_OPERATION_TIMEOUT'));h.fail('PROTOCOL_OPERATION_TIMEOUT');},c.operationTimeout||5000);pending.set(id,{resolve,reject,timer});child.send({kind:'action',id,action,payload},error=>{if(error&&!stopped)h.fail('PROTOCOL_GRPC_WORKER_FAILED');});});}};
}

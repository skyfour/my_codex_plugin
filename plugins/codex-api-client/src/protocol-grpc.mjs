import grpc from '@grpc/grpc-js';
import loader from '@grpc/proto-loader';
import protobuf from 'protobufjs';
import {GrpcReflection} from 'grpc-js-reflection-client';
import {posix} from 'node:path';
const options={keepCase:true,longs:String,enums:String,defaults:true,oneofs:true};
// Parse only the uploaded logical file map: protobuf never gets a filesystem fetcher.
export function grpcDefinition(files,entry){
 const root=new protobuf.Root(),loaded=new Set();
 const visit=name=>{if(loaded.has(name))return;if(!files.has(name))throw Error('PROTOCOL_PROTO_DEPENDENCY_MISSING');loaded.add(name);const parsed=protobuf.parse(files.get(name),root,{keepCase:true});for(const dependency of [...parsed.imports||[],...parsed.weakImports||[]]){const sibling=posix.normalize(posix.join(posix.dirname(name),dependency));visit(files.has(dependency)?dependency:sibling);}};
 try{visit(entry);root.resolveAll();return loader.fromJSON(root.toJSON(),options);}catch{throw Error('PROTOCOL_PROTO_INVALID: 文件或依赖缺失');}
}
const metadataOf=c=>{const m=new grpc.Metadata();for(const [key,value]of Object.entries(c.headers||{}))m.set(key.toLowerCase(),String(value));for(const row of c.metadata||[])if(!row.disabled)m.set(row.key,row.key.endsWith('-bin')?Buffer.from(row.value,'base64'):String(row.value));return m;};
export function grpcAdapter(c,h){
 const address=new URL(c.url).host,secure=new URL(c.url).protocol==='grpcs:';
 const credentials=secure?grpc.credentials.createSsl(c.tlsBytes?.ca,c.tlsBytes?.key,c.tlsBytes?.cert):grpc.credentials.createInsecure();
 const sockets=new Set();let stopped=false;
 const capture=socket=>{if(!socket||typeof socket.destroy!=='function')throw Error('PROTOCOL_GRPC_CLEANUP_UNSUPPORTED');sockets.add(socket);socket.once('close',()=>sockets.delete(socket));if(stopped)socket.destroy();return socket;};
 // shortcut: grpc-js 1.14.6 close leaves pending HTTP/2 handshakes; recheck connector hook on upgrade.
 if(typeof credentials._createSecureConnector!=='function')throw Error('PROTOCOL_GRPC_CLEANUP_UNSUPPORTED');
 const create=credentials._createSecureConnector;credentials._createSecureConnector=function(...args){const connector=create.apply(this,args);if(typeof connector.connect!=='function')throw Error('PROTOCOL_GRPC_CLEANUP_UNSUPPORTED');const connect=connector.connect;connector.connect=async function(socket){capture(socket);const result=await connect.call(this,socket);capture(result.socket);return result;};return connector;};
 const channelOptions={'grpc.max_receive_message_length':1024*1024,'grpc.max_send_message_length':1024*1024,'grpc.enable_http_proxy':0,'grpc.enable_retries':0,'grpc.use_local_subchannel_pool':1};
 const client=new grpc.Client(address,credentials,channelOptions),metadata=metadataOf(c);let reflection,call,current,serial=0;
 const close=()=>{if(stopped)return;stopped=true;call?.cancel();client.close();reflection?.client?.close();for(const socket of sockets)socket.destroy();sockets.clear();};h.signal.addEventListener('abort',close,{once:true});
 const definitions=new Map();
 (async()=>{let definition=c.definition;if(c.reflection){reflection=new GrpcReflection(address,credentials,channelOptions);
  // shortcut: pinned reflection client 1.4.1 private channel; revisit when public close is added.
  if(typeof reflection.client?.close!=='function')throw Error('PROTOCOL_REFLECTION_CLEANUP_UNSUPPORTED');const services=await reflection.listServices('*',metadata,{deadline:Date.now()+(c.connectTimeout||30000)});definition={};for(const service of services.filter(s=>!s.startsWith('grpc.reflection.'))){if(stopped)return;Object.assign(definition,(await reflection.getDescriptorBySymbol(service,metadata,{deadline:Date.now()+(c.connectTimeout||30000)})).getPackageDefinition(options));}reflection.client?.close();}
  if(stopped)return;for(const value of Object.values(definition||{}))if(value&&typeof value==='object')for(const method of Object.values(value))if(method?.path&&method.requestSerialize)definitions.set(method.path,method);
  if(!definitions.size)throw Error();await new Promise((res,rej)=>client.waitForReady(Date.now()+(c.connectTimeout||30000),e=>e?rej(e):res()));if(stopped)return;
  h.emit('methods',[...definitions.values()].map(m=>({path:m.path,requestStream:m.requestStream,responseStream:m.responseStream,requestType:m.requestType,responseType:m.responseType})));h.open();
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

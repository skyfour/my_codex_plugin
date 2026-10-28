import WebSocket from 'ws';
import {io} from 'socket.io-client';
const binary=payload=>{if(!payload||payload.encoding!=='base64'||typeof payload.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.base64))throw Error('PROTOCOL_BINARY_INVALID');return Buffer.from(payload.base64,'base64');};
export function validateWebConfig(c){
 const allowed=['version','type','connectTimeout','operationTimeout','reconnectAttempts','reconnectDelay','path','auth','subprotocols','url','headers','network','secrets'];
 for(const key of Object.keys(c))if(!allowed.includes(key))throw Error('PROTOCOL_CONFIG_UNSUPPORTED');
 if(c.subprotocols!==undefined&&(!Array.isArray(c.subprotocols)||c.subprotocols.some(v=>typeof v!=='string')))throw Error('PROTOCOL_CONFIG_INVALID: subprotocols');
 if(c.type!=='websocket'&&c.subprotocols!==undefined)throw Error('PROTOCOL_CONFIG_UNSUPPORTED');
 if(c.type!=='socketio'&&(c.path!==undefined||c.auth!==undefined))throw Error('PROTOCOL_CONFIG_UNSUPPORTED');
 if(!['sse','websocket','socketio'].includes(c.type))throw Error('PROTOCOL_UNSUPPORTED');
 let url;try{url=new URL(c.url);}catch{throw Error('PROTOCOL_URL_INVALID');}
 if(url.username||url.password)throw Error('PROTOCOL_URL_CREDENTIALS: 使用认证字段或敏感变量');
 if(!(c.type==='websocket'?['ws:','wss:']:['http:','https:']).includes(url.protocol))throw Error('PROTOCOL_URL_INVALID');
 for(const [key,min,max]of [['connectTimeout',1,300000],['operationTimeout',1,300000],['reconnectAttempts',0,3],['reconnectDelay',0,60000]])if(c[key]!==undefined&&(!Number.isInteger(c[key])||c[key]<min||c[key]>max))throw Error('PROTOCOL_CONFIG_INVALID: '+key);
 if(c.network.proxy||c.network.caFile||c.network.certificates?.length||c.network.proxyCredentials?.length||c.network.noProxy?.length)throw Error('PROTOCOL_NETWORK_UNSUPPORTED: 代理、CA、证书及绕过规则暂不支持');
 if(c.type==='sse'&&c.network.strictSSL===false)throw Error('PROTOCOL_NETWORK_UNSUPPORTED: SSE 必须验证 TLS');
 if(c.type!=='sse'&&c.network.followRedirects===false)throw Error('PROTOCOL_NETWORK_UNSUPPORTED: 此适配器不支持重定向覆盖');
 if(c.reconnectAttempts&&c.type==='websocket')throw Error('PROTOCOL_RECONNECT_UNSUPPORTED: WebSocket 请显式重新连接');
 if(c.path!==undefined&&(typeof c.path!=='string'||!c.path.startsWith('/')||c.path.length>2048))throw Error('PROTOCOL_CONFIG_INVALID: path');
}
const websocket=(c,h)=>{
 const ws=new WebSocket(c.url,c.subprotocols||[],{headers:c.headers,rejectUnauthorized:c.network.strictSSL!==false,maxPayload:1024*1024,handshakeTimeout:c.connectTimeout||30000,followRedirects:false});
 ws.on('open',h.open);ws.on('message',(data,isBinary)=>h.emit('message',isBinary?data:data.toString()));ws.on('error',()=>h.fail('PROTOCOL_CONNECTION_FAILED'));ws.on('close',(code)=>{h.emit('close',{code});h.closed();});
 return {close(){if(ws.readyState!==WebSocket.CLOSED)ws.terminate();},async action(action,payload){if(action!=='send')throw Error('PROTOCOL_ACTION_UNSUPPORTED');const data=payload?.encoding==='base64'?binary(payload):payload?.text;if(typeof data!=='string'&&!Buffer.isBuffer(data))throw Error('PROTOCOL_PAYLOAD_INVALID');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('PROTOCOL_OPERATION_TIMEOUT')),c.operationTimeout||5000);ws.send(data,error=>{clearTimeout(timer);error?reject(Error('PROTOCOL_SEND_FAILED')):resolve();});});h.emit('sent',data);}};
};
const socketio=(c,h)=>{
 const socket=io(c.url,{autoConnect:false,forceNew:true,multiplex:false,path:c.path||'/socket.io',extraHeaders:c.headers,auth:c.auth,reconnection:!!c.reconnectAttempts,reconnectionAttempts:c.reconnectAttempts||0,reconnectionDelay:c.reconnectDelay??1000,reconnectionDelayMax:c.reconnectDelay??1000,timeout:c.connectTimeout||30000,rejectUnauthorized:c.network.strictSSL!==false});
 socket.on('connect',h.open);socket.onAny((event,...args)=>h.emit('message',{event,args}));socket.on('connect_error',()=>{if(!socket.active)h.fail('PROTOCOL_CONNECTION_FAILED');});socket.io.on('reconnect_failed',()=>h.fail('PROTOCOL_RECONNECT_FAILED'));socket.on('disconnect',reason=>{h.emit('disconnect',{reason:reason==='io client disconnect'?'client':'transport'});if(!socket.active)h.closed();else h.connecting();});socket.connect();
 return {close(){socket.removeAllListeners();socket.io.removeAllListeners();socket.disconnect();},async action(action,payload){if(action!=='emit')throw Error('PROTOCOL_ACTION_UNSUPPORTED');if(typeof payload?.event!=='string'||!payload.event||['connect','connect_error','disconnect','disconnecting','newListener','removeListener'].includes(payload.event))throw Error('PROTOCOL_EVENT_INVALID');const args=payload.binary?[binary(payload.binary)]:payload.args||[];if(!Array.isArray(args))throw Error('PROTOCOL_PAYLOAD_INVALID');if(payload.ack){const ack=await socket.timeout(c.operationTimeout||5000).emitWithAck(payload.event,...args).catch(()=>{throw Error('PROTOCOL_OPERATION_TIMEOUT');});h.emit('ack',{event:payload.event,args:ack});}else socket.emit(payload.event,...args);h.emit('sent',{event:payload.event,args});}};
};
const sse=(c,h)=>{
 let stopped=false,reader;const close=()=>{stopped=true;reader?.cancel().catch(()=>{});};h.signal.addEventListener('abort',close,{once:true});
 (async()=>{let id='',retry=c.reconnectDelay??1000;for(let attempt=0;!stopped;attempt++){
  let attemptTimer;const attemptController=new AbortController();
  try{
   attemptTimer=setTimeout(()=>attemptController.abort(),c.connectTimeout||30000);
   const response=await fetch(c.url,{headers:{...c.headers,Accept:'text/event-stream',...(id?{'Last-Event-ID':id}:{})},signal:AbortSignal.any([h.signal,attemptController.signal]),redirect:c.network.followRedirects===false?'error':'follow'});
   clearTimeout(attemptTimer);
   if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream'))throw Error();h.open();reader=response.body.getReader();const decoder=new TextDecoder();let pending='',data=[],event='',eventBytes=0,first=true;
   const line=text=>{if(first){text=text.replace(/^\uFEFF/,'');first=false;}if(!text){if(data.length)h.emit('message',{event:event||'message',id,retry,data:data.join('\n')});data=[];event='';eventBytes=0;return;}if(text.startsWith(':'))return;const colon=text.indexOf(':'),field=colon<0?text:text.slice(0,colon),value=colon<0?'':text.slice(colon+1).replace(/^ /,'');if(field==='data'){data.push(value);eventBytes+=Buffer.byteLength(value);if(eventBytes>1024*1024)throw Error('limit');}else if(field==='event')event=value;else if(field==='id'&&!value.includes('\0'))id=value;else if(field==='retry'&&/^\d+$/.test(value))retry=Math.min(Number(value),60000);};
   while(!stopped){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let m;while((m=/\r\n|\r(?!$)|\n/.exec(pending))){line(pending.slice(0,m.index));pending=pending.slice(m.index+m[0].length);}if(Buffer.byteLength(pending)>1024*1024)throw Error('limit');}
  }catch{if(!stopped&&attempt>=(c.reconnectAttempts||0)){h.fail('PROTOCOL_STREAM_FAILED');return;}}
  finally{clearTimeout(attemptTimer);await reader?.cancel().catch(()=>{});}
  if(stopped)return;if(attempt>=(c.reconnectAttempts||0)){h.closed();return;}h.connecting();h.emit('retry',{attempt:attempt+1,delay:retry});await new Promise(resolve=>{const timer=setTimeout(done,retry);function done(){clearTimeout(timer);h.signal.removeEventListener('abort',done);resolve();}h.signal.addEventListener('abort',done,{once:true});});
 }})().catch(()=>h.fail('PROTOCOL_STREAM_FAILED'));
 return {close,async action(){throw Error('PROTOCOL_ACTION_UNSUPPORTED: SSE 仅接收');}};
};
export const webAdapters={sse,websocket,socketio};

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
export function mcpAdapter(c,h){
 const client=new Client({name:'Codex API Client debugger',version:'0.2.1'}),pending=new Set();let stopped=false,closing;
 // Keep redirects and legacy SSE POST endpoints on the explicitly selected origin.
 const origin=new URL(c.url).origin;
 const boundedFetch=async(url,init={})=>{
  if(new URL(url).origin!==origin)throw Error('PROTOCOL_MCP_ORIGIN');
  const response=await fetch(url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),...c.headers},redirect:'error',signal:AbortSignal.any([h.signal,...(init.signal?[init.signal]:[])])});
  if(!response.body)return response;
  const reader=response.body.getReader();let bytes=0;
  // Bound decoded bytes before SDK JSON/SSE parsing, including one SSE connection's lifetime.
  const body=new ReadableStream({async pull(controller){try{const next=await reader.read();if(next.done){controller.close();return;}bytes+=next.value.byteLength;if(bytes>10*1024*1024){await reader.cancel();h.fail('PROTOCOL_MCP_RESPONSE_LIMIT');controller.error(Error('PROTOCOL_MCP_RESPONSE_LIMIT'));return;}controller.enqueue(next.value);}catch{controller.error(Error('PROTOCOL_MCP_TRANSPORT_ERROR'));}},cancel:reason=>reader.cancel(reason)});
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
 const transport=c.transport==='sse'?new SSEClientTransport(new URL(c.url),{fetch:boundedFetch,eventSourceInit:{fetch:boundedFetch},requestInit:{headers:c.headers}}):new StreamableHTTPClientTransport(new URL(c.url),{fetch:boundedFetch,requestInit:{headers:c.headers},reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1}});
 const close=()=>{if(stopped)return closing;stopped=true;for(const controller of pending)controller.abort();closing=client.close().catch(()=>{});return closing;};h.signal.addEventListener('abort',close,{once:true});
 client.onclose=()=>{if(!stopped)h.closed();};client.onerror=()=>h.emit('error','PROTOCOL_MCP_TRANSPORT_ERROR');
 client.connect(transport,{timeout:c.connectTimeout||30000,signal:h.signal}).then(()=>{if(!stopped){h.emit('capabilities',client.getServerCapabilities());h.open();}}).catch(()=>{if(!stopped)h.fail('PROTOCOL_MCP_CONNECT_FAILED');});
 return {close,async action(action,p={}){
  if(action==='cancel'){for(const controller of pending)controller.abort();return;}
  if(!['listTools','listResources','listPrompts','callTool','readResource','getPrompt'].includes(action))throw Error('PROTOCOL_ACTION_UNSUPPORTED');if(pending.size>=8)throw Error('PROTOCOL_QUEUE_LIMIT');if(!p||typeof p!=='object'||Array.isArray(p))throw Error('PROTOCOL_PAYLOAD_INVALID');
  const controller=new AbortController();pending.add(controller);const opts={signal:AbortSignal.any([h.signal,controller.signal]),timeout:c.operationTimeout||5000,maxTotalTimeout:c.operationTimeout||5000};
  try{const result=action==='callTool'?await client.callTool(p,undefined,opts):await client[action](p,opts);h.emit(action,result);if(result.isError)throw Error();}catch{h.emit('operationError',{action,code:controller.signal.aborted?'PROTOCOL_CANCELLED':'PROTOCOL_MCP_OPERATION_FAILED'});throw Error(controller.signal.aborted?'PROTOCOL_CANCELLED':'PROTOCOL_MCP_OPERATION_FAILED');}finally{pending.delete(controller);}
 }};
}

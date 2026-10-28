import {randomUUID} from 'node:crypto';
import {redact} from './secrets.mjs';
export const PROTOCOL_LIMITS={sessions:4,events:1000,bytes:10*1024*1024,eventBytes:1024*1024,retained:4};
// Adapters receive only resolved runtime config, an abort signal and sanitized event sinks.
export class ProtocolSessions {
 constructor(adapters={}){this.adapters=adapters;this.sessions=new Map();this.closed=false;}
 connect(config){
  if(this.closed)throw Error('PROTOCOL_CLOSED');
  const adapter=this.adapters[config.type];if(!adapter)throw Error('PROTOCOL_UNSUPPORTED');
  if([...this.sessions.values()].filter(s=>s.cleanupPending||!['closed','failed'].includes(s.state)).length>=PROTOCOL_LIMITS.sessions)throw Error('PROTOCOL_LIMIT: 同时最多 4 个会话');
  while(this.sessions.size>=PROTOCOL_LIMITS.retained){const old=[...this.sessions.values()].find(s=>!s.cleanupPending&&['closed','failed'].includes(s.state));if(!old)break;this.sessions.delete(old.id);}
  const s={id:randomUUID(),state:'connecting',seq:0,events:[],bytes:0,controller:new AbortController(),secrets:config.secrets||[],adapter:null};this.sessions.set(s.id,s);
  const state=value=>{if(['closed','failed'].includes(s.state))return;s.state=value;this.emit(s,'state',value);if(['closed','failed'].includes(value)){clearTimeout(s.timer);s.controller.abort();const cleanup=s.adapter?.close();if(cleanup?.then){s.cleanupPending=true;s.cleanup=Promise.resolve(cleanup).catch(()=>{}).finally(()=>{s.cleanupPending=false;});}}};
  const fail=code=>{this.emit(s,'error',code);state('failed');};
  this.emit(s,'state','connecting');
  s.timer=setTimeout(()=>fail('PROTOCOL_CONNECT_TIMEOUT'),config.connectTimeout||30000);s.timer.unref?.();
  try{s.adapter=adapter(config,{signal:s.controller.signal,emit:(type,data)=>this.emit(s,type,data),open:()=>{if(s.state==='connecting'){clearTimeout(s.timer);state('open');}},connecting:()=>state('connecting'),closed:()=>state('closed'),fail});if(s.controller.signal.aborted)s.adapter.close();}catch{fail('PROTOCOL_CONNECT_FAILED');}
  return {sessionId:s.id,state:s.state};
 }
 emit(s,type,data){
  if(['closed','failed'].includes(s.state)&&type!=='state')return;
  const binarySecrets=s.secrets.filter(v=>Buffer.isBuffer(v)||v instanceof Uint8Array).map(v=>Buffer.from(v)).filter(v=>v.length);
  const secrets=s.secrets.filter(Boolean).map(String);
  const needles=[...new Set([...secrets.flatMap(v=>[v,Buffer.from(v).toString('base64'),Buffer.from(v).toString('hex'),encodeURIComponent(v)]),...binarySecrets.flatMap(v=>[v.toString('base64'),v.toString('hex')])])].sort((a,b)=>b.length-a.length);
  const byteNeedles=[...binarySecrets,...needles.map(v=>Buffer.from(v))].sort((a,b)=>b.length-a.length);
  // Search original bytes only: inserted markers may themselves contain a secret.
  const cleanBinary=value=>{const original=Buffer.from(value),parts=[];let cursor=0;while(cursor<original.length){let next=-1,matched;for(const needle of byteNeedles){const at=original.indexOf(needle,cursor);if(at>=0&&(next<0||at<next)){next=at;matched=needle;}}if(next<0){parts.push(original.subarray(cursor));break;}parts.push(original.subarray(cursor,next),Buffer.from('[REDACTED]'));cursor=next+matched.length;}return Buffer.concat(parts);};
  const visit=v=>{if(Buffer.isBuffer(v)||v instanceof Uint8Array){const b=cleanBinary(v);return {encoding:'base64',base64:b.toString('base64'),size:b.length};}if(typeof v==='string')return redact(v,needles);if(Array.isArray(v))return v.map(visit);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)]));return v;};
  let clean=visit(data);let bytes=Buffer.byteLength(JSON.stringify(clean)??'null');
  if(bytes>PROTOCOL_LIMITS.eventBytes){type='error';clean='PROTOCOL_EVENT_LIMIT: 单条事件超过 1 MiB';bytes=Buffer.byteLength(JSON.stringify(clean));}
  const event={seq:++s.seq,time:new Date().toISOString(),type,data:clean};bytes=Buffer.byteLength(JSON.stringify(event));s.events.push({event,bytes});s.bytes+=bytes;
  while(s.events.length>PROTOCOL_LIMITS.events||s.bytes>PROTOCOL_LIMITS.bytes)s.bytes-=s.events.shift().bytes;
 }
 own(id){const s=this.sessions.get(id);if(!s)throw Error('NOT_FOUND: 协议会话不存在');return s;}
 async action({sessionId,action,payload}){const s=this.own(sessionId);if(s.state!=='open')throw Error('PROTOCOL_NOT_OPEN');if(Buffer.byteLength(JSON.stringify(payload)??'null')>PROTOCOL_LIMITS.eventBytes)throw Error('PROTOCOL_ACTION_LIMIT');try{await s.adapter.action(action,payload);return {sessionId,state:s.state};}catch(error){if(/^PROTOCOL_/.test(error.message))throw error;throw Error('PROTOCOL_ACTION_FAILED');}}
 events({sessionId,after=0,limit=100}){if(!Number.isInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>1000)throw Error('PROTOCOL_CURSOR_INVALID');const s=this.own(sessionId),first=s.events[0]?.event.seq||s.seq+1;const events=s.events.filter(v=>v.event.seq>after).slice(0,limit).map(v=>v.event);return {sessionId,state:s.state,events,cursor:events.at(-1)?.seq??after,firstSeq:first,gap:after<first-1};}
 async disconnect({sessionId}){const s=this.own(sessionId);if(!['closed','failed'].includes(s.state)){s.state='closing';this.emit(s,'state','closing');clearTimeout(s.timer);s.controller.abort();await s.adapter?.close();s.state='closed';this.emit(s,'state','closed');}await s.cleanup;return {sessionId,state:s.state};}
 async close(){this.closed=true;await Promise.all([...this.sessions.values()].map(s=>this.disconnect({sessionId:s.id})));}
}

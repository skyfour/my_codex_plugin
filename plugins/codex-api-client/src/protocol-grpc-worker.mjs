import {serialize} from 'node:v8';
import {grpcAdapterCore} from './protocol-grpc.mjs';
let adapter,bytes=0,started=false,sending=false;const queue=[];
const controller=new AbortController();
function flush(){
 if(sending||!queue.length)return;sending=true;const {message,size}=queue[0];
 try{process.send(message,error=>{if(error)process.exit(1);queue.shift();bytes-=size;sending=false;flush();});}catch{process.exit(1);}
}
function send(message){
 const size=serialize(message).byteLength;
 if(size>1024*1024)return send({kind:'event',type:'error',data:'PROTOCOL_EVENT_LIMIT'});
 if(queue.length>=1024||bytes+size>4*1024*1024)process.exit(1);
 queue.push({message,size});bytes+=size;flush();
}
process.on('disconnect',()=>process.exit(0));
process.on('message',async message=>{
 try{
  if(message.kind==='connect'&&!started){started=true;const c=message.config;if(c.tlsBytes)for(const key of ['ca','cert','key'])if(c.tlsBytes[key])c.tlsBytes[key]=Buffer.from(c.tlsBytes[key]);adapter=grpcAdapterCore(c,{signal:controller.signal,emit:(type,data)=>send({kind:'event',type,data}),open:()=>send({kind:'open'}),fail:()=>send({kind:'fail'})});}
  else if(message.kind==='action'&&adapter){try{await adapter.action(message.action,message.payload);send({kind:'reply',id:message.id});}catch(error){send({kind:'reply',id:message.id,error:/^PROTOCOL_[A-Z_]+$/.test(error.message)?error.message:'PROTOCOL_GRPC_OPERATION_FAILED'});}}
 }catch{send({kind:'fail'});}
});

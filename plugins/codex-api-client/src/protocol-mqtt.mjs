import {Duplex,Transform} from 'node:stream';
import mqtt from 'mqtt';
import net from 'node:net';
import tls from 'node:tls';
export function mqttAdapter(c,h){
 let stopped=false,retries=0,retryTimer,closing;const pending=new Set();
 const url=new URL(c.url),secure=url.protocol==='mqtts:';
 const stream=()=>{
  const socket=secure?tls.connect({host:url.hostname,port:Number(url.port)||8883,...(net.isIP(url.hostname)?{}:{servername:url.hostname}),rejectUnauthorized:c.network.strictSSL!==false,...c.tlsBytes}):net.connect({host:url.hostname,port:Number(url.port)||1883});
  let phase='type',remaining=0,multiplier=1,lengthBytes=0;
  // Inspect decoded bytes before MQTTJS can retain an incomplete declared payload.
  const bounded=new Transform({transform(chunk,encoding,callback){
   for(let i=0;i<chunk.length;){
    if(phase==='payload'){const consumed=Math.min(remaining,chunk.length-i);remaining-=consumed;i+=consumed;if(!remaining)phase='type';continue;}
    const byte=chunk[i++];
    if(phase==='type'){phase='length';remaining=0;multiplier=1;lengthBytes=0;continue;}
    remaining+=(byte&127)*multiplier;lengthBytes++;
    if(remaining>1024*1024||lengthBytes===4&&(byte&128)){
     h.fail('PROTOCOL_EVENT_LIMIT');callback(Error('PROTOCOL_EVENT_LIMIT'));return;
    }
    multiplier*=128;
    if(!(byte&128))phase=remaining?'payload':'type';
   }
   callback(null,chunk);
  }});
  socket.on('error',error=>bounded.destroy(error));
  bounded.on('error',()=>socket.destroy());
  return Duplex.from({readable:socket.pipe(bounded),writable:socket});
 };
 // Direct stream builder prevents MQTTJS_SOCKS_PROXY from silently routing native traffic.
 const client=new mqtt.MqttClient(stream,{username:c.username,password:c.password,clientId:c.clientId,clean:true,resubscribe:false,reconnectPeriod:0,queueQoSZero:false,connectTimeout:c.connectTimeout||30000,rejectUnauthorized:c.network.strictSSL!==false,...c.tlsBytes,socksProxy:null,protocolVersion:4});
 const close=()=>{if(stopped)return closing;stopped=true;clearTimeout(retryTimer);for(const reject of pending)reject(Error('PROTOCOL_CANCELLED'));closing=new Promise(resolve=>client.end(true,{},resolve));return closing;};h.signal.addEventListener('abort',close,{once:true});
 client.on('connect',()=>{h.emit('connected',{sessionPresent:false});h.open();});
 client.on('message',(topic,payload,packet)=>{if(payload.length>1024*1024){h.fail('PROTOCOL_EVENT_LIMIT');return;}h.emit('message',{topic,payload,qos:packet.qos,retain:packet.retain,dup:packet.dup});});
 client.on('error',()=>h.emit('error','PROTOCOL_MQTT_ERROR'));
 client.on('close',()=>{if(stopped)return;if(retries++<(c.reconnectAttempts||0)){h.connecting();retryTimer=setTimeout(()=>{if(!stopped)client.reconnect();},c.reconnectDelay??1000);}else h.fail('PROTOCOL_MQTT_CONNECTION_CLOSED');});
 const invoke=fn=>new Promise((resolve,reject)=>{if(pending.size>=16)return reject(Error('PROTOCOL_QUEUE_LIMIT'));let done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);pending.delete(cancel);error?reject(error):resolve();},cancel=error=>finish(error),timer=setTimeout(()=>{finish(Error('PROTOCOL_OPERATION_TIMEOUT'));h.fail('PROTOCOL_OPERATION_TIMEOUT');},c.operationTimeout||5000);pending.add(cancel);try{fn((error,result)=>{if(!error)h.emit('ack',result);finish(error?Error('PROTOCOL_MQTT_OPERATION_FAILED'):null);});}catch{finish(Error('PROTOCOL_MQTT_OPERATION_FAILED'));}});
 return {close,async action(action,p={}){
  if(!['subscribe','unsubscribe','publish'].includes(action))throw Error('PROTOCOL_ACTION_UNSUPPORTED');if(typeof p.topic!=='string'||!p.topic||Buffer.byteLength(p.topic)>65535||p.topic.includes('\0')||(action==='publish'&&/[+#]/.test(p.topic)))throw Error('PROTOCOL_MQTT_TOPIC_INVALID');if(p.qos!==undefined&&![0,1,2].includes(p.qos))throw Error('PROTOCOL_MQTT_QOS_INVALID');if(p.retain!==undefined&&typeof p.retain!=='boolean')throw Error('PROTOCOL_PAYLOAD_INVALID');
  if(action==='subscribe')await invoke(cb=>client.subscribe(p.topic,{qos:p.qos||0},cb));
  else if(action==='unsubscribe')await invoke(cb=>client.unsubscribe(p.topic,cb));
  else {let data;if(p.encoding==='base64'){if(typeof p.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.base64))throw Error('PROTOCOL_BINARY_INVALID');data=Buffer.from(p.base64,'base64');}else{if(typeof p.text!=='string')throw Error('PROTOCOL_PAYLOAD_INVALID');data=p.text;}await invoke(cb=>client.publish(p.topic,data,{qos:p.qos||0,retain:!!p.retain},cb));}
  h.emit('sent',{action,topic:p.topic,qos:p.qos||0,retain:!!p.retain});
 }};
}

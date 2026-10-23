import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {rewriteScript} from './compat.mjs';

const hop = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host','cookie','authorization','origin']);

// A private URL namespace is required because third-party cookies are unavailable
// in some MCP hosts. Only this process holds the upstream HttpOnly login cookie.
export async function createWebProxy({upstream, transformScript=rewriteScript, getVersion=()=>null}={}) {
  const target=new URL(upstream);
  if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password||target.pathname!=='/') throw new Error('DBX upstream must be a loopback HTTP origin');
  const prefix=`/${randomBytes(24).toString('hex')}/`, cookies=new Map(), sockets=new Set(), requests=new Set();
  const compat=await readFile(new URL('../ui/compat.js',import.meta.url),'utf8');
  let origin;
  const track=request=>{requests.add(request);request.once('close',()=>requests.delete(request));return request;};
  const rewrite=value=>value.replace(/(["'`])\/(assets|db-icons|fonts|images|icons)\//g,`$1${prefix}$2/`);
  const bootstrap=`(()=>{const prefix=${JSON.stringify(prefix)};const map=v=>{const u=new URL(v,location.href);if(u.origin===location.origin&&!u.pathname.startsWith(prefix))u.pathname=prefix.slice(0,-1)+u.pathname;return u.href;};const f=window.fetch.bind(window);window.fetch=(v,o)=>f(v instanceof Request?new Request(map(v.url),v):map(v),o);const x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...a){return x.call(this,m,map(u),...a)};for(const key of ['EventSource','WebSocket']){const C=window[key];if(C)window[key]=class extends C{constructor(u,...args){const v=new URL(u,location.href);const local=v.hostname===location.hostname&&v.port===location.port;if(local&&!v.pathname.startsWith(prefix))v.pathname=prefix.slice(0,-1)+v.pathname;super(v.href,...args)}};}window.__DBX_PROXY_PREFIX__=prefix;})();`;
  const headers=req=>{
    const result=Object.fromEntries(Object.entries(req.headers).filter(([key])=>!hop.has(key)));
    result.host=target.host;result['accept-encoding']='identity';
    if(cookies.size)result.cookie=[...cookies].map(([k,v])=>`${k}=${v}`).join('; ');
    return result;
  };
  const absorbCookies=response=>{for(const cookie of response.headers['set-cookie']??[]){const first=cookie.split(';',1)[0],eq=first.indexOf('=');if(eq>0){const key=first.slice(0,eq),value=first.slice(eq+1);if(value)cookies.set(key,value);else cookies.delete(key);}}};
  const pathFor=req=>{
    if(req.headers.host!==new URL(origin).host) return null;
    const requestOrigin=req.headers.origin;
    if(requestOrigin&&requestOrigin!==origin&&requestOrigin!=='null') return null;
    // Check the raw URL, before normalizing dot segments.
    if(!req.url?.startsWith(prefix))return null;
    let relative=req.url.slice(prefix.length-1);
    // Official webPath() may prepend its inferred base to a Vite asset URL
    // that already carries our namespace. Normalize only this exact capability.
    while(relative.startsWith(prefix))relative=relative.slice(prefix.length-1);
    if(!relative.startsWith('/')||relative.startsWith('//')||/\\|(?:^|\/)\.\.(?:\/|$)|%2e|%2f|%5c/i.test(relative.split('?')[0]))return null;
    if(new URL(relative,target).origin!==target.origin)return null;
    return relative;
  };
  const server=http.createServer((req,res)=>{
    const path=pathFor(req);if(!path){res.writeHead(404).end();return;}
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    if(path==='/_codex/compat.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(`${bootstrap}\n${compat}`);return;}
    const request=track(http.request(new URL(path,target),{method:req.method,headers:headers(req)},response=>{
      response.on('error',()=>res.destroy());
      absorbCookies(response);
      for(const [key,value] of Object.entries(response.headers)) if(value!==undefined&&!['set-cookie','content-length','content-security-policy','x-frame-options','location','transfer-encoding','connection','cache-control'].includes(key))res.setHeader(key,value);
      if(response.headers.location){const location=new URL(response.headers.location,target);if(location.origin===target.origin)res.setHeader('Location',prefix.slice(0,-1)+location.pathname+location.search);else {response.resume();res.writeHead(502).end('Unexpected upstream redirect');return;}}
      res.statusCode=response.statusCode;
      const type=String(response.headers['content-type']??'');
      if(!/text\/html|javascript|text\/css/.test(type)){response.pipe(res);return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>64*1024*1024){response.destroy();res.destroy();}else chunks.push(chunk);});
      response.on('end',()=>{
        try{
          let body=Buffer.concat(chunks).toString('utf8');
          if(type.includes('javascript'))body=transformScript(body,{version:getVersion(),filename:path.split('?')[0]}).source;
          if(type.includes('text/html'))body=body.replace(/(\b(?:src|href)=["'])\/(?!\/)/gi,`$1${prefix}`).replace(/<head([^>]*)>/i,`<head$1><base href="${prefix}"><script src="${prefix}_codex/compat.js"></script>`);
          else body=rewrite(body);
          if(type.includes('text/css'))body=body.replace(/url\(\s*\/(?!\/)/gi,`url(${prefix}`);
          res.removeHeader('etag');res.removeHeader('content-encoding');res.end(body);
        }catch{res.statusCode=503;res.end('DBX browser compatibility check failed. This official version needs a plugin compatibility update.');}
      });
    }));
    request.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('DBX is starting or Docker is unavailable. Use the DBX toolbar to retry.');});
    req.on('aborted',()=>request.destroy());res.once('close',()=>request.destroy());req.pipe(request);
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.on('upgrade',(req,socket,head)=>{
    const path=pathFor(req);if(!path){socket.destroy();return;}
    const request=track(http.request(new URL(path,target),{headers:{...headers(req),connection:'Upgrade',upgrade:req.headers.upgrade??'websocket'}}));
    let remoteSocket;
    const cancel=()=>{request.destroy();remoteSocket?.destroy();};
    socket.once('end',cancel);socket.once('close',cancel);socket.once('error',cancel);
    request.on('upgrade',(response,remote,remoteHead)=>{
      if(socket.destroyed){remote.destroy();return;}
      remoteSocket=remote;
      absorbCookies(response);
      sockets.add(remote);remote.once('close',()=>sockets.delete(remote));
      socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n${Object.entries(response.headers).filter(([key])=>key!=='set-cookie').map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);socket.pipe(remote).pipe(socket);
      remote.once('close',()=>socket.destroy());remote.on('error',()=>socket.destroy());
    });
    request.on('response',response=>{socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`);response.resume();});
    request.on('error',()=>socket.destroy());request.end();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,url:origin+prefix,close:async()=>{cookies.clear();for(const request of requests)request.destroy();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer,defaultDataDirectory } from '../src/server.mjs';
import { invoke } from '../src/tools.mjs';

export async function startPreview({port=47890,directory=defaultDataDirectory()}={}) {
  const token=randomBytes(32).toString('hex'),app=createServer({directory});
  const html=(await readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace('<head>',`<head><script>window.__DEV_TOKEN__=${JSON.stringify(token)};</script>`);
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const expected=`127.0.0.1:${server.address().port}`;
    if(req.headers.host!==expected){res.writeHead(403);return res.end('Forbidden Host');}
    if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(html);}
    if(req.method!=='POST'||!req.url?.startsWith('/api/')||req.headers['x-api-token']!==token||(req.headers.origin&&req.headers.origin!==`http://${expected}`)){res.writeHead(403);return res.end('Forbidden');}
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>30*1024*1024)throw new Error('PAYLOAD_LIMIT');chunks.push(chunk);}
      const args=JSON.parse(Buffer.concat(chunks).toString());
      const result=await invoke(app.service,req.url.slice(5),args);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
    }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,app,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await app.close();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const preview=await startPreview({port:Number(process.env.PORT||47890)});
  console.log('API Client preview: '+preview.url);
  process.once('SIGTERM',()=>preview.close().finally(()=>process.exit()));
  process.once('SIGINT',()=>preview.close().finally(()=>process.exit()));
}

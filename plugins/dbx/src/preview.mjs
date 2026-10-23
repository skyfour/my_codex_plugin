import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';

// Development host only. Uses the same resource and handlers as the stdio MCP
// server, under the restrictive sandbox used by desktop MCP hosts.
export async function createPreview(app,{port=0,theme='dark'}={}){
  const prefix=`/${randomBytes(24).toString('hex')}/`;let origin;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    if(req.headers.host!==new URL(origin).host||!req.url.startsWith(prefix)){res.writeHead(404).end();return;}
    try{
      if(req.url===prefix&&req.method==='GET'){
        const html=(await app.readUi()).contents[0].text;
        const script=`const plugin=document.querySelector('iframe');window.addEventListener('message',async e=>{const m=e.data;if(e.source!==plugin.contentWindow||m?.jsonrpc!=='2.0'||m.id===undefined)return;try{const result=m.method==='tools/call'?await fetch('rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m.params)}).then(r=>r.json()):{hostContext:{theme:${JSON.stringify(theme)}}};e.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');}catch(error){e.source.postMessage({jsonrpc:'2.0',id:m.id,error:{message:error.message}},'*');}});plugin.srcdoc=${JSON.stringify(html).replace(/<\/script/gi,'<\\/script')};`;
        res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><title>DBX 开发预览</title><style>html,body{height:100%;margin:0;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style><iframe title="Codex MCP 开发宿主" sandbox="allow-scripts allow-same-origin"></iframe><script>${script}</script>`);return;
      }
      if(req.url===prefix+'rpc'&&req.method==='POST'&&req.headers.origin===origin){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>6*1024*1024)throw new Error('请求过大');chunks.push(chunk);}
        const {name,arguments:args={}}=JSON.parse(Buffer.concat(chunks).toString());if(!app.actions.has(name))throw new Error('未知的面板操作');
        const data=await app.actions.get(name)(args);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({content:[],structuredContent:data}));return;
      }
      res.writeHead(404).end();
    }catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({isError:true,content:[{type:'text',text:error.message}]}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
  return {url:origin+prefix,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

import { App } from '@modelcontextprotocol/ext-apps';
declare global { interface Window { __DEV_TOKEN__?: string } }
let app: App | undefined;
let connection: Promise<void> | undefined;
export async function connect() {
  if(window.__DEV_TOKEN__)return;
  if(!connection){
    app=new App({name:'Codex API Client',version:'0.1.0'},{});
    app.onhostcontextchanged=ctx=>{if(!localStorage.getItem('api-theme')&&ctx.theme)document.documentElement.dataset.theme=ctx.theme;};
    connection=app.connect();
  }
  return connection;
}
export async function call<T=any>(name:string,args:Record<string,unknown>={}):Promise<T>{
  await connect();
  if(window.__DEV_TOKEN__){
    const r=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-API-Token':window.__DEV_TOKEN__},body:JSON.stringify(args)});
    const value=await r.json();if(!r.ok)throw new Error(value.error);return value;
  }
  const result=await app!.callServerTool({name,arguments:args});
  if(result.isError)throw new Error(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
  return result.structuredContent as T;
}
export async function download(name:string,content:string,base64=false){
  if(app){
    const resource=base64?{uri:'file:///'+encodeURIComponent(name),mimeType:'application/octet-stream',blob:content}:{uri:'file:///'+encodeURIComponent(name),mimeType:'text/plain',text:content};
    const result=await app.downloadFile({contents:[{type:'resource',resource}]});
    if(result.isError)throw new Error('下载被取消或客户端暂不支持下载');
  }else{
    const blob=base64?new Blob([Uint8Array.from(atob(content),c=>c.charCodeAt(0))]):new Blob([content]);
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
}

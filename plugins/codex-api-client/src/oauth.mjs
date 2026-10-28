import http from 'node:http';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
const endpoint=value=>{try{const u=new URL(value);if(u.username||u.password||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw Error();return u;}catch{throw Error('OAUTH_CONFIG: 需要 HTTPS 地址（本地回环允许 HTTP）');}};
const openBrowser=url=>new Promise((resolve,reject)=>{const child=spawn(process.platform==='darwin'?'/usr/bin/open':'xdg-open',[url],{stdio:'ignore'});child.once('error',()=>reject(Error('OAUTH_BROWSER')));child.once('exit',code=>code?reject(Error('OAUTH_BROWSER')):resolve());});
export class OAuthSessions{
 constructor(store,{open=openBrowser,ttl=180000}={}){this.store=store;this.open=open;this.ttl=Math.min(ttl,300000);this.sessions=new Map();}
 status(s){return {sessionId:s.id,status:s.status,target:s.target,expiresAt:s.expiresAt,...(s.error?{error:s.error}:{}),...(s.token?{token:s.token}:{})};}
 get(id){const s=this.sessions.get(id);if(!s)throw Error('OAUTH_NOT_FOUND');return s;}
 poll({sessionId}){return this.status(this.get(sessionId));}
 finish(s,status,error){if(s.status!=='pending')return; s.status=status;s.error=error;clearTimeout(s.timer);s.controller.abort();s.server?.close();s.server?.closeIdleConnections();delete s.verifier;delete s.config;delete s.state;s.cleanupTimer=setTimeout(()=>this.sessions.delete(s.id),300000);s.cleanupTimer.unref();}
 cancel({sessionId}){const s=this.get(sessionId);this.finish(s,'cancelled');return this.status(s);}
 async start(config){
  if(!['authorization_code','client_credentials'].includes(config.flow))throw Error('OAUTH_CONFIG: 授权类型无效');
  endpoint(config.tokenUrl);if(config.flow==='authorization_code')endpoint(config.authorizationUrl);
  if(!config.clientId||!['environment','globals'].includes(config.target?.kind)||!config.target.key)throw Error('OAUTH_CONFIG: 请指定客户端及 Token 变量');
  const doc=await this.store.get(config.target.kind,config.target.id);if(!doc)throw Error('OAUTH_TARGET: 目标变量文档不存在');
  // At most four active flows; completed metadata is bounded too.
  if([...this.sessions.values()].filter(s=>s.status==='pending').length>=4||this.sessions.size>=100)throw Error('OAUTH_LIMIT');
  const s={id:randomUUID(),status:'pending',target:config.target,config,controller:new AbortController(),expiresAt:new Date(Date.now()+this.ttl).toISOString()};this.sessions.set(s.id,s);
  s.timer=setTimeout(()=>this.finish(s,'expired','OAUTH_EXPIRED'),this.ttl);s.timer.unref();
  if(config.flow==='client_credentials'){await this.exchange(s,{grant_type:'client_credentials'});return this.status(s);}
  s.state=randomBytes(32).toString('base64url');s.verifier=randomBytes(48).toString('base64url');
  s.server=http.createServer(async(req,res)=>{
   const url=new URL(req.url,'http://127.0.0.1');
   const respond=(code,text)=>{res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"});res.end(text);};
   if(req.method!=='GET'||url.pathname!=='/oauth/callback'){respond(404,'Not found');return;}
   const state=url.searchParams.get('state')||'',expected=s.state||'';
   if(s.status!=='pending'||Buffer.byteLength(state)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(state),Buffer.from(expected))||url.searchParams.getAll('state').length!==1){respond(400,'OAuth state invalid');this.finish(s,'failed','OAUTH_STATE');return;}
   const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code||url.searchParams.getAll('code').length!==1||code.length>8192){respond(400,'OAuth authorization failed');this.finish(s,'failed','OAUTH_AUTHORIZATION');return;}
   // Close listener before exchange; no code/state reflected into page or results.
   respond(200,'授权已收到，请返回 API Client。');s.server.close();s.server.closeIdleConnections();
   await this.exchange(s,{grant_type:'authorization_code',code,redirect_uri:s.redirectUri,code_verifier:s.verifier});
  });
  try{await new Promise((resolve,reject)=>{s.server.once('error',reject);s.server.listen(0,'127.0.0.1',resolve);});s.redirectUri=`http://127.0.0.1:${s.server.address().port}/oauth/callback`;const url=endpoint(config.authorizationUrl);for(const key of ['code','access_token','token','client_secret','password'])url.searchParams.delete(key);for(const [k,v]of Object.entries({response_type:'code',client_id:config.clientId,redirect_uri:s.redirectUri,state:s.state,code_challenge:createHash('sha256').update(s.verifier).digest('base64url'),code_challenge_method:'S256',scope:config.scope||''}))url.searchParams.set(k,v);await this.open(url.toString());}catch{this.finish(s,'failed','OAUTH_BROWSER');}
  return this.status(s);
 }
 async exchange(s,grant){
  try{
   const c=s.config,body=new URLSearchParams({...grant,client_id:c.clientId,...(c.clientSecret?{client_secret:c.clientSecret}:{}),...(c.scope?{scope:c.scope}:{})});
   const response=await fetch(endpoint(c.tokenUrl),{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:s.controller.signal});
   if(!response.ok)throw Error();let size=0,parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>65536){s.controller.abort();throw Error();}parts.push(chunk);}
   const token=JSON.parse(Buffer.concat(parts).toString());if(typeof token.access_token!=='string'||!token.access_token||token.access_token.length>32768||(token.token_type&&token.token_type.toLowerCase()!=='bearer'))throw Error();
   if(s.status!=='pending')return;
   const doc=await this.store.get(s.target.kind,s.target.id,{reveal:true});if(!doc)throw Error();if(s.status!=='pending')return;
   const values=doc.data.values.filter(v=>v.key!==s.target.key);
   const previous=c;
   values.push({key:s.target.key,value:token.access_token,type:'secret',oauth:{tokenUrl:c.tokenUrl,clientId:c.clientId,scope:c.scope||'',...(c.clientSecret?{clientSecret:c.clientSecret}:{}),...(token.refresh_token||previous?.refreshToken?{refreshToken:token.refresh_token||previous.refreshToken}:{}),expiresAt:Number.isFinite(Number(token.expires_in))?new Date(Date.now()+Math.min(Number(token.expires_in),31536000)*1000).toISOString():null}});
   // Secret nodes are terminal in transformSecrets, so keep OAuth credentials in a sibling variable.
   const entry=values.at(-1),metadata=entry.oauth;delete entry.oauth;
   const metaKey=s.target.key+'.__oauth';const clean=values.filter(v=>v.key!==metaKey);clean.push({key:metaKey,value:JSON.stringify(metadata),type:'secret'});
   await this.store.putMany([{kind:s.target.kind,id:s.target.id,data:{...doc.data,values:clean},expectedRevision:doc.revision}],{beforeCommit:()=>{if(s.status!=='pending')throw Error('OAUTH_CANCELLED');}});
   s.token={stored:true,variable:s.target.key,expiresAt:metadata.expiresAt};this.finish(s,'completed');
  }catch{this.finish(s,'failed','OAUTH_EXCHANGE: 授权交换失败，请检查配置或重试');}
 }
 async refresh({target}){
  if([...this.sessions.values()].filter(s=>s.status==='pending').length>=4||this.sessions.size>=100)throw Error('OAUTH_LIMIT');
  if(!['environment','globals'].includes(target?.kind))throw Error('OAUTH_TARGET');
  const doc=await this.store.get(target.kind,target.id,{reveal:true});let config;try{config=JSON.parse(doc?.data.values.find(v=>v.key===target.key+'.__oauth')?.value);}catch{throw Error('OAUTH_REFRESH: 没有刷新凭据');}
  if(!config.refreshToken)throw Error('OAUTH_REFRESH: 没有刷新凭据');
  const s={id:randomUUID(),status:'pending',target,config,controller:new AbortController(),expiresAt:new Date(Date.now()+this.ttl).toISOString()};this.sessions.set(s.id,s);s.timer=setTimeout(()=>this.finish(s,'expired','OAUTH_EXPIRED'),this.ttl);s.timer.unref();await this.exchange(s,{grant_type:'refresh_token',refresh_token:typeof config.refreshToken==='object'?config.refreshToken.value:config.refreshToken});return this.status(s);
 }
 close(){for(const s of this.sessions.values()){this.finish(s,'cancelled');clearTimeout(s.cleanupTimer);}this.sessions.clear();}
}

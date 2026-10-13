import http from 'node:http';
const token='local-demo-token';
const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.url==='/login'&&req.method==='POST'){
    res.setHeader('Set-Cookie','session=local-demo-session; HttpOnly; Path=/');
    return res.end(JSON.stringify({token,expiresIn:3600}));
  }
  if(req.url==='/profile'){
    if(req.headers.authorization!=='Bearer '+token){res.statusCode=401;return res.end(JSON.stringify({error:'请先登录'}));}
    return res.end(JSON.stringify({id:1,name:'本地演示用户',session:Boolean(req.headers.cookie)}));
  }
  res.end(JSON.stringify({method:req.method,url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()}));
});
server.listen(Number(process.env.DEMO_PORT||47893),'127.0.0.1',()=>console.log('Demo API: http://127.0.0.1:'+server.address().port));
process.once('SIGTERM',()=>{server.closeAllConnections();server.close();});
process.once('SIGINT',()=>{server.closeAllConnections();server.close();});

import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {BoardStore} from '../src/store.mjs';
import {createPanelServer} from '../servers/server.mjs';
import {loadBoardHtml} from '../src/ui-resource.mjs';

const demo=process.argv.includes('--demo'),dataDir=process.env.TASK_PANEL_DEV_HOME??join(process.cwd(),'.dev-data',demo?'demo':'local');
const store=new BoardStore(join(dataDir,'board.sqlite'));
const demoRecords=Array.from({length:31},(_,i)=>({provider:'tapd',account:'100',resourceType:'tasks',sourceId:String(1001+i),sourceUpdatedAt:Date.now()-100000,
 title:['修复消息列表首次加载空白','完善需求文档与验收条件','优化文件上传失败重试','补充群成员权限校验','调整会话列表排序','验证多端未读数一致性'][i%6]+(i>5?` ${i+1}`:''),
 body:`<h3>背景</h3><p>这里是任务 ${1001+i} 的完整原始描述，用于本地演示。</p><h3>处理范围</h3><ol><li>核对当前实现中的状态变化。</li><li>修复异常路径并保留用户输入。</li></ol><h3>验收标准</h3><p>正常与异常流程均可恢复，重复提交不会产生重复记录。</p><script>window.__unsafe=true</script><img src=x onerror="window.__unsafe=true">`,sender:'示例创建人',url:`https://www.tapd.cn/100/prong/tasks/view/${1001+i}`,sourceState:i%3===0?'progressing':'open',owner:'demo.nick'}));
if(demo&&!store.snapshot().tasks.length){store.configure({workspaceId:'100',ownerName:'演示用户',version:store.config().version});store.applyImport(demoRecords.slice(0,6),{runId:'demo-seed'});const snap=store.snapshot();for(let i=0;i<snap.tasks.length;i++){const t=store.getTask(snap.tasks[i].id);for(const lane of snap.lanes.slice(1,i%4+1))store.moveCard({id:t.id,laneId:lane.id,version:store.getTask(t.id).version});}}
const demoThreads=new Map(Array.from({length:32},(_,i)=>{const id=`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;return [id,{id,title:`示例会话 ${i+1}`,cwd:process.cwd(),updatedAt:Math.floor(Date.now()/1000)-i*100}];}));
const threadProvider={list:async({search='',cursor}={})=>{const all=[...demoThreads.values()].filter(t=>t.title.includes(search)),offset=Number(cursor??0);return {items:all.slice(offset,offset+25),nextCursor:all.length>offset+25?String(offset+25):null};},read:async id=>{const t=demoThreads.get(id);if(!t)throw Error('THREAD_UNAVAILABLE');return t;},create:async(cwd,onCreated,title)=>{const t={id:randomUUID(),cwd,title,updatedAt:Math.floor(Date.now()/1000)};demoThreads.set(t.id,t);onCreated(t);return t;}};
const app=createPanelServer({store,...(demo?{threads:threadProvider,credentials:async()=> 'synthetic-demo-token',read:async()=>({identity:{id:'9',nick:'demo.nick',name:'演示用户'},records:demoRecords,missingIds:[]})}:{})});
const token=randomUUID();let origin;
const http=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url==='/'){let html=await loadBoardHtml();html=html.replace('<head>',`<head><script>window.__TASK_PANEL_DEV__=${JSON.stringify(token)};window.__TASK_PANEL_DEMO__=${demo}</script>`);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer'});res.end(html);return;}
    if(req.method==='POST'&&req.url==='/rpc'){
      if(req.headers['x-task-panel-token']!==token||(req.headers.origin&&req.headers.origin!==origin)||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(403);res.end();return;}
      const parts=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024){res.writeHead(413);res.end();return;}parts.push(chunk);}
      const {name,args}=JSON.parse(Buffer.concat(parts).toString('utf8'));const action=app.actions.get(name);if(!action){res.writeHead(404);res.end();return;}
      const result=await action(args??{});res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(result));return;
    }
    res.writeHead(404);res.end();
  }catch{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({isError:true,content:[{type:'text',text:'本地预览请求失败。'}]}));}
});
http.listen(Number(process.env.PORT??0),'127.0.0.1',()=>{origin=`http://127.0.0.1:${http.address().port}`;console.log(`${demo?'DEMO':'LOCAL'} preview: ${origin}`);});
const close=()=>http.close(()=>{store.close();process.exit(0);});process.on('SIGINT',close);process.on('SIGTERM',close);

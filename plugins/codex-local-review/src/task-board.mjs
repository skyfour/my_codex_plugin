import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';import {join} from 'node:path';
export function boardTasks(dir=process.env.TASK_PANEL_HOME??join(process.env.CODEX_HOME??join(homedir(),'.codex'),'task-panel')){
 const path=join(dir,'board.sqlite');if(!existsSync(path))return {tasks:[],notice:'尚未安装或使用任务看板，请先导入 TAPD 任务。'};
 const db=new DatabaseSync(path,{readOnly:true});try{
 db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000');
 const hasScm=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_scm'").get();
 const rows=db.prepare(`SELECT t.id,json_extract(t.source_json,'$.title') AS title,json_extract(t.source_json,'$.sourceId') AS sourceId,json_extract(t.source_json,'$.account') AS account,json_extract(t.source_json,'$.sourceState') AS state,${hasScm?'COALESCE(s.keyword,\'\')':'\'\''} AS keyword FROM tasks t ${hasScm?'LEFT JOIN task_scm s ON s.task_id=t.id':''} ORDER BY t.imported_at DESC LIMIT 2000`).all();
 return {tasks:rows,notice:hasScm?'':'任务看板尚无源码关键字，请在新版任务详情中获取。'};
 }finally{db.close();}
}

// The review plugin is installed independently; use the board's existing local
// credential format without importing a sibling plugin's versioned cache.
export async function fetchBoardKeyword(taskId,{dir=process.env.TASK_PANEL_HOME??join(process.env.CODEX_HOME??join(homedir(),'.codex'),'task-panel'),env=process.env,fetchImpl=fetch}={}){
 const task=boardTasks(dir).tasks.find(t=>t.id===taskId);if(!task)throw Error('任务不存在，请刷新任务列表');
 const {lstat,readFile}=await import('node:fs/promises');let token=env.TAPD_ACCESS_TOKEN;
 try{const path=join(dir,'credentials.json'),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw Error('凭据文件权限无效，请在任务看板设置中重新保存令牌');const data=JSON.parse(await readFile(path,'utf8'));if(typeof data.tapdAccessToken!=='string')throw Error('凭据文件无效');token=data.preferLocal===true?data.tapdAccessToken:token||data.tapdAccessToken;}catch(e){if(!token&&e.code!=='ENOENT')throw Error('无法读取本机 TAPD 凭据，请在任务看板设置中重新保存令牌');}
 if(typeof token!=='string'||!/^[!-~]{1,4096}$/.test(token))throw Error('尚未配置 TAPD 凭据，请在任务看板设置中保存一次令牌');
 if(!/^\d{1,32}$/.test(task.account)||!/^\d{1,32}$/.test(task.sourceId))throw Error('任务来源信息无效');
 const url=new URL('https://api.tapd.cn/svn_commits/get_scm_copy_keywords');url.search=new URLSearchParams({workspace_id:task.account,object_id:task.sourceId,type:'task'});
 let reader;const signal=AbortSignal.timeout(20000);
 try{
 const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{accept:'application/json',authorization:`Bearer ${token}`},signal});
 if([401,403,422].includes(response.status))throw Error('TAPD 凭据无效或权限不足，请更新令牌');if(response.status===429)throw Error('TAPD 请求限流，请稍后重试');if(!response.ok)throw Error('TAPD 暂时无法获取关键字，请重试');
 reader=response.body?.getReader();if(!reader)throw Error('TAPD 返回格式无效');let size=0;const chunks=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('TAPD 返回数据过大');chunks.push(value);}const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(data?.status!==1||typeof data.data!=='string'||!data.data.trim()||data.data.length>2048||/[\x00-\x1f]/.test(data.data))throw Error('TAPD 返回的源码关键字无效');return {taskId,keyword:data.data.trim()};
 }catch(e){if(reader)await reader.cancel().catch(()=>{});if(signal.aborted)throw Error('获取 TAPD 关键字超时，请重试');if(e instanceof SyntaxError)throw Error('TAPD 返回格式无效');if(e instanceof TypeError)throw Error('无法连接 TAPD，请检查网络后重试');throw e;}
}

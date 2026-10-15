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

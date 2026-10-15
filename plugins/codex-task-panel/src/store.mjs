import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {normalizeSourceInput,sourceKey,sourceHash} from './source-input.mjs';

const laneName=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>48||/[\x00-\x1f]/.test(value))throw new Error('INVALID_LANE_NAME');return value.trim();};
const revision=value=>{if(!Number.isSafeInteger(value)||value<1)throw new Error('VERSION_CONFLICT');};

export class BoardStore {
  constructor(path){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);
    if(path!==':memory:')chmodSync(path,0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta VALUES('schema',1);
      CREATE TABLE IF NOT EXISTS lanes(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,position INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS task_scm(task_id TEXT PRIMARY KEY REFERENCES tasks(id),keyword TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,source_json TEXT NOT NULL,hash TEXT NOT NULL,lane_id TEXT NOT NULL REFERENCES lanes(id),position INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,imported_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS config(id INTEGER PRIMARY KEY CHECK(id=1),workspace_id TEXT NOT NULL DEFAULT '',owner_name TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,identity_json TEXT);
      INSERT OR IGNORE INTO config(id) VALUES(1);`);
    const schema=this.db.prepare("SELECT value FROM meta WHERE key='schema'").get().value;
    if(![1,2,3].includes(schema))throw new Error('UNSUPPORTED_SCHEMA');
    this.transaction(()=>{this.db.exec(`CREATE TABLE IF NOT EXISTS task_threads(task_id TEXT NOT NULL REFERENCES tasks(id),thread_id TEXT NOT NULL,title TEXT NOT NULL,cwd TEXT NOT NULL,bound_at INTEGER NOT NULL,PRIMARY KEY(task_id,thread_id));
      CREATE TABLE IF NOT EXISTS thread_creations(request_id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),title TEXT NOT NULL,cwd TEXT NOT NULL,thread_json TEXT);
`);});
    this.transaction(()=>{if(!this.db.prepare('SELECT id FROM lanes LIMIT 1').get())['待处理','进行中','待验收','已完成'].forEach((name,i)=>this.db.prepare('INSERT INTO lanes(id,name,position) VALUES(?,?,?)').run(randomUUID(),name,i));});
    this.transaction(()=>{
      this.db.exec(`CREATE TABLE IF NOT EXISTS workflow_transitions(from_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,to_lane_id TEXT NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,PRIMARY KEY(from_lane_id,to_lane_id),CHECK(from_lane_id<>to_lane_id));
        INSERT OR IGNORE INTO meta VALUES('workflow_version',1);`);
      if(schema<3){const lanes=this.db.prepare('SELECT id FROM lanes ORDER BY position,id').all();for(let i=1;i<lanes.length;i++)this.db.prepare('INSERT OR IGNORE INTO workflow_transitions VALUES(?,?)').run(lanes[i-1].id,lanes[i].id);}
      this.db.exec("UPDATE meta SET value=3 WHERE key='schema'");
    });
  }
  workflow(){return {version:this.db.prepare("SELECT value FROM meta WHERE key='workflow_version'").get().value,transitions:this.db.prepare('SELECT from_lane_id AS fromLaneId,to_lane_id AS toLaneId FROM workflow_transitions ORDER BY from_lane_id,to_lane_id').all()};}
  updateWorkflow({fromLaneId,toLaneIds,version}){revision(version);return this.transaction(()=>{
    if(this.workflow().version!==version)throw new Error('VERSION_CONFLICT');
    const ids=new Set(this.snapshot().lanes.map(l=>l.id));
    if(!ids.has(fromLaneId)||!Array.isArray(toLaneIds)||new Set(toLaneIds).size!==toLaneIds.length||toLaneIds.some(id=>id===fromLaneId||!ids.has(id)))throw new Error('INVALID_WORKFLOW');
    this.db.prepare('DELETE FROM workflow_transitions WHERE from_lane_id=?').run(fromLaneId);
    for(const id of toLaneIds)this.db.prepare('INSERT INTO workflow_transitions VALUES(?,?)').run(fromLaneId,id);
    this.db.exec("UPDATE meta SET value=value+1 WHERE key='workflow_version'");return this.snapshot();
  });}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
  taskRow(r){return r?{...JSON.parse(r.source_json),id:r.id,laneId:r.lane_id,position:r.position,version:r.version,hash:r.hash,importedAt:r.imported_at,threadCount:this.db.prepare('SELECT COUNT(*) AS n FROM task_threads WHERE task_id=?').get(r.id).n}:null;}
  snapshot(){return {workflow:this.workflow(),lanes:this.db.prepare('SELECT id,name,position,version FROM lanes ORDER BY position,id').all(),tasks:this.db.prepare('SELECT * FROM tasks ORDER BY position,id').all().map(r=>this.taskRow(r))};}
  getTask(id){const task=this.taskRow(this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id));if(!task)throw new Error('TASK_NOT_FOUND');return task;}
  scmKeyword(id){this.getTask(id);return this.db.prepare('SELECT keyword FROM task_scm WHERE task_id=?').get(id)?.keyword??'';}
  saveScmKeyword(id,keyword){this.getTask(id);if(typeof keyword!=='string'||keyword.length>2048||/[\x00-\x1f]/.test(keyword))throw Error('INVALID_SCM_KEYWORD');this.db.prepare('INSERT INTO task_scm VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET keyword=excluded.keyword').run(id,keyword.trim());return {task:{...this.getTask(id),scmKeyword:this.scmKeyword(id)}};}
  findSource(s){return this.taskRow(this.db.prepare('SELECT * FROM tasks WHERE source_key=?').get(sourceKey(s)));}
  threads(taskId){this.getTask(taskId);return this.db.prepare('SELECT thread_id AS id,title,cwd,bound_at AS boundAt FROM task_threads WHERE task_id=? ORDER BY bound_at,thread_id').all(taskId);}
  bindThreads(taskId,threads){this.getTask(taskId);this.transaction(()=>{for(const t of threads)this.db.prepare('INSERT OR IGNORE INTO task_threads VALUES(?,?,?,?,?)').run(taskId,t.id,t.title,t.cwd,Date.now());});}
  unbindThread(taskId,threadId){this.getTask(taskId);this.db.prepare('DELETE FROM task_threads WHERE task_id=? AND thread_id=?').run(taskId,threadId);}
  creation(id){const r=this.db.prepare('SELECT * FROM thread_creations WHERE request_id=?').get(id);return r?{...r,thread:r.thread_json?JSON.parse(r.thread_json):null}:null;}
  reserveCreation(id,taskId,title,cwd){this.getTask(taskId);this.db.prepare('INSERT INTO thread_creations VALUES(?,?,?,?,NULL)').run(id,taskId,title,cwd);}
  saveCreation(id,thread){this.db.prepare('UPDATE thread_creations SET thread_json=? WHERE request_id=?').run(JSON.stringify(thread),id);}
  config(){const c=this.db.prepare('SELECT * FROM config WHERE id=1').get();return {workspaceId:c.workspace_id,ownerName:c.owner_name,version:c.version,identity:c.identity_json?JSON.parse(c.identity_json):null};}
  configure({workspaceId,ownerName,version}){
    if(typeof workspaceId!=='string'||!/^\d{1,32}$/.test(workspaceId)||typeof ownerName!=='string'||!ownerName.trim()||ownerName.length>128)throw new Error('INVALID_CONFIG');
    revision(version);this.transaction(()=>{const c=this.config();if(c.version!==version)throw new Error('VERSION_CONFLICT');this.db.prepare('UPDATE config SET workspace_id=?,owner_name=?,version=version+1,identity_json=NULL WHERE id=1').run(workspaceId,ownerName.trim());});return this.config();
  }
  createLane(name){name=laneName(name);return this.transaction(()=>{if(this.db.prepare('SELECT id FROM lanes WHERE name=?').get(name))throw new Error('LANE_NAME_EXISTS');if(this.snapshot().lanes.length>=20)throw new Error('LANE_LIMIT');const id=randomUUID();this.db.prepare('INSERT INTO lanes(id,name,position) VALUES(?,?,?)').run(id,name,this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS p FROM lanes').get().p);this.db.exec("UPDATE meta SET value=value+1 WHERE key='workflow_version'");return this.snapshot();});}
  renameLane(id,name,version){name=laneName(name);revision(version);return this.transaction(()=>{const l=this.db.prepare('SELECT * FROM lanes WHERE id=?').get(id);if(!l)throw new Error('LANE_NOT_FOUND');if(l.version!==version)throw new Error('VERSION_CONFLICT');if(this.db.prepare('SELECT id FROM lanes WHERE name=? AND id<>?').get(name,id))throw new Error('LANE_NAME_EXISTS');this.db.prepare('UPDATE lanes SET name=?,version=version+1 WHERE id=?').run(name,id);return this.snapshot();});}
  reorderLanes(items){return this.transaction(()=>{const lanes=this.snapshot().lanes;if(!Array.isArray(items)||items.length!==lanes.length||new Set(items.map(i=>i.id)).size!==lanes.length)throw new Error('INVALID_LANE_ORDER');for(const item of items){const l=lanes.find(l=>l.id===item.id);if(!l||l.version!==item.version)throw new Error('VERSION_CONFLICT');}items.forEach((l,i)=>this.db.prepare('UPDATE lanes SET position=?,version=version+1 WHERE id=?').run(i,l.id));return this.snapshot();});}
  deleteLane(id,version){revision(version);return this.transaction(()=>{const lanes=this.snapshot().lanes,l=lanes.find(l=>l.id===id);if(!l)throw new Error('LANE_NOT_FOUND');if(l.version!==version)throw new Error('VERSION_CONFLICT');if(lanes.length<=1)throw new Error('LAST_LANE');if(this.db.prepare('SELECT id FROM tasks WHERE lane_id=? LIMIT 1').get(id))throw new Error('LANE_NOT_EMPTY');this.db.prepare('DELETE FROM lanes WHERE id=?').run(id);this.db.exec("UPDATE meta SET value=value+1 WHERE key='workflow_version'");return this.snapshot();});}
  moveCard({id,laneId,beforeId,version}){revision(version);return this.transaction(()=>{
    const task=this.getTask(id);if(task.version!==version)throw new Error('VERSION_CONFLICT');
    if(!this.db.prepare('SELECT id FROM lanes WHERE id=?').get(laneId))throw new Error('LANE_NOT_FOUND');
    if(task.laneId!==laneId&&!this.db.prepare('SELECT 1 FROM workflow_transitions WHERE from_lane_id=? AND to_lane_id=?').get(task.laneId,laneId))throw new Error('TRANSITION_NOT_ALLOWED');
    if(beforeId===id&&task.laneId===laneId)return this.snapshot();
    const target=this.db.prepare('SELECT id FROM tasks WHERE lane_id=? AND id<>? ORDER BY position,id').all(laneId,id).map(r=>r.id);
    const index=beforeId?target.indexOf(beforeId):target.length;if(index<0)throw new Error('INVALID_DROP_TARGET');target.splice(index,0,id);
    this.db.prepare('UPDATE tasks SET lane_id=? WHERE id=?').run(laneId,id);
    target.forEach((taskId,i)=>this.db.prepare('UPDATE tasks SET position=?,version=version+1 WHERE id=?').run(i,taskId));
    return this.snapshot();
  });}
  getRun(id){const row=this.db.prepare('SELECT result_json FROM runs WHERE id=?').get(id);return row?JSON.parse(row.result_json):null;}
  history(){return this.db.prepare('SELECT result_json FROM runs ORDER BY created_at DESC,rowid DESC LIMIT 50').all().map(r=>JSON.parse(r.result_json));}
  applyImport(inputs,{runId,laneId,expectedHashes,configVersion,identity}={}){
    if(typeof runId!=='string'||!runId||!Array.isArray(inputs)||inputs.length<1)throw new Error('INVALID_IMPORT');
    const records=inputs.map(normalizeSourceInput);
    if(new Set(records.map(sourceKey)).size!==records.length)throw new Error('DUPLICATE_SELECTION');
    const requestHash=createHash('sha256').update(JSON.stringify([records,laneId??null])).digest('hex');
    return this.transaction(()=>{
      const prior=this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
      if(prior){if(prior.request_hash!==requestHash)throw new Error('CONFIRMATION_REUSED');return JSON.parse(prior.result_json);}
      if(configVersion!==undefined&&this.config().version!==configVersion)throw new Error('CONFIG_CHANGED');
      const target=laneId??this.snapshot().lanes[0].id;if(!this.db.prepare('SELECT id FROM lanes WHERE id=?').get(target))throw new Error('LANE_NOT_FOUND');
      let created=0,updated=0;const time=Date.now(),ids=[];
      for(const source of records){
        const key=sourceKey(source),existing=this.findSource(source),hash=sourceHash(source);
        if(expectedHashes&&(!Object.hasOwn(expectedHashes,key)||expectedHashes[key]!== (existing?.hash??null)))throw new Error('PREVIEW_STALE');
        if(existing){
          if(source.sourceUpdatedAt<existing.sourceUpdatedAt||(source.sourceUpdatedAt===existing.sourceUpdatedAt&&existing.hash!==hash))throw new Error('SOURCE_VERSION_CONFLICT');
          if(existing.hash!==hash){this.db.prepare('UPDATE tasks SET source_json=?,hash=?,version=version+1 WHERE id=?').run(JSON.stringify(source),hash,existing.id);updated++;}
          ids.push(existing.id);
        }else{const id=randomUUID(),p=this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS p FROM tasks WHERE lane_id=?').get(target).p;
          this.db.prepare('INSERT INTO tasks(id,source_key,source_json,hash,lane_id,position,imported_at) VALUES(?,?,?,?,?,?,?)').run(id,key,JSON.stringify(source),hash,target,p,time);ids.push(id);created++;
        }
      }
      if(identity)this.db.prepare('UPDATE config SET identity_json=? WHERE id=1').run(JSON.stringify(identity));
      const result={runId,created,updated,count:records.length,taskIds:ids,selectedSourceIds:records.map(s=>s.sourceId),laneId:target,finishedAt:time};
      this.db.prepare('INSERT INTO runs VALUES(?,?,?,?)').run(runId,requestHash,JSON.stringify(result),time);return result;
    });
  }
}

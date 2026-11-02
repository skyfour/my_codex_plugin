import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodexProjects} from '../src/codex-projects.mjs';
import {ThreadService} from '../src/thread-service.mjs';
import {BoardStore} from '../src/store.mjs';
import {CodexThreads} from '../src/codex-client.mjs';
import {source} from './fixtures.mjs';
import {createPanelServer} from '../servers/server.mjs';

test('project picker uses desktop projects, order and selection, preserving every root',async()=>{
 const home=await mkdtemp(join(tmpdir(),'panel-projects-')),one=join(home,'one'),two=join(home,'two');await mkdir(one);await mkdir(two);
 const a=randomUUID(),b=randomUUID(),extra=randomUUID(),calls=[];
 const native=[{id:a,name:'Native A',roots:[{path:one},{path:two}]},{id:b,name:'Native B',roots:[{path:two}]},{id:extra,name:'not in sidebar',roots:[{path:one}]}];
 const state={'local-projects':{alpha:{id:'alpha',name:'前端项目',rootPaths:[one,two]},beta:{id:'beta',name:'后端项目',rootPaths:[two]}},'project-order':['beta','alpha'],'selected-project':{type:'local',projectId:'alpha'},'app-server-project-id-by-legacy-project-id-by-host':{['local:'+home]:{alpha:a,beta:b}}};
 try{
  await writeFile(join(home,'.codex-global-state.json'),JSON.stringify(state));
  const projects=new CodexProjects({codeHome:home,connect:async fn=>fn(async(method,args)=>{calls.push({method,args});return {data:native,nextCursor:null};})});
  const result=await projects.list();assert.deepEqual(result.items.map(p=>p.id),['beta','alpha']);assert.equal(result.selectedId,'alpha');
  assert.equal(result.items[1].title,'前端项目');assert.deepEqual(result.items[1].roots,[one,two]);assert.equal(result.items[1].available,true);
  assert.equal((await projects.resolve('alpha')).nativeId,a);await assert.rejects(projects.resolve(extra),/PROJECT_UNAVAILABLE/);
  await rm(two,{recursive:true});await assert.rejects(projects.resolve('alpha'),/PROJECT_UNAVAILABLE/);
  assert.ok(calls.every(c=>c.method==='project/list'));
 }finally{await rm(home,{recursive:true,force:true});}
});

test('native project pages are read without relying on thread history; errors stay retryable',async()=>{
 const home=await mkdtemp(join(tmpdir(),'panel-project-pages-')),id=randomUUID();let fail=false;
 const projects=new CodexProjects({codeHome:home,connect:async fn=>fn(async(method,args)=>{if(fail)throw Error('offline');return args.cursor?{data:[{id,name:'Project',roots:[{path:home}]}],nextCursor:null}:{data:[],nextCursor:'next'};})});
 try{assert.equal((await projects.list()).items[0].id,id);fail=true;await assert.rejects(projects.list(),/PROJECTS_UNAVAILABLE/);fail=false;assert.equal((await projects.list()).items.length,1);}
 finally{await rm(home,{recursive:true,force:true});}
});

test('new chat resolves its project on the server and retries keep the same project and thread',async()=>{
 const home=await mkdtemp(join(tmpdir(),'panel-project-create-')),store=new BoardStore(':memory:');store.applyImport([source()],{runId:'seed'});
 const selected={id:'desktop-project',nativeId:randomUUID(),title:'Project',roots:[home],cwd:home,available:true},created={id:randomUUID(),title:'Empty',cwd:home};let creates=0;
 const service=new ThreadService(store,{create:async(cwd,saved,title,project)=>{creates++;assert.equal(cwd,home);assert.equal(project.nativeId,selected.nativeId);saved(created);return created;}},{resolve:async id=>{if(id!==selected.id)throw Error('PROJECT_UNAVAILABLE');return selected;}});
 const args={taskId:store.snapshot().tasks[0].id,requestId:randomUUID(),title:'Empty',projectId:selected.id};
 try{assert.equal((await service.create(args)).thread.id,created.id);assert.equal((await service.create(args)).bound,true);assert.equal(creates,1);await assert.rejects(service.create({...args,projectId:'another'}),/CONFIRMATION_REUSED/);assert.equal(store.creation(args.requestId).project_id,selected.id);}
 finally{store.close();await rm(home,{recursive:true,force:true});}
});

test('connection failure before thread/start does not leave a poisoned creation request',async()=>{
 const home=await mkdtemp(join(tmpdir(),'panel-unstarted-')),store=new BoardStore(':memory:');store.applyImport([source()],{runId:'seed'});
 let down=true,starts=0;const created={id:randomUUID(),cwd:home,path:join(home,'rollout.jsonl')};await writeFile(created.path,'saved');
 const provider=new CodexThreads(async fn=>{if(down)throw Error('CODEX_UNAVAILABLE');return fn(async method=>{if(method==='thread/start')starts++;return {thread:created};});});
 const project={id:'project',nativeId:randomUUID(),roots:[home],cwd:home,available:true},service=new ThreadService(store,provider,{resolve:async()=>project});
 const args={taskId:store.snapshot().tasks[0].id,requestId:randomUUID(),title:'Empty',projectId:'project'};
 try{await assert.rejects(service.create(args),/CREATION_NOT_STARTED/);assert.equal(store.creation(args.requestId),null);assert.equal(starts,0);down=false;assert.equal((await service.create(args)).bound,true);assert.equal(starts,1);}
 finally{store.close();await rm(home,{recursive:true,force:true});}
});

test('public create accepts a project selection and rejects caller-supplied paths before creation',async()=>{
 const store=new BoardStore(':memory:');store.applyImport([source()],{runId:'seed'});let creates=0;
 const project={id:'project',nativeId:randomUUID(),roots:[tmpdir()],cwd:tmpdir(),available:true};
 const app=createPanelServer({store,env:{},projects:{list:async()=>({items:[project],selectedId:project.id}),resolve:async()=>project},threads:{create:async(cwd,saved,title)=>{creates++;const t={id:randomUUID(),cwd,title};saved(t);return t;}}});
 const args={taskId:store.snapshot().tasks[0].id,requestId:randomUUID(),title:'Empty'};
 try{
  const invalid=await app.actions.get('thread_create')({...args,cwd:'/unexpected'});assert.equal(invalid.isError,true);assert.equal(creates,0);
  const result=await app.actions.get('thread_create')({...args,projectId:'project'});assert.equal(result.structuredContent.bound,true);assert.equal(creates,1);
  assert.equal((await app.actions.get('project_list')({})).structuredContent.items[0].id,'project');
 }finally{await app.server.close();store.close();}
});

test('schema 3 pending creations and existing task links survive the project journal upgrade',async()=>{
 const home=await mkdtemp(join(tmpdir(),'panel-project-migrate-')),path=join(home,'board.sqlite');let store=new BoardStore(path);
 try{
  store.applyImport([source()],{runId:'seed'});const taskId=store.snapshot().tasks[0].id,requestId=randomUUID(),thread={id:randomUUID(),title:'Existing',cwd:home};
  store.reserveCreation(requestId,taskId,'Existing',home);store.saveCreation(requestId,thread);store.bindThreads(taskId,[thread]);const before=store.snapshot();
  store.db.exec("ALTER TABLE thread_creations DROP COLUMN project_id; UPDATE meta SET value=3 WHERE key='schema'");store.close();store=new BoardStore(path);
  assert.deepEqual(store.snapshot(),before);assert.deepEqual(store.creation(requestId).thread,thread);assert.equal(store.creation(requestId).project_id,null);assert.equal(store.threads(taskId)[0].id,thread.id);
 }finally{store.close();await rm(home,{recursive:true,force:true});}
});

test('recovering a known creation does not depend on the project list still being available',async()=>{
 const store=new BoardStore(':memory:');store.applyImport([source()],{runId:'seed'});let projectDown=false,verificationDown=true,starts=0;
 const project={id:'project',nativeId:randomUUID(),roots:[tmpdir()],cwd:tmpdir(),available:true},thread={id:randomUUID(),cwd:tmpdir(),title:'Empty'};
 const service=new ThreadService(store,{create:async(cwd,saved)=>{starts++;saved(thread);return thread;},verifyCreated:async()=>{if(verificationDown)throw Error('CODEX_UNAVAILABLE');}},{resolve:async()=>{if(projectDown)throw Error('PROJECTS_UNAVAILABLE');return project;}});
 const args={taskId:store.snapshot().tasks[0].id,requestId:randomUUID(),title:'Empty',projectId:'project'};
 try{await assert.rejects(service.create(args),/CODEX_UNAVAILABLE/);projectDown=true;verificationDown=false;assert.equal((await service.create(args)).bound,true);assert.equal(starts,1);}
 finally{store.close();}
});

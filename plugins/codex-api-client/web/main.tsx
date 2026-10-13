import React,{useEffect,useRef,useState} from 'react';
import {TreeMenu,TreeIcon} from './TreeMenu';
import {createRoot} from 'react-dom/client';
import {call,download} from './bridge';
import {CodeEditor} from './Editor';
import {SettingsPanel} from './SettingsPanel';
import {BrandIcon} from './BrandIcon';
import {EnvironmentPicker} from './EnvironmentPicker';
import {AuthEditor,Rows,Modal,type Row} from './components';
import {findItem} from '../src/collections.mjs';
import './style.css';

type Doc={kind:string,id:string,revision:number,data:any};
type Tab={key:string,doc:Doc,itemId?:string,dirty:boolean};
type State={collections:Doc[],environments:Doc[],globals:Doc|null,settings:Doc|null,cookies:Doc|null,history:any[],defaults:any};
const empty:State={collections:[],environments:[],globals:null,settings:null,cookies:null,history:[],defaults:{}};
const uid=()=>crypto.randomUUID();
const stringify=(v:any)=>JSON.stringify(v,null,2);
const clone=<T,>(v:T):T=>structuredClone(v);
const rawUrl=(r:any):string=>typeof r.url==='string'?r.url:r.url?.raw||`${r.url?.protocol||'https'}://${[].concat(r.url?.host||[]).join('.')}/${[].concat(r.url?.path||[]).join('/')}`;
const nodeOf=(tab:Tab|undefined):any=>!tab?null:tab.itemId?findItem(tab.doc.data,tab.itemId)?.item:tab.doc.data;
const titleOf=(tab:Tab)=>nodeOf(tab)?.name||nodeOf(tab)?.info?.name||'未命名';

function App(){
  const [state,setState]=useState<State>(empty),[tabs,setTabs]=useState<Tab[]>([]),[active,setActive]=useState('');
  const [section,setSection]=useState('collections'),[editorTab,setEditorTab]=useState('参数'),[scriptStage,setScriptStage]=useState('prerequest');
  const [theme,setTheme]=useState(()=>localStorage.getItem('api-theme')||'light'),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [environment,setEnvironment]=useState(()=>localStorage.getItem('api-environment')||''),[busy,setBusy]=useState(false),[results,setResults]=useState<Record<string,any>>({}),[responseTab,setResponseTab]=useState('正文'),[responseIndex,setResponseIndex]=useState(0),[pretty,setPretty]=useState(true),[search,setSearch]=useState('');
  const [modal,setModal]=useState(''),[importText,setImportText]=useState(''),[importWarnings,setImportWarnings]=useState<string[]>([]),[confirm,setConfirm]=useState<{text:string,action:()=>void}|null>(null);
  const [runOptions,setRunOptions]=useState({iterations:1,delay:0,stopOnFailure:false}),[dataText,setDataText]=useState(''),[dataFormat,setDataFormat]=useState('json');
  const [settingsRevision,setSettingsRevision]=useState(0),[cookiesRevision,setCookiesRevision]=useState(0);
  const [settingsText,setSettingsText]=useState(''),[cookiesText,setCookiesText]=useState(''),[moveTarget,setMoveTarget]=useState(''),[movePosition,setMovePosition]=useState(0);
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(localStorage.getItem('api-collapsed')||'{}');}catch{return {};}});
  useEffect(()=>{localStorage.setItem('api-collapsed',JSON.stringify(collapsed));},[collapsed]);
  const toggle=(key:string)=>setCollapsed(v=>({...v,[key]:!v[key]}));
  const [sidebar,setSidebar]=useState(260),[split,setSplit]=useState(54),[ready,setReady]=useState(false);
  const tab=tabs.find(t=>t.key===active),node=nodeOf(tab),request=node?.request;
  const result=results[active]||null;
  const setResult=(value:any,key=active)=>setResults(all=>({...all,[key]:value}));
  const structureBusy=useRef(false),[changingStructure,setChangingStructure]=useState(false);
  const saves=useRef(new Map<string,Promise<Doc|undefined>>());
  const [menu,setMenu]=useState<{target:Tab,x:number,y:number}|null>(null),[actionTarget,setActionTarget]=useState<Tab>(),[rename,setRename]=useState('');
  const dialogTarget=actionTarget||tab;
  const showResponse=!!request||!!result;
  function targetOf(doc:Doc,itemId?:string):Tab{const draft=latest.current.tabs.find(t=>t.doc.kind===doc.kind&&t.doc.id===doc.id);return {key:`${doc.kind}:${doc.id}:${itemId||'root'}`,doc:draft?.doc||doc,itemId,dirty:draft?.dirty||false};}
  function rowMenu(e:React.MouseEvent,doc:Doc,itemId?:string){e.preventDefault();const r=e.currentTarget.getBoundingClientRect();setMenu({target:targetOf(doc,itemId),x:e.type==='contextmenu'?e.clientX:r.right,y:e.type==='contextmenu'?e.clientY:r.bottom+4});}
  const latest=useRef({tab,tabs});latest.current={tab,tabs};
  const safe=async(fn:()=>Promise<any>)=>{setError('');try{return await fn();}catch(e){setError(e instanceof Error?e.message:String(e));return undefined;}};
  const refresh=async()=>{const s=await call<State>('api_workspace_state');setState(s);setReady(true);return s;};
  useEffect(()=>{safe(refresh);const timer=setInterval(()=>{refresh().catch(()=>{});},4000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('api-theme',theme);},[theme]);
  useEffect(()=>{localStorage.setItem('api-environment',environment);},[environment]);
  useEffect(()=>{if(ready&&environment&&!state.environments.some(e=>e.id===environment))setEnvironment('');},[ready,state.environments,environment]);
  useEffect(()=>{const before=(e:BeforeUnloadEvent)=>{if(latest.current.tabs.some(t=>t.dirty)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();if(!document.querySelector('[role=dialog]'))safe(()=>save(latest.current.tab));}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  const runningIds=Object.entries(results).filter(([,r])=>r.status==='running').map(([key,r])=>[key,r.id]);
  useEffect(()=>{
    if(!runningIds.length)return;
    let alive=true,polling=false;
    const poll=async()=>{if(polling)return;polling=true;try{await Promise.all(runningIds.map(async([key,id])=>{try{const r=await call('api_run_result',{runId:id,includeBodies:true});if(alive){setResults(all=>all[key]?.id===id?{...all,[key]:r}:all);if(r.status!=='running')refresh().catch(()=>{});}}catch(e){if(alive)setError(String(e));}}));}finally{polling=false;}};
    const timer=setInterval(poll,500);poll();return()=>{alive=false;clearInterval(timer);};
  },[JSON.stringify(runningIds)]);

  function open(doc:Doc,itemId?:string){
    const key=doc.kind+':'+doc.id+':'+(itemId||'root');
    setTabs(all=>{if(all.some(t=>t.key===key))return all;const existing=all.find(t=>t.doc.kind===doc.kind&&t.doc.id===doc.id);return [...all,{key,doc:clone(existing?.doc||doc),itemId,dirty:existing?.dirty||false}];});
    setActive(key);setEditorTab(doc.kind==='collection'?(itemId&&findItem(doc.data,itemId)?.item.request?'参数':'概览'):'变量');
  }
  function edit(patch:(draft:any)=>void){
    if(!tab||structureBusy.current)return;
    setTabs(all=>{const current=all.find(t=>t.key===tab.key);if(!current)return all;const doc=clone(current.doc),node=nodeOf({...current,doc});if(!node)return all;patch(node);return all.map(t=>t.doc.kind===doc.kind&&t.doc.id===doc.id?{...t,doc,dirty:true}:t);});
  }
  async function save(current=tab):Promise<Doc|undefined>{
    if(!current)return;
    const key=current.doc.kind+':'+current.doc.id,pending=saves.current.get(key);
    if(pending){const saved=await pending,next=latest.current.tabs.find(t=>t.doc.kind===current!.doc.kind&&t.doc.id===current!.doc.id);return next?save({...current,doc:next.doc,dirty:next.dirty}):saved;}
    const live=latest.current.tabs.find(t=>t.doc.kind===current!.doc.kind&&t.doc.id===current!.doc.id);
    current=live?{...current,doc:live.doc,dirty:live.dirty}:current;
    if(!current.dirty)return current.doc;
    const snapshot=JSON.stringify(current.doc.data),draft=current;
    const saving=(async()=>{
      const saved=await call<Doc>('api_document_put',{kind:draft.doc.kind,id:draft.doc.id,revision:draft.doc.revision,data:draft.doc.data});
      setTabs(all=>all.map(t=>{if(t.doc.id!==saved.id||t.doc.kind!==saved.kind)return t;return JSON.stringify(t.doc.data)!==snapshot?{...t,doc:{...t.doc,revision:saved.revision},dirty:true}:{...t,doc:clone(saved),dirty:false};}));
      await refresh();setNotice('已保存');return saved;
    })();
    saves.current.set(key,saving);try{return await saving;}finally{saves.current.delete(key);}
  }
  async function reloadCurrent(){if(!tab)return;const fresh=await call<Doc>('api_document_get',{kind:tab.doc.kind,id:tab.doc.id});setTabs(all=>all.filter(t=>t.doc.id!==fresh.id||t.doc.kind!==fresh.kind||!t.itemId||findItem(fresh.data,t.itemId)).map(t=>t.doc.id===fresh.id&&t.doc.kind===fresh.kind?{...t,doc:fresh,dirty:false}:t));setError('');}
  async function newCollection(){const doc=await call<Doc>('api_document_put',{kind:'collection',revision:0,data:{info:{name:'新集合'},item:[]}});await refresh();open(doc);}
  async function newEnvironment(){const doc=await call<Doc>('api_document_put',{kind:'environment',revision:0,data:{name:'新环境',values:[]}});await refresh();setEnvironment(doc.id);open(doc);}
  async function changeTree(action:()=>Promise<void>){if(structureBusy.current)return;structureBusy.current=true;setChangingStructure(true);try{await action();}finally{structureBusy.current=false;setChangingStructure(false);}}
  async function newItem(folder=false,target=tab){return changeTree(async()=>{
    let doc:Doc|undefined;if(target?.doc.kind==='collection')doc=await save(target);else doc=state.collections[0];
    if(!doc){await newCollection();return;}
    const item=folder?{name:'新文件夹',item:[]}:{name:'新请求',request:{method:'GET',url:'',header:[]},event:[]};
    const parentId=target?.itemId&&nodeOf(target)?.item?target.itemId:undefined;
    const saved=await call<Doc>('api_item_edit',{collectionId:doc.id,revision:doc.revision,operation:'upsert',parentId,item,position:(parentId?findItem(doc.data,parentId)?.item.item:doc.data.item)?.length||0});
    setTabs(all=>all.map(t=>t.doc.id===doc!.id&&!t.dirty?{...t,doc:clone(saved)}:t));
    setCollapsed(v=>({...v,[doc!.id]:false,...(parentId?{[doc!.id+':'+parentId]:false}:{})}));
    const container=parentId?findItem(saved.data,parentId)?.item:saved.data;
    await refresh();open(saved,container.item.at(-1).id);
  });}
  async function treeAction(operation:string,target=tab){return changeTree(async()=>{
    if(!target?.itemId)return;const doc=await save(target);if(!doc)return;
    const saved=await call<Doc>('api_item_edit',{collectionId:doc.id,itemId:target.itemId,operation,revision:doc.revision,...(operation==='move'?{parentId:moveTarget||undefined,position:movePosition}:{})});
    setTabs(all=>all.filter(t=>operation!=='delete'||t.doc.id!==saved.id||!t.itemId||findItem(saved.data,t.itemId)).map(t=>t.doc.id===saved.id&&!t.dirty?{...t,doc:clone(saved)}:t));await refresh();setModal('');
    if(operation==='delete'){if(latest.current.tab?.doc.id===saved.id&&latest.current.tab.itemId&&!findItem(saved.data,latest.current.tab.itemId))setActive('');}else setNotice(operation==='duplicate'?'已复制，可在左侧打开副本':'已移动');
  });}
  async function removeDoc(target=tab){if(!target)return;target=targetOf(target.doc,target.itemId);await call('api_document_delete',{kind:target.doc.kind,id:target.doc.id,revision:target.doc.revision});setTabs(all=>all.filter(t=>t.doc.id!==target.doc.id||t.doc.kind!==target.doc.kind));if(latest.current.tab?.doc.id===target.doc.id)setActive('');await refresh();}
  async function copyCollection(target=tab){if(!target)return;const doc=await save(target);if(!doc)return;const data=clone(doc.data);data.info.name+=' 副本';data.info._postman_id=uid();const copied=await call<Doc>('api_document_put',{kind:'collection',revision:0,data});await refresh();setModal('');open(copied);}
  async function renameTarget(){const target=dialogTarget;if(!target||!rename.trim())return;await changeTree(async()=>{const doc=await save(target);if(!doc)return;const data=clone(doc.data),n=target.itemId?findItem(data,target.itemId)?.item:data;if(!n)throw Error('该项目已被删除，请刷新工作区');if(n.info)n.info.name=rename.trim();else n.name=rename.trim();const saved=await call<Doc>('api_document_put',{kind:doc.kind,id:doc.id,revision:doc.revision,data});setTabs(all=>all.map(t=>t.doc.id===doc.id?{...t,doc:saved,dirty:false}:t));await refresh();setModal('');});}
  async function start(collectionRun=false,target=tab){
    if(!target||target.doc.kind!=='collection')return;
    setBusy(true);try{
      const saved=await save(target);if(!saved)return;
      const args:any={collectionId:saved.id,environmentId:environment||undefined,itemId:target.itemId};
      if(collectionRun)Object.assign(args,{options:runOptions,dataText,dataFormat});
      const r=await call('api_run_start',args);setResult({id:r.runId,status:'running',responses:[],assertions:[],logs:[],errors:[]},target.key);if(latest.current.tab?.key!==target.key)open(saved,target.itemId);setResponseIndex(0);setResponseTab('正文');setModal('');
    }finally{setBusy(false);}
  }
  async function upload(file:File){const data=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));const r=await call('api_file_upload',{name:file.name,base64:btoa(binary)});return r.path as string;}
  async function exportCurrent(format='postman',target=tab){if(!target)return;await save(target);const r=await call('api_export',{kind:target.doc.kind,id:target.doc.id,format,itemId:target.itemId});await download(r.name,r.text||stringify(r.data));if(r.warnings?.length)setNotice(r.warnings.join("；"));}
  async function importNow(){const r=await call('api_import',{text:importText});setImportWarnings(r.warnings);await refresh();if(r.document.kind==='environment')setEnvironment(r.document.id);open(r.document);if(!r.warnings.length){setModal('');setImportText('');setNotice('导入成功');}}
  async function globalVars(){const d=state.globals||await call<Doc>('api_document_put',{kind:'globals',id:'default',revision:0,data:{name:'全局变量',values:[]}});await refresh();open(d);}
  function ask(text:string,action:()=>void){setConfirm({text,action});}
  function resize(e:React.PointerEvent,target:'sidebar'|'split'){
    const bounds=e.currentTarget.parentElement!.getBoundingClientRect();const move=(ev:PointerEvent)=>target==='sidebar'?setSidebar(Math.max(180,Math.min(480,ev.clientX-bounds.left))):setSplit(Math.max(25,Math.min(75,(ev.clientY-bounds.top)/bounds.height*100)));
    const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);
  }
  function menuButton(doc:Doc,itemId?:string){const target=targetOf(doc,itemId);return <button className="tree-more" aria-label={'操作 '+titleOf(target)} aria-haspopup="menu" aria-expanded={menu?.target.key===target.key} disabled={changingStructure} onClick={e=>rowMenu(e,doc,itemId)}><TreeIcon name="more"/></button>;}
  function renderTree(doc:Doc,items:any[],depth=0):React.ReactNode{return items.map(item=>{const key=doc.id+':'+item.id;return <React.Fragment key={item.id}><div onContextMenu={e=>rowMenu(e,doc,item.id)} className={'tree-row '+(active===`collection:${doc.id}:${item.id}`?'selected':'')} style={{paddingLeft:12+depth*16}}>{item.item?<><button className="tree-toggle" aria-label={(collapsed[key]?'展开 ':'收起 ')+item.name} aria-expanded={!collapsed[key]} onClick={()=>toggle(key)}><TreeIcon name={collapsed[key]?'right':'down'}/></button><TreeIcon name="folder"/></>:<span className={'tree-symbol '+(item.request?.method||'GET').toLowerCase()}>{item.request?.method||'GET'}</span>}<button className="tree-name" title={item.name} onClick={()=>open(doc,item.id)}>{item.name}</button>{menuButton(doc,item.id)}</div>{item.item&&!collapsed[key]&&renderTree(doc,item.item,depth+1)}</React.Fragment>;});}
  function chooseTree(action:string,target:Tab){setMenu(null);setActionTarget(target);if(action==='open')open(target.doc,target.itemId);else if(action==='request'||action==='folder')safe(()=>newItem(action==='folder',target));else if(action==='rename'){setRename(titleOf(target));setModal('rename');}else if(action==='duplicate')safe(()=>target.itemId?treeAction('duplicate',target):copyCollection(target));else if(action==='move'){setMoveTarget('');setMovePosition(0);setModal('move');}else if(action==='run'){if(nodeOf(target)?.request)safe(()=>start(false,target));else setModal('runner');}else if(action==='export')safe(()=>exportCurrent(nodeOf(target)?.request?'curl':'postman',target));else if(action==='delete')ask('确认删除 '+titleOf(target)+'？'+(nodeOf(target)?.item?'其中的文件夹和请求也将删除。':''),()=>safe(()=>target.itemId?treeAction('delete',target):removeDoc(target)));}
  const selectedResponse=result?.responses?.[responseIndex]||result?.responses?.at(-1);
  const responseBody=selectedResponse?.body||'';let shownBody=responseBody;if(pretty){try{shownBody=stringify(JSON.parse(responseBody));}catch{}}
  const running=result?.status==='running';

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-mark"><BrandIcon/></span><b>API Client</b><span className="local-badge">LOCAL</span></div><div className="header-actions"><span className="connection"><i/>{ready?'本地工作区':'连接中…'}</span><button aria-label="切换主题" onClick={()=>setTheme(theme==='light'?'dark':'light')}>{theme==='light'?'☾':'☀'}</button><button onClick={()=>{setSettingsRevision(state.settings?.revision||0);setSettingsText(stringify({...state.defaults,...state.settings?.data}));setModal('settings');}}>设置</button></div></header>
    <div className="workspace-toolbar"><EnvironmentPicker environments={state.environments} globals={state.globals} value={environment} onSelect={setEnvironment} onEdit={doc=>open(doc as Doc)} onCreate={()=>safe(newEnvironment)} onImport={()=>{setImportWarnings([]);setModal('import');}} onGlobals={()=>safe(globalVars)}/><span className="workspace-toolbar-note">工作区环境</span></div>
    <div className="workspace" style={{gridTemplateColumns:`${sidebar}px 5px 1fr`}}>
      <aside className="sidebar"><div className="workspace-title"><span>我的工作区</span><button aria-label="刷新工作区" onClick={()=>safe(refresh)}>↻</button></div><div className="side-nav">{[['collections','集合'],['history','历史']].map(([key,label])=><button key={key} className={section===key?'active':''} onClick={()=>setSection(key)}>{label}</button>)}</div>
      <div className="side-tools">{section==='collections'?<><button onClick={()=>safe(newCollection)}>＋ 新建集合</button><button onClick={()=>{setImportWarnings([]);setModal('import');}}>导入</button></>:<span className="muted">最近 100 次运行</span>}</div>
      <div className="side-scroll">{section==='collections'&&<>{!state.collections.length&&<div className="side-empty">创建一个集合，<br/>开始整理你的 API。</div>}{state.collections.map(doc=><div className="collection" key={doc.id}><div onContextMenu={e=>rowMenu(e,doc)} className={'collection-head '+(active===`collection:${doc.id}:root`?'selected':'')}><button className="tree-toggle" aria-label={(collapsed[doc.id]?'展开 ':'收起 ')+doc.data.info.name} aria-expanded={!collapsed[doc.id]} onClick={()=>toggle(doc.id)}><TreeIcon name={collapsed[doc.id]?'right':'down'}/></button><TreeIcon name="collection"/><button className="tree-name" onClick={()=>open(doc)}>{doc.data.info.name}</button><small>{countRequests(doc.data)}</small>{menuButton(doc)}</div>{!collapsed[doc.id]&&renderTree(doc,doc.data.item)}</div>)}</>}
      {section==='history'&&state.history.map(h=><button className="history-row" key={h.id} onClick={()=>safe(async()=>{const value=await call('api_run_result',{runId:h.id,includeBodies:true});setResponseIndex(0);const doc=state.collections.find(c=>c.id===value.collectionId);if(doc){const itemId=value.itemId&&findItem(doc.data,value.itemId)?value.itemId:undefined;setResult(value,`collection:${doc.id}:${itemId||'root'}`);open(doc,itemId);}else{setResult(value);setModal('history');}})}><span className={'run-dot '+h.status}/><span><b>{h.name}</b><small>{new Date(h.createdAt).toLocaleString('zh-CN')} · {h.responses} 个响应</small></span><small>{h.failed?'失败 '+h.failed:h.status==='running'?'运行中':'查看'}</small></button>)}
      </div><footer className="sidebar-footer"><i/>数据保存在本机<span>v0.1</span></footer></aside>
      <div className="vertical-handle" role="separator" aria-label="调整侧栏宽度" onPointerDown={e=>resize(e,'sidebar')}/>
      <main className="main"><div className="request-tabs">{tabs.map(t=><div key={t.key} className={'request-tab '+(t.key===active?'active':'')}><button onClick={()=>{setActive(t.key);setEditorTab(t.doc.kind!=='collection'?'变量':nodeOf(t)?.request?'参数':'概览');}}><span className="tab-method">{nodeOf(t)?.request?.method||'◈'}</span>{titleOf(t)}{t.dirty&&<span className="dirty-dot"/>}</button><button aria-label={'关闭 '+titleOf(t)} onClick={()=>{const close=()=>{setTabs(all=>all.filter(v=>v.key!==t.key));if(active===t.key){const next=tabs.find(v=>v.key!==t.key);setActive(next?.key||'');setEditorTab(next?.doc.kind!=='collection'?'变量':nodeOf(next)?.request?'参数':'概览');}};t.dirty?ask('此集合或环境有未保存修改。关闭最后一个相关标签会丢失修改；其他相关标签仍会保留草稿。',close):close();}}>×</button></div>)}<button className="add-tab" aria-label="新建请求标签" onClick={()=>safe(()=>newItem())}>＋</button></div>
      {(error||notice)&&<div className={'message '+(error?'error':'success')} role={error?'alert':'status'}><span>{error||notice}</span>{error.includes('CONFLICT')&&<button onClick={()=>ask('重新加载会丢弃此集合或环境所有标签的未保存修改。',()=>safe(reloadCurrent))}>重新加载当前内容</button>}<button aria-label="关闭提示" onClick={()=>{setError('');setNotice('');}}>×</button></div>}
      {tab?<div className="editor-workspace" inert={changingStructure} aria-busy={changingStructure}>
        <div className="editor-top"><div className="breadcrumb">{tab.doc.kind==='collection'?'集合':tab.doc.kind==='globals'?'全局变量':'环境'}<span>/</span>{titleOf(tab)}{tab.dirty&&<small>未保存</small>}</div><div className="editor-controls"><button onClick={()=>safe(()=>save())}>保存</button><button aria-label="更多操作" onClick={()=>{setActionTarget(undefined);setModal('actions');}}>•••</button></div></div>
        <div className={"panes "+(!showResponse?"document-panes":"")}><section className="request-pane" style={{height:showResponse?split+'%':'100%'}}>
        <div className="name-row"><input aria-label="名称" className="name-input" value={node?.info?.name||node?.name||''} onChange={e=>edit(n=>{if(n.info)n.info.name=e.target.value;else n.name=e.target.value;})}/>{tab.doc.kind==='collection'&&<div className="inline-actions"><button onClick={()=>safe(()=>newItem())}>新建请求</button><button onClick={()=>safe(()=>newItem(true))}>新建文件夹</button>{!request&&<button className="primary" onClick={()=>{setActionTarget(undefined);setModal('runner');}}>运行集合</button>}</div>}</div>
        {request&&<div className="url-bar"><select aria-label="请求方法" value={request.method||'GET'} onChange={e=>edit(n=>{n.request.method=e.target.value;})}>{['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(m=><option key={m}>{m}</option>)}</select><input aria-label="URL" spellCheck={false} placeholder="输入 URL，例如 {{baseUrl}}/users" value={rawUrl(request)} onChange={e=>edit(n=>{n.request.url=e.target.value;delete n.request._query;})}/>{running?<button className="danger" onClick={()=>safe(()=>call('api_run_cancel',{runId:result.id}))}>取消</button>:<button aria-label="发送" className="primary" disabled={busy||!rawUrl(request)} onClick={()=>safe(()=>start())}>发送<span>↗</span></button>}</div>}
        <nav className="editor-nav">{(tab.doc.kind!=='collection'?['变量']:request?['参数','认证','请求头','请求体','脚本']:['概览','认证','脚本','变量']).map(label=><button key={label} aria-label={label} className={editorTab===label?'active':''} onClick={()=>setEditorTab(label)}>{label}{label==='请求头'&&request?.header?.length>0&&<small>{request.header.length}</small>}</button>)}</nav>
        <div className="editor-content" key={tab.key+':'+editorTab}>
          {editorTab==='概览'&&<div className="overview"><div className="overview-heading"><TreeIcon name="collection"/><div><b>{tab.itemId?'文件夹概览':'集合概览'}</b><p className="muted">组织接口请求，共享认证、变量和脚本。</p></div></div><label>描述<textarea aria-label="描述" rows={4} value={typeof (node.info?.description??node.description)==='string'?(node.info?.description??node.description):(node.info?.description??node.description)?.content||''} onChange={e=>edit(n=>{if(n.info)n.info.description=e.target.value;else n.description=e.target.value;})}/></label><div className="overview-metrics"><div><b>{countRequests(node)}</b><span>个请求</span></div><div><b>{(node.event||[]).filter((e:any)=>e.script?.exec?.length).length}</b><span>段脚本</span></div></div></div>}
          {editorTab==='变量'&&<><p className="panel-caption">使用 {'{{变量名}}'} 引用。敏感值保存到系统钥匙串，导出时排除。</p>{tab.itemId&&<p className="panel-caption">文件夹变量作为临时变量继承给子请求，优先级高于运行数据；不会改写集合或环境变量。</p>}<Rows variables rows={tab.doc.kind==='collection'?node.variable||[]:node.values||[]} onChange={rows=>edit(n=>{n[tab.doc.kind==='collection'?'variable':'values']=rows;})}/></>}
          {editorTab==='认证'&&<AuthEditor auth={request?request.auth:node.auth} onChange={auth=>edit(n=>{if(n.request)n.request.auth=auth;else n.auth=auth;})}/>}
          {editorTab==='请求头'&&<Rows rows={request.header||[]} onChange={rows=>edit(n=>{n.request.header=rows;})}/>}
          {editorTab==='参数'&&<><p className="panel-caption">查询参数 · 支持重复参数和变量</p><Rows rows={queryRows(request)} onChange={rows=>edit(n=>{n.request._query=rows;n.request.url=buildUrl(rawUrl(n.request),rows);})}/></>}
          {editorTab==='请求体'&&<BodyEditor request={request} edit={edit} theme={theme} upload={f=>safe(()=>upload(f))}/>}
          {editorTab==='脚本'&&<><div className="script-toolbar"><div className="segmented"><button className={scriptStage==='prerequest'?'active':''} onClick={()=>setScriptStage('prerequest')}>请求前</button><button className={scriptStage==='test'?'active':''} onClick={()=>setScriptStage('test')}>响应后</button></div><button className="text-button" onClick={()=>edit(n=>setScript(n,scriptStage,scriptStage==='test'?'pm.test("状态为 200", () => {\n  pm.response.to.have.status(200);\n});':'// 在请求前设置变量或生成签名\npm.variables.set("timestamp", Date.now());'))}>插入示例</button></div><CodeEditor testId="script-editor" value={getScript(node,scriptStage)} onChange={value=>edit(n=>setScript(n,scriptStage,value))} theme={theme}/><p className="panel-caption">{scriptStage==='prerequest'?'请求前':'响应后'}按集合 → 外层文件夹 → 内层文件夹 → 请求执行。支持 pm.* 脚本和断言。</p></>}
        </div></section>
        {showResponse&&<><div className="horizontal-handle" role="separator" aria-label="调整请求与响应高度" onPointerDown={e=>resize(e,'split')}/>
        <section className="response-pane"><div className="response-heading"><b>响应</b>{result&&<button className="text-button" onClick={()=>safe(()=>download('run-report.json',stringify(result)))}>导出报告</button>}{selectedResponse&&<><span className={'status-code '+(selectedResponse.code>=400?'bad':'')}>{selectedResponse.code} {selectedResponse.status}</span><span>{Math.round(selectedResponse.time)} ms</span><span>{Math.round((selectedResponse.size?.body||0)/1024*10)/10} KB</span></>}{running&&<><span className="spinner"/><span>请求执行中</span><button className="text-button" onClick={()=>safe(()=>call('api_run_cancel',{runId:result.id}))}>取消</button></>}{result&&result.status!=='running'&&<small>{({completed:'运行完成',cancelled:'已取消',failed:'运行失败'} as any)[result.status]}</small>}</div>
        {result?<><div className="response-tools"><nav>{['正文','响应头','Cookie','断言','日志','变量变化'].map(label=><button key={label} className={responseTab===label?'active':''} onClick={()=>setResponseTab(label)}>{label}{label==='断言'&&<small>{result.assertions.length}</small>}</button>)}</nav>{result.responses.length>1&&<select aria-label="选择响应" value={responseIndex} onChange={e=>setResponseIndex(Number(e.target.value))}>{result.responses.map((r:any,i:number)=><option key={i} value={i}>{i+1}. {r.name} · {r.code}</option>)}</select>}</div>
        {result.errors.length>0&&<div className="run-errors">{result.errors.map((e:any,i:number)=><p key={i}>{e.message}</p>)}</div>}
        <div className="response-content">{responseTab==='正文'&&<><div className="body-toolbar"><div className="segmented"><button className={pretty?'active':''} onClick={()=>setPretty(true)}>格式化</button><button className={!pretty?'active':''} onClick={()=>setPretty(false)}>原始</button></div><input aria-label="搜索响应" placeholder="搜索响应…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<small>{shownBody.split(search).length-1} 处</small>}<button onClick={()=>safe(async()=>{await navigator.clipboard.writeText(responseBody);setNotice('已复制响应');})}>复制</button><button onClick={()=>safe(()=>download('response.bin',selectedResponse?.bodyBase64||'',true))}>保存响应</button></div><pre data-testid="response-body">{search?shownBody.split(search).map((s:string,i:number)=><React.Fragment key={i}>{i>0&&<mark>{search}</mark>}{s}</React.Fragment>):shownBody||'等待响应…'}</pre></>}
        {responseTab==='响应头'&&<ReadTable rows={selectedResponse?.headers||[]}/>}{responseTab==='Cookie'&&<ReadTable rows={(selectedResponse?.cookies||[]).map((c:any)=>({key:c.name||c.key,value:c.value}))}/>}
        {responseTab==='断言'&&<div className="assertions">{!result.assertions.length&&<p className="muted">在响应后脚本中添加 pm.test() 查看断言结果。</p>}{result.assertions.map((a:any,i:number)=><div key={i} className={'assertion '+(a.error?'fail':'pass')}><span>{a.skipped?'跳过':a.error?'失败':'通过'}</span><b>{a.name}</b>{a.error&&<p>{a.error.message}</p>}</div>)}</div>}
        {responseTab==='日志'&&<div className="logs">{result.logs.map((l:any,i:number)=><pre key={i}><small>{l.level}</small> {l.messages.map((v:any)=>typeof v==='string'?v:stringify(v)).join(' ')}</pre>)}</div>}
        {responseTab==='变量变化'&&<ReadTable rows={(result.variableChanges||[]).map((v:any)=>({key:v.scope+'.'+v.key,value:stringify(v.before)+' → '+stringify(v.after)}))}/>}
        </div></>:<div className="response-empty"><span>↗</span><p>发送请求，查看响应</p><small>请求前脚本、响应后脚本与断言将在这里汇总。</small></div>}</section></>}
        </div></div>:<div className="welcome"><span className="welcome-icon"><BrandIcon/></span><div className="eyebrow">YOUR APIS. YOUR MACHINE.</div><h1>把接口调试，留在手边。</h1><p>组织请求，切换环境，用脚本连接每一步。<br/>从一个集合开始，或导入已有的 Postman 请求。</p><div><button className="primary" onClick={()=>safe(newCollection)}>新建集合</button><button onClick={()=>setModal('import')}>导入 Postman / cURL</button></div><div className="welcome-features"><span>◈ 本地保存</span><span>⌘ 脚本与断言</span><span>↗ Codex 对话操作</span></div></div>}
      </main>
    </div>
    {menu&&<TreeMenu target={menu.target} x={menu.x} y={menu.y} onClose={()=>setMenu(null)} onChoose={action=>chooseTree(action,menu.target)}/>}
    {modal==='rename'&&<Modal title="重命名" onClose={()=>setModal('')}><form onSubmit={e=>{e.preventDefault();safe(renameTarget);}}><label>名称<input aria-label="新名称" value={rename} onChange={e=>setRename(e.target.value)} autoFocus/></label><footer><button type="button" onClick={()=>setModal('')}>取消</button><button className="primary" disabled={!rename.trim()||changingStructure}>保存名称</button></footer></form></Modal>}
    {modal==='import' &&<Modal title="导入请求" wide onClose={()=>setModal('')}><p className="muted">粘贴 Postman Collection v2.1、环境 JSON 或一条 cURL。</p><textarea aria-label="导入内容" rows={12} value={importText} onChange={e=>setImportText(e.target.value)} placeholder="curl 'http://localhost:3000/users'"/><label className="file-picker">或选择 JSON 文件<input type="file" accept=".json,.txt" onChange={e=>{const f=e.target.files?.[0];if(f)f.text().then(setImportText);}}/></label>{importWarnings.length>0&&<div className="warning">已导入，但这些能力需要调整：{importWarnings.map(w=><p key={w}>{w}</p>)}</div>}<footer><button onClick={()=>setModal('')}>关闭</button><button className="primary" disabled={!importText.trim()} onClick={()=>safe(importNow)}>确认导入</button></footer></Modal>}
    {modal==='runner'&&<Modal title="运行集合" onClose={()=>setModal('')}><p>顺序运行 {titleOf(dialogTarget!)} 中的请求与脚本。</p><div className="form-grid"><label>迭代次数<input type="number" min={1} max={1000} value={runOptions.iterations} onChange={e=>setRunOptions({...runOptions,iterations:Number(e.target.value)})}/></label><label>请求间隔（毫秒）<input type="number" min={0} value={runOptions.delay} onChange={e=>setRunOptions({...runOptions,delay:Number(e.target.value)})}/></label></div><label className="checkbox"><input type="checkbox" checked={runOptions.stopOnFailure} onChange={e=>setRunOptions({...runOptions,stopOnFailure:e.target.checked})}/>断言失败或请求出错时停止</label><label>运行数据<select value={dataFormat} onChange={e=>setDataFormat(e.target.value)}><option value="json">JSON</option><option value="csv">CSV</option></select><textarea aria-label="运行数据" rows={5} value={dataText} placeholder="可选：JSON 对象数组或 CSV" onChange={e=>setDataText(e.target.value)}/></label><label className="file-picker">选择数据文件<input type="file" accept=".csv,.json" onChange={e=>{const f=e.target.files?.[0];if(f){setDataFormat(f.name.endsWith('.csv')?'csv':'json');f.text().then(setDataText);}}}/></label><footer><button onClick={()=>setModal('')}>取消</button><button className="primary" disabled={busy} onClick={()=>safe(()=>start(true,dialogTarget))}>开始运行</button></footer></Modal>}
    {modal==='history'&&<Modal title="历史运行结果" wide onClose={()=>setModal('')}><pre>{stringify(result)}</pre><footer><button onClick={()=>safe(()=>download('run-report.json',stringify(result)))}>导出报告</button></footer></Modal>}
    {modal==='actions'&&<Modal title="更多操作" onClose={()=>setModal('')}><div className="action-list"><button onClick={()=>safe(()=>exportCurrent())}>导出 Postman 文件</button>{tab?.doc.kind==='collection'&&!tab.itemId&&<button onClick={()=>safe(()=>copyCollection())}>复制集合</button>}{tab?.doc.kind==='environment'&&<button onClick={()=>safe(async()=>{const doc=await save();if(!doc)return;const data=clone(doc.data);data.name+=' 副本';delete data.id;const copied=await call<Doc>('api_document_put',{kind:'environment',revision:0,data});await refresh();setModal('');open(copied);})}>复制环境</button>}{request&&<button onClick={()=>safe(()=>exportCurrent('curl'))}>导出 cURL</button>}{tab?.itemId&&<><button onClick={()=>safe(()=>treeAction('duplicate'))}>复制请求或文件夹</button><button onClick={()=>{setActionTarget(undefined);setMoveTarget('');setMovePosition(0);setModal('move');}}>移动或排序</button><button onClick={()=>{setActionTarget(undefined);setModal('runner');}}>集合运行选项</button></>}<button onClick={()=>ask('重新加载会丢弃此集合或环境所有标签的未保存修改。',()=>safe(reloadCurrent))}>重新加载当前内容</button><button className="danger-text" onClick={()=>ask('确认删除 '+titleOf(tab!)+'？',()=>safe(()=>tab?.itemId?treeAction('delete'):removeDoc()).then(()=>setModal('')))}>删除</button></div></Modal>}
    {modal==='move'&&<Modal title="移动或排序" onClose={()=>setModal('')}><label>目标文件夹<select aria-label="目标文件夹" value={moveTarget} onChange={e=>setMoveTarget(e.target.value)}><option value="">集合根目录</option>{folders((dialogTarget!).doc.data).filter((f:any)=>f.id!==dialogTarget?.itemId&&!findItem(nodeOf(dialogTarget),f.id)).map((f:any)=><option key={f.id} value={f.id}>{f.path}</option>)}</select></label><label>插入位置（从 0 开始）<input type="number" min={0} value={movePosition} onChange={e=>setMovePosition(Number(e.target.value))}/></label><footer><button className="primary" onClick={()=>safe(()=>treeAction('move',dialogTarget))}>确认移动</button></footer></Modal>}
    {modal==='settings'&&<SettingsPanel value={settingsText} onChange={setSettingsText} theme={theme} onClose={()=>setModal('')} onCookies={()=>{setCookiesRevision(state.cookies?.revision||0);setCookiesText(stringify(state.cookies?.data||{cookies:[]}));setModal('cookies');}} onSave={data=>safe(async()=>{await call('api_document_put',{kind:'settings',id:'default',revision:settingsRevision,data});await refresh();setModal('');setNotice('设置已保存');})}/>}
    {modal==='cookies'&&<Modal title="Cookie 管理" wide onClose={()=>setModal('')}><p className="muted">按域名、路径维护 Cookie。清空 cookies 数组可移除所有 Cookie。</p><CodeEditor value={cookiesText} onChange={setCookiesText} language="json" theme={theme}/><footer><button className="primary" onClick={()=>safe(async()=>{await call('api_document_put',{kind:'cookies',id:'default',revision:cookiesRevision,data:JSON.parse(cookiesText)});await refresh();setModal('');})}>保存 Cookie</button></footer></Modal>}
    {confirm&&<Modal title="确认操作" onClose={()=>setConfirm(null)}><p>{confirm.text}</p><footer><button onClick={()=>setConfirm(null)}>保留内容</button><button className="primary" onClick={()=>{const action=confirm.action;setConfirm(null);action();}}>确认</button></footer></Modal>}
    {modal&&error&&<div className="modal-error" role="alert">{error}<button onClick={()=>setError('')}>×</button></div>}
  </div>;
}
function ReadTable({rows}:{rows:any[]}){return <table className="read-table"><thead><tr><th>名称</th><th>值</th></tr></thead><tbody>{rows.map((v,i)=><tr key={i}><td>{v.key}</td><td>{typeof v.value==='string'?v.value:stringify(v.value)}</td></tr>)}</tbody></table>;}
function getScript(node:any,stage:string){return (node?.event||[]).filter((e:any)=>e.listen===stage).map((e:any)=>[].concat(e.script?.exec||[]).join('\n')).join('\n');}
function setScript(node:any,stage:string,value:string){node.event=(node.event||[]).filter((e:any)=>e.listen!==stage);node.event.push({listen:stage,script:{type:'text/javascript',exec:value.split('\n')}});}
function countRequests(node:any):number{return (node.item||[]).reduce((n:number,i:any)=>n+(i.item?countRequests(i):1),0);}
function folders(root:any,path:string[]=[]):any[]{return (root.item||[]).flatMap((n:any)=>n.item?[{id:n.id,path:[...path,n.name].join(' / ')},...folders(n,[...path,n.name])]:[]);}
function queryRows(r:any):Row[]{if(r._query)return r._query;if(typeof r.url==='object'&&r.url.query)return r.url.query;const query=rawUrl(r).split('?')[1]?.split('#')[0]||'';return [...new URLSearchParams(query)].map(([key,value])=>({key,value}));}
function buildUrl(raw:string,rows:Row[]){const base=raw.split('?')[0].split('#')[0],hash=raw.includes('#')?'#'+raw.split('#').slice(1).join('#'):'';const enc=(s:string)=>encodeURIComponent(s).replaceAll('%7B','{').replaceAll('%7D','}');const query=rows.filter(r=>!r.disabled&&r.key).map(r=>enc(r.key)+'='+enc(r.value||'')).join('&');return base+(query?'?'+query:'')+hash;}
function BodyEditor({request,edit,theme,upload}:{request:any,edit:(fn:(n:any)=>void)=>void,theme:string,upload:(f:File)=>Promise<any>}){
  const body=request.body||{mode:'none'},mode=body.mode==='raw'?body.options?.raw?.language||'text':body.mode;
  return <><div className="body-mode"><label>请求体类型<select aria-label="请求体类型" value={mode} onChange={e=>edit(n=>{const type=e.target.value,previous=n.request.body||{};n.request.body=['json','text','xml'].includes(type)?{...previous,mode:'raw',raw:previous.raw||'',options:{...previous.options,raw:{...previous.options?.raw,language:type}}}:['urlencoded','formdata'].includes(type)?{...previous,mode:type,[type]:previous[type]||[]}:{...previous,mode:type,...(type==='file'?{file:previous.file||{src:''}}:{})};n.request.body.disabled=type==='none';})}><option value="none">无</option><option value="json">JSON</option><option value="text">文本</option><option value="xml">XML</option><option value="urlencoded">x-www-form-urlencoded</option><option value="formdata">multipart/form-data</option><option value="file">二进制文件</option></select></label></div>
  {body.mode==='raw'&&<CodeEditor value={body.raw||''} onChange={value=>edit(n=>{n.request.body.raw=value;})} language={mode==='json'?'json':'text'} theme={theme}/>}
  {['formdata','urlencoded'].includes(body.mode)&&<Rows rows={body[body.mode]||[]} files={body.mode==='formdata'} onUpload={upload} onUploaded={(id,path)=>edit(n=>{const row=n.request.body?.formdata?.find((r:Row)=>r.id===id);if(row?.type==='file')row.src=path;})} onChange={rows=>edit(n=>{if(n.request.body.mode===body.mode)n.request.body[body.mode]=rows;})}/>}
  {body.mode==='file'&&<label className="file-picker large">{body.file?.src?.split('/').at(-1)||'选择二进制文件'}<input type="file" aria-label="二进制文件" onChange={async e=>{const f=e.target.files?.[0];if(f){const path=await upload(f);if(path)edit(n=>{if(n.request.body.mode==='file')n.request.body.file={src:path};});}}}/></label>}
  {body.mode==='none'&&<p className="muted">此请求不包含请求体。</p>}</>;
}
createRoot(document.getElementById('root')!).render(<App/>);

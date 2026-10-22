const $=id=>document.getElementById(id),pending=new Map(),drafts=new Map(),fullscreenHorizontal=new WeakMap();
let selectionSequence=0,fileLoading=false,pendingNavigation=null;
function updateBusy(){document.body.setAttribute('aria-busy',String(busy||fileLoading));}
function navigate(fn,{projectId=project?.id}={}){if(busy){pendingNavigation=()=>{if(projectId===null||project?.id===projectId)navigate(fn,{projectId});};return;}void run(fn);}
function navigateFile(path,mode){if(busy){const projectId=project?.id;pendingNavigation=()=>{if(project?.id===projectId)navigateFile(path,mode);};return;}void selectFile(path,true,mode).catch(e=>status(e.message,true));}
let sequence=0,busy=false,workspace={projects:[],reviews:[]},project=null,repository=null,review=null,file=null,files=[],scope={mode:'working'},tab='changes',directory='',anchor=null,rows=[],entries=[],expanded=new Set(),layout=matchMedia('(max-width:1000px)').matches?'unified':'split',layoutChosen=false,pageStart=0,exports=null,folder=null,quickIndex=0,managedProject=null,failedFile=null,selectedFiles=new Set(),fileHunkData=null,fileMode='working';
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function button(text,fn,cls){const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;}
function status(text,error=false){$('status').textContent=text||'就绪';$('status').classList.toggle('error',error);$('status').title=text||'';}
function rpc(method,params,timeout=45000){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('操作超时，请重试'));},timeout);pending.set(id,{resolve,reject,timer});window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});}
window.addEventListener('message',event=>{if(event.source!==window.parent||event.data?.jsonrpc!=='2.0')return;const m=event.data;if(m.method==='ui/notifications/host-context-changed'&&['light','dark'].includes(m.params?.theme))document.documentElement.style.colorScheme=m.params.theme;const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message??'宿主操作失败')):p.resolve(m.result);}});
async function call(name,args={}){const r=await rpc('tools/call',{name,arguments:args},name==='project_pick'?195000:name==='git_operation_execute'?150000:45000);if(r.isError){const error=Error(r.content?.find(c=>c.type==='text')?.text??'操作失败');Object.assign(error,r.structuredContent??{});throw error;}return r.structuredContent;}
async function run(fn,label='正在加载…'){
 if(busy)return;selectionSequence++;fileLoading=false;busy=true;updateBusy();$('reviewed').disabled=true;status(label);$('dialogError').textContent='';updateActions();
 try{await fn();status('就绪');}catch(e){status(e.message,true);if($('openDialog').open)$('dialogError').textContent=e.message;if($('settingsDialog').open)$('settingsError').textContent=e.message;if(liveGit())$('commitError').textContent=e.message;}finally{busy=false;updateBusy();$('reviewed').disabled=!file||file.binary||!project;updateActions();const next=pendingNavigation;pendingNavigation=null;next?.();}
}
function acceptWorkspace(data){if(data.version&&data.version!=='0.5.4')status('插件后台仍是旧版本，请重开 Codex 后打开新工作台',true);for(const key of ['projects','reviews','activeProject','limits'])if(data[key]!==undefined)workspace[key]=data[key];renderProjects();renderReviews();}
function projectCopy(p){const copy=el('span',undefined,'project-copy');copy.append(el('strong',(p.pinned?'◆ ':'')+p.name),el('small',p.path));return copy;}
function renderProjects(){
 const filter=$('projectSearch').value.toLowerCase();$('projects').replaceChildren();for(const p of workspace.projects.filter(p=>(p.name+' '+p.path).toLowerCase().includes(filter))){const b=button('',()=>navigate(()=>openProject({id:p.id}),{projectId:null}));b.title=p.path;b.dataset.projectId=p.id;b.oncontextmenu=e=>{e.preventDefault();if(!busy)manage(p);};b.setAttribute('aria-current',String(project?.id===p.id));b.append(el('span','⌘','project-icon'),projectCopy(p));$('projects').append(b);}
 if(!$('projects').childElementCount)$('projects').append(el('p',workspace.projects.length?'没有匹配的项目':'打开过的项目会显示在这里','empty-list'));
 const opened=workspace.projects.filter(p=>p.opened!==false);
 $('projectSelect').replaceChildren(new Option('选择项目…',''));for(const [name,items] of [['已打开',opened],['最近项目',workspace.projects.filter(p=>p.opened===false)]]){if(!items.length)continue;const group=el('optgroup');group.label=name;for(const p of items){const same=workspace.projects.filter(x=>x.name===p.name).length>1,label=p.name+(same?' · '+p.path.split('/').slice(-2).join('/'):'');const option=new Option(label,p.id);option.title=p.path;group.append(option);}$('projectSelect').append(group);}$('projectSelect').value=project?.id??'';$('projectTotal').textContent=`${opened.length} 个已打开`;
 $('projectTabs').replaceChildren();for(const p of opened){const tab=el('span',undefined,'project-tab');tab.setAttribute('aria-current',String(project?.id===p.id));const b=button(p.name,()=>navigate(()=>openProject({id:p.id}),{projectId:null}));b.title=p.path;b.setAttribute('aria-current',String(project?.id===p.id));b.dataset.projectId=p.id;const close=button('×',()=>run(()=>closeProject(p.id)),'close-tab');close.title=`关闭 ${p.name}`;close.setAttribute('aria-label',`关闭项目 ${p.name}`);tab.append(b,close);$('projectTabs').append(tab);}if(!opened.length)$('projectTabs').append(el('span','没有打开的项目，从上方选择或打开文件夹','empty-list'));

 $('manageProject').disabled=!project;$('repoName').textContent=project?.name??'选择项目';$('repoName').title=project?.name??'';$('branchName').textContent=repository?.branch??'';$('branchName').title=repository?.branch??'';$('projectPath').textContent=project?.path??'';$('projectPath').title=project?.path??'';
 $('branchesSection').hidden=!repository?.branches?.length;$('branches').replaceChildren();for(const b of repository?.branches??[]){const n=button('⑂ '+b.name,()=>navigate(async()=>{saveDraft();scope={mode:'commits',base:'HEAD',target:b.name};review=null;tab='commits';await loadChanges();await remember();}));n.title=`比较 HEAD → ${b.name}`;$('branches').append(n);}
}
async function remember(extra={}){if(!project)return;const selected=project;selected.state={...selected.state,...scope,file:reviewSurface.isSummary()?'':file?.path??'',lastReview:review?.id??null,...extra};const saved={...selected.state};await call('project_update',{id:selected.id,state:saved});const p=workspace.projects.find(p=>p.id===selected.id);if(p)p.state=saved;}
async function closeProject(id){saveDraft();const active=project?.id===id,result=await call('project_close',{id});acceptWorkspace(result);if(active){project=null;repository=null;review=null;file=null;files=[];renderProjects();renderFiles();renderDetail();if(result.activeProject)await openProject({id:result.activeProject});}}
async function openProject(args){
 saveDraft();saveCommitText();reviewSurface.reset(true);const result=await call('project_open',args);project=result.project;repository=result.repository;commitDraft=null;composerSequence++;$('commitSummary').value=commitTextDrafts.get(project.id)?.summary??'';failedFile=null;selectedFiles.clear();acceptWorkspace(result);document.body.classList.remove('project-drawer');$('projectMenu').setAttribute('aria-expanded','false');$('openDialog').close();$('quickDialog').close();$('fileSearch').value='';$('commitSearch').value='';review=null;file=null;files=[];directory='';scope=project.isGit?{mode:'working'}:{mode:'files'};tab='changes';renderNavigation();renderFiles();renderDetail();
 if(project.state?.lastReview){try{review=(await call('review_get',{id:project.state.lastReview})).review;scope={mode:review.mode,...(review.base&&review.base!==':'?{base:review.base}:{}),...(review.target?{target:review.target}:{})};files=review.files;tab='reviews';renderNavigation();renderFiles();await selectFile(project.state.file||files[0]?.path,Boolean(project.state.file));return;}catch{review=null;}}
 if(project.isGit&&['working','staged','unstaged','commits','commit'].includes(project.state?.mode))scope={mode:project.state.mode,...(project.state.base?{base:project.state.base}:{}),...(project.state.target?{target:project.state.target}:{})};
 await loadChanges(project.state?.file);renderProjects();
}
async function loadChanges(preferred=file?.path??failedFile?.path,{preserveSummary=false,followIndex=false,mode,position}={}){
 saveDraft();reviewSurface.reset(false,preserveSummary);file=null;failedFile=null;fileHunkData=null;selectedFiles.clear();review=null;expanded=new Set();pageStart=0;
 if(followIndex&&mode&&['staged','unstaged'].includes(scope.mode))scope={mode};
 if(!project.isGit&&scope.mode==='files'){const result=await call('project_files',{id:project.id,directory});files=result.entries;}
 else{const result=await call('project_changes',{id:project.id,...scope});files=result.files;}
 if(followIndex&&preferred&&!files.some(f=>f.path===preferred)&&['staged','unstaged'].includes(scope.mode)){
  const destination={mode:scope.mode==='unstaged'?'staged':'unstaged'},result=await call('project_changes',{id:project.id,...destination});
  if(result.files.some(f=>f.path===preferred)){scope=destination;files=result.files;}
 }
 renderNavigation();renderFiles();renderDetail();reviewSurface.restorePosition(position);
 const wanted=files.find(f=>f.path===preferred&&!f.directory&&!f.symlink)??(followIndex?undefined:files.find(f=>!f.directory&&!f.symlink));
 if(followIndex&&!wanted)reviewSurface.reset(true,preserveSummary);
 const preferredMode=mode==='staged'&&wanted?.canUnstage||mode==='unstaged'&&wanted?.canStage?mode:undefined;
 const refresh=refreshGitStatus();
 void refreshComposer({includeTasks:!preserveSummary});
 await selectFile(wanted?.path,false,preferredMode);await remember();await refresh;
}
function renderNavigation(){
 for(const [id,value] of [['changesTab','changes'],['commitsTab','commits'],['reviewsTab','reviews']])$(id).setAttribute('aria-pressed',String(tab===value));
 $('scopes').hidden=tab!=='changes'||!project?.isGit;$('commitsTab').disabled=!project?.isGit;$('commitPane').hidden=tab!=='commits';$('reviewPane').hidden=tab!=='reviews';
 document.querySelectorAll('[data-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scope===scope.mode)));
 renderCommits();renderReviews();updateActions();
}
function renderCommits(){const filter=$('commitSearch').value.toLowerCase();$('commits').replaceChildren();for(const c of (repository?.commits??[]).filter(c=>(c.title+' '+c.author+' '+c.sha).toLowerCase().includes(filter))){const b=button('',()=>navigate(async()=>{saveDraft();reviewSurface.reset(true);scope={mode:'commit',target:c.sha};review=null;await loadChanges();}));b.dataset.sha=c.sha;b.setAttribute('aria-current',String(scope.target===c.sha));b.title=`${c.title}\n${c.author} · ${c.date}`;b.append(el('strong','● '+c.title),el('small',`${c.sha.slice(0,7)} · ${c.author} · ${new Date(c.date).toLocaleDateString('zh-CN')}`));$('commits').append(b);}if(!$('commits').childElementCount)$('commits').append(el('p','没有匹配的本地提交','empty-list'));}
function renderReviews(){if(!$('reviews'))return;$('reviews').replaceChildren();for(const r of workspace.reviews.filter(r=>r.project===project?.path)){const b=button('',()=>navigate(()=>openReview(r.id)));b.setAttribute('aria-current',String(review?.id===r.id));b.dataset.reviewId=r.id;b.append(el('strong',`${r.reviewed}/${r.count} 已审阅`),el('small',`${localDate(r.createdAt)} · ${scopeName(r.mode)}`));$('reviews').append(b);}if(!$('reviews').childElementCount)$('reviews').append(el('p','尚无审查记录；添加评论时会自动保存快照','empty-list'));}
function localDate(value){return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}
function scopeName(mode){return {working:'全部未提交改动',staged:'已暂存改动',unstaged:'未暂存改动',commit:'提交差异',commits:'分支 / 提交比较',files:'本地文件'}[mode]??mode;}
function renderFiles(){
 const filter=$('fileSearch').value.toLowerCase();$('files').replaceChildren();const visible=files.filter(f=>f.path.toLowerCase().includes(filter));$('fileCount').textContent=`${directory?directory+' / ':''}文件 · ${files.length}`;$('progress').textContent=review?`${review.files.filter(f=>f.reviewed).length}/${review.files.length} 已审阅`:'';
 if(directory&&!review&&!project?.isGit)$('files').append(button('↑ 上级目录',()=>run(async()=>{directory=directory.split('/').slice(0,-1).join('/');await loadChanges();})));
 for(const f of visible){const b=button('',()=>{if(f.directory&&!review)navigate(async()=>{directory=f.path;await loadChanges();});else if(!f.symlink)navigateFile(f.path);});b.dataset.path=f.path;b.setAttribute('aria-current',String((file?.path??failedFile?.path)===f.path));b.title=f.path;const state=f.directory?'▸':f.symlink?'↗':f.status?.includes('?')?'A':f.status?.includes('D')?'D':f.status?.includes('A')?'A':'M';b.append(el('span',state,'file-status'+(state==='A'?' add':state==='D'?' del':'')));const label=el('span',undefined,'file-label');const parts=f.path.split('/');label.append(el('span',parts.pop()));if(parts.length)label.append(el('small',parts.join('/')));b.append(label);if(f.reviewed)b.append(el('span','✓','review-check'));const row=el('div',undefined,'file-row');if(liveGit()){const input=el('input');input.type='checkbox';input.dataset.gitPath=f.path;input.dataset.eligible=String(Boolean(f.canStage||f.canUnstage));input.checked=selectedFiles.has(f.path);input.setAttribute('aria-label',`选择文件 ${f.path}`);input.onchange=()=>{if(input.checked)selectedFiles.add(f.path);else selectedFiles.delete(f.path);updateActions();};row.append(input);}row.append(b);$('files').append(row);}
 updateActions();if(!visible.length)$('files').append(el('p',filter?'没有匹配的文件':project?.isGit?'工作区干净，没有此范围内的改动':'文件夹中没有可显示的文件','empty-list'));
}
function draftKey(){return project&&file?`${project.id}:${review?.id??JSON.stringify(scope)}:${file.path}`:'';}
function saveDraft(){const key=draftKey();if(key&&anchor)drafts.set(key,{anchor:{...anchor},text:$('commentText').value,severity:$('severity').value});}
function restoreDraft(){const d=drafts.get(draftKey());anchor=d?.anchor??null;$('commentText').value=d?.text??'';$('severity').value=d?.severity??'note';$('commentForm').hidden=!anchor;if(anchor)$('anchor').textContent=`${anchor.side==='before'?'旧':'新'}代码 · 第 ${anchor.line} 行`;renderComments();}
async function selectFile(path,persist=true,mode){
 const comparison=mode??(liveGit()&&scope.mode==='working'?(files.find(f=>f.path===path)?.canStage?'unstaged':'staged'):scope.mode);
 if(persist&&!reviewSurface.isSummary()&&file?.path===path&&fileMode===comparison&&!fileLoading)return;
 saveDraft();const request=++selectionSequence,selectedProject=project,selectedReview=review,selectedScope={...scope},live=liveGit();
 if(!path){file=null;failedFile=null;fileLoading=false;updateBusy();renderDetail();return;}
 fileMode=comparison;if(persist||!reviewSurface.isSummary())reviewSurface.activate(path,fileMode);
 const current=()=>request===selectionSequence&&project===selectedProject&&review===selectedReview;
 fileHunkData=null;file=null;failedFile={path,loading:true};fileLoading=true;updateBusy();renderFiles();renderDetail();
 try{
 const value=selectedReview?selectedReview.files.find(f=>f.path===path):(await call('project_file',{id:selectedProject.id,path,...selectedScope,mode:comparison})).file;
 let hunks=null;if(live&&!value?.binary){try{hunks=await call('git_hunks',{id:selectedProject.id,path,mode:comparison});}catch(e){hunks={hunks:[],notice:'局部操作暂不可用：'+e.message};}}
 if(!current())return;file=value;fileHunkData=hunks;failedFile=null;pageStart=0;expanded=new Set();renderFiles();renderDetail();restoreDraft();if(persist)await remember();if(current()&&!busy)status('就绪');
 }catch(e){if(!current())return;file=null;failedFile={path,error:e};renderFiles();renderDetail();throw e;}
 finally{if(current()){fileLoading=false;updateBusy();updateActions();}}
}
function navigationFiles(){const filter=$('fileSearch').value.toLowerCase();return files.filter(f=>!f.directory&&!f.symlink&&f.path.toLowerCase().includes(filter));}
function updateFileNavigation(){const candidates=navigationFiles(),index=candidates.findIndex(f=>f.path===(file?.path??failedFile?.path));$('filePosition').textContent=`文件 ${index<0?0:index+1} / ${candidates.length}`;$('prevFile').disabled=busy||index<=0;$('nextFile').disabled=busy||index<0||index>=candidates.length-1;}
function moveFile(delta){if(busy)return;const candidates=navigationFiles(),index=candidates.findIndex(f=>f.path===(file?.path??failedFile?.path)),next=index<0?null:candidates[index+delta];if(next)navigateFile(next.path);}
function liveGit(){return Boolean(project?.isGit&&!review&&tab==='changes'&&['working','staged','unstaged'].includes(scope.mode));}
function selectedRecords(operation){return files.filter(f=>selectedFiles.has(f.path)&&(operation==='stage'?f.canStage:f.canUnstage));}
function updateActions(){const working=busy||fileLoading;updateComposerActions();updateFileNavigation();reviewSurface.busy(working);$('stageReviewedFile').hidden=!project?.isGit||!review||!['working','unstaged'].includes(review.mode)||!file||file.binary;$('stageReviewedFile').disabled=working||!file?.reviewed;$('stageReviewedFile').title=file?.reviewed?'核对当前内容与审阅快照一致后暂存；内容变化时需要重新审阅':'请先勾选已审阅，再暂存这个文件';const hasProject=Boolean(project),live=liveGit(),current=files.find(f=>f.path===(file?.path??failedFile?.path));$('gitFile').hidden=!live||!current;$('gitBulk').hidden=!live||!files.length;$('stageFile').hidden=!current?.canStage||fileMode==='staged';$('unstageFile').hidden=!current?.canUnstage||fileMode==='unstaged';$('stageFile').disabled=$('unstageFile').disabled=working;for(const [operation,id] of [['stage','stageSelected'],['unstage','unstageSelected']]){const count=selectedRecords(operation).length;$(id).textContent=`${operation==='stage'?'Stage':'Unstage'}${count?' ('+count+')':''}`;$(id).disabled=working||!count;}const visible=files.filter(f=>f.path.toLowerCase().includes($('fileSearch').value.toLowerCase())&&(f.canStage||f.canUnstage));$('selectVisible').checked=Boolean(visible.length)&&visible.every(f=>selectedFiles.has(f.path));$('selectVisible').indeterminate=visible.some(f=>selectedFiles.has(f.path))&&!$('selectVisible').checked;document.querySelectorAll('[data-git-path]').forEach(i=>i.disabled=working||!live||i.dataset.eligible!=='true');$('selectVisible').disabled=working||!visible.length;$('readonly').textContent=live?'Git 工作区':review?(project?.isGit&&['working','unstaged'].includes(review.mode)?'审查快照 · 核对后可暂存':'审查快照只读'):'文件预览';$('manageProject').disabled=!hasProject;$('saveReview').disabled=!hasProject||!files.some(f=>!f.directory&&!f.symlink)||working;$('reviewed').disabled=!file||working;$('export').hidden=!review;$('liveView').hidden=!review;$('saveReview').hidden=Boolean(review)||!file;$('commitsTab').disabled=!project?.isGit;updateGitWorkbench();}
function renderDetail(){
 reviewSurface.render();$('detailHeader').hidden=!project;if(!project)setReviewFullscreen(false);
 $('welcome').hidden=Boolean(project);$('detail').hidden=!project;if(!project)return;
 $('viewLabel').textContent=review?'审查快照 · '+scopeName(review.mode):scopeName(reviewSurface.isSummary()?scope.mode:fileMode);$('reviewDate').textContent=review?localDate(review.createdAt):['commit','commits'].includes(scope.mode)&&scope.target?scope.target.slice(0,18):'实时查看 · 未保存';$('fileTitle').textContent=file?.path??failedFile?.path??'';$('fileTitle').title=$('fileTitle').textContent;document.querySelector('.file-toolbar').hidden=!file&&!failedFile;document.querySelector('.diff-toolbar').hidden=!file&&!failedFile;$('diffControls').hidden=!file||file.binary;$('reviewed').checked=file?.reviewed??false;updateActions();
 if(reviewSurface.isSummary()&&files.some(f=>!f.directory&&!f.symlink)){$('commentsPanel').hidden=!anchor&&!review?.comments?.length;return;}
 if(failedFile?.loading){reviewSurface.fileContainer.replaceChildren(el('p',`正在读取 ${failedFile.path}…`,'empty-list'));$('commentsPanel').hidden=true;$('diffStats').textContent='';return;}
 if(!file&&failedFile){const empty=el('div',undefined,'empty-state');empty.append(el('span','!','empty-state-icon'),el('h2',failedFile.error.code==='FILE_LIMIT'?'文件超出预览上限':'暂时无法预览此文件'),el('p',failedFile.error.message));if(failedFile.error.code==='FILE_LIMIT')empty.append(button('调整预览上限',showSettings));reviewSurface.fileContainer.replaceChildren(empty);$('commentsPanel').hidden=true;$('diffStats').textContent='';return;}
 if(!file){const empty=el('div',undefined,'empty-state'),clean=project.isGit&&!files.length&&scope.mode==='working';empty.append(el('span',clean?'✓':'⌘','empty-state-icon'),el('h2',clean?'工作区干净':files.length?'选择一个文件':scope.mode==='staged'?'没有已暂存的改动':scope.mode==='unstaged'?'没有未暂存的改动':'当前范围没有文件差异'),el('p',clean?'当前项目没有未提交的改动，可以浏览提交历史。':files.length?'从文件列表选择内容，开始查看差异。':'切换审查范围或刷新，查看最新内容。'));const actions=el('div',undefined,'empty-actions');if(repository?.commits?.length)actions.append(button('浏览提交历史',()=>$('commitsTab').click()));actions.append(button('刷新项目',()=>$('refresh').click()));empty.append(actions);reviewSurface.activeContainer.replaceChildren(empty);$('commentsPanel').hidden=true;$('diffStats').textContent='';return;}
 if(file.binary){reviewSurface.fileContainer.replaceChildren(el('p','二进制文件；可标记已审阅，不展示文本差异。','empty-list'));$('diffStats').textContent='二进制';rows=[];entries=[];renderComments();return;}
 try{rows=alignedRows(file.before,file.after,window.Diff.diffLines);}catch(e){rows=[];entries=[];reviewSurface.fileContainer.replaceChildren(el('p',e.message,'empty-list'));$('diffStats').textContent='差异未能计算';$('commentsPanel').hidden=true;return;}const added=rows.filter(r=>r.type==='change'&&r.new!==null).length,removed=rows.filter(r=>r.type==='change'&&r.old!==null).length;$('diffStats').replaceChildren(el('span',`+${added}`,'add-text'),el('span',`  −${removed}`,'del-text'));renderCode();renderComments();
}
function highlight(text,path=file?.path){const code=el('code');const ext=path?.split('.').at(-1)?.toLowerCase(),language={js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',sh:'bash',zsh:'bash',json:'json',html:'xml',xml:'xml',svg:'xml',css:'css',scss:'scss',java:'java',go:'go',rs:'rust',rb:'ruby',sql:'sql',md:'markdown',yaml:'yaml',yml:'yaml',c:'c',h:'c',cpp:'cpp',swift:'swift'}[ext];if(language&&window.hljs?.getLanguage(language)&&text.length<10000)code.innerHTML=window.hljs.highlight(text,{language,ignoreIllegals:true}).value;else code.textContent=text;return code;}
function renderCode(){
 if(reviewSurface.isSummary()){reviewSurface.render(true);return;}
 $('splitView').setAttribute('aria-pressed',String(layout==='split'));$('unifiedView').setAttribute('aria-pressed',String(layout==='unified'));
 reviewSurface.fileContainer.replaceChildren(createDiffView({value:file,rows,hunks:fileHunkData,layout,wrap:$('wrapCode').checked,full:$('fullContext').checked,expanded,page:pageStart,
  onComment:(side,line)=>run(()=>startComment(side,line)),onExpand:r=>{for(let i=r.start;i<r.end;i++)expanded.add(i);renderCode();},onPage:page=>{pageStart=page;renderCode();},onFull:full=>{$('fullContext').checked=full;renderCode();},onHunk:liveGit()?(h,operation)=>operation==='discard'?confirmDiscardHunk(h):void mutateHunk(h,operation):undefined
 }));
}

async function ensureSaved(mode=scope.mode){
 if(review)return;const oldKey=draftKey(),args={project:project.path,...scope,mode};if(scope.mode==='files')args.paths=file?[file.path]:files.filter(f=>!f.directory&&!f.symlink).map(f=>f.path);if(file?.digest&&fileMode===mode)args.expected={path:file.path,digest:file.digest};
 review=(await call('review_create',args)).review;const chosen=file?.path;selectedFiles.clear();files=review.files;file=files.find(f=>f.path===chosen)??files[0]??null;if(drafts.has(oldKey))drafts.set(draftKey(),drafts.get(oldKey));await remember();acceptWorkspace(await call('review_open'));renderFiles();renderNavigation();renderDetail();
}
async function startComment(side,line){saveDraft();await ensureSaved(fileMode);anchor={side,line};$('anchor').textContent=`${side==='before'?'旧':'新'}代码 · 第 ${line} 行`;$('commentForm').hidden=false;$('commentsPanel').hidden=false;$('commentText').focus();}
function renderComments(){const comments=review?.comments.filter(c=>c.path===file?.path)??[];$('comments').replaceChildren();$('commentCount').textContent=comments.length?`${comments.length} 条`:'';$('commentsPanel').hidden=!comments.length&&!anchor;
 for(const c of comments){const n=el('div',undefined,'comment');n.append(button('删除',()=>run(async()=>{saveDraft();review=(await call('review_update',{id:review.id,version:review.version,path:file.path,deleteComment:c.id})).review;renderComments();})),el('strong',`${{note:'备注',issue:'问题',blocking:'阻塞'}[c.severity]} · ${c.side==='before'?'旧':'新'}代码 ${c.line} 行`),el('p',c.text));$('comments').append(n);}}
async function openReview(id){saveDraft();reviewSurface.reset(true);selectedFiles.clear();failedFile=null;review=(await call('review_get',{id})).review;if(review.project!==project.path)throw Error('审查记录与项目不匹配');files=review.files;scope={mode:review.mode};tab='reviews';renderNavigation();renderFiles();await selectFile(files[0]?.path,false);}
async function currentChanges(){saveDraft();reviewSurface.reset(true);review=null;scope={mode:project.isGit?'working':'files'};tab='changes';directory='';await loadChanges();}
function showOpen(){if(busy)return;$('dialogError').textContent='';$('openDialog').showModal();}
async function nativeChoice(){if(busy)return;await run(async()=>{try{const result=await call('project_pick');acceptWorkspace(result);if(!result.canceled){$('openDialog').close();await openProject({id:result.activeProject});}}catch(e){$('openDialog').showModal();throw e;}},'请在系统窗口中选择项目文件夹…');}
$('openProject').onclick=$('welcomeOpen').onclick=$('addProject').onclick=nativeChoice;
$('projectSelect').onchange=()=>{const id=$('projectSelect').value;if(id)navigate(()=>openProject({id}),{projectId:null});};
$('projectMenu').onclick=()=>{if(busy)return;if(matchMedia('(max-width:800px)').matches){const expanded=document.body.classList.toggle('project-drawer');$('projectMenu').setAttribute('aria-expanded',String(expanded));}else{$('projectSearch').focus();$('projectSearch').select();}};$('welcomeBrowse').onclick=$('browseProjects').onclick=()=>{showOpen();run(()=>browse());};
$('nativePick').onclick=nativeChoice;
$('pathForm').onsubmit=e=>{e.preventDefault();run(()=>openProject({path:$('project').value.trim()}));};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
$('browseFolders').onclick=()=>run(()=>browse($('project').value.trim()||undefined));
async function browse(path){folder=await call('folder_browse',path?{path}:{});$('folderBrowser').hidden=false;$('folderPath').textContent=folder.path;$('folderPath').title=folder.path;$('folderUp').disabled=!folder.parent;$('folders').replaceChildren();for(const f of folder.folders)$('folders').append(button('▸ '+f.name,()=>run(()=>browse(f.path))));$('folderHint').textContent=folder.truncated?'仅显示前 500 个文件夹，请进入更具体的目录':'';$('discovered').replaceChildren();$('addDiscovered').hidden=true;}
$('folderUp').onclick=()=>{if(folder?.parent)run(()=>browse(folder.parent));};$('openFolder').onclick=()=>run(()=>openProject({path:folder.path}));
$('scanFolder').onclick=()=>run(async()=>{const result=await call('project_discover',{path:folder.path});$('discovered').replaceChildren();for(const p of result.projects){const label=el('label'),input=el('input');input.type='checkbox';input.value=p.path;label.append(input,projectCopy(p));$('discovered').append(label);}$('folderHint').textContent=`找到 ${result.projects.length} 个仓库${result.truncated?'（已达扫描上限，可进入子目录继续）':''}，勾选后添加`;$('addDiscovered').hidden=!result.projects.length;});
$('addDiscovered').onclick=()=>run(async()=>{const paths=[...$('discovered').querySelectorAll('input:checked')].map(i=>i.value);if(!paths.length)throw Error('请勾选要添加的项目');const result=await call('project_add_many',{paths});acceptWorkspace(result);await openProject({id:result.activeProject});});
$('projectSearch').oninput=renderProjects;$('fileSearch').oninput=()=>{renderFiles();reviewSurface.render();};$('commitSearch').oninput=renderCommits;
$('changesTab').onclick=$('liveView').onclick=()=>{if(project)navigate(currentChanges);};$('commitsTab').onclick=()=>{if(project?.isGit)navigate(async()=>{reviewSurface.reset(true);tab='commits';renderNavigation();const c=repository.commits[0];if(c){scope={mode:'commit',target:c.sha};await loadChanges();}});};
$('reviewsTab').onclick=()=>{if(!project||busy)return;tab='reviews';renderNavigation();};
for(const b of document.querySelectorAll('[data-scope]'))b.onclick=()=>{if(project)navigate(async()=>{saveDraft();scope={mode:b.dataset.scope};reviewSurface.reset(true);tab='changes';await loadChanges();});};
$('refresh').onclick=()=>run(async()=>{if(!project){acceptWorkspace(await call('review_open'));return;}if(review){saveDraft();const path=file?.path;review=(await call('review_get',{id:review.id})).review;files=review.files;renderFiles();await selectFile(path,false);}else{repository=(await call('project_open',{id:project.id})).repository;await loadChanges();}acceptWorkspace(await call('review_open'));});
$('saveReview').onclick=()=>run(()=>ensureSaved(reviewSurface.isSummary()?scope.mode:fileMode),'正在保存审查快照…');
$('reviewed').onchange=()=>run(async()=>{const wanted=$('reviewed').checked;try{saveDraft();await ensureSaved(fileMode);review=(await call('review_update',{id:review.id,version:review.version,path:file.path,reviewed:wanted})).review;files=review.files;file=files.find(f=>f.path===file.path);$('reviewed').checked=file.reviewed;renderFiles();}catch(e){$('reviewed').checked=file?.reviewed??false;throw e;}});
$('commentForm').onsubmit=e=>{e.preventDefault();run(async()=>{const text=$('commentText').value,selectedAnchor={...anchor},severity=$('severity').value;review=(await call('review_update',{id:review.id,version:review.version,path:file.path,comment:{...selectedAnchor,severity,text}})).review;drafts.delete(draftKey());anchor=null;$('commentText').value='';$('commentForm').hidden=true;renderComments();},'正在保存评论…');};
$('cancelComment').onclick=()=>{saveDraft();anchor=null;$('commentForm').hidden=true;renderComments();};
$('splitView').onclick=()=>{if(busy)return;layoutChosen=true;layout='split';$('splitView').setAttribute('aria-pressed','true');$('unifiedView').setAttribute('aria-pressed','false');if(file&&!file.binary)renderCode();};$('unifiedView').onclick=()=>{if(busy)return;layoutChosen=true;layout='unified';$('unifiedView').setAttribute('aria-pressed','true');$('splitView').setAttribute('aria-pressed','false');if(file&&!file.binary)renderCode();};$('wrapCode').onchange=()=>{if(file&&!file.binary)renderCode();};$('fullContext').onchange=()=>{pageStart=0;if(file&&!file.binary)renderCode();};$('prevFile').onclick=()=>moveFile(-1);$('nextFile').onclick=()=>moveFile(1);
function manage(p){managedProject=p;$('managedName').textContent=p.path;$('pinProject').textContent=p.pinned?'取消固定':'固定项目';$('manageDialog').showModal();}
$('manageProject').onclick=()=>{if(project&&!busy)manage(project);};
$('pinProject').onclick=()=>run(async()=>{const id=managedProject.id,pinned=!managedProject.pinned;acceptWorkspace(await call('project_update',{id,pinned}));if(project?.id===id)project.pinned=pinned;renderProjects();$('manageDialog').close();});
$('forgetProject').onclick=()=>run(async()=>{const id=managedProject.id,active=project?.id===id;saveDraft();acceptWorkspace(await call('project_forget',{id}));$('manageDialog').close();if(active){project=null;repository=null;review=null;file=null;files=[];renderProjects();renderFiles();renderDetail();if(workspace.projects[0])await openProject({id:workspace.projects[0].id});}});

function quickProjects(){return workspace.projects.filter(p=>(p.name+' '+p.path).toLowerCase().includes($('quickSearch').value.toLowerCase()));}
function renderQuick(){const results=quickProjects();quickIndex=Math.min(quickIndex,Math.max(0,results.length-1));$('quickResults').replaceChildren();results.forEach((p,i)=>{const b=button('',()=>navigate(()=>openProject({id:p.id}),{projectId:null}));b.setAttribute('aria-selected',String(i===quickIndex));b.append(projectCopy(p));$('quickResults').append(b);});if(!results.length)$('quickResults').append(el('p','没有匹配项目，可从「打开项目」选择文件夹','empty-list'));}
function showQuick(){if(busy)return;$('quickSearch').value='';quickIndex=0;renderQuick();$('quickDialog').showModal();$('quickSearch').focus();}$('quickOpen').onclick=showQuick;$('quickSearch').oninput=()=>{quickIndex=0;renderQuick();};$('quickSearch').onkeydown=e=>{const results=quickProjects();if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();quickIndex=Math.max(0,Math.min(results.length-1,quickIndex+(e.key==='ArrowDown'?1:-1)));renderQuick();$('quickResults').querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});}if(e.key==='Enter'&&results[quickIndex]){e.preventDefault();navigate(()=>openProject({id:results[quickIndex].id}),{projectId:null});}};
$('export').onclick=()=>run(async()=>{exports=await call('review_export',{id:review.id});$('exportText').value=exports[$('exportFormat').value];$('exportPanel').showModal();});$('exportFormat').onchange=()=>{$('exportText').value=exports?.[$('exportFormat').value]??'';};
function download(format){if(!exports||!review)return;const url=URL.createObjectURL(new Blob([exports[format]],{type:format==='json'?'application/json':'text/markdown;charset=utf-8'}));const a=el('a');a.href=url;a.download=`review-${review.id}.${format==='json'?'json':'md'}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}$('downloadMd').onclick=()=>download('markdown');$('downloadJson').onclick=()=>download('json');
function showSettings(){if(busy)return;const limits=workspace.limits??{fileMiB:5,totalMiB:50};$('fileLimit').value=limits.fileMiB;$('totalLimit').value=limits.totalMiB;$('settingsError').textContent='';$('settingsDialog').showModal();}
$('settings').onclick=showSettings;
$('limitsForm').onsubmit=e=>{e.preventDefault();run(async()=>{const path=file?.path??failedFile?.path;const result=await call('limits_configure',{fileMiB:Number($('fileLimit').value),totalMiB:Number($('totalLimit').value)});workspace.limits=result.limits;$('settingsDialog').close();if(project&&!review){try{await loadChanges(path);}catch(e){if(e.code!=='FILE_LIMIT')throw e;}}},'正在保存设置…');};
$('selectVisible').onchange=()=>{for(const f of files.filter(f=>f.path.toLowerCase().includes($('fileSearch').value.toLowerCase())&&(f.canStage||f.canUnstage))){if($('selectVisible').checked)selectedFiles.add(f.path);else selectedFiles.delete(f.path);}renderFiles();};
async function gitAction(operation,bulk=false){if(!liveGit())return;const path=file?.path??failedFile?.path,records=bulk?selectedRecords(operation):files.filter(f=>f.path===path&&(operation==='stage'?f.canStage:f.canUnstage));if(!records.length)return;await run(async()=>{const args={id:project.id,mode:bulk?scope.mode:fileMode,operation,files:records.map(({path,fingerprint})=>({path,fingerprint}))};if(records.length===1&&file?.path===records[0].path&&file.digest){args.mode=fileMode;args.preview={path:file.path,digest:file.digest};}await call('git_index_change',args);selectedFiles.clear();try{await loadChanges(path,{preserveSummary:true,followIndex:!bulk,mode:bulk?undefined:operation==='stage'?'staged':'unstaged'});}catch(e){if(e.code!=='FILE_LIMIT')throw Error('Git 操作已完成，但刷新失败：'+e.message);}},operation==='stage'?'正在暂存文件…':'正在取消暂存…');}
$('stageReviewedFile').onclick=()=>run(async()=>{if(!review||!file?.reviewed)return;const path=file.path;await call('review_stage',{id:project.id,reviewId:review.id,version:review.version,path});saveDraft();review=null;scope={mode:'working'};tab='changes';directory='';await loadChanges(path);},'正在核对并暂存已审阅文件…');
$('stageFile').onclick=()=>gitAction('stage');$('unstageFile').onclick=()=>gitAction('unstage');$('stageSelected').onclick=()=>gitAction('stage',true);$('unstageSelected').onclick=()=>gitAction('unstage',true);
function setReviewFullscreen(expanded){
 if(expanded===document.body.classList.contains('review-fullscreen')||expanded&&!project)return;
 const column=document.querySelector('.detail-column'),code=$('code');
 const scroller=reviewSurface.isSummary()||code.scrollHeight<=code.clientHeight&&column.scrollHeight>column.clientHeight?column:code;
 const rect=scroller.getBoundingClientRect(),top=scroller.scrollTop,left=scroller.scrollLeft;
 const horizontal=[...code.querySelectorAll('.diff-view')].map(node=>({node,left:node.scrollLeft,saved:fullscreenHorizontal.get(node)}));
 // Anchor a complete visible line: rewrapping changes the height of preceding code.
 const stickyHeight=reviewSurface.isSummary()?$('detailHeader').offsetHeight+(matchMedia('(min-width:801px)').matches?column.querySelector('.summary-file-header')?.offsetHeight||0:0):0;
 const visibleTop=rect.top+stickyHeight,views=top?horizontal.map(item=>item.node).filter(view=>{const r=view.getBoundingClientRect();return r.bottom>visibleTop&&r.top<rect.bottom;}):[];
 const visibleRows=views.flatMap(view=>[...view.querySelectorAll('tr[data-row]')]).map(node=>({node,rect:node.getBoundingClientRect()})).filter(row=>row.rect.bottom>visibleTop&&row.rect.top<rect.bottom);
 const line=visibleRows.find(row=>row.rect.top>=visibleTop)||visibleRows[0];
 document.body.classList.toggle('review-fullscreen',expanded);
 const toggle=$('reviewFullscreen');toggle.setAttribute('aria-pressed',String(expanded));toggle.querySelector('span').textContent=expanded?'退出全屏':'全屏审阅';toggle.title=expanded?'退出全屏审阅（Esc）':'展开审阅区；Esc 退出全屏';
 scroller.scrollTop=top;scroller.scrollLeft=left;
 if(line)scroller.scrollTop+=line.node.getBoundingClientRect().top-scroller.getBoundingClientRect().top-(line.rect.top-rect.top);
 for(const {node,left,saved} of horizontal){
  // Undo width clamping on exit, unless the reader scrolled to a new position.
  node.scrollLeft=!expanded&&saved&&left===saved.clamped?saved.left:left;
  if(expanded)fullscreenHorizontal.set(node,{left,clamped:node.scrollLeft});else fullscreenHorizontal.delete(node);
 }
}
$('reviewFullscreen').onclick=()=>setReviewFullscreen(!document.body.classList.contains('review-fullscreen'));
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')){if((e.metaKey||e.ctrlKey)&&['o','p','r'].includes(e.key.toLowerCase()))e.preventDefault();return;}if(e.key==='Escape'){if(document.body.classList.contains('review-fullscreen')){e.preventDefault();setReviewFullscreen(false);}document.body.classList.remove('project-drawer');$('projectMenu').setAttribute('aria-expanded','false');}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='o'){e.preventDefault();nativeChoice();}else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='p'){e.preventDefault();showQuick();}else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='r'){e.preventDefault();$('refresh').click();}else if(!document.querySelector('dialog[open]')&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)&&!e.target.isContentEditable){if((e.altKey&&['ArrowDown','ArrowUp'].includes(e.key))||(!e.metaKey&&!e.ctrlKey&&!e.altKey&&['j','k'].includes(e.key.toLowerCase()))){e.preventDefault();moveFile(e.key==='ArrowDown'||e.key.toLowerCase()==='j'?1:-1);}}});
async function init(){try{const data=await rpc('ui/initialize',{appInfo:{name:'codex-local-review',version:'0.5.4'},appCapabilities:{},protocolVersion:'2026-01-26'});if(['light','dark'].includes(data?.hostContext?.theme))document.documentElement.style.colorScheme=data.hostContext.theme;window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:900,width:document.documentElement.clientWidth}},'*');await run(async()=>{acceptWorkspace(await call('review_open'));if(workspace.activeProject&&workspace.projects.some(p=>p.id===workspace.activeProject))await openProject({id:workspace.activeProject});});}catch(e){status(e.message,true);}}void init();

matchMedia('(max-width:1000px)').addEventListener('change',e=>{if(layoutChosen)return;layout=e.matches?'unified':'split';if(file&&!file.binary)renderCode();});

let commitDraft=null,keywordLoading=false,keywordError='',keywordSequence=0,composerSequence=0,taskList=null,taskNotice='',committing=false,composerLoading=false;const commitTextDrafts=new Map(),keywordMemory=new Map();
function updateComposerActions(){
 const visible=liveGit();$('commitWorkspace').hidden=!visible;if(!visible)return;
 const task=commitDraft?.tasks.find(t=>t.id===$('commitTask').value),ready=commitDraft?.projectId===project?.id&&Boolean(commitDraft.token);
 $('confirmCommit').disabled=busy||!ready||!$('commitSummary').value.trim()||keywordLoading||Boolean(task&&!task.keyword);
 $('confirmCommit').textContent=busy?'正在处理…':!ready?(composerLoading?'正在准备提交…':'暂无可提交改动'):'提交暂存改动';
 $('refreshCommit').disabled=busy;$('commitTask').disabled=busy||!commitDraft;$('commitSummary').disabled=committing;$('retryKeyword').disabled=busy||keywordLoading;
}
function buildCommitMessage(){
 const t=commitDraft?.tasks.find(t=>t.id===$('commitTask').value),summary=$('commitSummary').value.trim();$('commitMessage').textContent=summary+(t?.keyword?'\n\n'+t.keyword:'');
 $('commitTaskHint').textContent=keywordLoading?'正在从 TAPD 获取源码关键字…':keywordError|| (t?'已自动关联 TAPD · 完整关键字见下方预览':commitDraft?.notice??'选择任务后自动获取源码关键字，无需切换看板。');
 $('commitTaskHint').classList.toggle('error',Boolean(keywordError));$('retryKeyword').hidden=!keywordError;updateComposerActions();
}
async function refreshComposer({includeTasks=true}={}){
 if(!liveGit())return;const projectId=project.id,request=++composerSequence;keywordSequence++;keywordLoading=false;keywordError='';composerLoading=true;
 if(commitDraft?.projectId===projectId)commitDraft.token=null;else $('commitCount').textContent='正在读取暂存区…';updateComposerActions();
 try{
 const data=await call('commit_prepare',{id:projectId,includeTasks:includeTasks||!taskList});if(request!==composerSequence||project?.id!==projectId||!liveGit())return;
 const position=reviewSurface.capturePosition({preferFocus:false});
 if(data.tasks){taskList=data.tasks;taskNotice=data.notice??'';}data.tasks=(taskList??[]).map(t=>({...t}));data.notice=taskNotice;
 commitDraft={...data,projectId};for(const t of commitDraft.tasks)t.keyword=keywordMemory.get(t.id)??t.keyword;
 $('commitRepo').textContent=data.branch;$('commitRepo').title=data.root+' · '+data.branch;$('commitTask').replaceChildren(new Option('不关联 TAPD 任务',''));
 for(const t of data.tasks){const option=new Option(t.title+' · '+t.account+' / '+t.sourceId,t.id);$('commitTask').append(option);}
 const saved=commitTextDrafts.get(projectId);$('commitSummary').value=saved?.summary??'';if(saved?.taskId&&data.tasks.some(t=>t.id===saved.taskId))$('commitTask').value=saved.taskId;
 $('commitError').textContent='';$('commitFiles').replaceChildren(...data.files.map(f=>el('li',f.path)));$('commitCount').textContent=data.files.length?data.files.length+' 个已暂存文件':'先 Stage 要提交的文件';buildCommitMessage();reviewSurface.restorePosition(position);
 if($('commitTask').value&&!keywordMemory.has($('commitTask').value))void loadCommitKeyword();
 }catch(e){if(request!==composerSequence||project?.id!==projectId||!liveGit())return;commitDraft=null;$('commitRepo').textContent=repository?.branch??'';$('commitError').textContent=e.message;$('commitCount').textContent='暂时无法提交';updateComposerActions();}
 finally{if(request===composerSequence){composerLoading=false;updateComposerActions();}}
}
async function loadCommitKeyword(){
 const taskId=$('commitTask').value,projectId=commitDraft?.projectId,request=++keywordSequence;keywordError='';keywordLoading=false;if(!taskId){buildCommitMessage();return;}
 const task=commitDraft?.tasks.find(t=>t.id===taskId);if(!task)return;task.keyword='';keywordLoading=true;buildCommitMessage();
 try{const data=await call('commit_task_keyword',{taskId});if(request!==keywordSequence||project?.id!==projectId||$('commitTask').value!==taskId)return;task.keyword=data.keyword;keywordMemory.set(taskId,data.keyword);}
 catch(e){if(request!==keywordSequence||project?.id!==projectId)return;keywordError=e.message;}
 finally{if(request===keywordSequence&&project?.id===projectId){keywordLoading=false;buildCommitMessage();}}
}
function saveCommitText(){if(project?.id)commitTextDrafts.set(project.id,{summary:$('commitSummary').value,taskId:$('commitTask').value});}
$('commitTask').onchange=()=>{const task=commitDraft?.tasks.find(t=>t.id===$('commitTask').value);if(task&&!$('commitSummary').value.trim())$('commitSummary').value=task.title;saveCommitText();void loadCommitKeyword();};$('commitSummary').oninput=()=>{saveCommitText();buildCommitMessage();};$('retryKeyword').onclick=()=>void loadCommitKeyword();$('refreshCommit').onclick=()=>run(()=>refreshComposer());
$('gitCommitForm').onsubmit=e=>{e.preventDefault();if(busy||!commitDraft||$('confirmCommit').disabled)return;const draft=commitDraft,message=$('commitMessage').textContent,taskId=$('commitTask').value;committing=true;run(async()=>{try{
 const result=await call('commit_execute',{id:draft.projectId,token:draft.token,message,...(taskId?{taskId}:{})});commitTextDrafts.delete(draft.projectId);commitDraft=null;keywordSequence++;$('commitSummary').value='';
 try{await openProject({id:draft.projectId});}catch(e){if(e.code!=='FILE_LIMIT')throw Error('已提交 '+result.commit.slice(0,8)+'，但刷新失败：'+e.message);}$('commitResult').textContent='已提交 '+result.commit.slice(0,8)+' · '+result.branch;
 }finally{committing=false;updateComposerActions();}},'正在提交，请等待 Git hooks 完成…');};

const reviewSurface=createReviewSurface({
 state:()=>({project,repository,scope,review,files,layout,busy:busy||fileLoading,limits:workspace.limits,live:liveGit()}),
 readFile:async ctx=>{const selectedProject=project,selectedReview=review,selectedScope={...scope},live=liveGit();const value=selectedReview?selectedReview.files.find(f=>f.path===ctx.path):(await call('project_file',{id:selectedProject.id,...selectedScope,path:ctx.path,mode:ctx.mode})).file;let hunks=null;if(live&&!value.binary){hunks=await call('git_hunks',{id:selectedProject.id,path:ctx.path,mode:ctx.mode});const verified=(await call('project_file',{id:selectedProject.id,...selectedScope,path:ctx.path,mode:ctx.mode})).file;if(verified.digest!==value.digest)throw Error('读取期间文件发生变化，请刷新后重试。');}return {file:value,hunks};},
 select:(path,mode)=>navigateFile(path,mode),
 mutateFile:(ctx,operation)=>operation==='discard'?void openGitOperation('discard',{paths:[ctx.path]}):void run(async()=>{const position=reviewSurface.capturePosition();await call('git_index_change',{id:project.id,mode:ctx.mode,operation,files:[{path:ctx.path,fingerprint:ctx.record.fingerprint}]});await loadChanges(ctx.path,{preserveSummary:true,mode:ctx.mode,position});}),
 mutateHunk:(ctx,hunks,hunk,operation)=>{const args={id:project.id,path:ctx.path,mode:ctx.mode,token:hunks.token,hunkId:hunk.id,operation,confirmed:true};if(operation==='discard')confirmDiscardHunk(hunk,args);else void run(async()=>{const position=reviewSurface.capturePosition();await call('git_hunk_apply',args);await loadChanges(ctx.path,{preserveSummary:true,mode:ctx.mode,position});});},
 markReviewed:(ctx,wanted)=>run(async()=>{await selectFile(ctx.path,false,ctx.mode);await ensureSaved(ctx.mode);review=(await call('review_update',{id:review.id,version:review.version,path:ctx.path,reviewed:wanted})).review;files=review.files;file=files.find(f=>f.path===ctx.path);renderFiles();renderDetail();}),
 stageReviewed:ctx=>run(async()=>{await call('review_stage',{id:project.id,reviewId:review.id,version:review.version,path:ctx.path});await currentChanges();}),
 comment:(ctx,side,line)=>run(async()=>{await selectFile(ctx.path,true,ctx.mode);await startComment(side,line);}),
 bulk:operation=>operation==='discard'?void openGitOperation('discard'):void stageAll(operation)
});

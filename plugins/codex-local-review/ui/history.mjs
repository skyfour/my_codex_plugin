// History visibility is independent of checkout; preferences belong to each project.
let historySelection=new Set();
function renderHistoryControls(){
 const mode=repository?.historyMode??project?.state?.historyMode??'current',refs=repository?.historyRefs??project?.state?.historyRefs??[],missing=repository?.missingHistoryRefs??[];
 $('historyMode').value=mode;$('chooseHistoryBranches').hidden=mode!=='selected';
 const label=mode==='current'?`当前分支 · ${repository?.branch??''}`:mode==='all'?'全部本地与远程分支':`已选择 ${refs.length} 个分支`;
 $('historyHint').textContent=label+' · 最多 100 条'+(missing.length?' · 分支已不存在：'+missing.map(ref=>ref.replace(/^refs\/(heads|remotes)\//,'')).join('、'):'');
 $('historyHint').title=mode==='selected'?refs.join('\n'):'当前分支包含继承的历史；分支范围只影响显示。';updateHistoryActions();
}
function updateHistoryActions(){
 const working=busy||fileLoading,disabled=working||!project?.isGit;
 $('historyMode').disabled=$('chooseHistoryBranches').disabled=disabled;$('applyHistoryBranches').disabled=working||!historySelection.size;
 $('historyBranchSearch').disabled=working;
 for(const input of $('historyBranches').querySelectorAll('input'))input.disabled=working||!input.checked&&historySelection.size>=32;
}
async function showCommitHistory({preferHead=false,target}={}){
 if(target&&tab==='commits'&&scope.mode==='commit'&&scope.target===target)return;
 const preferred=file?.path??failedFile?.path,wanted=target??(!preferHead&&scope.mode==='commit'?scope.target:repository.head),commit=repository.commits.find(c=>c.sha===wanted)||repository.commits.find(c=>c.sha===repository.head)||repository.commits[0];
 leaveReviewContext();reviewSurface.reset(true);review=null;tab='commits';scope={mode:'commit',target:commit?.sha??''};
 if(commit){await loadChanges(preferred);return;}
 file=null;files=[];failedFile=null;fileHunkData=null;anchor=null;$('commentText').value='';$('commentForm').hidden=true;selectedFiles.clear();fileLoading=false;updateBusy();renderNavigation();renderFiles();renderDetail();renderComments();await refreshGitStatus();await remember();
}
async function applyHistoryRange(mode,refs=project?.state?.historyRefs??[]){
 saveDraft();const selected=project;
 const result=await call('project_update',{id:selected.id,state:{historyMode:mode,historyRefs:refs}});selected.state={...selected.state,historyMode:mode,historyRefs:refs};acceptWorkspace(result);
 repository=(await call('project_open',{id:selected.id})).repository;
 if(tab==='commits'&&scope.mode==='commit'&&repository.commits.some(c=>c.sha===scope.target)){renderNavigation();await refreshGitStatus();await remember();}
 else await showCommitHistory();
 renderProjects();
}
function renderHistoryBranches(){
 const filter=$('historyBranchSearch').value.toLowerCase(),all=repository?.branches??[],matches=all.filter(b=>b.name.toLowerCase().includes(filter));$('historyBranches').replaceChildren();
 for(const [title,local] of [['本地分支',true],['远程分支',false]]){
  const items=matches.slice(0,100).filter(b=>b.local===local);if(!items.length)continue;$('historyBranches').append(el('h3',title));
  for(const branch of items){const row=el('label'),input=el('input');input.type='checkbox';input.dataset.historyRef=branch.ref;input.checked=historySelection.has(branch.ref);input.setAttribute('aria-label',branch.name);input.onchange=()=>{if(input.checked)historySelection.add(branch.ref);else historySelection.delete(branch.ref);updateHistorySelection();};const name=el('span',branch.name);name.title=branch.name;row.append(input,name);$('historyBranches').append(row);}
 }
 if(!matches.length)$('historyBranches').append(el('p','没有匹配的分支','empty-list'));
 if(matches.length>100)$('historyBranches').append(el('p',`匹配 ${matches.length} 个分支，显示前 100 个；输入更多文字缩小范围。`,'empty-list'));
 updateHistorySelection();
}
function updateHistorySelection(){$('historySelectionCount').textContent=`已选择 ${historySelection.size} / 32 个分支`;updateHistoryActions();}
function openHistoryBranches(){
 if(busy||!project?.isGit)return;
 const available=new Set((repository?.branches??[]).map(b=>b.ref));historySelection=new Set((project.state?.historyRefs??[]).filter(ref=>available.has(ref)));
 const current='refs/heads/'+repository.branch;if(!historySelection.size&&available.has(current))historySelection.add(current);
 $('historyBranchSearch').value='';renderHistoryBranches();$('historyDialog').showModal();$('historyBranchSearch').focus();
}
$('historyMode').onchange=()=>{const mode=$('historyMode').value;if(mode==='selected'){renderHistoryControls();openHistoryBranches();}else navigate(()=>applyHistoryRange(mode));};
$('chooseHistoryBranches').onclick=openHistoryBranches;$('historyBranchSearch').oninput=renderHistoryBranches;
$('applyHistoryBranches').onclick=()=>{if(!historySelection.size||busy)return;const refs=[...historySelection];$('historyDialog').close();navigate(()=>applyHistoryRange('selected',refs));};

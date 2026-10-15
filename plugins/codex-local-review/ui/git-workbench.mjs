// UI adapter for repository commands. No shell commands or patch construction here.
let gitStatus=null,gitDialogState=null;
async function refreshGitStatus(){gitStatus=null;if(project?.isGit){try{gitStatus=await call('git_status',{id:project.id});}catch(e){gitStatus={error:e.message,branch:repository?.branch??'',remotes:[],branches:[],files:[]};}}updateGitWorkbench();}
function updateGitWorkbench(){
 const enabled=Boolean(project?.isGit),live=liveGit();$('gitCommandBar').hidden=!enabled;$('currentBranch').textContent=gitStatus?.branch||repository?.branch||'分离 HEAD';$('syncStatus').textContent=gitStatus?.upstream?`${gitStatus.upstream.remote}/${gitStatus.upstream.branch} · ↓${gitStatus.behind??'?'} ↑${gitStatus.ahead??'?'}`:gitStatus?.error||'未设置 upstream';
 for(const id of ['switchBranch','gitFetch','gitPull','gitPush','pullOptions','pushOptions'])$(id).disabled=busy||!enabled||!gitStatus||Boolean(gitStatus.error);
 $('gitAll').hidden=!live;$('stageAll').disabled=busy||!gitStatus?.files?.some(f=>f.canStage);$('unstageAll').disabled=busy||!gitStatus?.files?.some(f=>f.canUnstage);$('discardAll').disabled=$('stageAll').disabled;
 const current=files.find(f=>f.path===(file?.path??failedFile?.path));$('discardFile').hidden=!live||!current?.canStage||fileMode==='staged';$('discardFile').disabled=busy;
 $('hunkNotice').textContent=live?(fileHunkData?.notice??''):'';$('hunkNotice').hidden=!$('hunkNotice').textContent;
 document.querySelectorAll('[data-hunk-operation]').forEach(button=>button.disabled=busy||!live);
 for(const input of document.querySelectorAll('#gitOperationForm input,#gitOperationForm select,#gitPreviewOperation,#gitCreateBranch,#gitDialog [data-close]'))input.disabled=busy;
 $('gitConfirmOperation').disabled=busy||!gitDialogState?.plan;
}
async function refreshAfterGit(preferred=file?.path??failedFile?.path){repository=(await call('project_open',{id:project.id})).repository;review=null;tab='changes';scope={mode:'working'};await loadChanges(preferred);renderProjects();}
async function stageAll(operation){await run(async()=>{const state=await call('git_status',{id:project.id}),records=state.files.filter(f=>operation==='stage'?f.canStage:f.canUnstage);if(!records.length)return;await call('git_index_change',{id:project.id,mode:'working',operation,files:records.map(({path,fingerprint})=>({path,fingerprint}))});await refreshAfterGit();},operation==='stage'?'正在暂存全部文件…':'正在取消全部暂存…');}
function dialogArgs(){
 const d=gitDialogState,args={operation:d.operation};
 if(d.operation==='switch')args.branch=$('gitBranchTarget').value;
 if(d.operation==='create_branch')args.branch=$('gitNewBranch').value.trim();
 if(['fetch','pull','push'].includes(d.operation))args.remote=$('gitRemoteTarget').value;
 if(['pull','push'].includes(d.operation))args.branch=$('gitRemoteBranch').value.trim();
 if(d.operation==='push')args.setUpstream=$('gitSetUpstream').checked;
 if(d.paths)args.paths=d.paths;
 return args;
}
function invalidateGitPlan(){if(!gitDialogState)return;gitDialogState.plan=null;gitDialogState.previewSequence=(gitDialogState.previewSequence??0)+1;$('gitConfirmOperation').disabled=true;$('gitPlanText').textContent='选项已变化，请重新预览操作。';$('gitPlanFiles').replaceChildren();$('gitDialogError').textContent='';}
async function previewGitOperation(){const d=gitDialogState;if(!d)return;const args=dialogArgs(),sequence=d.previewSequence=(d.previewSequence??0)+1;$('gitConfirmOperation').disabled=true;$('gitDialogError').textContent='';try{const plan=await call('git_operation_prepare',{id:d.projectId,...args});if(gitDialogState!==d||d.previewSequence!==sequence||!$('gitDialog').open)return;d.plan={...plan,args};$('gitPlanText').textContent=plan.summary;$('gitPlanFiles').replaceChildren(...plan.files.map(f=>el('li',f.path+(f.untracked?'（未跟踪，将删除）':''))));$('gitConfirmOperation').disabled=false;}catch(e){if(gitDialogState===d&&d.previewSequence===sequence&&$('gitDialog').open)$('gitDialogError').textContent=e.message;}}
async function openGitOperation(operation,{paths,choose=false}={}){
 if(busy||!project?.isGit)return;clearTimeout(gitPreviewTimer);
 const d=gitDialogState={operation,projectId:project.id,paths,plan:null};$('gitDialogTitle').textContent={switch:'切换分支',create_branch:'创建分支',fetch:'Fetch 远程',pull:'Pull 拉取',push:'Push 推送',discard:'Discard 丢弃未暂存改动'}[operation];$('gitCurrent').textContent=`${project.name} · ${gitStatus?.branch||'分离 HEAD'}`;
 $('gitBranchLabel').hidden=operation!=='switch';$('gitCreateBranch').hidden=operation!=='switch';$('gitNewBranchLabel').hidden=operation!=='create_branch';$('gitNewBranch').value='';
 $('gitBranchTarget').replaceChildren();for(const [label,local] of [['本地分支',true],['远程分支',false]]){const group=el('optgroup');group.label=label;for(const b of gitStatus?.branches??[]){if(b.local!==local)continue;group.append(new Option(b.name,b.ref));}$('gitBranchTarget').append(group);}const current='refs/heads/'+gitStatus?.branch;$('gitBranchTarget').value=(gitStatus?.branches??[]).find(b=>b.ref!==current)?.ref??current;
 $('gitRemoteLabel').hidden=!['fetch','pull','push'].includes(operation);$('gitRemoteTarget').replaceChildren(...(gitStatus?.remotes??[]).map(remote=>new Option(remote,remote)));$('gitRemoteTarget').value=gitStatus?.upstream?.remote??(gitStatus?.remotes.includes('origin')?'origin':gitStatus?.remotes[0]??'');
 $('gitRemoteBranchLabel').hidden=!['pull','push'].includes(operation);$('gitRemoteBranch').value=gitStatus?.upstream?.branch??gitStatus?.branch??'';$('gitUpstreamLabel').hidden=operation!=='push';$('gitSetUpstream').checked=!gitStatus?.upstream;
 $('gitDialogError').textContent='';$('gitPlanText').textContent='正在读取操作范围…';$('gitPlanFiles').replaceChildren();$('gitConfirmOperation').disabled=true;$('gitPreviewOperation').hidden=false;$('gitDialog').showModal();
 if(!choose)await previewGitOperation();else invalidateGitPlan();
}
$('gitPreviewOperation').onclick=()=>void previewGitOperation();
let gitPreviewTimer;
for(const id of ['gitBranchTarget','gitNewBranch','gitRemoteTarget','gitRemoteBranch','gitSetUpstream'])$(id).oninput=()=>{invalidateGitPlan();clearTimeout(gitPreviewTimer);gitPreviewTimer=setTimeout(()=>{if($('gitDialog').open&&!busy)void previewGitOperation();},250);};
$('gitCreateBranch').onclick=()=>{$('gitDialog').close();void openGitOperation('create_branch',{choose:true});};
$('gitOperationForm').onsubmit=e=>{e.preventDefault();const d=gitDialogState;if(!d?.plan||busy)return;const plan=d.plan;$('gitConfirmOperation').disabled=true;void run(async()=>{try{await call('git_operation_execute',{id:d.projectId,...plan.args,token:plan.token,confirmed:true});$('gitDialog').close();await refreshAfterGit();$('gitResult').textContent='已完成 '+plan.args.operation;}catch(error){d.plan=null;$('gitDialogError').textContent=error.message;await refreshGitStatus();throw error;}},'正在执行 Git 操作…');};
async function quickRemote(operation){
 if(busy||!project?.isGit)return;
 const upstream=gitStatus?.upstream,remotes=gitStatus?.remotes??[];
 if(!remotes.length||operation==='pull'&&!upstream||!upstream&&remotes.length>1){await openGitOperation(operation,{choose:true});return;}
 const args={operation,remote:upstream?.remote??remotes[0],...(operation==='pull'?{branch:upstream.branch}:{})};
 await run(async()=>{const plan=await call('git_operation_prepare',{id:project.id,...args});await call('git_operation_execute',{id:project.id,...args,token:plan.token,confirmed:true});await refreshAfterGit();$('gitResult').textContent='已完成 '+operation;},operation==='fetch'?'正在 Fetch 远程引用…':'正在 Pull（仅快进）…');
}
$('switchBranch').onclick=()=>void openGitOperation('switch');$('gitFetch').onclick=()=>void quickRemote('fetch');$('gitPull').onclick=()=>void quickRemote('pull');$('gitPush').onclick=()=>void openGitOperation('push');$('pullOptions').onclick=()=>void openGitOperation('pull',{choose:true});$('pushOptions').onclick=()=>void openGitOperation('push',{choose:true});
$('discardFile').onclick=()=>void openGitOperation('discard',{paths:[file?.path??failedFile?.path]});$('discardAll').onclick=()=>void openGitOperation('discard');$('stageAll').onclick=()=>void stageAll('stage');$('unstageAll').onclick=()=>void stageAll('unstage');
function hunkRange(start,count){return count?`第 ${start}${count>1?'–'+(start+count-1):''} 行`:'无对应行';}
async function mutateHunk(hunk,operation){const context={id:project.id,path:file.path,mode:fileHunkData.mode,token:fileHunkData.token,hunkId:hunk.id,operation,confirmed:true};await run(async()=>{await call('git_hunk_apply',context);await loadChanges(context.path);},'正在处理选中的改动块…');}
function confirmDiscardHunk(hunk,selectedContext){
 if(busy)return;clearTimeout(gitPreviewTimer);const context=selectedContext??{id:project.id,path:file.path,mode:fileHunkData.mode,token:fileHunkData.token,hunkId:hunk.id,operation:'discard',confirmed:true};
 const d=gitDialogState={projectId:project.id,hunk:context,plan:{}};$('gitDialogTitle').textContent='Discard Hunk';$('gitCurrent').textContent=project.name;
 for(const id of ['gitBranchLabel','gitNewBranchLabel','gitCreateBranch','gitRemoteLabel','gitRemoteBranchLabel','gitUpstreamLabel','gitPreviewOperation'])$(id).hidden=true;
 $('gitPlanText').textContent=`丢弃 ${context.path} 中选中的未暂存改动块（修改前${hunkRange(hunk.oldStart,hunk.oldCount)} → 修改后${hunkRange(hunk.newStart,hunk.newCount)}）。保留其他改动块和暂存区；不能通过 Unstage 恢复。`;$('gitPlanFiles').replaceChildren();$('gitDialogError').textContent='';$('gitConfirmOperation').disabled=false;$('gitDialog').showModal();
}
$('gitDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
const submitRepositoryOperation=$('gitOperationForm').onsubmit;
$('gitOperationForm').onsubmit=e=>{if(!gitDialogState?.hunk){submitRepositoryOperation(e);return;}e.preventDefault();if(busy)return;const context=gitDialogState.hunk;$('gitConfirmOperation').disabled=true;void run(async()=>{try{await call('git_hunk_apply',context);$('gitDialog').close();await loadChanges(context.path);}catch(error){gitDialogState.plan=null;$('gitDialogError').textContent=error.message;throw error;}},'正在丢弃选中的改动块…');};

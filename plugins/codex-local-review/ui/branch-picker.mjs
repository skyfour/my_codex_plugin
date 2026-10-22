// Nonmodal branch picker. Git commands and freshness checks stay in the backend.
let branchPickerState=null;
function branchPickerOpen(){return $('branchPopover').matches(':popover-open');}
function closeBranchPicker(restoreFocus=false){if(branchPickerOpen())$('branchPopover').hidePopover();$('switchBranch').setAttribute('aria-expanded','false');if(restoreFocus)$('switchBranch').focus({preventScroll:true});}
function positionBranchPicker(){
 if(!branchPickerOpen())return;const panel=$('branchPopover'),anchor=$('switchBranch').getBoundingClientRect(),width=Math.min(520,innerWidth-16),top=Math.min(anchor.bottom+6,Math.max(8,innerHeight-180));
 panel.style.width=width+'px';panel.style.left=Math.max(8,Math.min(innerWidth-width-8,anchor.left+anchor.width/2-width/2))+'px';panel.style.top=top+'px';panel.style.maxHeight=Math.max(100,innerHeight-top-8)+'px';
}
function remoteBranchSuffix(ref){const remote=[...(gitStatus?.remotes??[])].sort((a,b)=>b.length-a.length).find(name=>ref.startsWith(`refs/remotes/${name}/`));return remote?ref.slice(`refs/remotes/${remote}/`.length):'';}
function openBranchPicker(){
 if(branchPickerOpen()){closeBranchPicker(true);return;}if(busy||fileLoading||!project?.isGit||!gitStatus||gitStatus.error)return;
 const old=branchPickerState;if(old?.projectId===project.id&&old.error){branchPickerState=old;old.signature='';}else{branchPickerState={projectId:project.id,mode:'list',options:[],index:0,signature:'',error:''};$('branchSearch').value='';$('branchCreateName').value='';}renderBranchPicker();$('branchPopover').showPopover();$('switchBranch').setAttribute('aria-expanded','true');positionBranchPicker();focusBranchMode();
}
function focusBranchMode(){const mode=branchPickerState?.mode,node=mode==='actions'?$('branchActions').querySelector('button:not([hidden]):not(:disabled)'):$(mode==='remote'?'branchLocalName':mode==='create'?'branchCreateName':'branchSearch');node?.focus({preventScroll:true});}
function setBranchMode(mode){if(!branchPickerState)return;branchPickerState.mode=mode;branchPickerState.error='';renderBranchPicker();focusBranchMode();}
function renderBranchOptions(){
 const state=branchPickerState,query=$('branchSearch').value.toLowerCase(),signature=JSON.stringify([gitStatus?.token,query]);if(state.signature===signature)return;state.signature=signature;
 state.options=(gitStatus?.branches??[]).filter(b=>b.name.toLowerCase().includes(query)).toSorted((a,b)=>Number(b.local)-Number(a.local)||a.name.localeCompare(b.name));state.index=0;
 const list=$('branchOptions');list.replaceChildren();let lastGroup='';
 for(const [index,b] of state.options.entries()){
  const group=b.local?'本地分支':'远端分支';if(lastGroup!==group){const heading=el('div',group,'branch-group');heading.setAttribute('role','presentation');list.append(heading);lastGroup=group;}
  const row=button('',()=>chooseBranch(b),'branch-option');row.id='branchOption-'+index;row.dataset.branchRef=b.ref;row.setAttribute('role','option');row.tabIndex=-1;row.title=b.name;
  row.append(el('span',b.local?'⑂':'↳','branch-kind'),el('span',b.name,'branch-name'));row.append(el('small',b.ref==='refs/heads/'+gitStatus?.branch?'当前 · 操作 ›':'操作 ›','branch-badge'));
  row.addEventListener('pointermove',()=>{if(state.index!==index){state.index=index;highlightBranchOption();}});list.append(row);
 }
 if(!state.options.length)list.append(el('p',query?'没有匹配的分支':'尚无本地或远端分支','empty-list'));highlightBranchOption();
}
function highlightBranchOption(){const state=branchPickerState;if(!state)return;for(const [index,node] of [...$('branchOptions').querySelectorAll('[data-branch-ref]')].entries())node.setAttribute('aria-selected',String(state.index===index));const active=$('branchOptions').querySelector('[aria-selected=true]');if(active)$('branchSearch').setAttribute('aria-activedescendant',active.id);else $('branchSearch').removeAttribute('aria-activedescendant');}
function renderBranchPicker(){
 const s=branchPickerState;if(!s)return;const working=busy||fileLoading||!gitStatus||Boolean(gitStatus.error),list=s.mode==='list';
 $('branchListView').hidden=!list;$('branchActions').hidden=s.mode!=='actions';$('branchRemoteActions').hidden=s.mode!=='remote';$('branchCreateForm').hidden=s.mode!=='create';$('branchBack').hidden=list;$('branchBack').setAttribute('aria-label',s.mode==='actions'?'返回分支列表':'返回分支操作');$('branchPickerTitle').textContent=list?'选择分支':s.selected?.name??'分支操作';$('branchPickerTitle').title=$('branchPickerTitle').textContent;$('branchError').textContent=s.error||'';
 if(list)renderBranchOptions();
 for(const node of $('branchPopover').querySelectorAll('button,input'))node.disabled=working;for(const id of ['branchClose'])$(id).disabled=false;
 if(s.selected){
  const current=s.selected.ref==='refs/heads/'+gitStatus?.branch;
  $('branchSelectedName').textContent=s.selected.name;$('branchSelectedKind').textContent=s.selected.local?'本地分支':'远端分支';$('branchActions').dataset.branchRef=s.selected.ref;
  $('branchCheckout').hidden=!s.selected.local;$('branchCheckout').disabled=working||current;$('branchCheckout').textContent=current?'当前分支':'切换到此分支';
  $('branchCreate').textContent=s.selected.local?'从此分支创建新分支…':'创建本地跟踪分支…';$('branchDetach').hidden=s.selected.local;
  $('branchCreateSource').textContent=s.selected.name;
 }
 if(s.mode==='remote'){
  $('branchRemoteSource').textContent=s.remote.name;const name=$('branchLocalName').value.trim(),exists=gitStatus?.branches?.find(b=>b.local&&b.name===name);s.existing=exists;
  $('branchLocalCheckout').hidden=!exists;$('branchLocalCheckout').textContent=exists?'切换本地 '+exists.name:'切换本地分支';$('branchTrack').disabled=working||!name||Boolean(exists);$('branchNameHint').textContent=exists?'本地已有同名分支，可切换它，或修改名称创建新的跟踪分支。':'创建后自动设置此远端为 upstream。';
 }
 $('branchCreateSubmit').disabled=working||!$('branchCreateName').value.trim();positionBranchPicker();
}
function updateBranchPicker(){if(branchPickerState&&branchPickerState.projectId!==project?.id){closeBranchPicker();branchPickerState=null;return;}if(branchPickerState&&branchPickerOpen())renderBranchPicker();}
function chooseBranch(branch){
 if(busy||!branchPickerState||branchPickerState.projectId!==project?.id)return;
 branchPickerState.selected=branch;branchPickerState.remote=branch.local?null:branch;branchPickerState.index=branchPickerState.options.findIndex(b=>b.ref===branch.ref);$('branchCreateName').value='';$('branchLocalName').value=branch.local?'':remoteBranchSuffix(branch.ref);setBranchMode('actions');
}
async function executeBranchAction(args){
 const state=branchPickerState,selected=project;if(busy||!state||selected?.id!==state.projectId)return;state.error='';
 await run(async()=>{try{
  const plan=await call('git_operation_prepare',{id:state.projectId,...args});if(project!==selected)return;
  await call('git_operation_execute',{id:state.projectId,...args,token:plan.token,confirmed:true});if(project!==selected)return;
  if(branchPickerState===state)closeBranchPicker();await refreshAfterGit(undefined,{preferHead:true});$('gitResult').textContent=args.detach?'已检出远端提交 · 分离 HEAD':args.operation==='create_branch'?'已创建并切换分支':'已切换分支';
 }catch(error){state.error=error.message;if(branchPickerState===state&&project===selected)renderBranchPicker();if(project===selected)await refreshGitStatus();throw error;}},args.detach?'正在检出远端提交…':args.operation==='create_branch'?'正在创建分支…':'正在切换分支…');
}
$('branchSearch').oninput=()=>{if(branchPickerState){branchPickerState.signature='';renderBranchOptions();renderBranchPicker();}};
$('branchSearch').onkeydown=e=>{const s=branchPickerState;if(!s||busy)return;if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();s.index=Math.max(0,Math.min(s.options.length-1,s.index+(e.key==='ArrowDown'?1:-1)));highlightBranchOption();$('branchOptions').querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});}else if(e.key==='Enter'){e.preventDefault();if(s.options[s.index])chooseBranch(s.options[s.index]);}};
$('branchCreate').onclick=()=>{if(branchPickerState?.selected)setBranchMode(branchPickerState.selected.local?'create':'remote');};$('branchBack').onclick=()=>setBranchMode(branchPickerState?.mode==='actions'?'list':'actions');$('branchClose').onclick=()=>closeBranchPicker(true);
$('branchCheckout').onclick=()=>{const selected=branchPickerState?.selected;if(selected?.local&&!$('branchCheckout').disabled)void executeBranchAction({operation:'switch',branch:selected.ref});};
$('branchActions').onkeydown=e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const options=[...$('branchActions').querySelectorAll('button:not([hidden]):not(:disabled)')];if(!options.length)return;e.preventDefault();const index=options.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next].focus();};
$('branchTrackForm').onsubmit=e=>{e.preventDefault();if(branchPickerState?.remote&&!$('branchTrack').disabled)void executeBranchAction({operation:'switch',branch:branchPickerState.remote.ref,localBranch:$('branchLocalName').value.trim()});};
$('branchLocalName').oninput=()=>{if(branchPickerState)branchPickerState.error='';renderBranchPicker();};$('branchCreateName').oninput=()=>{if(branchPickerState)branchPickerState.error='';renderBranchPicker();};
$('branchLocalCheckout').onclick=()=>{if(branchPickerState?.existing)void executeBranchAction({operation:'switch',branch:branchPickerState.existing.ref});};$('branchDetach').onclick=()=>{if(branchPickerState?.remote)void executeBranchAction({operation:'switch',branch:branchPickerState.remote.ref,detach:true});};
$('branchCreateForm').onsubmit=e=>{e.preventDefault();if(branchPickerState?.selected?.local&&!$('branchCreateSubmit').disabled)void executeBranchAction({operation:'create_branch',branch:$('branchCreateName').value.trim(),startPoint:branchPickerState.selected.ref});};
$('branchPopover').addEventListener('toggle',()=>{$('switchBranch').setAttribute('aria-expanded',String(branchPickerOpen()));});
window.addEventListener('resize',positionBranchPicker);

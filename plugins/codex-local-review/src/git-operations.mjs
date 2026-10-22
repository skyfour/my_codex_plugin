import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {realpath,lstat,unlink} from 'node:fs/promises';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {git,indexState} from './git-index.mjs';
import {withGitWrite} from './git-lock.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function repositoryStatus(root){
 const state=await indexState(root),branch=(await git(state.root,['symbolic-ref','-q','HEAD']).catch(()=>'' )).trim().replace(/^refs\/heads\//,'');
 const lines=(await git(state.root,['for-each-ref','--format=%(refname)%00%(objectname)%00%(symref)','refs/heads','refs/remotes'])).trim().split('\n').filter(Boolean);
 const branches=lines.map(line=>{const [ref,sha,symref]=line.split('\0');return {ref,sha,symref,name:ref.replace(/^refs\/(heads|remotes)\//,''),local:ref.startsWith('refs/heads/')};}).filter(b=>!b.symref);
 const remotes=(await git(state.root,['remote'])).trim().split('\n').filter(Boolean);let upstream=null,ahead=null,behind=null;
 if(branch){const remote=(await git(state.root,['config','--get',`branch.${branch}.remote`]).catch(()=>'' )).trim(),merge=(await git(state.root,['config','--get',`branch.${branch}.merge`]).catch(()=>'' )).trim();if(remotes.includes(remote)&&merge.startsWith('refs/heads/'))upstream={remote,branch:merge.slice(11)};}
 if(upstream){const ref=(await git(state.root,['rev-parse','--symbolic-full-name','@{upstream}']).catch(()=>'' )).trim();if(ref){const counts=(await git(state.root,['rev-list','--left-right','--count',`${ref}...HEAD`]).catch(()=>'' )).trim().split(/\s+/).map(Number);if(counts.length===2&&counts.every(Number.isFinite))[behind,ahead]=counts;}}
 let ongoing=false;for(const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply']){const path=(await git(state.root,['rev-parse','--git-path',name])).trim();if(existsSync(isAbsolute(path)?path:join(state.root,path)))ongoing=true;}
 // Configuration is hashed for freshness but remote URLs/credentials never leave this module.
 const remoteConfig=await Promise.all(remotes.map(async name=>[name,await git(state.root,['config','--get-all',`remote.${name}.url`]).catch(()=>''),await git(state.root,['config','--get-all',`remote.${name}.pushurl`]).catch(()=>'' ),await configValues(state.root,`remote.${name}.fetch`)]));
 const token=hash([state.head,state.files,branch,branches,upstream,remoteConfig,ongoing]);
 return {...state,branch,branches,remotes,upstream,ahead,behind,ongoing,token};
}
async function branchName(root,name){if(typeof name!=='string'||!name||name==='HEAD'||name.startsWith('-')||name.length>256)throw Error('分支名称无效');try{await git(root,['check-ref-format',`refs/heads/${name}`]);}catch{throw Error('分支名称无效');}return name;}
async function newBranchName(s,name){name=await branchName(s.root,name);if(s.branches.some(b=>b.ref==='refs/heads/'+name))throw Error(`本地分支 ${name} 已存在，请直接选择本地分支或换一个名称`);if(s.branches.some(b=>b.local&&(b.name.startsWith(name+'/')||name.startsWith(b.name+'/'))))throw Error('分支名称与已有分支的目录结构冲突，请换一个名称');return name;}
function remoteBranch(s,ref){const remote=s.remotes.filter(name=>ref.startsWith(`refs/remotes/${name}/`)).sort((a,b)=>b.length-a.length)[0];if(!remote)throw Error('远程分支无效，请刷新分支列表');return {remote,branch:ref.slice(`refs/remotes/${remote}/`.length)};}
async function configValues(root,key){try{return (await git(root,['config','--null','--get-all',key])).split('\0').slice(0,-1);}catch(e){if(e.code===1)return [];throw e;}}
async function noTrackingConfig(root,name){const values=await Promise.all(['remote','merge'].map(key=>configValues(root,`branch.${name}.${key}`)));if(values.some(items=>items.length))throw Error(`本地分支 ${name} 已有跟踪配置，请换一个名称；现有配置会保留`);}
function matchRef(pattern,ref){const parts=pattern.split('*');if(parts.length===1)return pattern===ref?'':null;if(parts.length!==2||!ref.startsWith(parts[0])||!ref.endsWith(parts[1])||ref.length<parts[0].length+parts[1].length)return null;return ref.slice(parts[0].length,ref.length-parts[1].length);}
function mapRef(pattern,replacement,ref){if(pattern.split('*').length!==replacement.split('*').length)return null;const matched=matchRef(pattern,ref);return matched===null?null:replacement.replace('*',()=>matched);}
async function trackingSource(s,ref){
 const source=remoteBranch(s,ref),specs=await configValues(s.root,`remote.${source.remote}.fetch`),positive=[],negative=[];
 for(const spec of specs){if(spec.startsWith('^')){negative.push(spec.slice(1));continue;}const [from,to,...extra]=spec.replace(/^\+/,'').split(':');if(!extra.length&&from?.startsWith('refs/heads/')&&to)positive.push({from,to});}
 const candidates=new Set(positive.map(({from,to})=>mapRef(to,from,ref)).filter(candidate=>candidate&&!negative.some(pattern=>matchRef(pattern,candidate)!==null)));
 const merge=candidates.size===1?[...candidates][0]:null,destinations=new Set(merge?positive.map(({from,to})=>mapRef(from,to,merge)).filter(Boolean):[]);
 if(!merge||destinations.size!==1||!destinations.has(ref))throw Error('选定远程分支的 fetch 映射不唯一或已被排除，请检查远程配置，或使用分离检出');
 try{await git(s.root,['check-ref-format',merge]);}catch{throw Error('选定远程分支的 fetch 源分支映射无效，请检查远程配置');}
 return {...source,merge};
}
async function safeDiscardPath(root,path){
 const parent=await realpath(dirname(join(root,path))),rel=relative(root,parent);if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw Error('文件目录已移出当前仓库');
 try{const s=await lstat(join(root,path));if(!s.isFile()&&!s.isSymbolicLink())throw Error('Discard 只支持具体文件');}catch(e){if(e.code!=='ENOENT')throw e;}
}
export async function prepareOperation(root,args){
 const s=await repositoryStatus(root);if(s.ongoing||s.files.some(f=>f.unmerged))throw Error('请先完成当前合并、变基或冲突处理');
 const {operation}=args;let branch=args.branch,remote=args.remote,startPoint,localBranch,tracking,detach=false,files=[],summary='';
 if(operation!=='switch'&&(args.localBranch!==undefined||args.detach!==undefined))throw Error('localBranch / detach 仅支持远程分支切换');
 if(operation!=='create_branch'&&args.startPoint!==undefined)throw Error('startPoint 仅支持创建分支的起点');
 if(operation==='switch'){
  const target=s.branches.find(b=>b.ref===branch);if(!target)throw Error('目标分支已变化，请刷新分支列表');
  if(args.detach!==undefined&&typeof args.detach!=='boolean')throw Error('detach 必须是布尔值');
  if(target.local){if(args.localBranch!==undefined||args.detach!==undefined)throw Error('localBranch / detach 仅支持远程分支切换');summary=`切换到 ${target.name}。保留可以安全携带的未提交改动；发生覆盖冲突时 Git 会停止。`;}
  else{const source=remoteBranch(s,branch);if(args.localBranch!==undefined&&args.detach!==undefined)throw Error('localBranch 与 detach 不能同时使用');detach=args.detach===true;if(detach)summary=`检出 ${target.name} 的提交 ${target.sha.slice(0,12)}，进入 detached HEAD。发生覆盖未提交改动的冲突时 Git 会停止。`;else{localBranch=await newBranchName(s,args.localBranch===undefined?source.branch:args.localBranch);await noTrackingConfig(s.root,localBranch);tracking=await trackingSource(s,branch);summary=`从 ${target.name} 创建并切换到本地跟踪分支 ${localBranch}，跟踪 ${tracking.remote}/${tracking.merge.slice(11)}。保留可以安全携带的未提交改动；发生覆盖冲突时 Git 会停止。`;}}
 }else if(operation==='create_branch'){
  branch=await newBranchName(s,branch);await noTrackingConfig(s.root,branch);
  if(args.startPoint!==undefined){const source=typeof args.startPoint==='string'&&/^refs\/(heads|remotes)\//.test(args.startPoint)?s.branches.find(b=>b.ref===args.startPoint):null;if(!source)throw Error('创建分支起点已变化或无效，请选择当前本地或远程分支');startPoint=source.ref;summary=`从 ${source.name}（${source.sha.slice(0,12)}）创建并切换到 ${branch}，不自动设置 upstream。`;}
  else summary=`从当前 HEAD 创建并切换到 ${branch}，不自动设置 upstream。`;
 }else if(['fetch','pull','push'].includes(operation)){
  if(!s.remotes.includes(remote)||!remote||remote.startsWith('-'))throw Error('请选择当前仓库已配置的远程');
  if(operation!=='fetch'){
   if(!s.branch)throw Error('当前处于 detached HEAD，请先切换到本地分支');if(operation==='push'&&!s.head)throw Error('当前分支还没有提交，请先创建本地 commit');branch=await branchName(s.root,branch);
  }
  summary=operation==='fetch'?`Fetch ${remote}：仅更新远程引用，不合并到当前分支。`:operation==='pull'?`Pull ${remote}/${branch} → ${s.branch}，仅允许快进。`:`Push ${s.branch} → ${remote}/${branch}${args.setUpstream?'，设置跟踪分支':''}。不会强制推送。`;
 }else if(operation==='discard'){
  const paths=args.paths??s.files.filter(f=>f.canStage).map(f=>f.path);if(!Array.isArray(paths)||!paths.length||paths.length>300||new Set(paths).size!==paths.length)throw Error('请选择 1–300 个需要丢弃未暂存改动的文件');
  files=paths.map(path=>{const f=s.files.find(f=>f.path===path);if(!f?.canStage)throw Error('文件未暂存状态已变化，请刷新');return f;});
  for(const f of files)await safeDiscardPath(s.root,f.path);
  summary=`丢弃 ${files.length} 个文件的未暂存改动。已暂存内容保留；其中 ${files.filter(f=>f.status==='??').length} 个未跟踪文件将被删除。此操作不能通过 Unstage 恢复。`;
 }else throw Error('不支持的 Git 操作');
 const command={operation,...(branch?{branch}:{}),...(remote?{remote}:{}),...(startPoint?{startPoint}:{}),...(localBranch?{localBranch}:{}),...(detach?{detach:true}:{}),...(operation==='push'?{setUpstream:args.setUpstream===true}:{}),...(operation==='discard'?{paths:files.map(f=>f.path)}:{})};
 return {indexToken:hash([s.head,s.files]),token:hash([s.token,command,tracking]),command,summary,files:files.map(f=>({path:f.path,untracked:f.status==='??'})),branch:s.branch,tracking};
}
function commandError(e){const detail=String(e.stderr??e.message);if(/non-fast-forward|fast-forward|fetch first|divergent/i.test(detail))return Error('远程与本地已分叉或推送被拒绝；仅允许快进，请先核对并手动合并 / 变基。');if(/Authentication failed|Permission denied|could not read Username|Host key verification failed/i.test(detail))return Error('Git 认证失败，请先在本机终端配置 SSH / Git 凭据后重试。');if(/would be overwritten|local changes/i.test(detail))return Error('操作会覆盖未提交改动，Git 已停止。请先提交或处理这些文件。');if(/already checked out|already used by worktree/i.test(detail))return Error('目标分支正在其他 worktree 使用，请打开对应项目。');return Error('Git 操作未确认完成，请刷新核对仓库；检查本机 Git 状态、网络和认证后再试。');}
export async function executeOperation(root,args){return withGitWrite(root,async()=>{
 const plan=await prepareOperation(root,args);if(args.token!==plan.token)throw Error('仓库状态或操作目标已变化，请重新预览确认');const c=plan.command;let createdBranch=null;
 try{
  if(c.operation==='switch'){
   if(c.branch.startsWith('refs/heads/'))await git(root,['switch','--no-guess','--',c.branch.slice(11)]);
   else if(c.detach)await git(root,['switch','--no-guess','--detach',c.branch]);
   // --track is ambiguous for nested remote names such as origin and origin/team.
   // Configure the newly created branch explicitly after its safe checkout succeeds.
   else{const source=plan.tracking;await git(root,['switch','--no-track','-c',c.localBranch,c.branch]);createdBranch=c.localBranch;await noTrackingConfig(root,c.localBranch);await git(root,['config','--local','--add',`branch.${c.localBranch}.remote`,source.remote]);await git(root,['config','--local','--add',`branch.${c.localBranch}.merge`,source.merge]);
    const [remotes,merges]=await Promise.all(['remote','merge'].map(key=>configValues(root,`branch.${c.localBranch}.${key}`))),upstream=(await git(root,['rev-parse','--symbolic-full-name',`${c.localBranch}@{upstream}`])).trim();if(remotes.length!==1||remotes[0]!==source.remote||merges.length!==1||merges[0]!==source.merge||upstream!==c.branch)throw Error('新分支的有效 upstream 与预览目标不一致');}
  }else if(c.operation==='create_branch'){await git(root,['switch','--no-track','-c',c.branch,...(c.startPoint?[c.startPoint]:[])]);createdBranch=c.branch;await noTrackingConfig(root,c.branch);}
  else if(c.operation==='fetch')await git(root,['fetch','--',c.remote],{timeout:120000});
  else if(c.operation==='pull')await git(root,['-c','merge.autostash=false','-c','rebase.autoStash=false','-c','pull.rebase=false','pull','--ff-only','--no-rebase','--',c.remote,c.branch],{timeout:120000});
  else if(c.operation==='push')await git(root,['-c','push.followTags=false','push',...(c.setUpstream?['--set-upstream']:[]),'--',c.remote,`HEAD:refs/heads/${c.branch}`],{timeout:120000});
  else if(c.operation==='discard'){
   const s=await indexState(root);if(hash([s.head,s.files])!==plan.indexToken)throw Error('文件未暂存状态已变化，请重新预览');const files=c.paths.map(path=>s.files.find(f=>f.path===path)),tracked=files.filter(f=>f.status!=='??');if(tracked.length)await git(root,['restore','--worktree','--',...tracked.map(f=>f.path)]);
   for(const f of files.filter(f=>f.status==='??')){await safeDiscardPath(s.root,f.path);await unlink(join(s.root,f.path));}
  }
 }catch(e){if(createdBranch)throw Error(`本地分支 ${createdBranch} 可能已创建并切换，但跟踪配置未确认完成。请刷新核对当前分支和 upstream 后再操作；现有分支不会重置。`);if(e.message==='文件未暂存状态已变化，请重新预览')throw e;throw commandError(e);}
 return {operation:c.operation,summary:plan.summary};
});}

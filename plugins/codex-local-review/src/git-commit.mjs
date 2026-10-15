import {createHash} from 'node:crypto';
import {git,indexState} from './git-index.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function prepareCommit(root,{allowEmpty=false}={}){
 const state=await indexState(root);if(state.files.some(f=>f.unmerged))throw Error('存在未解决的合并冲突，不能提交');
 const branch=(await git(state.root,['symbolic-ref','--quiet','HEAD']).catch(()=>'' )).trim();if(!branch)throw Error('当前处于 detached HEAD，请先切换到分支后提交');
 for(const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply']){
 const path=(await git(state.root,['rev-parse','--git-path',name])).trim();const {existsSync}=await import('node:fs');if(existsSync(path.startsWith('/')?path:state.root+'/'+path))throw Error('仓库正在合并、变基或拣选，请先在 Git 中完成该操作');
 }
 const tree=(await git(state.root,['write-tree'])).trim();const parentTree=state.head?(await git(state.root,['rev-parse','HEAD^{tree}'])).trim():'';
 const empty=tree===parentTree||!state.files.some(f=>f.status!=='??'&&f.status[0]!==' ');if(empty&&!allowEmpty)throw Error('没有已暂存的改动，请先 Stage 文件');
 const gitdir=(await git(state.root,['rev-parse','--absolute-git-dir'])).trim();
 const files=state.files.filter(f=>f.status!=='??'&&f.status[0]!==' ').map(f=>({path:f.path,status:f.status}));
 return {root:state.root,branch:branch.replace('refs/heads/',''),head:state.head,files,token:empty?null:hash([state.root,gitdir,branch,state.head,tree])};
}
const inFlight=new Set();
export async function commitStaged(root,{token,message}){
 if(typeof message!=='string'||!message.trim()||message.length>10000||message.includes('\0'))throw Error('请输入有效提交信息（最多 10000 字）');
 if(inFlight.has(root))throw Error('当前仓库正在提交，请等待结果');inFlight.add(root);
 try{
 const state=await prepareCommit(root);if(token!==state.token)throw Error('分支、HEAD 或暂存区已变化，请重新打开提交窗口核对');
 try{await git(state.root,['commit','--cleanup=verbatim','-m',message.trim()]);}catch(e){throw Error('提交未确认完成，请刷新核对 HEAD 后再重试：'+String(e.stderr??e.message).trim().slice(0,1200));}
 const commit=(await git(state.root,['rev-parse','HEAD'])).trim();return {commit,branch:state.branch};
 }finally{inFlight.delete(root);}
}

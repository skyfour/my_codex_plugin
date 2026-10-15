import {snapshot} from './review.mjs';
import {indexState,changeIndex} from './git-index.mjs';
// Application use case: a review decision authorizes only the exact inspected version.
// Git/index rules remain in the Git domain; review snapshots are never rewritten here.
export async function stageReviewedFile({project,review,path,version,limits}) {
  if(!project.isGit||review.project!==project.path)throw Error('审查记录与当前 Git 项目不匹配');
  if(review.version!==version)throw Error('审查记录已更新，请刷新后重新核对');
  if(!['working','unstaged'].includes(review.mode))throw Error('只有工作区或未暂存改动的审查快照可以 Stage');
  const inspected=review.files.find(f=>f.path===path);
  if(!inspected?.reviewed||inspected.binary)throw Error('请先审阅这个文本文件，再进行 Stage');
  const state=await indexState(project.path),record=state.files.find(f=>f.path===path);
  if(!record)throw Error('文件改动已变化，请返回工作区重新核对');
  const current=await snapshot({project:project.path,mode:review.mode,selection:[path]},limits);
  const actual=current.files[0];
  if(current.base!==review.base||!actual||actual.before!==inspected.before||actual.after!==inspected.after||actual.binary!==inspected.binary)throw Error('文件内容或比较基线已变化，请返回工作区重新审阅后再 Stage');
  return changeIndex(project.path,{operation:'stage',files:[{path,fingerprint:record.fingerprint}]});
}

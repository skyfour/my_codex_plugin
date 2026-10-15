// Task-board application service. Repository and source gateway are injected ports.
// Only this bounded context knows task identity, keyword persistence and TAPD.
export class CommitContextService {
  constructor({store,credentials,readKeyword}) { Object.assign(this,{store,credentials,readKeyword}); }
  list() {
    const tasks=this.store.snapshot().tasks.sort((a,b)=>b.importedAt-a.importedAt).slice(0,2000);
    return {contractVersion:1,tasks:tasks.map(t=>({taskId:t.id,title:t.title,source:{workspaceId:t.account,objectId:t.sourceId},state:t.sourceState,keyword:this.store.scmKeyword(t.id)}))};
  }
  async get(taskId,{refresh=false}={}) {
    const task=this.store.getTask(taskId);
    let keyword=this.store.scmKeyword(taskId);
    if(refresh||!keyword) {
      if(task.provider!=='tapd'||task.resourceType!=='tasks')throw Error('UNSUPPORTED_COMMIT_SOURCE');
      const token=await this.credentials();if(!token)throw Error('TAPD_CREDENTIAL_REQUIRED');
      keyword=await this.readKeyword({token,workspaceId:task.account,objectId:task.sourceId});
      if(typeof keyword!=='string'||!keyword.trim()||keyword.length>2048||/[\x00-\x1f]/.test(keyword))throw Error('INVALID_SCM_KEYWORD');
      this.store.saveScmKeyword(taskId,keyword);
      keyword=this.store.scmKeyword(taskId);
    }
    return {contractVersion:1,taskId,title:task.title,keyword};
  }
}

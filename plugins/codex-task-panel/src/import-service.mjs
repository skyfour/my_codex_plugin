import {randomUUID} from 'node:crypto';
import {readTapd} from './tapd.mjs';
import {normalizeSourceInput,sourceKey,sourceHash} from './source-input.mjs';

export class ImportService {
  constructor({store,credentials,read=readTapd,now=Date.now}){Object.assign(this,{store,credentials,read,now});this.current=null;this.busy=false;}
  async preview(){
    if(this.busy)throw new Error('TAPD_BUSY');this.busy=true;this.current=null;
    try{
      const config=this.store.config();if(!config.workspaceId||!config.ownerName)throw new Error('SOURCE_NOT_CONFIGURED');
      const token=await this.credentials();if(!token)throw new Error('TAPD_CREDENTIAL_REQUIRED');
      const known=this.store.snapshot().tasks.filter(t=>t.account===config.workspaceId);
      const output=await this.read({token,workspaceId:config.workspaceId,ownerName:config.ownerName,expectedIdentity:config.identity,cursor:null,knownIds:known.map(t=>t.sourceId)});
      if(this.store.config().version!==config.version)throw new Error('CONFIG_CHANGED');
      const records=output.records.map(normalizeSourceInput);if(new Set(records.map(sourceKey)).size!==records.length)throw new Error('TAPD_RESPONSE_INVALID');
      const items=records.map(source=>{
        const current=this.store.findSource(source),hash=sourceHash(source);let action='create';
        if(current){action=current.hash===hash?'unchanged':source.sourceUpdatedAt>current.sourceUpdatedAt?'update':'conflict';}
        return {...source,body:undefined,action,selectable:action==='create'||action==='update',expectedHash:current?.hash??null};
      });
      const previewId=randomUUID(),expiresAt=this.now()+300_000;
      this.current={previewId,expiresAt,configVersion:config.version,identity:output.identity,records,items,missingIds:output.missingIds??[]};
      return {previewId,expiresAt,count:items.length,items:items.slice(0,50),identity:output.identity,missingIds:this.current.missingIds};
    }finally{this.busy=false;}
  }
  active(previewId){const p=this.current;if(!p||p.previewId!==previewId||p.expiresAt<=this.now())throw new Error('PREVIEW_STALE');if(this.store.config().version!==p.configVersion)throw new Error('CONFIG_CHANGED');return p;}
  candidates({previewId,search='',status='all',page=1,pageSize=50,selectedIds,onlySelected=false}){
    const p=this.active(previewId);if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new Error('INVALID_PAGE');
    const items=p.items.filter(t=>(!search||`${t.title} ${t.sourceId}`.toLowerCase().includes(search.toLowerCase()))&&(status==='all'||(status==='unfinished'?t.sourceState!=='done':t.sourceState===status))&&(!onlySelected||(selectedIds??[]).includes(t.sourceId)));
    return {items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize};
  }
  get({previewId,sourceId}){const record=this.active(previewId).records.find(t=>t.sourceId===sourceId);if(!record)throw new Error('TASK_NOT_FOUND');return record;}
  selection({previewId,search='',status='all'}){const p=this.active(previewId);const items=p.items.filter(t=>t.selectable&&(!search||`${t.title} ${t.sourceId}`.toLowerCase().includes(search.toLowerCase()))&&(status==='all'||(status==='unfinished'?t.sourceState!=='done':t.sourceState===status)));return {items,ids:items.map(t=>t.sourceId)};}
  commit({previewId,selectedIds,laneId,confirmed}){
    if(confirmed!==true)throw new Error('CONFIRMATION_REQUIRED');
    if(!Array.isArray(selectedIds)||!selectedIds.length||new Set(selectedIds).size!==selectedIds.length||selectedIds.some(id=>typeof id!=='string'))throw new Error('INVALID_SELECTION');
    const prior=this.store.getRun(previewId);
    if(prior){if(JSON.stringify([...selectedIds].sort())!==JSON.stringify([...prior.selectedSourceIds].sort())||(laneId&&laneId!==prior.laneId))throw new Error('CONFIRMATION_REUSED');return prior;}
    const p=this.active(previewId),records=[],expectedHashes={};
    for(const id of selectedIds){const item=p.items.find(t=>t.sourceId===id);if(!item?.selectable)throw new Error('INVALID_SELECTION');const record=p.records.find(t=>t.sourceId===id);records.push(record);expectedHashes[sourceKey(record)]=item.expectedHash;}
    return this.store.applyImport(records,{runId:previewId,laneId,expectedHashes,configVersion:p.configVersion,identity:p.identity});
  }
}

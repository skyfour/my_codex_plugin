import {createHash} from 'node:crypto';

export function normalizeSourceInput(input) {
  if(!input || input.provider!=='tapd' || input.resourceType!=='tasks' ||
    !/^[0-9]{1,32}$/.test(input.account) || !/^[0-9]{1,32}$/.test(input.sourceId) ||
    !Number.isSafeInteger(input.sourceUpdatedAt) || input.sourceUpdatedAt<0) throw new Error('INVALID_SOURCE');
  const result={provider:'tapd',account:input.account,resourceType:'tasks',sourceId:input.sourceId,sourceUpdatedAt:input.sourceUpdatedAt};
  for(const [key,limit] of Object.entries({title:4096,body:2*1024*1024,sender:4096,url:2048,sourceState:128,owner:8192})){
    const value=input[key]??'';
    if(typeof value!=='string'||value.includes('\0')||!value.isWellFormed()||Buffer.byteLength(value)>limit)throw new Error('INVALID_SOURCE');
    result[key]=value;
  }
  if(!result.title.trim()||!['open','progressing','done'].includes(result.sourceState))throw new Error('INVALID_SOURCE');
  if(result.url!==`https://www.tapd.cn/${result.account}/prong/tasks/view/${result.sourceId}`)throw new Error('INVALID_SOURCE_URL');
  return result;
}
export function sourceKey(s){return `${s.provider}:${s.account}:${s.resourceType}:${s.sourceId}`;}
export function sourceHash(s){return createHash('sha256').update(JSON.stringify(s)).digest('hex');}

import {DockerRuntime} from './runtime.mjs';
import {verifyOfficialWeb} from './preflight.mjs';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export async function verifyCachedWeb({home,baseUrl,version,imageId},{verify=verifyOfficialWeb,adapterFiles=['compat.mjs','preflight.mjs','proxy.mjs','../ui/compat.js'].map(path=>new URL(path,import.meta.url))}={}){
  if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw new Error('缺少已验证的 Docker 镜像 ID');
  const hash=createHash('sha256');for(const [index,file] of adapterFiles.entries())hash.update(String(index)).update('\0').update(await readFile(file)).update('\0');
  const adapter=hash.digest('hex'),path=join(home,'frontend-verified.json');
  try{const previous=JSON.parse(await readFile(path,'utf8'));if(previous.imageId===imageId&&previous.version===version&&previous.adapter===adapter)return {cached:true,...previous};}catch{/* A missing/invalid attestation requires a fresh check. */}
  const result=await verify({baseUrl,version});
  const proof={imageId,version,adapter,checkedAt:new Date().toISOString(),fileCount:result.fileCount,dialogCalls:result.dialogCalls};
  const temporary=path+`.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(proof),{mode:0o600,flag:'wx'});await rename(temporary,path);return {cached:false,...proof};
}

export function configuredRuntime(env=process.env){
  let runtime;runtime=new DockerRuntime({verifyWeb:options=>verifyCachedWeb({home:runtime.home,...options}),...(env.DBX_CODEX_DOCKER_HOME?{home:env.DBX_CODEX_DOCKER_HOME}:{}),...(env.DBX_CODEX_DOCKER_PORT?{port:Number(env.DBX_CODEX_DOCKER_PORT)}:{})});return runtime;
}

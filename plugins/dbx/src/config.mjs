import {DockerRuntime} from './runtime.mjs';
import {NativeRuntime} from './native-runtime.mjs';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {verifyOfficialWeb} from './preflight.mjs';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export async function verifyCachedWeb({home,baseUrl,version,imageId},{verify=verifyOfficialWeb,adapterFiles=['compat.mjs','preflight.mjs','proxy.mjs','../ui/compat.js'].map(path=>new URL(path,import.meta.url))}={}){
  if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw new Error('缺少已验证的 DBX 程序或镜像标识');
  const hash=createHash('sha256');for(const [index,file] of adapterFiles.entries())hash.update(String(index)).update('\0').update(await readFile(file)).update('\0');
  const adapter=hash.digest('hex'),path=join(home,'frontend-verified.json');
  try{const previous=JSON.parse(await readFile(path,'utf8'));if(previous.imageId===imageId&&previous.version===version&&previous.adapter===adapter)return {cached:true,...previous};}catch{/* A missing/invalid attestation requires a fresh check. */}
  const result=await verify({baseUrl,version});
  const proof={imageId,version,adapter,checkedAt:new Date().toISOString(),fileCount:result.fileCount,dialogCalls:result.dialogCalls};
  const temporary=path+`.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(proof),{mode:0o600,flag:'wx'});await rename(temporary,path);return {cached:false,...proof};
}

export function configuredRuntime(env=process.env){
  const codeHome=env.CODEX_HOME??join(homedir(),'.codex'),dockerHome=env.DBX_CODEX_DOCKER_HOME??join(codeHome,'dbx-docker');
  const existingDocker=existsSync(join(dockerHome,'data','.dbx','dbx.db'))||existsSync(join(dockerHome,'data','dbx.db'));
  const mode=env.DBX_CODEX_RUNTIME??(env.DBX_CODEX_DOCKER_HOME||env.DBX_CODEX_DOCKER_PORT||(!env.DBX_CODEX_NATIVE_HOME&&existingDocker)?'docker':'native');
  if(!['native','docker'].includes(mode))throw Error('DBX 运行模式仅支持 native 或 docker');
  let runtime;const verifyWeb=options=>verifyCachedWeb({home:runtime.home,...options});
  runtime=mode==='docker'?new DockerRuntime({home:dockerHome,verifyWeb,...(env.DBX_CODEX_DOCKER_PORT?{port:Number(env.DBX_CODEX_DOCKER_PORT)}:{})}):new NativeRuntime({home:env.DBX_CODEX_NATIVE_HOME??join(codeHome,'dbx-native'),verifyWeb,...(env.DBX_CODEX_NATIVE_PORT?{port:Number(env.DBX_CODEX_NATIVE_PORT)}:{}),...(env.DBX_CODEX_NATIVE_BIN?{binary:env.DBX_CODEX_NATIVE_BIN}:{})});
  return runtime;
}

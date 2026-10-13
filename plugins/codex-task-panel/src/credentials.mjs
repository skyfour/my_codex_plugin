import {readFile,lstat,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
export async function loadToken(dataDir,env=process.env){
  if(env.TAPD_ACCESS_TOKEN)return env.TAPD_ACCESS_TOKEN;
  const path=join(dataDir,'credentials.json');
  try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('CREDENTIAL_FILE_PERMISSIONS');
    const data=JSON.parse(await readFile(path,'utf8'));if(typeof data.tapdAccessToken!=='string')throw new Error('CREDENTIAL_FILE_INVALID');return data.tapdAccessToken;
  }catch(error){if(error.code==='ENOENT')return null;throw new Error(error.message==='CREDENTIAL_FILE_PERMISSIONS'?error.message:'CREDENTIAL_FILE_INVALID');}
}
export async function saveToken(dataDir,token,env=process.env){
  if(typeof token!=='string'||!/^[!-~]{1,4096}$/.test(token))throw new Error('INVALID_CREDENTIAL');
  if(env.TAPD_ACCESS_TOKEN)throw new Error('CREDENTIAL_ENV_OVERRIDE');
  const path=join(dataDir,'credentials.json'),temporary=join(dataDir,`.credentials-${randomUUID()}.tmp`);
  try{
    await mkdir(dataDir,{recursive:true,mode:0o700});
    try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('CREDENTIAL_FILE_PERMISSIONS');}catch(e){if(e.code!=='ENOENT')throw e;}
    await writeFile(temporary,JSON.stringify({tapdAccessToken:token}),{flag:'wx',mode:0o600});
    await rename(temporary,path);
  }catch(e){throw new Error(e.message==='CREDENTIAL_FILE_PERMISSIONS'?e.message:'CREDENTIAL_SAVE_FAILED');}
  finally{await rm(temporary,{force:true}).catch(()=>{});}
}

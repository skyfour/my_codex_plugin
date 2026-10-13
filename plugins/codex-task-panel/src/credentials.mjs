import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
export async function loadToken(dataDir,env=process.env){
  if(env.TAPD_ACCESS_TOKEN)return env.TAPD_ACCESS_TOKEN;
  const path=join(dataDir,'credentials.json');
  try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('CREDENTIAL_FILE_PERMISSIONS');
    const data=JSON.parse(await readFile(path,'utf8'));if(typeof data.tapdAccessToken!=='string')throw new Error('CREDENTIAL_FILE_INVALID');return data.tapdAccessToken;
  }catch(error){if(error.code==='ENOENT')return null;throw new Error(error.message==='CREDENTIAL_FILE_PERMISSIONS'?error.message:'CREDENTIAL_FILE_INVALID');}
}

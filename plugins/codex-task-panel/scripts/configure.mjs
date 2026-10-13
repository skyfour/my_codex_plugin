import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {mkdir,writeFile,chmod,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {BoardStore} from '../src/store.mjs';
import {defaultDataDir} from '../servers/server.mjs';
if(!process.stdin.isTTY){console.error('请在本地交互终端运行配置，勿通过聊天传递令牌。');process.exit(1);}
const dir=defaultDataDir();await mkdir(dir,{recursive:true,mode:0o700});const store=new BoardStore(join(dir,'board.sqlite'));
let mute=false;const output=new Writable({write(chunk,encoding,callback){if(!mute)process.stdout.write(chunk,encoding);callback();}});
const rl=createInterface({input:process.stdin,output,terminal:true});
const ask=(label,secret=false)=>new Promise(resolve=>{process.stdout.write(label);mute=secret;rl.question('',answer=>{mute=false;if(secret)process.stdout.write('\n');resolve(answer.trim());});});
try{
  const c=store.config();const workspaceId=await ask(`TAPD 工作空间 ID${c.workspaceId?` [${c.workspaceId}]`:''}：`)||c.workspaceId;
  const ownerName=await ask(`当前账户完整姓名${c.ownerName?` [${c.ownerName}]`:''}：`)||c.ownerName;
  const token=await ask('TAPD Access Token（输入不回显，留空保留现有凭据）：',true);
  if(token&&!/^[!-~]{1,4096}$/.test(token))throw new Error('凭据格式无效。');
  store.configure({workspaceId,ownerName,version:c.version});
  if(token){const path=join(dir,'credentials.json');try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('凭据路径必须为普通文件。');}catch(e){if(e.code!=='ENOENT')throw e;}await writeFile(path,JSON.stringify({tapdAccessToken:token}),{mode:0o600});await chmod(path,0o600);}
  console.log('本地配置已保存。回到插件重新检查凭据，再查询并勾选导入。');
}catch{console.error('配置未完成，请检查工作空间、账户姓名和本地文件权限。');process.exitCode=1;}finally{rl.close();store.close();}

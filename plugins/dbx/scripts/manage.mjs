import {configuredRuntime} from '../src/config.mjs';
const command=process.argv[2];
if(!['status','setup','start','update'].includes(command)||process.argv.length!==3){console.error('用法: node plugins/dbx/scripts/manage.mjs status|setup|start|update');process.exitCode=1;}
else {
  let previousStage,lastPrinted=0;
  const onProgress=progress=>{const now=Date.now();if(progress.stage!==previousStage||now-lastPrinted>1000){console.error(`[DBX] ${progress.message}`);previousStage=progress.stage;lastPrinted=now;}};
  try{
    const runtime=configuredRuntime();
    const result=command==='status'?await runtime.status():await runtime[command==='setup'||command==='start'?'ensure':'update']({allowDownload:command==='setup',onProgress});
    console.log(JSON.stringify(result,null,2));
    if(command!=='status'&&result.phase!=='ready'){console.error(`[DBX] ${result.message??'准备未完成'}`);process.exitCode=1;}
  }catch(error){console.error(error.message);process.exitCode=1;}
}

import {configuredRuntime} from '../src/config.mjs';
const command=process.argv[2];
if(!['status','start','update'].includes(command)){console.error('用法: node plugins/dbx/scripts/manage.mjs status|start|update');process.exitCode=1;}
else {try{const runtime=configuredRuntime(),result=await runtime[command==='start'?'ensure':command]();console.log(JSON.stringify(result,null,2));if(command!=='status'&&result.phase!=='ready')process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}}

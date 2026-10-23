import {createDbxServer} from '../servers/server.mjs';
import {createPreview} from '../src/preview.mjs';
const app=await createDbxServer(),preview=await createPreview(app,{port:process.env.DBX_PREVIEW_PORT?Number(process.env.DBX_PREVIEW_PORT):0});
console.log(preview.url);
let closing=false;const close=()=>{if(closing)return;closing=true;void preview.close().then(()=>app.close()).finally(()=>process.exit(0));};
process.on('SIGINT',close);process.on('SIGTERM',close);

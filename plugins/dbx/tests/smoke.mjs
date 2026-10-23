import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

// This checks the actual installed entrypoint without asking Docker to inspect,
// pull or start anything. A failing fake Docker catches accidental eager work.
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const temporary=await mkdtemp(join(tmpdir(),'dbx-stdio-smoke-'));
const home=join(temporary,'isolated-runtime'),bin=join(temporary,'bin'),dockerLog=join(temporary,'docker-calls');
const secret='dbx-smoke-private-token-must-not-leak';
await mkdir(bin);
await writeFile(join(bin,'docker'),`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(dockerLog)},'docker invoked');process.exit(97);\n`,{mode:0o700});
const client=new Client({name:'dbx-stdio-smoke',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'servers/server.mjs')],cwd:root,env:{...process.env,PATH:`${bin}:${process.env.PATH??''}`,DBX_CODEX_DOCKER_HOME:home,DBX_CODEX_DOCKER_PORT:'54224',DBX_SMOKE_SECRET:secret},stderr:'pipe'});
let stderr='';transport.stderr?.on('data',value=>{stderr+=value;});
try{
  await client.connect(transport,{timeout:5000});
  const {tools}=await client.listTools();
  assert.equal(tools.length,7);
  const open=tools.find(tool=>tool.name==='dbx_codex_open');
  assert.ok(open);
  assert.ok(open.icons?.[0]?.src.startsWith('data:image/png;base64,'));
  assert.equal(open.icons[0].mimeType,'image/png');
  assert.deepEqual(open._meta['openai/ui'].entrypoints,[{type:'global'}]);
  const uri=open._meta.ui.resourceUri;
  assert.equal(uri,'ui://dbx/docker-workbench.html');
  for(const name of ['dbx_codex_start','dbx_codex_update','dbx_codex_clipboard','dbx_codex_transfer']){
    const tool=tools.find(tool=>tool.name===name);
    assert.deepEqual(tool._meta.ui.visibility,['app']);
    assert.equal(tool.annotations.readOnlyHint,false);
    assert.equal(tool._meta['openai/ui'],undefined);
  }
  const resources=await client.listResources();
  assert.deepEqual(resources.resources.map(resource=>resource.uri),[uri]);
  const resource=await client.readResource({uri});
  const page=resource.contents[0];
  assert.equal(page.mimeType,'text/html;profile=mcp-app');
  assert.match(page.text,/<iframe[^>]+title="DBX 官方完整工作台"/);
  assert.match(page.text,/dbx_codex_update/);
  assert.match(page.text,/ui\/initialize/);
  assert.ok(!page.text.includes('/* APP_SCRIPT */'));
  const csp=page._meta.ui.csp;
  assert.equal(csp.frameDomains.length,1);
  assert.match(csp.frameDomains[0],/^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(csp.connectDomains,[]);
  assert.deepEqual(csp.resourceDomains,[]);
  assert.deepEqual(page._meta.ui.permissions,{clipboardWrite:{}});
  const opened=await client.callTool({name:'dbx_codex_open',arguments:{}});
  assert.deepEqual(opened.structuredContent,{name:'DBX',architecture:'official-docker-web'});
  assert.ok(!JSON.stringify({tools,resource,opened}).includes(secret));
  assert.ok(!JSON.stringify(resource).includes(home));
  assert.equal(existsSync(dockerLog),false,'安装检查不得调用 Docker');
  assert.equal(existsSync(home),false,'安装检查不得创建或迁移运行数据');
  console.log('DBX 真实 stdio MCP、侧栏图标、完整内联界面与本机 CSP 通过；未调用 Docker、未创建运行数据。');
}catch(error){if(stderr)console.error(stderr);throw error;}
finally{await client.close();await rm(temporary,{recursive:true,force:true});}

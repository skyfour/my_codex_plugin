import {TOOL_DEFINITIONS} from '../src/tools.mjs';
import { readFile,access,mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(join(root,'.codex-plugin/plugin.json'),'utf8'));
for(const file of ['.mcp.json','skills/api-client/SKILL.md','assets/icon.svg','dist/index.html','node_modules/postman-runtime/package.json'])await access(join(root,file));
assert.equal(manifest.name,'codex-api-client');
for(const key of ['logo','composerIcon']){
  assert.ok(manifest.interface[key]?.startsWith('./assets/'),`${key} must reference a bundled asset`);
  await access(join(root,manifest.interface[key]));
}
const html=await readFile(join(root,'dist/index.html'),'utf8');
assert.ok(!/<script[^>]+src=/.test(html),'UI script must be bundled inline');
assert.ok(!/<link[^>]+href=["']https?:/.test(html),'UI must not require remote styles');
const directory=await mkdtemp(join(tmpdir(),'api-check-'));
const client=new Client({name:'install-check',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:['--experimental-sqlite',join(root,'src/server.mjs')],env:{HOME:process.env.HOME,PATH:process.env.PATH,CODEX_API_CLIENT_DATA_DIR:directory},stderr:'pipe'});
try{
  await client.connect(transport);
  const tools=await client.listTools();assert.deepEqual(tools.tools.map(t=>t.name).sort(),TOOL_DEFINITIONS.map(d=>d[0]).sort());
  for(const [name,,,,,visibility]of TOOL_DEFINITIONS)if(visibility==='app')assert.deepEqual(tools.tools.find(t=>t.name===name)._meta.ui.visibility,['app']);
  const entrypoint=tools.tools.find(t=>t.name==='api_client_open');
  assert.equal(entrypoint._meta['openai/ui'].entrypoints[0].type,'global');
  assert.equal(entrypoint.icons?.[0]?.mimeType,'image/svg+xml','Sidebar entrypoint must publish its icon in tools/list');
  const sidebarSvg=Buffer.from(entrypoint.icons[0].src.split(',')[1],'base64').toString('utf8');
  assert.equal(sidebarSvg,await readFile(join(root,'assets/icon-sidebar.svg'),'utf8'));
  assert.ok(sidebarSvg.includes('viewBox="0 0 20 20"')&&sidebarSvg.includes('currentColor'));
  assert.ok(client.getServerVersion().icons?.length,'initialize must include a server icon fallback');
  assert.ok(tools.tools.find(t=>t.name==='api_run_start').inputSchema.properties.collectionId);
  const resource=await client.readResource({uri:'ui://codex-api-client/index.html'});assert.ok(resource.contents[0].text.includes('<html'));
  const state=await client.callTool({name:'api_client_open',arguments:{}});assert.ok(state.structuredContent.collections);
  console.log(`Plugin check passed: ${tools.tools.length} tools, inline UI, SQLite, Postman Runtime`);
}finally{await client.close();await rm(directory,{recursive:true,force:true});}

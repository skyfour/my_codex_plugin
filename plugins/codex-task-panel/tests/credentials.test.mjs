import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadToken,saveToken} from '../src/credentials.mjs';
import {BoardStore} from '../src/store.mjs';
import {createPanelServer} from '../servers/server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

async function directory(t){const dir=await mkdtemp(join(tmpdir(),'board-credentials-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('credential saves survive restart and replace the existing file with private permissions',async t=>{
 const dir=await directory(t),path=join(dir,'credentials.json');
 await writeFile(path,'invalid old contents',{mode:0o644});
 await saveToken(dir,'synthetic-token-one',{});
 assert.equal(await loadToken(dir,{}),'synthetic-token-one');
 assert.equal((await stat(path)).mode&0o777,0o600);
 await saveToken(dir,'synthetic-token-two',{});
 assert.equal(await loadToken(dir,{}),'synthetic-token-two');
});
test('invalid credential input preserves the old file and never echoes the input in errors',async t=>{
 const dir=await directory(t);await saveToken(dir,'synthetic-valid',{});
 for(const value of ['', 'synthetic\nsecret','x'.repeat(4097)]){
  await assert.rejects(()=>saveToken(dir,value,{}),{message:'INVALID_CREDENTIAL'});
  assert.equal(await loadToken(dir,{}),'synthetic-valid');
 }
});
test('credential saves reject symlinks without changing their target',async t=>{
 const dir=await directory(t),target=join(dir,'other.json');await writeFile(target,'keep');
 await symlink(target,join(dir,'credentials.json'));
 await assert.rejects(()=>saveToken(dir,'synthetic-valid',{}),{message:'CREDENTIAL_FILE_PERMISSIONS'});
 assert.equal(await readFile(target,'utf8'),'keep');
});
test('explicit local saves override environment credentials without changing the environment',async t=>{
 const dir=await directory(t),env={TAPD_ACCESS_TOKEN:'synthetic-env'};
 assert.equal(await loadToken(dir,env),'synthetic-env');
 await saveToken(dir,'synthetic-new',env);
 assert.equal(await loadToken(dir,env),'synthetic-new');
 assert.equal(await loadToken(dir,{}),'synthetic-new');
 assert.equal(env.TAPD_ACCESS_TOKEN,'synthetic-env');
 await saveToken(dir,'synthetic-replaced',env);
 assert.equal(await loadToken(dir,env),'synthetic-replaced');
});
test('credential configuration is app-only and never returns the token in MCP results',async t=>{
 const dir=await directory(t),store=new BoardStore(':memory:');
 const {server}=createPanelServer({store,dataDir:dir,env:{}}),client=new Client({name:'credential-test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  const listed=await client.listTools(),tool=listed.tools.find(t=>t.name==='credential_configure');
  assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool.annotations.readOnlyHint,false);
  const before=await client.callTool({name:'source_status',arguments:{}});assert.equal(before.structuredContent.credentialReady,false);
  const result=await client.callTool({name:'credential_configure',arguments:{token:'synthetic-mcp-secret'}});
  assert.equal(result.isError,undefined);assert.equal(result.structuredContent.credentialReady,true);
  assert.ok(!JSON.stringify(result).includes('synthetic-mcp-secret'));
  const invalid=await client.callTool({name:'credential_configure',arguments:{token:'synthetic\nsecret'}});
  assert.equal(invalid.isError,true);assert.ok(!JSON.stringify(invalid).includes('synthetic'));
  assert.equal(await loadToken(dir,{}),'synthetic-mcp-secret');
 }finally{await client.close();await server.close();store.close();}
});
test('an invalid local credential file does not prevent opening settings to repair it',async t=>{
 const dir=await directory(t);await writeFile(join(dir,'credentials.json'),'invalid',{mode:0o600});
 const store=new BoardStore(':memory:'),{server,actions}=createPanelServer({store,dataDir:dir,env:{}});
 try{
  const opened=await actions.get('board_open')({});assert.equal(opened.isError,undefined);assert.equal(opened.structuredContent.credentialReady,false);assert.ok(opened.structuredContent.credentialError);
  const saved=await actions.get('credential_configure')({token:'synthetic-repaired'});assert.equal(saved.structuredContent.credentialReady,true);
 }finally{await server.close();store.close();}
});

test('legacy credential files retain environment priority until the user saves a replacement',async t=>{
 const dir=await directory(t),env={TAPD_ACCESS_TOKEN:'synthetic-env'};
 await writeFile(join(dir,'credentials.json'),JSON.stringify({tapdAccessToken:'synthetic-legacy'}),{mode:0o600});
 assert.equal(await loadToken(dir,env),'synthetic-env');
 assert.equal(await loadToken(dir,{}),'synthetic-legacy');
 await saveToken(dir,'synthetic-updated',env);
 assert.equal(await loadToken(dir,env),'synthetic-updated');
});
test('the import service uses the newly saved local token in an existing server process',async t=>{
 const dir=await directory(t),env={TAPD_ACCESS_TOKEN:'synthetic-env'},store=new BoardStore(':memory:');
 store.configure({workspaceId:'100',ownerName:'示例',version:1});let usedToken;
 const {server,actions}=createPanelServer({store,dataDir:dir,env,read:async({token})=>{usedToken=token;return {identity:{id:'1',nick:'demo',name:'示例'},records:[],missingIds:[]};}});
 try{
  const saved=await actions.get('credential_configure')({token:'synthetic-live-update'});
  assert.equal(saved.isError,undefined);assert.equal(saved.structuredContent.credentialReady,true);
  const queried=await actions.get('import_preview')({});assert.equal(queried.isError,undefined);
  assert.equal(usedToken,'synthetic-live-update');assert.ok(!JSON.stringify(saved).includes('synthetic-live-update'));
 }finally{await server.close();store.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {realpathSync} from 'node:fs';
import {configuredRuntime,verifyCachedWeb} from '../src/config.mjs';

test('compatibility attestation is reused only for the same immutable image and adapter code',async t=>{
  const home=await mkdtemp(join(tmpdir(),'dbx-preflight-cache-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const adapterFile=join(home,'adapter.js');await writeFile(adapterFile,'adapter v1');let calls=0;
  const dependencies={adapterFiles:[adapterFile],verify:async()=>{calls++;return {fileCount:502,dialogCalls:42};}};
  const options={home,baseUrl:'http://127.0.0.1:54224',version:'0.6.52',imageId:'sha256:'+'a'.repeat(64)};
  assert.equal((await verifyCachedWeb(options,dependencies)).cached,false);assert.equal(calls,1);
  assert.equal((await verifyCachedWeb(options,dependencies)).cached,true);assert.equal(calls,1);
  await writeFile(adapterFile,'adapter v2');assert.equal((await verifyCachedWeb(options,dependencies)).cached,false);assert.equal(calls,2);
  assert.equal((await verifyCachedWeb({...options,imageId:'sha256:'+'b'.repeat(64)},dependencies)).cached,false);assert.equal(calls,3);
  const proof=await readFile(join(home,'frontend-verified.json'),'utf8');
  await assert.rejects(verifyCachedWeb({...options,imageId:'sha256:'+'c'.repeat(64)},{...dependencies,verify:async()=>{throw Error('unsupported official frontend');}}));
  assert.equal(await readFile(join(home,'frontend-verified.json'),'utf8'),proof,'a failed candidate must preserve the prior proof for rollback');
});

test('runtime configuration accepts explicit independent homes and rejects malformed ports',()=>{
  const runtime=configuredRuntime({DBX_CODEX_DOCKER_HOME:'/tmp/dbx-config-example',DBX_CODEX_DOCKER_PORT:'55225'});
  assert.equal(runtime.home,join(realpathSync('/tmp'),'dbx-config-example'));assert.equal(runtime.baseUrl,'http://127.0.0.1:55225');
  assert.throws(()=>configuredRuntime({DBX_CODEX_DOCKER_PORT:'abc'}),/端口/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

function fixture(t,{daemon=true}={}){
  const root=mkdtempSync(join(tmpdir(),'dbx-manage-cli-')),bin=join(root,'bin'),home=join(root,'runtime'),log=join(root,'docker.jsonl');
  t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(bin);
  writeFileSync(join(bin,'docker'),`#!${process.execPath}
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args[0]==='info'){console.log('29.5.2');process.exit(${daemon?0:1});}
if(args[0]==='inspect'){console.error('No such object: fixture');process.exit(1);}
process.exit(90);
`,{mode:0o700});
  return {home,run(args){
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/manage.mjs',import.meta.url)),...args],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:`${bin}:${process.env.PATH}`,DBX_CODEX_DOCKER_HOME:home}});
    assert.ifError(result.error);
    return {...result,calls:existsSync(log)?readFileSync(log,'utf8').trim().split(String.fromCharCode(10)).filter(Boolean).map(line=>JSON.parse(line)):[]};
  }};
}

test('management start refuses an unprepared service without downloading or reporting success',t=>{
  const f=fixture(t),result=f.run(['start']);
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).code,'SETUP_REQUIRED');
  assert.match(result.stderr,/setup:dbx/);assert.deepEqual(result.calls.map(args=>args[0]),['info','inspect']);
});

test('management setup exits unsuccessfully when Docker is unavailable',t=>{
  const result=fixture(t,{daemon:false}).run(['setup']);
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).code,'DOCKER_UNAVAILABLE');
  assert.match(result.stderr,/Docker/);assert.deepEqual(result.calls.map(args=>args[0]),['info']);
});

test('management status does not create runtime data or attempt preparation',t=>{
  const f=fixture(t),result=f.run(['status']);
  assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).phase,'absent');
  assert.equal(existsSync(f.home),false);assert.deepEqual(result.calls.map(args=>args[0]),['info','inspect']);
});

test('management rejects unknown commands and extra arguments before touching Docker',t=>{
  for(const args of [[],['invalid'],['setup','extra']]){
    const result=fixture(t).run(args);assert.equal(result.status,1);assert.match(result.stderr,/用法/);assert.deepEqual(result.calls,[]);
  }
});

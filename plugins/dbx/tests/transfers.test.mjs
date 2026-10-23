import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {Transfers} from '../src/transfers.mjs';
import {execFileSync} from 'node:child_process';

async function fixture(t){
  const home=await mkdtemp(join(tmpdir(),'dbx-transfer-test-')),transfers=new Transfers(home);
  t.after(async()=>{await transfers.close();await rm(home,{recursive:true,force:true});});
  return {home,transfers,directory:join(home,'exports')};
}
const encoded=text=>Buffer.from(text).toString('base64');

// A real process file-size limit forces a short write followed by EFBIG. Never report a truncated export as saved.
test('file-size limit rejects a short write and removes the incomplete export', {skip:process.platform==='win32'},()=>{
  const script=`
    import {mkdtemp,readdir,rm} from 'node:fs/promises';
    import {tmpdir} from 'node:os';
    import {join} from 'node:path';
    import {Transfers} from ${JSON.stringify(new URL('../src/transfers.mjs',import.meta.url).href)};
    process.on('SIGXFSZ',()=>{});
    const home=await mkdtemp(join(tmpdir(),'dbx-write-limit-')),transfers=new Transfers(home);
    try {
      const {id}=await transfers.action('download-open',{name:'export.bin'});
      let rejected=false,closed=false;
      try {await transfers.action('download-write',{id,data:Buffer.alloc(4096,65).toString('base64')});} catch {rejected=true;}
      try {await transfers.action('download-close',{id});closed=true;} catch {}
      console.log(JSON.stringify({rejected,closed,files:await readdir(join(home,'exports'))}));
    } finally {await transfers.close();await rm(home,{recursive:true,force:true});}
  `;
  const result=JSON.parse(execFileSync('/bin/sh',['-c','ulimit -f 2\nexec "$@"','dbx-write-limit',process.execPath,'--input-type=module','-e',script],{encoding:'utf8',timeout:10000}));
  assert.deepEqual(result,{rejected:true,closed:false,files:[]});
});

// Untrusted server filenames must not escape the controlled private exports directory.
for(const name of ['../../outside.csv','/tmp/outside.csv','..\\..\\outside.csv','a\u0000b\nc.csv'])test(`download filename stays inside exports: ${JSON.stringify(name)}`,async t=>{
  const {transfers,directory}=await fixture(t);
  const {id}=await transfers.action('download-open',{name});
  await transfers.action('download-write',{id,data:encoded('字段,数据\n中文,é\n')});
  const saved=await transfers.action('download-close',{id});
  assert.equal(dirname(saved.path),directory);assert(!/[\\\x00-\x1f]/.test(basename(saved.path)));
  assert.equal(await readFile(saved.path,'utf8'),'字段,数据\n中文,é\n');
  assert.equal((await stat(saved.path)).mode&0o777,0o600);
});

// Invalid and oversized chunks must not alter the partial file or poison an otherwise valid export.
test('rejects oversized and invalid base64 chunks without closing a valid export',async t=>{
  const {transfers,directory}=await fixture(t),{id}=await transfers.action('download-open',{name:'data.csv'});
  for(const data of ['a'.repeat(90001),'not base64!'])await assert.rejects(transfers.action('download-write',{id,data}));
  const [file]=await readdir(directory);assert.equal((await stat(join(directory,file))).size,0);
  await transfers.action('download-write',{id,data:encoded('valid data')});
  const saved=await transfers.action('download-close',{id});assert.equal(await readFile(saved.path,'utf8'),'valid data');
});

// Parallel creation must reserve slots before asynchronous filesystem work, so the four-file limit cannot be bypassed.
test('parallel download-open enforces the four-export limit including pending opens',async t=>{
  const {transfers,directory}=await fixture(t);
  const results=await Promise.allSettled(Array.from({length:8},(_,i)=>transfers.action('download-open',{name:`file-${i}.csv`})));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,4);
  assert.equal(results.filter(result=>result.status==='rejected').length,4);
  assert.equal((await readdir(directory)).length,4);
  const first=results.find(result=>result.status==='fulfilled').value;
  await transfers.action('download-cancel',{id:first.id});
  const next=await transfers.action('download-open',{name:'replacement.csv'});assert.equal(typeof next.id,'string');
});

// Reaching the total byte cap must cancel and remove the oversized partial file rather than leave a misleading successful export.
test('rejects more than 256 MiB and removes the oversized partial file', {timeout:15000},async t=>{
  const {transfers,directory}=await fixture(t),{id}=await transfers.action('download-open',{name:'large.bin'});
  const block=Buffer.alloc(65536,0x61).toString('base64');
  for(let i=0;i<4096;i++)await transfers.action('download-write',{id,data:block});
  const [file]=await readdir(directory);assert.equal((await stat(join(directory,file))).size,256*1024*1024);
  await assert.rejects(transfers.action('download-write',{id,data:encoded('x')}),/256/);
  assert.deepEqual(await readdir(directory),[]);
  await assert.rejects(transfers.action('download-close',{id}));
});

// Cancel must release its slot and unlink partial content; replayed actions may not recreate or close another export.
test('cancel deletes partial content and frees its slot',async t=>{
  const {transfers,directory}=await fixture(t),{id}=await transfers.action('download-open',{name:'cancel.csv'});
  await transfers.action('download-write',{id,data:encoded('private partial data')});
  assert.equal((await readdir(directory)).length,1);
  await transfers.action('download-cancel',{id});assert.deepEqual(await readdir(directory),[]);
  await assert.rejects(transfers.action('download-write',{id,data:encoded('replay')}));
  const next=await transfers.action('download-open',{name:'next.csv'});assert.notEqual(next.id,id);
});

// Shutdown owns active partial exports, but completed user files must remain available afterward.
test('close removes active partial exports while preserving completed exports',async t=>{
  const {transfers,directory}=await fixture(t);
  const complete=await transfers.action('download-open',{name:'complete.csv'});
  await transfers.action('download-write',{id:complete.id,data:encoded('completed')});
  const saved=await transfers.action('download-close',{id:complete.id});
  for(let i=0;i<2;i++){const partial=await transfers.action('download-open',{name:`partial-${i}.csv`});await transfers.action('download-write',{id:partial.id,data:encoded('partial')});}
  await transfers.close();assert.deepEqual(await readdir(directory),[basename(saved.path)]);
  assert.equal(await readFile(saved.path,'utf8'),'completed');
});

// Rejected action names and unknown IDs cannot close a legitimate active file or truncate its bytes.
test('unknown actions and IDs leave the legitimate export usable',async t=>{
  const {transfers}=await fixture(t),{id}=await transfers.action('download-open',{name:'known.csv'});
  await transfers.action('download-write',{id,data:encoded('first,')});
  await assert.rejects(transfers.action('unknown-action',{id}));
  await assert.rejects(transfers.action('download-close',{id:'not-a-transfer'}));
  await transfers.action('download-write',{id,data:encoded('last')});
  const saved=await transfers.action('download-close',{id});assert.equal(await readFile(saved.path,'utf8'),'first,last');
});

test('abandoned iframe exports expire without deleting completed exports',async t=>{
  const home=await mkdtemp(join(tmpdir(),'dbx-transfer-expiry-'));let now=0;
  const transfers=new Transfers(home,{now:()=>now,ttlMs:100});
  t.after(async()=>{await transfers.close();await rm(home,{recursive:true,force:true});});
  const complete=await transfers.action('download-open',{name:'complete.csv'});
  await transfers.action('download-write',{id:complete.id,data:encoded('kept')});
  const saved=await transfers.action('download-close',complete);
  const partial=await transfers.action('download-open',{name:'abandoned.csv'});
  now=101;await transfers.expire();
  await assert.rejects(transfers.action('download-close',partial));
  assert.deepEqual(await readdir(join(home,'exports')),[basename(saved.path)]);
});

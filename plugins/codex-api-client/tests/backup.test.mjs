import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptArchive,decryptArchive} from '../src/backup.mjs';
test('encrypted archive roundtrip and authenticated failure',()=>{const source={version:1,documents:[],files:[],secret:'synthetic-secret'},bytes=encryptArchive(source,'password');assert(!bytes.toString().includes(source.secret));assert.deepEqual(decryptArchive(bytes,'password'),source);assert.throws(()=>decryptArchive(bytes,'wrong'));const envelope=JSON.parse(bytes);envelope.tag='AAAAAAAAAAAAAAAAAAAAAA==';assert.throws(()=>decryptArchive(Buffer.from(JSON.stringify(envelope)),'password'));envelope.kdf.N=2**30;assert.throws(()=>decryptArchive(Buffer.from(JSON.stringify(envelope)),'password'));});
import {Store} from '../src/store.mjs';
import {BackupService} from '../src/backup.mjs';
import {BackupTransfer} from '../src/backup-transfer.mjs';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
class Secrets {values=new Map();async set(k,v){this.values.set(k,v);}async get(k){return this.values.get(k);}async delete(k){this.values.delete(k);}}
async function isolated(fn){const dir=await mkdtemp(join(tmpdir(),'backup-')),a=new Store(join(dir,'a'),new Secrets()),b=new Store(join(dir,'b'),new Secrets());try{await fn(a,b,dir);}finally{a.close();b.close();await rm(dir,{recursive:true,force:true});}}
test('two-store roundtrip restores credentials, Cookies, files and singleton decisions without network',()=>isolated(async(a,b)=>{
 await mkdir(join(a.directory,'uploads'));const path=join(a.directory,'uploads','fixture');await writeFile(path,'test attachment');
 await a.put('collection','c',{info:{name:'fixture'},item:[{id:'request-1',name:'request',request:{method:'POST',url:'https://invalid.test',body:{mode:'file',file:{src:path}},auth:{type:'basic',basic:[{key:'password',value:'auth-secret'}]}}}]},0);
 await a.put('environment','env',{name:'env',values:[{key:'TOKEN',type:'secret',value:'synthetic-secret'}]},0);
 await a.put('cookies','default',{cookies:[{key:'session',domain:'invalid.test',path:'/',value:'cookie-secret'}]},0);
 await a.put('settings','default',{requestTimeout:1234,allowedFiles:['/source-machine/private'],selectedEnvironment:'env'},0);
 await b.put('settings','default',{requestTimeout:5678},0);
 const source=new BackupService(a),target=new BackupService(b),bytes=await source.export('password');assert(!bytes.toString().includes('synthetic-secret'));
 const preview=await target.preview(bytes,'password');assert.equal(preview.environmentCount,1);assert(!JSON.stringify(preview).includes('synthetic-secret'));await target.restore(preview.transferId);
 const env=(await b.list('environment'))[0];assert.equal((await b.get('environment',env.id,{reveal:true})).data.values[0].value,'synthetic-secret');assert.equal((await b.get('settings','default')).data.requestTimeout,5678);
 const restored=(await b.list('collection'))[0];assert.notEqual(restored.data.item[0].request.body.file.src,path);assert.equal((await b.get('cookies','default',{reveal:true})).data.cookies[0].value,'cookie-secret');
 const full=await target.preview(bytes,'password','replace');const result=await target.restore(full.transferId);assert(result.snapshot);assert.equal((await b.get('settings','default')).data.requestTimeout,1234);assert(!JSON.stringify((await b.get('settings','default')).data).includes('/source-machine/private'));assert.equal((await b.get('settings','default')).data.selectedEnvironment,(await b.list('environment'))[0].id);
 const recovery=await target.preview(result.snapshot,'password','replace');await target.restore(recovery.transferId);assert.equal((await b.get('settings','default')).data.requestTimeout,5678);
}));
test('unsafe archive and transaction failure leave target unchanged and compensate Keychain',()=>isolated(async(a,b)=>{
 const target=new BackupService(b);await b.put('settings','default',{requestTimeout:5678},0);const before=b.db.prepare('SELECT * FROM documents').all();
 await assert.rejects(target.preview(encryptArchive({version:1,documents:[{kind:'collection',data:{item:[{request:{body:{file:{src:'/etc/passwd'}}}}]}}],files:[]},'p'),'p'));
 const payload={version:1,documents:[{kind:'environment',id:'e',data:{name:'new',values:[{key:'TOKEN',type:'secret',value:'new-secret'}]}}],files:[]};const p=await target.preview(encryptArchive(payload,'p'),'p');b.db.exec("CREATE TRIGGER fail_write BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'injected failure'); END;");await assert.rejects(target.restore(p.transferId));assert.deepEqual(b.db.prepare('SELECT * FROM documents').all(),before);assert.equal(b.secrets.values.size,0);
}));
test('chunk transfer rejects invalid offsets and limits and cleans cancelled sessions',()=>isolated(async(a)=>{const transfer=new BackupTransfer(new BackupService(a)),s=await transfer.start({operation:'import',password:'p'});assert.throws(()=>transfer.chunk({transferId:s.transferId,offset:1,base64:'AAAA'}),/OFFSET/);assert.throws(()=>transfer.chunk({transferId:s.transferId,base64:Buffer.alloc(1024*1024+1).toString('base64')}),/LIMIT/);transfer.cancel(s);await assert.rejects(transfer.finish(s),/EXPIRED/);transfer.close();}));

import {sanitizedPortableData} from '../src/workspace-transfer.mjs';
test('ordinary export removes structured auth, headers, proxy credentials, private keys and references',async()=>{const data={auth:{type:'basic',basic:[{key:'password',value:'secret-auth'}]},request:{header:[{key:'Authorization',value:'Bearer secret-header'}],url:'https://user:pass@example.test/'},proxy:'http://u:proxy-secret@localhost:8080',privateKey:'-----BEGIN PRIVATE KEY-----private',values:[{key:'secret',value:'••••••••',type:'secret',secretRef:'keychain-ref'}]};const clean=JSON.stringify(await sanitizedPortableData(data));for(const secret of ['secret-auth','secret-header','proxy-secret','keychain-ref','BEGIN PRIVATE','user:pass'])assert(!clean.includes(secret));});
test('conflicts expose masked individual rows and choices restore only selected globals Cookies and settings',()=>isolated(async(a,b)=>{
 for(const [store,prefix]of [[a,'backup'],[b,'local']]){
  await store.put('globals','default',{values:[{key:'A',type:'secret',value:prefix+'-A'},{key:'B',value:prefix+'-B'}]},0);
  await store.put('cookies','default',{cookies:[{domain:prefix==='backup'?'.EXAMPLE.test':'example.test',path:'/',key:'first',value:prefix+'-first'},{domain:'example.test',path:'/other',key:'second',value:prefix+'-second'}]},0);
  await store.put('settings','default',{requestTimeout:prefix==='backup'?111:222,followRedirects:prefix==='backup',ui:{theme:prefix==='backup'?'dark':'light'}},0);
 }
 const source=new BackupService(a),target=new BackupService(b),preview=await target.preview(await source.export('password'),'password');
 assert.equal(preview.conflicts.length,7);assert(!JSON.stringify(preview).includes('backup-A'));assert(!JSON.stringify(preview).includes('local-first'));
 const select=(kind,key)=>preview.conflicts.find(r=>r.kind===kind&&r.key===key).id;
 const cookie=preview.conflicts.find(r=>r.kind==='cookies'&&r.key==='first');assert.equal(cookie.domain,'example.test');assert.equal(cookie.path,'/');assert.equal(cookie.local,'masked');assert.equal(cookie.backup,'masked');
 await target.restore(preview.transferId,{[select('globals','A')]:'backup',[cookie.id]:'backup',[select('settings','requestTimeout')]:'backup',[select('settings','ui.theme')]:'backup'});
 const globals=(await b.get('globals','default',{reveal:true})).data.values;assert.equal(globals.find(v=>v.key==='A').value,'backup-A');assert.equal(globals.find(v=>v.key==='B').value,'local-B');
 const cookies=(await b.get('cookies','default',{reveal:true})).data.cookies;assert.equal(cookies.length,2);assert.equal(cookies.find(c=>c.key==='first').value,'backup-first');assert.equal(cookies.find(c=>c.key==='second').value,'local-second');
 const settings=(await b.get('settings','default')).data;assert.equal(settings.requestTimeout,111);assert.equal(settings.followRedirects,false);assert.equal(settings.ui.theme,'dark');
}));
import {ApiService} from '../src/service.mjs';
test('ordinary workspace and document exports sanitize standard API key value only',()=>isolated(async(a)=>{
 const service=new ApiService(a);await service.put({kind:'collection',id:'api-key',revision:0,data:{info:{name:'key test'},auth:{type:'apikey',apikey:[{key:'key',value:'X-Custom-Key'},{key:'value',value:'synthetic-api-secret'},{key:'in',value:'header'}]},item:[]}});
 for(const result of [await service.exportWorkspace(),await service.export({kind:'collection',id:'api-key'})]){const auth=(result.data.collections?.[0]||result.data).auth;assert.equal(auth.apikey.find(v=>v.key==='value').value,'');assert.equal(auth.apikey.find(v=>v.key==='key').value,'X-Custom-Key');assert.equal(auth.apikey.find(v=>v.key==='in').value,'header');assert(!JSON.stringify(result).includes('synthetic-api-secret'));}await service.close();
}));
test('restore remaps only schema references and attachment locations, preserving equal business strings',()=>isolated(async(a,b)=>{
 await mkdir(join(a.directory,'uploads'));const path=join(a.directory,'uploads','fixture');await writeFile(path,'fixture');
 await a.put('environment','dev',{name:'dev',values:[{key:'dev',value:'dev'},{key:'secret',type:'secret',value:'dev'},{key:'attachmentBusiness',value:path}]},0);
 await a.put('collection','collection',{info:{name:'dev'},item:[{id:'dev',name:'dev',request:{url:'https://invalid.test',method:'POST',header:[{key:'dev',value:path}],auth:{type:'basic',basic:[{key:'password',value:'dev'}]},body:{mode:'file',file:{src:path},raw:'dev'}}}]},0);
 await a.put('settings','default',{selectedEnvironment:'dev'},0);const source=new BackupService(a),target=new BackupService(b);await target.restore((await target.preview(await source.export('p'),'p')).transferId);
 const env=(await b.list('environment'))[0],data=(await b.get('environment',env.id,{reveal:true})).data;assert.notEqual(env.id,'dev');assert.equal(data.name,'dev');assert.equal(data.values[0].key,'dev');assert.equal(data.values[0].value,'dev');assert.equal(data.values[1].value,'dev');assert.equal(data.values[2].value,path);assert.equal((await b.get('settings','default')).data.selectedEnvironment,env.id);
 const restoredCollection=(await b.list('collection'))[0];assert.equal(restoredCollection.data.item[0].request.auth.basic[0].value,'••••••••');const item=(await b.get('collection',restoredCollection.id,{reveal:true})).data.item[0];assert.equal(item.id,'dev');assert.equal(item.name,'dev');assert.equal(item.request.body.raw,'dev');assert.equal(item.request.header[0].value,path);assert.equal(item.request.auth.basic[0].value,'dev');assert.notEqual(item.request.body.file.src,path);
}));
test('history merge assigns fresh run IDs and remaps collection/environment references',()=>isolated(async(a,b)=>{
 for(const store of [a,b]){await store.put('collection','same',{info:{name:'collection'},item:[]},0);await store.put('environment','dev',{name:'environment',values:[]},0);}
 const run={id:'same-run',collectionId:'same',environmentId:'dev',status:'completed',responses:[],assertions:[],errors:[],logs:[],name:'backup-run'};a.saveRun(run);b.saveRun({...run,name:'local-run'});
 const source=new BackupService(a),target=new BackupService(b);await target.restore((await target.preview(await source.export('p',true),'p')).transferId);assert.equal(b.getRun('same-run').name,'local-run');const restored=b.listRuns().find(r=>r.name==='backup-run');assert(restored);assert.notEqual(restored.id,'same-run');assert.notEqual(restored.collectionId,'same');assert.notEqual(restored.environmentId,'dev');assert(b.row('collection',restored.collectionId));assert(b.row('environment',restored.environmentId));
}));
test('replacement rejects workspace changes accepted during delayed Keychain preparation',()=>isolated(async(a,b)=>{
 await a.put('environment','incoming',{name:'incoming',values:[{key:'secret',type:'secret',value:'synthetic'}]},0);await b.put('settings','default',{requestTimeout:1000},0);
 const source=new BackupService(a),target=new BackupService(b),preview=await target.preview(await source.export('p'),'p','replace');let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),set=b.secrets.set.bind(b.secrets);b.secrets.set=async(k,v)=>{entered();await gate;await set(k,v);};
 const restoring=target.restore(preview.transferId);await started;await b.put('environment','concurrent',{name:'accepted concurrent change',values:[]},0);release();await assert.rejects(restoring,/CONFLICT/);assert(b.row('environment','concurrent'));assert.equal((await b.get('settings','default')).data.requestTimeout,1000);assert.equal(b.row('environment','incoming'),undefined);assert.equal(b.secrets.values.size,0);
}));
test('replacement rejects history accepted while the recovery snapshot is being captured',()=>isolated(async(a,b)=>{
 await a.put('environment','incoming',{name:'incoming',values:[]},0);await b.put('environment','existing',{name:'existing',values:[{key:'secret',type:'secret',value:'original-secret'}]},0);b.saveRun({id:'local-run',name:'before'});
 const source=new BackupService(a),target=new BackupService(b),preview=await target.preview(await source.export('p'),'p','replace');let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),get=b.secrets.get.bind(b.secrets);b.secrets.get=async k=>{entered();await gate;return get(k);};
 const restoring=target.restore(preview.transferId);await started;b.saveRun({id:'local-run',name:'accepted during snapshot'});release();await assert.rejects(restoring,/CONFLICT/);assert.equal(b.getRun('local-run').name,'accepted during snapshot');assert(b.row('environment','existing'));assert.equal(b.row('environment','incoming'),undefined);assert.equal(b.secrets.values.size,1);
}));

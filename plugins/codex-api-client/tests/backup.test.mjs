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

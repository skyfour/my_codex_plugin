import test from 'node:test';
import assert from 'node:assert/strict';
import {importDocument} from '../src/formats.mjs';
import {normalizeCollection,flattenRequests} from '../src/collections.mjs';
const spec={openapi:'3.0.3',info:{title:'Pets',version:'1'},servers:[{url:'https://example.test/v1'}],paths:{'/pets':{post:{summary:'Add pet',requestBody:{content:{'application/json':{schema:{$ref:'#/components/schemas/Pet'}}}},responses:{200:{description:'ok'}}}}},components:{schemas:{Pet:{type:'object',properties:{name:{type:'string'}}}}}};
test('OpenAPI JSON and Swagger YAML convert via official converter without sending',async()=>{
 for(const text of [JSON.stringify(spec),'swagger: "2.0"\ninfo: {title: Swagger, version: "1"}\nhost: example.test\nbasePath: /v1\npaths:\n  /pets:\n    get:\n      responses:\n        "200": {description: ok}\n']){
  const result=await importDocument(text);assert.equal(result.kind,'collection');assert.equal(flattenRequests(result.data).length,1);assert.equal(result.data['x-codex-api-client'].compatibilityMode,'strict');assert.ok(result.warnings.some(w=>/OpenAPI|Swagger/.test(w)));
 }
});
test('reject every remote or unavailable ref before conversion, allow explicit local files only',async()=>{
 for(const ref of ['https://example.test/schema.json#/Pet','file:///etc/passwd','../secret.yaml#/Pet','missing.yaml#/Pet']){
  const input=structuredClone(spec);input.components.schemas.Pet={$ref:ref};await assert.rejects(async()=>importDocument(JSON.stringify(input)),/REF/);
 }
 const input=structuredClone(spec);input.components.schemas.Pet={$ref:'schemas/pet.yaml#/Pet'};
 const result=await importDocument(JSON.stringify(input),{localFiles:{'schemas/pet.yaml':'Pet: {type: object, properties: {name: {type: string}}}'}});assert.equal(flattenRequests(result.data).length,1);
 await assert.rejects(async()=>importDocument(JSON.stringify(input),{localFiles:{'schemas/pet.yaml':'Pet: {$ref: "https://example.test/no"}'}}),/REF/);
});
test('HAR preserves duplicate headers, query URL and request body, warns omitted responses',async()=>{
 const imported=await importDocument(JSON.stringify({log:{version:'1.2',entries:[{request:{method:'POST',url:'https://example.test/?q=one&q=two',headers:[{name:'X-Test',value:'1'},{name:'X-Test',value:'2'}],postData:{mimeType:'application/json',text:'{"hello":1}'}},response:{content:{text:'private response'}}}]}}));
 const r=imported.data.item[0].request;assert.equal(r.body.raw,'{"hello":1}');assert.equal(r.header.filter(h=>h.key==='X-Test').length,2);assert.match(r.url,/q=one&q=two/);assert.ok(imported.warnings.some(w=>/响应/.test(w)));
});
test('cURL rejects options that would silently change transport behavior',()=>{
 for(const flag of ['--retry 3','--insecure','--location','--compressed','--proxy http://localhost:8080'])assert.throws(()=>importDocument('curl https://example.test '+flag),/UNSUPPORTED/);
});
test('strict import ignores folder extension unless explicitly requested; legacy normalization keeps it',async()=>{
 const input={info:{name:'folders'},'x-other':{keep:1},item:[{id:'f',name:'F',variable:[{key:'x',value:'folder'}],item:[{id:'r',name:'R',request:{method:'POST',url:'https://example.test',body:{mode:'graphql',graphql:{query:'query Hi { hello }',variables:'{"x":1}',operationName:'Hi'},'x-meta':true},'x-request':1},'x-item':2}]}]};
 const strict=await importDocument(JSON.stringify(input));assert.equal(strict.data['x-codex-api-client'].compatibilityMode,'strict');assert.ok(strict.warnings.some(w=>/文件夹变量/.test(w)));
 const legacy=normalizeCollection(input);assert.equal(legacy['x-codex-api-client'].compatibilityMode,'extended');assert.deepEqual(strict.data.item,input.item);assert.deepEqual(strict.data['x-other'],{keep:1});
});

test('explicit nested local refs resolve relative to their own files, cycles and unused remote refs fail',async()=>{
 const input=structuredClone(spec);input.components.schemas.Pet={$ref:'schemas/pet.yaml#/Pet'};
 const result=await importDocument(JSON.stringify(input),{localFiles:{'schemas/pet.yaml':'Pet: {$ref: "../common.yaml#/Pet"}','common.yaml':'Pet: {type: object}'}});assert.equal(flattenRequests(result.data).length,1);
 await assert.rejects(async()=>importDocument(JSON.stringify(input),{localFiles:{'schemas/pet.yaml':'Pet: {$ref: "pet.yaml#/Pet"}'}}),/REF/);
 await assert.rejects(async()=>importDocument(JSON.stringify(spec),{localFiles:{'unused.yaml':'Pet: {$ref: "https://example.test/unused"}'}}),/REF/);
});

test('common cURL GET data URL encoding and attached headers preserve request semantics',()=>{
 const r=importDocument("curl -G 'https://example.test/search?fixed=yes' --data-urlencode 'q=hello world' --data-urlencode 'tag=a+b' -H'X-Test: yes' -A 'fixture-agent' -e 'https://example.test/'").data.item[0].request;
 assert.equal(r.method,'GET');assert.equal(r.url,'https://example.test/search?fixed=yes&q=hello%20world&tag=a%2Bb');assert.equal(r.body,undefined);assert.equal(r.header.find(h=>h.key==='X-Test').value,'yes');assert.equal(r.header.find(h=>h.key==='User-Agent').value,'fixture-agent');assert.equal(r.header.find(h=>h.key==='Referer').value,'https://example.test/');
 assert.throws(()=>importDocument('curl https://example.test --data-urlencode q@/etc/passwd'),/UNSUPPORTED/);
});

test('existing collection, environment and workspace formats outrank unknown spec/HAR fields without losing them',async()=>{
 const collection={info:{name:'Existing'},item:[{id:'original-id',name:'Original request',request:{method:'GET',url:'https://example.test/original'}}]};
 const sources=[['collection',collection],['environment',{name:'Existing environment',values:[{key:'x',value:'original'}]}],['workspace',{format:'codex-api-client-workspace',version:1,collections:[collection],environments:[],globals:null}]];
 const collisions=[{log:{custom:true}},{log:{version:'1.2',entries:[{request:{method:'GET',url:'https://example.test/wrong-collection',headers:[]}}]}},{openapi:{custom:true}},{openapi:'3.0.3'},{swagger:{custom:true}},{swagger:'2.0'}];
 for(const [kind,source] of sources)for(const extra of collisions){
  const input={...structuredClone(source),...extra},result=await importDocument(JSON.stringify(input));
  assert.equal(result.kind,kind,`${kind} must outrank ${Object.keys(extra)[0]}`);
  for(const [key,value]of Object.entries(extra))assert.deepEqual(result.data[key],value);
  if(kind==='collection')assert.equal(result.data.item[0].id,'original-id');
  if(kind==='environment')assert.deepEqual(result.data.values,input.values);
  if(kind==='workspace')assert.equal(result.data.collections[0].item[0].id,'original-id');
 }
});
test('format sniffing requires supported version syntax or actual HAR log shape',async()=>{
 for(const data of [{...spec,openapi:{custom:true}},{...spec,openapi:'not-a-version'},{...spec,openapi:'2.0.0'},{info:{title:'Invalid'},swagger:true},{info:{title:'Invalid'},swagger:'3.0'},{log:{custom:true}},{log:{entries:'not-an-array'}},{log:{version:'invalid',entries:[{request:{url:'https://example.test',method:'GET'}}]}}]){
  await assert.rejects(async()=>importDocument(JSON.stringify(data)),/IMPORT: 无法识别/);
 }
});

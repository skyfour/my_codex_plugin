import test from 'node:test';
import assert from 'node:assert/strict';
const tree = await import('../src/collections.mjs').catch(() => ({}));
const formats = await import('../src/formats.mjs').catch(() => ({}));

test('move preserves identities, duplicate gets fresh IDs and cycle move is rejected', () => {
  assert.equal(typeof tree.moveItem, 'function');
  const c = { item: [{ id: 'f', name: 'F', item: [{ id: 'r', name: 'R', request: { url: 'http://localhost' } }, { id: 'g', name: 'G', item: [] }] }, { id: 'h', name: 'H', item: [] }] };
  const moved = tree.moveItem(c, 'r', 'h', 0);
  assert.equal(moved.item[1].item[0].id, 'r');
  assert.equal(c.item[0].item.length, 2);
  assert.throws(() => tree.moveItem(c, 'f', 'g', 0), /CYCLE/);
  const copied = tree.duplicateItem(c, 'f');
  assert.notEqual(copied.item[1].id, 'f');
  assert.notEqual(copied.item[1].item[0].id, 'r');
});

test('Postman import preserves inherited scripts, normalizes IDs and warns about unsupported features', () => {
  assert.equal(typeof formats.importDocument, 'function');
  const input = { info: { name: 'Original', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, event: [{ listen: 'prerequest', script: { exec: ['pm.vault.get("a");'] } }], item: [{ name: 'Fetch', request: { url: 'https://example.test', method: 'GET', auth: { type: 'oauth2' } } }] };
  const result = formats.importDocument(JSON.stringify(input));
  assert.equal(result.kind, 'collection');
  assert.equal(result.data.item[0].request.method, 'GET');
  assert.ok(result.data.item[0].id);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.data.event[0].script.exec[0], 'pm.vault.get("a");');
});

test('cURL import handles quoting, repeated headers, basic auth and file forms without executing shell', () => {
  assert.equal(typeof formats.importDocument, 'function');
  const result = formats.importDocument("curl 'http://localhost/upload?q=a%20b' -H 'X-Tag: one' -H 'X-Tag: two' -u 'user:pass' -F 'name=Alice' -F 'file=@/tmp/test.txt'");
  const r = result.data.item[0].request;
  assert.equal(r.method, 'POST'); assert.equal(r.header.length, 2);
  assert.equal(r.auth.type, 'basic');
  assert.equal(r.body.formdata[1].src, '/tmp/test.txt');
  assert.throws(() => formats.importDocument('curl http://localhost; touch /tmp/unsafe'), /SHELL/);
  assert.throws(() => formats.importDocument('curl http://localhost --unknown-flag'), /UNSUPPORTED/);
});

test('iteration data accepts CSV quoted newlines and rejects non-object JSON rows', () => {
  assert.equal(typeof formats.parseData, 'function');
  assert.deepEqual(formats.parseData('name,note\nAlice,"hello,\nworld"', 'csv'), [{ name: 'Alice', note: 'hello,\nworld' }]);
  assert.deepEqual(formats.parseData('[{"id":1}]', 'json'), [{ id: 1 }]);
  assert.throws(() => formats.parseData('[1]', 'json'), /DATA/);
});

test('cURL export preserves Basic, inherited bearer, API key and implicit JSON content type',()=>{
  const imported=formats.importDocument('curl https://example.test -u alice:pass -d x=1');
  assert.equal(formats.importDocument(formats.exportCurl(imported.data.item[0])).data.item[0].request.auth.basic[1].value,'pass');
  const item={request:{method:'POST',url:'https://example.test',body:{mode:'raw',raw:'{}',options:{raw:{language:'json'}}}}};
  const text=formats.exportCurl(item,{type:'bearer',bearer:[{key:'token',value:'{{token}}'}]});
  assert.match(text,/Authorization: Bearer/);assert.match(text,/application\/json/);
  assert.equal(formats.importDocument(formats.exportCurl(item,{type:'apikey',apikey:[{key:'key',value:'key'},{key:'value',value:'abc'},{key:'in',value:'query'}]})).data.item[0].request.url,'https://example.test?key=abc');
});

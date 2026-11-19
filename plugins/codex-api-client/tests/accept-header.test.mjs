import test from 'node:test';
import assert from 'node:assert/strict';
import {importDocument} from '../src/formats.mjs';

const curl = 'curl https://example.test';
const importHeaders = command => importDocument(command).data.item[0].request.header;

test('cURL Accept preserves ranges, quoted parameters and repeated header lines', () => {
  const browserAccept = 'application/json, text/plain, */*';
  const parameterized = String.raw`text/html; profile="a,b; \"quoted\""; Q=0.250, image/*;q=1.000`;
  const command = `${curl} -H 'Accept: ${browserAccept}' --header='aCcEpT: ${parameterized}'`;
  const result = importDocument(command);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.data.item[0].request.header, [
    {key:'Accept',value:browserAccept},
    {key:'aCcEpT',value:parameterized}
  ]);
});

test('cURL Accept handles HTTP empty list elements and optional parameters', () => {
  const value = ', text/plain; ;q=1.;charset=utf-8, , application/json;q=0.,';
  assert.deepEqual(importHeaders(`${curl} -H 'Accept:' -H 'accept: ${value}'`), [
    {key:'Accept',value:''},
    {key:'accept',value}
  ]);
  assert.deepEqual(importHeaders(`${curl} \\\r\n -H 'Accept: */*'`), [{key:'Accept',value:'*/*'}]);
});

test('cURL Accept leaves unresolved Postman variables enabled', () => {
  const value = 'text/{{subtype}};q={{quality}}, {{fallback}}';
  assert.deepEqual(importHeaders(`${curl} -H 'Accept: ${value}'`), [{key:'Accept',value}]);
});

test('cURL Accept preserves malformed media ranges and qualities in disabled rows', () => {
  for (const value of [
    'application/json, text/plain, /', '/  ', '*/json', 'text /plain', 'text/plain@',
    'text/html;q=1.01', 'text/html;q=0.0000', 'text/html;q=.5', 'text/html;q=', 'text/html;q="0.5"',
    'text/html;q=0.2;Q=0.3', 'text/html;profile="unterminated',
    'text/plain; charset =utf-8'
  ]) {
    const result = importDocument(`${curl} -H 'accept: */*' -H 'aCcEpT: ${value}'`);
    assert.deepEqual(result.data.item[0].request.header, [
      {key:'accept',value:'*/*'},
      {key:'aCcEpT',value,disabled:true}
    ]);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /Accept.*禁用/);
    assert.ok(!result.warnings[0].includes(value));
  }
});

test('cURL reports multiple malformed Accept rows in a single warning', () => {
  const result = importDocument(`${curl} -H 'Accept: /' -H 'accept: image/*' -H 'ACCEPT: */json'`);
  assert.deepEqual(result.data.item[0].request.header.map(row => Boolean(row.disabled)), [true, false, true]);
  assert.equal(result.warnings.length, 1);
});

test('cURL Accept preserves CR/LF in disabled rows without echoing it in warnings', () => {
  for (const value of ['text/plain\r', 'text/plain\n', 'text/plain\r\n,text/html', 'text/plain\\\n', '{{types}}\r\n']) {
    const result = importDocument(`${curl} -H 'Accept: ${value}'`);
    assert.deepEqual(result.data.item[0].request.header, [{key:'Accept',value,disabled:true}]);
    assert.match(result.warnings[0], /Accept.*禁用/);
    assert.ok(!/[\r\n]/.test(result.warnings[0]));
  }
});

test('Accept validation applies only to cURL imports', () => {
  const header = [{key:'Accept',value:'/'}];
  const postman = {info:{name:'Existing collection'},item:[{name:'example',request:{url:'https://example.test',header}}]};
  assert.deepEqual(importHeaders(JSON.stringify(postman)), header);
  assert.deepEqual(importHeaders(`${curl} -H 'X-Example: /'`), [{key:'X-Example',value:'/'}]);
});

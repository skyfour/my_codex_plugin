import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { Store } = await import('../src/store.mjs').catch(() => ({}));
const memorySecrets = () => {
  const values = new Map();
  return { async set(k, v) { values.set(k, v); }, async get(k) { return values.get(k); }, async delete(k) { values.delete(k); } };
};

test('documents survive reopen and stale saves cannot overwrite newer changes', async () => {
  assert.equal(typeof Store, 'function', 'persistent Store must exist');
  const dir = await mkdtemp(join(tmpdir(), 'api-store-'));
  const secrets = memorySecrets();
  let store = new Store(dir, secrets);
  try {
    const created = await store.put('environment', 'dev', { name: '开发', values: [{ key: 'host', value: 'localhost' }] }, 0);
    assert.equal(created.revision, 1);
    const other = new Store(dir, secrets);
    await other.put('environment', 'dev', { name: '另一个会话', values: [] }, 1);
    await assert.rejects(store.put('environment', 'dev', { name: '过期修改', values: [] }, 1), /CONFLICT/);
    other.close(); store.close(); store = new Store(dir, secrets);
    assert.equal((await store.get('environment', 'dev')).data.name, '另一个会话');
    await assert.rejects(store.remove('environment', 'dev', 1), /CONFLICT/);
    await store.remove('environment', 'dev', 2);
    assert.equal(await store.get('environment', 'dev'), null);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('secret values never enter SQLite and masked saves preserve keychain values', async () => {
  assert.equal(typeof Store, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'api-secret-'));
  const store = new Store(dir, memorySecrets());
  try {
    await store.put('environment', 'dev', { name: 'Dev', values: [{ key: 'token', value: 'private-token-987', type: 'secret' }] }, 0);
    const view = await store.get('environment', 'dev');
    assert.equal(view.data.values[0].value, '••••••••');
    assert.ok(view.data.values[0].secretRef);
    await store.put('environment', 'dev', { ...view.data, name: 'Renamed' }, 1);
    assert.equal((await store.get('environment', 'dev', { reveal: true })).data.values[0].value, 'private-token-987');
    const bytes = await readFile(join(dir, 'workspace.sqlite-wal'));
    assert.equal(bytes.includes(Buffer.from('private-token-987')), false);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('export removes secret values and secret references recursively', async () => {
  assert.equal(typeof Store, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'api-export-'));
  const store = new Store(dir, memorySecrets());
  try {
    await store.put('collection', 'c', { info: { name: 'C' }, variable: [{ key: 'token', type: 'secret', value: 'do-not-export' }], item: [] }, 0);
    const value = await store.export('collection', 'c');
    assert.equal(value.variable[0].value, '');
    assert.equal(JSON.stringify(value).includes('secretRef'), false);
    assert.equal(JSON.stringify(value).includes('do-not-export'), false);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

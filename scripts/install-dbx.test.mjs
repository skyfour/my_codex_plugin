import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = path => JSON.parse(readFileSync(path, 'utf8'));
function validateFixture(t, change = () => {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'codex-dbx-config-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const relative of ['.agents/plugins/marketplace.json', 'scripts/validate.mjs', 'plugins/dbx/.codex-plugin/plugin.json', 'plugins/dbx/.mcp.json', 'plugins/dbx/package.json', 'plugins/dbx/package-lock.json']) {
    const path = join(fixture, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, readFileSync(join(root, relative)));
  }
  const marketPath = join(fixture, '.agents/plugins/marketplace.json');
  const market = json(marketPath);
  market.plugins = market.plugins.filter(plugin => plugin.name === 'dbx');
  writeFileSync(marketPath, JSON.stringify(market));
  for (const relative of ['plugins/dbx/assets/icon.png', 'plugins/dbx/LICENSE', 'plugins/dbx/servers/server.mjs']) {
    mkdirSync(dirname(join(fixture, relative)), { recursive: true });
    writeFileSync(join(fixture, relative), 'fixture');
  }
  change(fixture);
  return spawnSync(process.execPath, [join(fixture, 'scripts/validate.mjs')], { encoding: 'utf8' });
}
function patchJson(fixture, relative, change) {
  const path = join(fixture, relative);
  const value = json(path);
  change(value);
  writeFileSync(path, JSON.stringify(value));
}

test('DBX 使用锁定 SDK 的轻量 Node 插件，不再携带固定 DBX 官方版本清单', t => {
  const result = validateFixture(t);
  assert.equal(result.status, 0, result.stderr);
  const pkg = json(join(root, 'plugins/dbx/package.json'));
  assert.deepEqual(pkg.dependencies, { '@modelcontextprotocol/sdk': '1.30.0', acorn: '8.15.0' });
  assert.equal(pkg.scripts.check, 'node tests/smoke.mjs');
  assert.equal(existsSync(join(root, 'plugins/dbx/release.json')), false);
});

for (const [name, change] of [
  ['拒绝旧原生可执行入口', value => { value.mcpServers.dbx.command = './bin/dbx-codex'; }],
  ['拒绝任意 Node 参数入口', value => { value.mcpServers.dbx.args = ['--eval', 'process.exit()']; }],
  ['拒绝缺失持久化目录变量', value => { value.mcpServers.dbx.env_vars = ['DBX_CODEX_DOCKER_PORT']; }],
  ['拒绝继承旧原生数据目录变量', value => { value.mcpServers.dbx.env_vars.push('DBX_CODEX_DATA_DIR'); }],
]) {
  test(`DBX 配置校验${name}`, t => {
    const result = validateFixture(t, fixture => patchJson(fixture, 'plugins/dbx/.mcp.json', change));
    assert.notEqual(result.status, 0, result.stdout);
  });
}

test('DBX SDK 不允许浮动版本或 npm 依赖生命周期自动运行 Docker', t => {
  const result = validateFixture(t, fixture => patchJson(fixture, 'plugins/dbx/package.json', value => {
    value.dependencies['@modelcontextprotocol/sdk'] = '^1.30.0';
  }));
  assert.notEqual(result.status, 0, result.stdout);
  const scripts = json(join(root, 'plugins/dbx/package.json')).scripts;
  assert.equal(scripts.preinstall, undefined);
  assert.equal(scripts.postinstall, undefined);
});

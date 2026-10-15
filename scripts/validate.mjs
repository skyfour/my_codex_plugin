import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const marketplace = json(resolve(root, '.agents/plugins/marketplace.json'));
assert.equal(marketplace.name, 'my-codex-plugins');
assert.ok(marketplace.plugins.length > 0);
const names = new Set();
for (const plugin of marketplace.plugins) {
  assert.ok(!names.has(plugin.name), '插件名重复');
  names.add(plugin.name);
  assert.equal(plugin.source.source, 'local');
  assert.ok(plugin.source.path.startsWith('./plugins/'));
  const path = resolve(root, plugin.source.path);
  assert.ok(path.startsWith(root + sep + 'plugins' + sep), '插件路径越界');
  assert.equal(plugin.policy.installation, 'AVAILABLE');
  assert.equal(plugin.policy.authentication, 'ON_INSTALL');
  assert.ok(plugin.category);
  const manifest = json(resolve(path, '.codex-plugin/plugin.json'));
  assert.equal(manifest.name, plugin.name);
  if (plugin.name === 'dbx') {
    const release = json(resolve(path, 'release.json'));
    const mcp = json(resolve(path, manifest.mcpServers));
    assert.equal(release.version, manifest.version);
    assert.equal(release.repository, 'skyfour/my_codex_plugin');
    assert.equal(release.tag, `dbx-v${release.version}`);
    assert.ok(Object.keys(release.artifacts).length > 0);
    for (const artifact of Object.values(release.artifacts)) {
      assert.match(artifact.file, /^dbx-codex-[\w.-]+\.tar\.gz$/);
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    }
    assert.equal(mcp.mcpServers.dbx.command, './bin/dbx-codex');
    assert.equal(mcp.mcpServers.dbx.cwd, '.');
    assert.ok(existsSync(resolve(path, manifest.interface.logo)));
    assert.ok(existsSync(resolve(path, 'LICENSE')));
    console.log(`dbx ${manifest.version}: manifest、MCP 入口、发布包校验信息通过`);
    continue;
  }
  const pkg = json(resolve(path, 'package.json'));
  const lock = json(resolve(path, 'package-lock.json'));
  assert.equal(pkg.name, plugin.name);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.ok(existsSync(resolve(path, manifest.skills)));
  const mcp = json(resolve(path, manifest.mcpServers));
  for (const server of Object.values(mcp.mcpServers)) {
    assert.equal(server.command, 'node');
    assert.equal(server.cwd, '.');
    assert.ok(server.args.includes('--experimental-sqlite'));
    assert.ok(existsSync(resolve(path, server.args.at(-1))));
  }
  console.log(`${plugin.name} ${manifest.version}: manifest、MCP 入口、锁文件通过`);
}

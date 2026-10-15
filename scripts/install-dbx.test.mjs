import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { installDbxArchive, sha256 } from './install-dbx.mjs';

test('DBX 包校验成功后填充运行文件，校验失败不改动已安装文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-dbx-test-'));
  try {
    const source = join(root, 'source/plugins/dbx');
    mkdirSync(join(source, '.codex-plugin'), { recursive: true });
    mkdirSync(join(source, 'bin'), { recursive: true });
    mkdirSync(join(source, 'assets'), { recursive: true });
    writeFileSync(join(source, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'dbx', version: '0.6.39' }));
    writeFileSync(join(source, 'bin/dbx-codex'), 'gateway');
    writeFileSync(join(source, 'bin/dbx-web'), 'backend');
    writeFileSync(join(source, 'assets/workbench.html'), '<main>DBX</main>');
    const archive = join(root, 'dbx.tar.gz');
    const tar = spawnSync('tar', ['-czf', archive, '-C', join(root, 'source'), 'plugins']);
    assert.equal(tar.status, 0, tar.stderr?.toString());
    const pluginDir = join(root, 'installed');
    mkdirSync(pluginDir);
    installDbxArchive(pluginDir, archive, sha256(archive), '0.6.39');
    assert.equal(readFileSync(join(pluginDir, 'bin/dbx-web'), 'utf8'), 'backend');
    assert.equal(JSON.parse(readFileSync(join(pluginDir, '.installed-release.json'), 'utf8')).version, '0.6.39');
    assert.throws(() => installDbxArchive(pluginDir, archive, '0'.repeat(64), '0.6.39'), /SHA-256/);
    assert.throws(() => installDbxArchive(pluginDir, archive, sha256(archive), '0.6.40'), /版本/);
    assert.equal(readFileSync(join(pluginDir, 'bin/dbx-web'), 'utf8'), 'backend');
    assert.ok(existsSync(join(pluginDir, 'assets/workbench.html')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

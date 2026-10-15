import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const files = ['bin/dbx-codex', 'bin/dbx-web', 'assets/workbench.html'];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 失败（${result.status}）`);
}

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function installDbxArchive(pluginDir, archive, expectedSha256, version) {
  if (sha256(archive) !== expectedSha256) throw new Error('DBX 发布包 SHA-256 不匹配，安装已中止。');
  const staging = mkdtempSync(join(tmpdir(), 'codex-dbx-extract-'));
  try {
    run('tar', ['-xzf', archive, '-C', staging]);
    const extracted = join(staging, 'plugins/dbx');
    const manifest = JSON.parse(readFileSync(join(extracted, '.codex-plugin/plugin.json'), 'utf8'));
    if (manifest.name !== 'dbx' || manifest.version !== version) throw new Error('DBX 发布包版本与仓库声明不一致。');
    for (const relative of files) {
      const source = join(extracted, relative);
      if (!existsSync(source) || !statSync(source).isFile() || statSync(source).size === 0) {
        throw new Error(`DBX 发布包缺少 ${relative}。`);
      }
    }
    for (const relative of files) {
      const destination = join(pluginDir, relative);
      mkdirSync(dirname(destination), { recursive: true });
      const temporary = `${destination}.new`;
      copyFileSync(join(extracted, relative), temporary);
      if (relative.startsWith('bin/')) run('chmod', ['755', temporary]);
      renameSync(temporary, destination);
    }
    writeFileSync(join(pluginDir, '.installed-release.json'), JSON.stringify({ version, sha256: expectedSha256 }) + '\n');
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function prepareDbx(root = repositoryRoot) {
  const pluginDir = resolve(root, 'plugins/dbx');
  const release = JSON.parse(readFileSync(join(pluginDir, 'release.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(pluginDir, '.codex-plugin/plugin.json'), 'utf8'));
  if (manifest.version !== release.version) throw new Error('DBX 插件与发布包版本不一致。');
  const platform = `${process.platform}-${process.arch}`;
  const artifact = release.artifacts[platform];
  if (!artifact) throw new Error(`DBX 尚未提供 ${platform} 发布包。`);
  const stampPath = join(pluginDir, '.installed-release.json');
  if (existsSync(stampPath)) {
    const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
    if (stamp.version === release.version && stamp.sha256 === artifact.sha256 && files.every(file => existsSync(join(pluginDir, file)))) {
      console.log(`DBX ${release.version} 已准备好。`);
      return;
    }
  }
  const downloadDir = mkdtempSync(join(tmpdir(), 'codex-dbx-download-'));
  try {
    const archive = join(downloadDir, artifact.file);
    const url = `https://github.com/${release.repository}/releases/download/${release.tag}/${artifact.file}`;
    console.log(`下载 DBX ${release.version} (${platform})`);
    run('curl', ['--fail', '--location', '--retry', '3', '--output', archive, url]);
    installDbxArchive(pluginDir, archive, artifact.sha256, release.version);
  } finally {
    rmSync(downloadDir, { recursive: true, force: true });
  }
}

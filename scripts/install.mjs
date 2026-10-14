import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const prepare = process.argv.slice(2).join(' ') === '--prepare';
if (process.argv.length > 2 && !prepare) throw new Error('用法：node scripts/install.mjs [--prepare]');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw new Error('需要 Node.js >=22.13，建议 Node 24 LTS。');
if (!prepare && process.platform !== 'darwin') throw new Error('当前完整安装支持 macOS；API 调试台依赖 macOS Keychain。');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败（${result.status}）`);
}
run(process.execPath, ['scripts/validate.mjs']);
if (!prepare) run('codex', ['plugin', '--help']);
const marketplace = JSON.parse(readFileSync(resolve(root, '.agents/plugins/marketplace.json'), 'utf8'));
for (const plugin of marketplace.plugins) {
  const cwd = resolve(root, plugin.source.path);
  console.log(`准备 ${plugin.name}`);
  run('npm', ['ci', '--no-audit', '--no-fund'], cwd);
  const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
  // 任务面板直接运行源码；它的 build 是旧的独立分发打包器。
  if (plugin.name === 'codex-api-client') run('npm', ['run', 'build'], cwd);
  if (pkg.scripts.check) run('npm', ['run', 'check'], cwd);
}
if (!prepare) {
  run('codex', ['plugin', 'marketplace', 'add', root]);
  for (const plugin of marketplace.plugins) run('codex', ['plugin', 'add', `${plugin.name}@${marketplace.name}`]);
  console.log('安装完成。重新打开 Codex 并新建聊天，输入“打开任务看板”、“打开 API 调试台”或“打开本地代码审查”。');
} else {
  console.log('插件准备完成，未修改 Codex 安装配置。');
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareDbx } from './install-dbx.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const prepare = args.includes('--prepare');
const pluginIndex = args.indexOf('--plugin');
const selectedName = pluginIndex === -1 ? undefined : args[pluginIndex + 1];
if (args.some((arg, index) => arg !== '--prepare' && arg !== '--plugin' && index !== pluginIndex + 1)
  || args.filter(arg => arg === '--prepare').length > 1
  || args.filter(arg => arg === '--plugin').length > 1
  || (pluginIndex !== -1 && !selectedName)) {
  throw new Error('用法：node scripts/install.mjs [--prepare] [--plugin <名称>]');
}
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
const plugins = selectedName
  ? marketplace.plugins.filter(plugin => plugin.name === selectedName)
  : marketplace.plugins.filter(plugin => plugin.name !== 'dbx');
if (!plugins.length) throw new Error(`未知插件：${selectedName}`);
for (const plugin of plugins) {
  if (plugin.name === 'dbx') {
    prepareDbx(root);
    continue;
  }
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
  for (const plugin of plugins) run('codex', ['plugin', 'add', `${plugin.name}@${marketplace.name}`]);
  if (plugins.some(plugin => plugin.name === 'codex-task-panel')) {
    const version=JSON.parse(readFileSync(resolve(root,'plugins/codex-task-panel/package.json'),'utf8')).version;
    const codeHome=process.env.CODEX_HOME??resolve(process.env.HOME,'.codex');
    run(process.execPath,['--experimental-sqlite',resolve(codeHome,'plugins/cache',marketplace.name,'codex-task-panel',version,'servers/commit-context.mjs'),'--register']);
  }
  console.log(selectedName === 'dbx'
    ? 'DBX 安装完成。重新打开 Codex 并新建聊天，然后点击左侧 DBX 图标。'
    : '安装完成。重新打开 Codex 并新建聊天，在插件设置中确认已启用。');
} else {
  console.log('插件准备完成，未修改 Codex 安装配置。');
}

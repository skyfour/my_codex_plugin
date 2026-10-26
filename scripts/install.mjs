import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const usage = `用法：
  npm run install:task-panel
  npm run install:api-client
  npm run install:local-review
  npm run install:dbx

批量安装：
  node scripts/install.mjs --plugin <名称> [--plugin <名称> ...] [--prepare]

可选插件：codex-task-panel、codex-api-client、codex-local-review、dbx
没有默认安装的插件。DBX 新安装默认使用原生后端，无需 Docker；安装阶段准备服务后才注册。
--prepare 仅准备明确选择的插件依赖与 MCP，不启动本地服务，也不注册到 Codex。`;

function parseArgs(args) {
  const names = [];
  let prepare = false;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--plugin') {
      const name = args[++index];
      if (!name || name.startsWith('-')) throw new Error(usage);
      names.push(name);
    } else if (arg === '--prepare' && !prepare) {
      prepare = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else {
      throw new Error(usage);
    }
  }
  return { names: [...new Set(names)], prepare, help };
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败（${result.status}）`);
}

export function installPlugins(args = process.argv.slice(2)) {
  const { names, prepare, help } = parseArgs(args);
  if (help || names.length === 0) {
    console.log(usage);
    return;
  }
  const marketplace = JSON.parse(readFileSync(resolve(root, '.agents/plugins/marketplace.json'), 'utf8'));
  const plugins = names.map(name => {
    const plugin = marketplace.plugins.find(plugin => plugin.name === name);
    if (!plugin) throw new Error(`未知插件：${name}\n${usage}`);
    return plugin;
  });
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('需要 Node.js >=22.13，建议 Node 24 LTS。');
  if (!prepare && process.platform !== 'darwin') throw new Error('当前完整安装支持 macOS；API 调试台依赖 macOS Keychain。');
  run(process.execPath, ['scripts/validate.mjs']);
  if (!prepare) run('codex', ['plugin', '--help']);
  for (const plugin of plugins) {
    const cwd = resolve(root, plugin.source.path);
    console.log(`准备 ${plugin.name}`);
    run('npm', ['ci', '--no-audit', '--no-fund'], cwd);
    const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
    // 任务面板直接运行源码；它的 build 是旧的独立分发打包器。
    if (plugin.name === 'codex-api-client') run('npm', ['run', 'build'], cwd);
    if (pkg.scripts.check) run('npm', ['run', 'check'], cwd);
  }
  if (!prepare) {
    if (names.includes('dbx')) {
      const dbx = plugins.find(plugin => plugin.name === 'dbx');
      console.log('准备 DBX 本地服务：首次下载原生程序（或所选 Docker 镜像）、启动与兼容预检将在终端完成。');
      run(process.execPath, ['scripts/manage.mjs', 'setup'], resolve(root, dbx.source.path));
    }
    run('codex', ['plugin', 'marketplace', 'add', root]);
    for (const plugin of plugins) run('codex', ['plugin', 'add', `${plugin.name}@${marketplace.name}`]);
    if (names.includes('codex-task-panel')) {
      const version = JSON.parse(readFileSync(resolve(root, 'plugins/codex-task-panel/package.json'), 'utf8')).version;
      const codeHome = process.env.CODEX_HOME ?? resolve(process.env.HOME, '.codex');
      run(process.execPath, ['--experimental-sqlite', resolve(codeHome, 'plugins/cache', marketplace.name, 'codex-task-panel', version, 'servers/commit-context.mjs'), '--register']);
    }
    console.log(`安装完成：${names.join('、')}。重新打开 Codex 并新建聊天，然后从左侧打开已启用的插件。`);
  } else {
    console.log(`插件准备完成：${names.join('、')}。未修改 Codex 安装配置。`);
  }
}

export function installPlugin(name, args = process.argv.slice(2)) {
  if (args.some(arg => !['--prepare', '--help', '-h'].includes(arg))) {
    throw new Error('独立安装入口只支持 --prepare 或 --help；批量选择请使用 scripts/install.mjs --plugin <名称>。');
  }
  return installPlugins(['--plugin', name, ...args]);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  installPlugins();
}

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const pluginNames = ['codex-task-panel', 'codex-api-client', 'codex-local-review', 'dbx'];
const json = path => JSON.parse(readFileSync(path, 'utf8'));

function write(path, value, options) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, options);
}

function fixture(t, { setupStatus = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'codex-selective-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(repositoryRoot, 'scripts'), join(root, 'scripts'), {
    recursive: true,
    filter: path => !path.endsWith('.test.mjs'),
  });
  const marketplace = json(join(repositoryRoot, '.agents/plugins/marketplace.json'));
  write(join(root, '.agents/plugins/marketplace.json'), JSON.stringify(marketplace));
  for (const name of pluginNames) {
    const source = join(repositoryRoot, 'plugins', name);
    const target = join(root, 'plugins', name);
    const manifest = json(join(source, '.codex-plugin/plugin.json'));
    const mcp = json(join(source, '.mcp.json'));
    write(join(target, '.codex-plugin/plugin.json'), JSON.stringify(manifest));
    write(join(target, '.mcp.json'), JSON.stringify(mcp));
    write(join(target, manifest.interface.logo), '<svg/>');
    if (existsSync(join(source, 'install.mjs'))) cpSync(join(source, 'install.mjs'), join(target, 'install.mjs'));
    for (const relative of ['package.json', 'package-lock.json']) cpSync(join(source, relative), join(target, relative));
    if (manifest.skills) mkdirSync(join(target, manifest.skills), { recursive: true });
    for (const server of Object.values(mcp.mcpServers)) write(join(target, server.args.at(-1)), '// fixture');
    if (name === 'dbx') {
      write(join(target, 'LICENSE'), 'fixture');
      write(join(target, 'scripts/manage.mjs'), `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.PLUGIN_INSTALL_TEST_LOG, JSON.stringify({ command: 'dbx-setup', args: process.argv.slice(2), cwd: process.cwd(), execPath: process.execPath }) + String.fromCharCode(10));
console.log('DBX setup fixture: ${setupStatus === 0 ? 'ready' : 'failed'}');
process.exit(${setupStatus});
`);
    }
  }
  const legacyApiEntry = 'plugins/codex-api-client/scripts/install-local.mjs';
  write(join(root, legacyApiEntry), readFileSync(join(repositoryRoot, legacyApiEntry)));
  const codeHome = join(root, 'codex-home');
  const log = join(root, 'calls.jsonl');
  const bin = join(root, 'fake-bin');
  const recorder = `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const command = process.argv[1].split('/').at(-1);
const args = process.argv.slice(2);
appendFileSync(process.env.PLUGIN_INSTALL_TEST_LOG, JSON.stringify({ command, args, cwd: process.cwd() }) + String.fromCharCode(10));
if (['curl', 'tar', 'docker'].includes(command)) process.exit(90);
if (command === 'codex' && args[0] === 'plugin' && args[1] === 'add' && args[2].startsWith('codex-task-panel@')) {
  const entry = join(process.env.CODEX_HOME, 'plugins/cache/my-codex-plugins/codex-task-panel', process.env.PLUGIN_INSTALL_TEST_TASK_VERSION, 'servers/commit-context.mjs');
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.PLUGIN_INSTALL_TEST_LOG, JSON.stringify({command:'provider',args:process.argv.slice(2),cwd:process.cwd()}) + String.fromCharCode(10));");
}
`;
  for (const command of ['npm', 'codex', 'curl', 'tar', 'docker']) {
    write(join(bin, command), `#!${process.execPath}\n${recorder}`, { mode: 0o755 });
  }
  mkdirSync(join(root, 'unrelated-working-directory'));
  return {
    run(entry = 'scripts/install.mjs', args = []) {
      const result = spawnSync(process.execPath, [join(root, entry), ...args], {
        cwd: join(root, 'unrelated-working-directory'),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          CODEX_HOME: codeHome,
          DBX_CODEX_DOCKER_HOME: join(root, 'dbx-runtime'),
          PLUGIN_INSTALL_TEST_LOG: log,
          PLUGIN_INSTALL_TEST_TASK_VERSION: json(join(root, 'plugins/codex-task-panel/package.json')).version,
        },
      });
      return {
        ...result,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [],
      };
    },
  };
}

function assertSelection(result, names, { prepare = false } = {}) {
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.calls.filter(call => call.command === 'npm' && call.args[0] === 'ci').map(call => basename(call.cwd)), names);
  const additions = result.calls.filter(call => call.command === 'codex' && call.args[0] === 'plugin' && call.args[1] === 'add');
  assert.deepEqual(additions.map(call => call.args[2]), prepare ? [] : names.map(name => `${name}@my-codex-plugins`));
  const registrations = result.calls.filter(call => call.command === 'provider');
  assert.equal(registrations.length, !prepare && names.includes('codex-task-panel') ? 1 : 0);
  if (registrations.length) assert.deepEqual(registrations[0].args, ['--register']);
  const setups = result.calls.filter(call => call.command === 'dbx-setup');
  assert.equal(setups.length, !prepare && names.includes('dbx') ? 1 : 0, '仅普通 DBX 安装应预热官方服务');
  if (setups.length) {
    assert.deepEqual(setups[0].args, ['setup']);
    assert.equal(basename(setups[0].cwd), 'dbx');
    assert.equal(setups[0].execPath, process.execPath);
  }
  assert.equal(result.calls.some(call => ['curl', 'tar', 'docker'].includes(call.command)), false,
    prepare || !names.includes('dbx') ? '其他插件和准备模式不得下载程序或调用 Docker' : '安装器只通过 DBX setup 管理官方服务');
  if (prepare) assert.equal(result.calls.some(call => call.command === 'codex'), false, '准备模式不得调用 Codex');
}

for (const args of [[], ['--prepare'], ['--help']]) {
  test(`未选择插件只显示用法，不执行安装：${args.join(' ') || '无参数'}`, t => {
    const result = fixture(t).run('scripts/install.mjs', args);
    assert.deepEqual(result.calls, [], result.output);
    assert.match(result.output, /用法|Usage/);
    if (args.includes('--help')) assert.equal(result.status, 0, result.output);
  });
}

for (const args of [
  ['--invalid'],
  ['--plugin', 'missing-plugin'],
  ['--plugin', 'codex-api-client', '--plugin', 'missing-plugin'],
  ['--plugin'],
  ['--plugin', '--prepare'],
  ['--plugin', 'codex-api-client', '--invalid'],
]) {
  test(`非法选择在任何准备或注册前失败：${args.join(' ')}`, t => {
    const result = fixture(t).run('scripts/install.mjs', args);
    assert.notEqual(result.status, 0, result.output);
    assert.deepEqual(result.calls, [], result.output);
  });
}

test('准备模式只处理显式选择，重复名称去重且不注册', t => {
  const result = fixture(t).run('scripts/install.mjs', ['--prepare', '--plugin', 'codex-api-client', '--plugin', 'codex-local-review', '--plugin', 'codex-api-client']);
  assertSelection(result, ['codex-api-client', 'codex-local-review'], { prepare: true });
});

test('批量安装只安装所选插件，重复名称去重且不注册未选择的看板接口', { skip: process.platform !== 'darwin' }, t => {
  const result = fixture(t).run('scripts/install.mjs', ['--plugin', 'codex-local-review', '--plugin', 'codex-api-client', '--plugin', 'codex-local-review']);
  assertSelection(result, ['codex-local-review', 'codex-api-client']);
});

for (const name of pluginNames) {
  test(`${name} 独立安装入口只安装自身`, { skip: process.platform !== 'darwin' }, t => {
    const result = fixture(t).run(`plugins/${name}/install.mjs`);
    assertSelection(result, [name]);
  });
  test(`${name} 独立入口 --help 不执行准备或安装`, t => {
    const result = fixture(t).run(`plugins/${name}/install.mjs`, ['--help']);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /用法|Usage/);
    assert.deepEqual(result.calls, []);
  });
  test(`${name} 独立入口拒绝连带安装其他插件`, t => {
    const other = name === 'codex-task-panel' ? 'codex-api-client' : 'codex-task-panel';
    const result = fixture(t).run(`plugins/${name}/install.mjs`, ['--plugin', other]);
    assert.notEqual(result.status, 0, result.output);
    assert.deepEqual(result.calls, [], result.output);
  });
}

test('API 旧安装入口只安装 API Client', { skip: process.platform !== 'darwin' }, t => {
  const result = fixture(t).run('plugins/codex-api-client/scripts/install-local.mjs');
  assertSelection(result, ['codex-api-client']);
});


test('DBX 准备只安装依赖和检查 MCP，不启动或更新 Docker', t => {
  const result = fixture(t).run('plugins/dbx/install.mjs', ['--prepare']);
  assertSelection(result, ['dbx'], { prepare: true });
  assert.deepEqual(result.calls.filter(call => call.command === 'npm').map(call => call.args), [
    ['ci', '--no-audit', '--no-fund'], ['run', 'check'],
  ]);
});

test('DBX 安装在依赖和 MCP 检查后预热，全部成功后才注册插件', { skip: process.platform !== 'darwin' }, t => {
  const result = fixture(t).run('scripts/install.mjs', ['--plugin', 'dbx', '--plugin', 'codex-local-review']);
  assertSelection(result, ['dbx', 'codex-local-review']);
  const setupIndex = result.calls.findIndex(call => call.command === 'dbx-setup');
  const preparationIndices = result.calls.flatMap((call, index) => call.command === 'npm' ? [index] : []);
  const registrationIndices = result.calls.flatMap((call, index) => call.command === 'codex' && ['marketplace', 'add'].includes(call.args[1]) ? [index] : []);
  assert.ok(preparationIndices.every(index => index < setupIndex), result.output);
  assert.ok(registrationIndices.length > 0 && registrationIndices.every(index => index > setupIndex), result.output);
  assert.match(result.output, /DBX setup fixture: ready/);
  assert.match(result.output, /安装完成/);
});

test('DBX 预热失败使安装失败，不注册任何所选插件或报告安装成功', { skip: process.platform !== 'darwin' }, t => {
  const result = fixture(t, { setupStatus: 73 }).run('scripts/install.mjs', ['--plugin', 'codex-local-review', '--plugin', 'dbx']);
  assert.notEqual(result.status, 0, result.output);
  assert.equal(result.calls.filter(call => call.command === 'dbx-setup').length, 1, result.output);
  assert.equal(result.calls.some(call => call.command === 'codex' && ['marketplace', 'add'].includes(call.args[1])), false, result.output);
  assert.equal(result.calls.some(call => call.command === 'provider'), false, result.output);
  assert.doesNotMatch(result.output, /安装完成/);
  assert.match(result.output, /DBX setup fixture: failed/);
});

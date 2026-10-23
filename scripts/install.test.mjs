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

function fixture(t) {
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
    if (name === 'dbx') write(join(target, 'LICENSE'), 'fixture');
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
  assert.equal(result.calls.some(call => ['curl', 'tar', 'docker'].includes(call.command)), false, '安装插件不得下载原生程序或调用 Docker');
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

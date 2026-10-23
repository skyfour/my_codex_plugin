import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { chmod, cp, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const PREFIX = 'io.skyfour.codex.dbx.';
const OWNER = 'my-codex-plugins/dbx';
const REPOSITORIES = new Set(['t8y2/dbx', 'docker.cnb.cool/dbxio.com/dbx']);
const RELEASE_URL = 'https://api.github.com/repos/t8y2/dbx/releases/latest';
const TOKEN_TARGET = '/run/secrets/dbx-mcp-token';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;

class RuntimeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function canonicalPath(path) {
  try { return realpathSync(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), path.slice(parent.length));
  }
}

function validVersion(value) {
  return typeof value === 'string' && value.length <= 48 && VERSION.test(value) && value.split('.').every(n => Number.isSafeInteger(Number(n)));
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}

// Docker is an external dependency; arguments are never interpreted by a shell.
export function runDocker(command, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', size = 0;
    let killTimeout;
    const terminate = () => {
      child.kill('SIGTERM');
      killTimeout ??= setTimeout(() => child.kill('SIGKILL'), 500);
    };
    const timeout = setTimeout(terminate, timeoutMs);
    const clearTimers = () => { clearTimeout(timeout); clearTimeout(killTimeout); };
    const append = which => chunk => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { terminate(); return; }
      if (which === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data', append('stdout')); child.stderr.on('data', append('stderr'));
    child.on('error', error => { clearTimers(); reject(error); });
    child.on('close', code => { clearTimers(); resolvePromise({ code: code ?? 1, stdout, stderr }); });
  });
}

export class DockerRuntime {
  #home; #port; #run; #fetch; #repository; #releaseUrl; #name; #healthTimeout; #pollInterval; #verifyWeb;
  constructor({ home = join(homedir(), '.codex', 'dbx-docker'), port = 54224, run = runDocker, fetchImpl = globalThis.fetch, imageRepository = 't8y2/dbx', releaseUrl = RELEASE_URL, healthTimeoutMs = 60_000, pollIntervalMs = 500, verifyWeb = async () => {} } = {}) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DBX 端口必须是 1024–65535 的整数。');
    if (!REPOSITORIES.has(imageRepository)) throw new Error('只能使用 DBX 官方 Docker 镜像仓库。');
    const releaseAddress = new URL(releaseUrl);
    if (releaseUrl !== RELEASE_URL && !(releaseAddress.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(releaseAddress.hostname))) throw new Error('版本检查只允许官方 GitHub API。');
    this.#home = canonicalPath(resolve(home));
    if (/[\r\n,]/.test(this.#home) || this.#home === dirname(this.#home)) throw new Error('DBX 数据目录不支持此路径。');
    this.#port = port; this.#run = run; this.#fetch = fetchImpl; this.#repository = imageRepository; this.#releaseUrl = releaseUrl;
    this.#name = `codex-dbx-${createHash('sha256').update(this.#home).digest('hex').slice(0, 16)}`;
    this.#healthTimeout = healthTimeoutMs; this.#pollInterval = pollIntervalMs; this.#verifyWeb = verifyWeb;
  }
  get home() { return this.#home; }
  get baseUrl() { return `http://127.0.0.1:${this.#port}`; }
  get containerName() { return this.#name; }

  async #prepare() {
    await mkdir(this.#home, { recursive: true, mode: 0o700 });
    for (const path of [this.#home, join(this.#home, 'data'), join(this.#home, 'secrets'), join(this.#home, 'backups')]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      const item = await lstat(path);
      if (!item.isDirectory() || item.isSymbolicLink()) throw new RuntimeError('UNSAFE_PATH', 'DBX 数据目录必须是独立目录，不能是符号链接。');
    }
    await chmod(join(this.#home, 'secrets'), 0o700);
  }

  async token() {
    await this.#prepare();
    const path = join(this.#home, 'secrets/mcp-token');
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(randomBytes(32).toString('hex'));
    } catch (error) { if (error.code !== 'EEXIST') throw new RuntimeError('TOKEN_FILE', '无法创建 DBX MCP 令牌文件。'); }
    finally { await handle?.close(); }
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new RuntimeError('TOKEN_FILE', 'DBX MCP 令牌必须是独立的普通文件。');
    await chmod(path, 0o600);
    const token = (await readFile(path, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new RuntimeError('TOKEN_FILE', 'DBX MCP 令牌文件无效；未覆盖现有文件。');
    return token;
  }

  async #command(args, timeoutMs) {
    try { return await this.#run('docker', args, { shell: false, timeoutMs }); }
    catch { throw new RuntimeError('DOCKER_UNAVAILABLE', 'Docker 未安装或后台未启动，请先启动 Docker。'); }
  }
  async #must(args, code = 'DOCKER_COMMAND', message = 'Docker 操作失败，请查看 Docker 后台状态。', timeoutMs) {
    const result = await this.#command(args, timeoutMs);
    if (result.code !== 0) throw new RuntimeError(code, message);
    return result.stdout;
  }
  async #daemon() { await this.#must(['info', '--format', '{{.ServerVersion}}'], 'DOCKER_UNAVAILABLE', 'Docker 后台未启动，请先启动 Docker。', 10_000); }

  #validateContainer(container) {
    const labels = container.Config?.Labels ?? {}, env = container.Config?.Env ?? [];
    const version = labels[`${PREFIX}version`], repository = labels[`${PREFIX}repository`];
    const ports = container.HostConfig?.PortBindings ?? {};
    const binding = ports['4224/tcp'];
    const mounts = container.Mounts ?? [];
    const hasMount = (source, destination, writable) => mounts.some(m => m.Type === 'bind' && resolve(m.Source) === source && m.Destination === destination && m.RW === writable);
    const valid = labels[`${PREFIX}owner`] === OWNER && labels[`${PREFIX}home`] === this.#home && validVersion(version) && REPOSITORIES.has(repository)
      && container.Name === `/${this.#name}` && /^[a-f0-9]{64}$/.test(container.Id) && IMAGE_ID.test(container.Image)
      && (container.Config.Image === container.Image || container.Config.Image === `${repository}:${version}`)
      && Object.keys(ports).length === 1 && binding?.length === 1 && binding[0].HostIp === '127.0.0.1' && binding[0].HostPort === String(this.#port)
      && mounts.length === 2 && hasMount(join(this.#home, 'data'), '/app/data', true) && hasMount(join(this.#home, 'secrets/mcp-token'), TOKEN_TARGET, false)
      && !container.HostConfig.Privileged && !['host', 'none'].includes(container.HostConfig.NetworkMode)
      && env.includes(`DBX_WEB_MCP_TOKEN_FILE=${TOKEN_TARGET}`) && env.includes(`DBX_WEB_MCP_ALLOWED_HOSTS=127.0.0.1:${this.#port}`)
      && !env.some(value => value.startsWith('DBX_WEB_MCP_TOKEN='));
    if (!valid) throw new RuntimeError('CONFLICT', '同名 DBX 容器的归属、端口或数据挂载不匹配，未修改该容器。');
    return { ...container, version, repository };
  }
  async #inspect() {
    const result = await this.#command(['inspect', this.#name], 10_000);
    if (result.code !== 0) {
      if (/no such (object|container)/i.test(result.stderr ?? '')) return null;
      throw new RuntimeError('DOCKER_INSPECT', '无法检查 DBX 容器，未执行更改。');
    }
    try {
      const parsed = JSON.parse(result.stdout);
      if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error('invalid');
      return this.#validateContainer(parsed[0]);
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError('DOCKER_INSPECT', 'DBX 容器信息无效，未执行更改。');
    }
  }
  async #health(version) {
    try {
      const authResponse = await this.#fetch(`${this.baseUrl}/api/auth/check`, { signal: AbortSignal.timeout(2_000), redirect: 'error' });
      if (!authResponse.ok) return false;
      const auth = await authResponse.json();
      if (!['authenticated', 'required', 'setup_required'].every(key => typeof auth[key] === 'boolean')) return false;
      const response = await this.#fetch(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(2_000), redirect: 'error' });
      // The image ID is pinned after pulling the official version tag. Before login,
      // DBX deliberately protects /api/version; its public auth endpoint proves readiness.
      if ([401, 403].includes(response.status)) return !auth.authenticated && (auth.required || auth.setup_required);
      if (!response.ok) return false;
      const body = await response.json();
      return body.version === version && body.demoMode !== true;
    } catch { return false; }
  }
  async #wait(version, imageId) {
    const deadline = Date.now() + this.#healthTimeout;
    do {
      if (await this.#health(version)) {
        try { await this.#verifyWeb({ baseUrl: this.baseUrl, version, imageId }); }
        catch { throw new RuntimeError('WEB_COMPATIBILITY', `DBX 官方 v${version} 界面未通过 Codex 兼容检查；升级备份将保留，请等待插件适配。`); }
        return;
      }
      await delay(this.#pollInterval);
    } while (Date.now() < deadline);
    throw new RuntimeError('HEALTH_FAILED', 'DBX 启动未通过健康或版本检查。');
  }
  #result(phase, container = null, extra = {}) { return { phase, currentVersion: container?.version ?? null, baseUrl: this.baseUrl, ...extra }; }
  #error(error, extra = {}) {
    const phase = error.code === 'DOCKER_UNAVAILABLE' ? 'docker-unavailable' : error.code === 'CONFLICT' ? 'conflict' : error.code === 'BUSY' ? 'busy' : 'error';
    return this.#result(phase, null, { code: error.code ?? 'RUNTIME_ERROR', message: error instanceof RuntimeError ? error.message : 'DBX 操作失败；保留了现有数据，请检查运行环境。', ...extra });
  }
  async status() {
    try {
      await this.#daemon(); const current = await this.#inspect();
      if (!current) return this.#result('absent');
      if (!current.State?.Running) return this.#result('stopped', current);
      return this.#result(await this.#health(current.version) ? 'ready' : 'starting', current);
    } catch (error) { return this.#error(error); }
  }
  async latest() {
    let release;
    try {
      const response = await this.#fetch(this.#releaseUrl, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'codex-dbx-plugin' }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
      if (!response.ok) throw new Error('release request failed');
      release = await response.json();
    } catch { throw new RuntimeError('RELEASE_LOOKUP', '无法检查 DBX 官方稳定版，请稍后重试。'); }
    const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : '';
    if (release.draft || release.prerelease || !validVersion(version)) throw new RuntimeError('INVALID_RELEASE', 'DBX 官方版本信息不是有效的稳定版本。');
    return { version, image: `${this.#repository}:${version}`, url: `https://github.com/t8y2/dbx/releases/tag/${release.tag_name}` };
  }

  async #lock() {
    await this.#prepare();
    const path = join(this.#home, '.operation-lock');
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') throw new RuntimeError('BUSY', 'DBX 正在启动或更新，请等待当前操作完成。'); throw error; }
    const nonce = randomUUID();
    await writeFile(join(path, 'owner.json'), JSON.stringify({ pid: process.pid, nonce, createdAt: new Date().toISOString() }), { mode: 0o600 });
    return async () => {
      try {
        const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
        if (owner.nonce === nonce) await rm(path, { recursive: true });
      } catch { /* A lock altered by another process is left for manual inspection. */ }
    };
  }
  async #pull(release) {
    await this.#must(['pull', release.image], 'PULL_FAILED', '无法拉取 DBX 官方镜像，现有容器和数据保持原状。', 10 * 60_000);
    const result = await this.#must(['image', 'inspect', release.image], 'IMAGE_INSPECT', '无法验证刚拉取的 DBX 官方镜像。');
    let id; try { id = JSON.parse(result)[0].Id; } catch { /* Validated below. */ }
    if (!IMAGE_ID.test(id)) throw new RuntimeError('IMAGE_INSPECT', 'DBX 镜像标识无效。');
    return id;
  }
  async #launch(image, version, repository = this.#repository) {
    await this.token();
    await this.#must(['run', '--detach', '--name', this.#name, '--restart', 'unless-stopped',
      '--label', `${PREFIX}owner=${OWNER}`, '--label', `${PREFIX}home=${this.#home}`, '--label', `${PREFIX}version=${version}`, '--label', `${PREFIX}repository=${repository}`,
      '--publish', `127.0.0.1:${this.#port}:4224`,
      '--mount', `type=bind,src=${join(this.#home, 'data')},dst=/app/data`,
      '--mount', `type=bind,src=${join(this.#home, 'secrets/mcp-token')},dst=${TOKEN_TARGET},readonly`,
      '--env', `DBX_WEB_MCP_TOKEN_FILE=${TOKEN_TARGET}`, '--env', `DBX_WEB_MCP_ALLOWED_HOSTS=127.0.0.1:${this.#port}`, image], 'START_FAILED', 'DBX 容器启动失败，请检查端口占用或 Docker 状态。');
    const current = await this.#inspect();
    if (!current || current.Image !== image || current.version !== version) throw new RuntimeError('CONFLICT', 'DBX 容器身份发生变化，未继续操作。');
    await this.#wait(version, image);
    return current;
  }
  async #startExisting(current) {
    if (!current.State?.Running) { await this.#must(['start', current.Id], 'START_FAILED', '无法启动现有 DBX 容器。'); }
    await this.#wait(current.version, current.Image);
    return this.#result('ready', current);
  }
  async ensure() {
    let unlock;
    try {
      unlock = await this.#lock(); await this.#daemon(); const current = await this.#inspect();
      if (current) return await this.#startExisting(current);
      const release = await this.latest(), image = await this.#pull(release);
      return this.#result('ready', await this.#launch(image, release.version), { latestVersion: release.version });
    } catch (error) { return this.#error(error); }
    finally { await unlock?.(); }
  }

  async #stopAndRemove(expected) {
    let current = await this.#inspect();
    if (!current || current.Id !== expected.Id || current.Image !== expected.Image) throw new RuntimeError('CONFLICT', 'DBX 容器身份发生变化，未停止或删除。');
    if (current.State?.Running) await this.#must(['stop', '--time', '30', current.Id], 'STOP_FAILED', 'DBX 未能正常停止，未继续替换容器。', 45_000);
    current = await this.#inspect();
    if (!current || current.State?.Running || current.Id !== expected.Id) throw new RuntimeError('CONFLICT', 'DBX 容器状态发生变化，未删除。');
    await this.#must(['rm', current.Id], 'REMOVE_FAILED', '无法替换已停止的 DBX 容器；数据未删除。');
  }

  async update() {
    let unlock, previous, backupPath, removed = false, stopped = false, release;
    try {
      unlock = await this.#lock(); await this.#daemon(); previous = await this.#inspect();
      release = await this.latest();
      if (!previous) return this.#result('ready', await this.#launch(await this.#pull(release), release.version), { latestVersion: release.version });
      if (compareVersions(release.version, previous.version) <= 0) return { ...await this.#startExisting(previous), latestVersion: release.version };
      const image = await this.#pull(release);
      const checked = await this.#inspect();
      if (!checked || checked.Id !== previous.Id || checked.Image !== previous.Image) throw new RuntimeError('CONFLICT', 'DBX 容器身份发生变化，已取消更新。');
      if (checked.State?.Running) await this.#must(['stop', '--time', '30', checked.Id], 'STOP_FAILED', 'DBX 未能正常停止，现有数据未替换。', 45_000);
      stopped = true;
      const offline = await this.#inspect();
      if (!offline || offline.State?.Running || offline.Id !== previous.Id) throw new RuntimeError('CONFLICT', '无法确认 DBX 已停止，未备份或替换。');
      backupPath = join(this.#home, 'backups', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
      await mkdir(backupPath, { mode: 0o700 });
      await cp(join(this.#home, 'data'), join(backupPath, 'data'), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      await writeFile(join(backupPath, 'backup.json'), JSON.stringify({ fromVersion: previous.version, toVersion: release.version, imageId: previous.Image, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
      await this.#stopAndRemove(previous); removed = true;
      const current = await this.#launch(image, release.version);
      return this.#result('ready', current, { latestVersion: release.version, backupPath });
    } catch (error) {
      if (!removed) {
        if (stopped && previous?.State?.Running) {
          try { const current = await this.#inspect(); if (current?.Id === previous.Id && !current.State?.Running) await this.#must(['start', current.Id]); } catch { /* Return the original failure, without claiming recovery. */ }
        }
        return this.#error(error, backupPath ? { backupPath } : {});
      }
      let rolledBack = false;
      try {
        const candidate = await this.#inspect();
        if (candidate) await this.#stopAndRemove(candidate);
        await rename(join(this.#home, 'data'), join(backupPath, 'failed-data'));
        await cp(join(backupPath, 'data'), join(this.#home, 'data'), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
        await this.#launch(previous.Image, previous.version, previous.repository); rolledBack = true;
      } catch { /* Backup and failed data remain for diagnosis; never claim rollback succeeded. */ }
      return this.#error(error, { currentVersion: rolledBack ? previous.version : null, latestVersion: release?.version, backupPath, rolledBack, servicePhase: rolledBack ? 'ready' : 'error', message: rolledBack ? (error.code === 'WEB_COMPATIBILITY' ? '新版本界面未通过兼容检查，已恢复原版本与升级前的数据和密钥；备份已保留。' : '更新失败，已恢复原版本与升级前的数据和密钥。') : '更新失败，自动恢复未完成；备份与故障数据已保留，请检查 Docker 后台。' });
    } finally { await unlock?.(); }
  }
}

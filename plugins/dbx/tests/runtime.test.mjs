import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DockerRuntime, runDocker } from '../src/runtime.mjs';

async function fixture(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dbx-runtime-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const docker = { container: null, imageVersions: new Map(), version: '0.6.52', daemon: true, calls: [], failVersion: null, onPull: null, auth: { authenticated: true, required: false, setup_required: false }, versionUnauthorized: false, failPull: false, onHealth: null };
  let release = { tag_name: 'v0.6.52', prerelease: false, draft: false };
  const run = async (command, args, commandOptions) => {
    assert.equal(command, 'docker');
    assert.equal(commandOptions?.shell, false);
    docker.calls.push([...args]);
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (args[0] === 'info') return docker.daemon ? ok('28.0.0') : { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' };
    if (args[0] === 'inspect') return docker.container ? ok(JSON.stringify([docker.container])) : { code: 1, stdout: '', stderr: `Error: No such object: ${args.at(-1)}` };
    if (args[0] === 'pull') { await docker.onPull?.(commandOptions); if (docker.failPull || docker.failRepositories?.some(repository=>args[1].startsWith(repository+':'))) return { code: 1, stdout: '', stderr: docker.pullError??'secret-value-from-docker-error' }; const version = args[1].split(':').at(-1); docker.imageVersions.set(`sha256:${version.replaceAll('.', '').padEnd(64, '0')}`, version); return ok(); }
    if (args[0] === 'image' && args[1] === 'inspect') { const version = args[2].split(':').at(-1); return ok(JSON.stringify([{ Id: `sha256:${version.replaceAll('.', '').padEnd(64, '0')}` }])); }
    if (args[0] === 'run') {
      const env = [], labels = {}, mounts = [], ports = {};
      let name;
      for (let i = 1; i < args.length - 1; i++) {
        if (args[i] === '--name') name = args[++i];
        else if (args[i] === '--label') { const [key, ...rest] = args[++i].split('='); labels[key] = rest.join('='); }
        else if (args[i] === '--env') env.push(args[++i]);
        else if (args[i] === '--publish') { const [HostIp, HostPort, containerPort] = args[++i].split(':'); ports[`${containerPort}/tcp`] = [{ HostIp, HostPort }]; }
        else if (args[i] === '--mount') { const spec = Object.fromEntries(args[++i].split(',').map(part => { const n = part.indexOf('='); return n < 0 ? [part, true] : [part.slice(0, n), part.slice(n + 1)]; })); mounts.push({ Type: spec.type, Source: spec.src, Destination: spec.dst, RW: !spec.readonly }); }
      }
      const image = args.at(-1);
      const version = docker.imageVersions.get(image);
      docker.container = { Id: 'a'.repeat(64), Name: `/${name}`, Image: image, Config: { Image: image, Labels: labels, Env: env }, State: { Running: true }, HostConfig: { PortBindings: ports, Privileged: false, NetworkMode: 'bridge' }, NetworkSettings: { Ports: ports }, Mounts: mounts };
      docker.version = version;
      if (version === docker.failVersion) { await writeFile(join(home, 'data/dbx.db'), 'new migrated database'); await writeFile(join(home, 'data/.dbx/secret.key'), 'changed key'); }
      return ok('container-fixture');
    }
    if (args[0] === 'stop') { assert.equal(args.at(-1), docker.container.Id, 'stop must target inspected immutable container ID'); docker.container.State.Running = false; return ok(); }
    if (args[0] === 'start') { assert.equal(args.at(-1), docker.container.Id, 'start must target inspected immutable container ID'); docker.container.State.Running = true; return ok(); }
    if (args[0] === 'rm') { assert.equal(args.at(-1), docker.container.Id, 'rm must target inspected immutable container ID'); assert.equal(docker.container.State.Running, false, 'must stop before removing'); assert(!args.includes('--force') && !args.includes('-v')); docker.container = null; return ok(); }
    throw new Error(`Unexpected docker command ${args.join(' ')}`);
  };
  const fetchImpl = async (url) => {
    if (String(url).includes('/releases/latest')) return new Response(JSON.stringify(release));
    if (String(url).endsWith('/api/auth/check')) await docker.onHealth?.();
    if (String(url).endsWith('/api/auth/check')) return docker.container?.State.Running && docker.version !== docker.failVersion ? new Response(JSON.stringify(docker.auth)) : new Response('', { status: 503 });
    if (String(url).endsWith('/api/version') && docker.versionUnauthorized) return new Response('', { status: 401 });
    if (String(url).endsWith('/api/version')) return docker.container?.State.Running && docker.version !== docker.failVersion ? new Response(JSON.stringify({ version: docker.version, demoMode: false })) : new Response('', { status: 503 });
    throw new Error(`Unexpected URL ${url}`);
  };
  const runtime = new DockerRuntime({ home, port: 54224, run, fetchImpl, healthTimeoutMs: 30, pollIntervalMs: 1, ...options });
  return { home: runtime.home, runtime, docker, setRelease(value) { release = value; } };
}

// Sidebar starts must never put a first registry download behind a blank workbench.
test('sidebar start without a prepared container requests installation without fetching or pulling',async t=>{
  const f=await fixture(t);f.setRelease({tag_name:'not-a-release'});
  const result=await f.runtime.ensure({allowDownload:false});
  assert.equal(result.code,'SETUP_REQUIRED');assert.match(result.message,/setup:dbx/);
  assert.equal(f.docker.calls.some(args=>['pull','run','start'].includes(args[0])),false);
});

// The terminal and sidebar must see actual phases before a slow external operation resolves.
test('first setup reports preparation stages and subsequent sidebar start reuses the prepared service',async t=>{
  const f=await fixture(t),events=[];
  const result=await f.runtime.ensure({onProgress:event=>events.push(event)});
  assert.equal(result.phase,'ready');
  assert.deepEqual(events.map(event=>event.stage),['docker','release','download','start','health','compatibility','ready']);
  assert(events.every(event=>typeof event.message==='string'&&event.message.length>0));
  assert(f.docker.calls.find(args=>args[0]==='run').includes('--pull=never'));
  f.docker.calls.length=0;f.setRelease({tag_name:'not-a-release'});
  assert.equal((await f.runtime.ensure({allowDownload:false})).phase,'ready');
  assert.equal(f.docker.calls.some(args=>['pull','run','stop','rm'].includes(args[0])),false);
});

// Pull progress is emitted while blocked, and only recognized counters can reach the panel.
test('download progress arrives before completion and never relays arbitrary Docker output',async t=>{
  const f=await fixture(t),events=[];let entered,release;
  const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  f.docker.onPull=async options=>{
    options.onOutput('registry error private-value-must-not-leak\nabc123: Downlo');
    options.onOutput('ading [==>] 2MB/10MB\n');entered();await gate;
  };
  const pending=f.runtime.ensure({onProgress:event=>events.push(event)});
  try{
    await started;assert(events.some(event=>event.stage==='download'&&event.message.includes('2MB / 10MB')));
    assert.equal(events.some(event=>event.stage==='ready'),false);
    assert.equal(JSON.stringify(events).includes('private-value'),false);
  }finally{release();}
  assert.equal((await pending).phase,'ready');
});

test('Docker command output streams to the observer before its result resolves',async()=>{
  const chunks=[];let completed=false,sawOutput;
  const first=new Promise(resolve=>{sawOutput=resolve;});
  const pending=runDocker(process.execPath,['-e',"console.log('abc123: Downloading 2MB/10MB');setTimeout(()=>process.exit(0),50)"],{onOutput:chunk=>{chunks.push(chunk);sawOutput();}}).then(result=>{completed=true;return result;});
  await first;assert.equal(completed,false);assert.match(chunks.join(''),/Downloading/);
  assert.equal((await pending).code,0);
});

// A missing daemon must yield actionable status without attempting a pull or touching legacy DBX data.
test('daemon unavailable is reported without container mutation', async t => {
  const { runtime, docker } = await fixture(t); docker.daemon = false;
  assert.equal((await runtime.status()).phase, 'docker-unavailable');
  assert.equal((await runtime.ensure()).phase, 'docker-unavailable');
  assert.equal(docker.calls.filter(c => ['run', 'pull', 'stop', 'rm'].includes(c[0])).length, 0);
});

// First install must pin a release and preserve a private file-backed token while reusing its own healthy container.
test('ensure creates a pinned official container and reuses it with private token', async t => {
  const { runtime, docker, home } = await fixture(t);
  const result = await runtime.ensure();
  assert.equal(result.phase, 'ready'); assert.equal(result.currentVersion, '0.6.52');
  assert.equal(result.baseUrl, 'http://127.0.0.1:54224');
  assert(docker.calls.some(c => c[0] === 'pull' && c[1] === 'docker.cnb.cool/dbxio.com/dbx:0.6.52'));
  assert.equal(docker.container.Config.Env.includes('DBX_WEB_MCP_TOKEN_FILE=/run/secrets/dbx-mcp-token'), true);
  assert.equal(docker.container.Config.Env.includes('DBX_WEB_MCP_ALLOWED_HOSTS=127.0.0.1:54224'), true);
  const token = await runtime.token(); assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal((await stat(join(home, 'secrets/mcp-token'))).mode & 0o777, 0o600);
  assert(!JSON.stringify(result).includes(token)); assert(!JSON.stringify(docker.calls).includes(token));
  assert.equal((await runtime.ensure()).phase, 'ready');
  assert.equal(docker.calls.filter(c => c[0] === 'run').length, 1);
  assert.equal(await runtime.token(), token);
});

// Even a plausible name must never authorize mutation of an unowned container, extra published ports, or redirected data mounts.
for (const [name, mutate] of [
  ['owner label', c => { delete c.Config.Labels['io.skyfour.codex.dbx.owner']; }],
  ['home label', c => { c.Config.Labels['io.skyfour.codex.dbx.home'] = '/other/home'; }],
  ['port', c => { c.HostConfig.PortBindings['4224/tcp'][0].HostIp = '0.0.0.0'; }],
  ['extra port', c => { c.HostConfig.PortBindings['9000/tcp'] = [{ HostIp: '127.0.0.1', HostPort: '9000' }]; }],
  ['data mount', c => { c.Mounts.find(m => m.Destination === '/app/data').Source = '/other/data'; }],
  ['secret writable', c => { c.Mounts.find(m => m.Destination === '/run/secrets/dbx-mcp-token').RW = true; }],
]) test(`refuses ${name} conflict before any mutation`, async t => {
  const { runtime, docker } = await fixture(t); await runtime.ensure(); mutate(docker.container); docker.calls.length = 0;
  assert.equal((await runtime.status()).phase, 'conflict');
  assert.equal((await runtime.ensure()).phase, 'conflict');
  assert.equal((await runtime.update()).phase, 'conflict');
  assert.equal(docker.calls.filter(c => ['pull', 'run', 'start', 'stop', 'rm'].includes(c[0])).length, 0);
});

// A completed upgrade must keep the same data and encryption key, and retain an offline backup made before replacement.
test('update backs up stopped data and retains keys while moving to the official stable version', async t => {
  const f = await fixture(t); f.setRelease({ tag_name: 'v0.6.51' }); await f.runtime.ensure();
  await mkdir(join(f.home, 'data/.dbx'), { recursive: true });
  await writeFile(join(f.home, 'data/dbx.db'), 'old database'); await writeFile(join(f.home, 'data/.dbx/secret.key'), 'old key');
  const token = await f.runtime.token(); f.setRelease({ tag_name: 'v0.6.52' });
  const result = await f.runtime.update();
  assert.equal(result.phase, 'ready'); assert.equal(result.currentVersion, '0.6.52');
  assert.equal(await readFile(join(f.home, 'data/dbx.db'), 'utf8'), 'old database');
  assert.equal(await readFile(join(f.home, 'data/.dbx/secret.key'), 'utf8'), 'old key');
  assert.equal(await f.runtime.token(), token);
  assert.equal(await readFile(join(result.backupPath, 'data/dbx.db'), 'utf8'), 'old database');
  assert.equal(await readFile(join(result.backupPath, 'data/.dbx/secret.key'), 'utf8'), 'old key');
  assert(f.docker.calls.findIndex(c => c[0] === 'stop') < f.docker.calls.findIndex(c => c[0] === 'rm'));
});

// A failed migration can corrupt both DB and encryption key; rollback must restore both before launching the exact previous image.
test('failed health check rolls back database and key and reports failure instead of upgrade success', async t => {
  const f = await fixture(t); f.setRelease({ tag_name: 'v0.6.51' }); await f.runtime.ensure();
  const oldImage = f.docker.container.Image;
  await mkdir(join(f.home, 'data/.dbx'), { recursive: true });
  await writeFile(join(f.home, 'data/dbx.db'), 'old database'); await writeFile(join(f.home, 'data/.dbx/secret.key'), 'old key');
  f.docker.failVersion = '0.6.52'; f.setRelease({ tag_name: 'v0.6.52' });
  const result = await f.runtime.update();
  assert.equal(result.phase, 'error'); assert.equal(result.rolledBack, true); assert.equal(result.currentVersion, '0.6.51');
  assert.equal(result.servicePhase, 'ready'); assert.equal(f.docker.container.Image, oldImage);
  assert.equal(await readFile(join(f.home, 'data/dbx.db'), 'utf8'), 'old database');
  assert.equal(await readFile(join(f.home, 'data/.dbx/secret.key'), 'utf8'), 'old key');
  assert.equal(await readFile(join(result.backupPath, 'failed-data/dbx.db'), 'utf8'), 'new migrated database');
  assert.equal((await f.runtime.status()).phase, 'ready');
});

// Independent runtime instances must not concurrently pull/stop the same shared service.
test('a held operation lock rejects a concurrent update without interrupting the first start', async t => {
  const f = await fixture(t); let entered; const gate = new Promise(resolve => { entered = resolve; }); let release; const blocked = new Promise(resolve => { release = resolve; });
  f.docker.onPull = async () => { entered(); await blocked; };
  const first = f.runtime.ensure(); await gate;
  const second = new DockerRuntime({ home: f.home, run: async () => { throw new Error('must not run Docker under another lock'); } });
  assert.equal((await second.update()).phase, 'busy'); release(); assert.equal((await first).phase, 'ready');
});

// Untrusted GitHub metadata cannot become a command argument/tag, and prereleases cannot silently replace the stable line.
for (const release of [{ tag_name: 'latest' }, { tag_name: 'v0.6.52;touch /tmp/no' }, { tag_name: 'v0.6.53-beta.1', prerelease: true }, { tag_name: 'v0.6.52', draft: true }]) test(`rejects non-stable release ${release.tag_name}`, async t => {
  const f = await fixture(t); f.setRelease(release);
  assert.equal((await f.runtime.ensure()).phase, 'error');
  assert.equal(f.docker.calls.some(c => c[0] === 'pull'), false);
});

// Release lookup works through real HTTP with the same JSON shape as GitHub, independently of Docker fakes.
test('latest resolves GitHub release JSON through an isolated local HTTP fixture', async t => {
  const server = createServer((request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ tag_name: 'v0.6.52', draft: false, prerelease: false })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const f = await fixture(t, { fetchImpl: fetch, releaseUrl: `http://127.0.0.1:${server.address().port}/releases/latest` });
  assert.deepEqual(await f.runtime.latest(), { version: '0.6.52', image: 'docker.cnb.cool/dbxio.com/dbx:0.6.52', url: 'https://github.com/t8y2/dbx/releases/tag/v0.6.52' });
});

// Official DBX protects /api/version before login; setup/login screens are nevertheless a healthy workbench.
for (const auth of [
  { authenticated: false, required: false, setup_required: true },
  { authenticated: false, required: true, setup_required: false },
]) test(`unauthenticated official workbench is ready (setup: ${auth.setup_required})`, async t => {
  const f = await fixture(t); f.docker.auth = auth; f.docker.versionUnauthorized = true;
  assert.equal((await f.runtime.ensure()).phase, 'ready');
  assert.equal((await f.runtime.status()).phase, 'ready');
});

// Failed downloads must leave the working old service untouched, and CLI diagnostics must never expose secrets.
test('pull failure leaves old service running and keeps Docker stderr out of user status', async t => {
  const f = await fixture(t); f.setRelease({ tag_name: 'v0.6.51' }); await f.runtime.ensure();
  const oldImage = f.docker.container.Image; f.docker.calls.length = 0; f.docker.failPull = true; f.setRelease({ tag_name: 'v0.6.52' });
  const result = await f.runtime.update();
  assert.equal(result.phase, 'error'); assert.equal(f.docker.container.Image, oldImage); assert.equal(f.docker.container.State.Running, true);
  assert.equal(f.docker.calls.some(c => ['stop', 'rm', 'run'].includes(c[0])), false);
  assert.equal(JSON.stringify(result).includes('secret-value-from-docker-error'), false);
});

// If ownership changes during the health wait, rollback must not stop that container or overwrite its mounted data.
test('ownership change during failed update prevents destructive rollback', async t => {
  const f = await fixture(t); f.setRelease({ tag_name: 'v0.6.51' }); await f.runtime.ensure();
  await mkdir(join(f.home, 'data/.dbx'), { recursive: true });
  await writeFile(join(f.home, 'data/dbx.db'), 'old database'); await writeFile(join(f.home, 'data/.dbx/secret.key'), 'old key');
  f.docker.failVersion = '0.6.52'; f.setRelease({ tag_name: 'v0.6.52' });
  let mutationsBeforeTakeover;
  f.docker.onHealth = () => {
    if (f.docker.version === '0.6.52') {
      delete f.docker.container.Config.Labels['io.skyfour.codex.dbx.owner'];
      mutationsBeforeTakeover ??= f.docker.calls.filter(c => ['stop', 'rm', 'run'].includes(c[0])).length;
    }
  };
  const result = await f.runtime.update();
  assert.equal(result.phase, 'error'); assert.equal(result.rolledBack, false); assert.equal(result.servicePhase, 'error');
  assert.equal(await readFile(join(f.home, 'data/dbx.db'), 'utf8'), 'new migrated database');
  assert.equal(f.docker.calls.filter(c => ['stop', 'rm', 'run'].includes(c[0])).length, mutationsBeforeTakeover);
  assert.equal(await readFile(join(result.backupPath, 'data/.dbx/secret.key'), 'utf8'), 'old key');
});

// An existing stopped service should restart its pinned image without network access or container replacement.
test('ensure restarts a valid stopped container without fetching latest', async t => {
  const f = await fixture(t); await f.runtime.ensure(); f.docker.container.State.Running = false; f.docker.calls.length = 0;
  f.setRelease({ tag_name: 'not-a-release' });
  assert.equal((await f.runtime.ensure()).phase, 'ready');
  assert.equal(f.docker.calls.some(c => ['pull', 'run', 'rm'].includes(c[0])), false);
});

// Data home aliases must resolve to one lock and one Docker container rather than split ownership.
test('home path normalization prevents parallel aliases and rejects unsafe repositories', async t => {
  const f = await fixture(t);
  const alias = new DockerRuntime({ home: join(f.home, '.', 'unused', '..') });
  assert.equal(alias.home, f.home); assert.equal(alias.containerName, f.runtime.containerName);
  assert.throws(() => new DockerRuntime({ home: f.home, imageRepository: 'example.com/attacker/dbx' }), /官方/);
  assert.throws(() => new DockerRuntime({ home: f.home, releaseUrl: 'https://attacker.example/releases/latest' }), /官方/);
});

// A Docker child that ignores SIGTERM must not keep an update job and its process lock alive forever.
test('command timeout terminates a child that ignores SIGTERM', { timeout: 4_000 }, async () => {
  const start = Date.now();
  const result = await runDocker(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { timeoutMs: 200 });
  assert.notEqual(result.code, 0);
  assert(Date.now() - start < 2_500);
});

// A healthy backend does not mean its new frontend can safely run in Codex; reject it before declaring success and restore the old data/image.
test('frontend compatibility failure rolls back even when API health is successful',async t=>{
  const verified=[];
  const f=await fixture(t,{verifyWeb:async({baseUrl,version})=>{verified.push({baseUrl,version});if(version==='0.6.52')throw new Error('unsupported native confirmation flow');}});
  f.setRelease({tag_name:'v0.6.51'});assert.equal((await f.runtime.ensure()).phase,'ready');
  await mkdir(join(f.home,'data/.dbx'),{recursive:true});await writeFile(join(f.home,'data/dbx.db'),'previous DB');await writeFile(join(f.home,'data/.dbx/secret.key'),'previous encryption key');
  f.setRelease({tag_name:'v0.6.52'});const result=await f.runtime.update();
  assert.equal(result.phase,'error');assert.equal(result.code,'WEB_COMPATIBILITY');assert.equal(result.rolledBack,true);assert.equal(result.currentVersion,'0.6.51');
  assert.match(result.message,/兼容/);assert.match(result.message,/备份/);
  assert.equal(await readFile(join(f.home,'data/dbx.db'),'utf8'),'previous DB');assert.equal(await readFile(join(f.home,'data/.dbx/secret.key'),'utf8'),'previous encryption key');
  assert.deepEqual(verified.map(item=>item.version),['0.6.51','0.6.52','0.6.51']);assert(verified.every(item=>item.baseUrl==='http://127.0.0.1:54224'));
});

// Reopening an existing stopped container must run the same compatibility check rather than bypassing verification.
test('restarting an existing image also runs the frontend verifier',async t=>{
  let blocked=false;
  const f=await fixture(t,{verifyWeb:async()=>{if(blocked)throw new Error('unsafe frontend');}});
  assert.equal((await f.runtime.ensure()).phase,'ready');f.docker.container.State.Running=false;blocked=true;
  const result=await f.runtime.ensure();assert.equal(result.phase,'error');assert.equal(result.code,'WEB_COMPATIBILITY');
});

// Frontend proof caches must bind to the inspected immutable image, including existing starts and rollback, rather than a mutable version label/tag.
test('frontend verifier receives the actual immutable image ID for new, existing and restored containers',async t=>{
  const verified=[];
  const f=await fixture(t,{verifyWeb:async identity=>{verified.push(identity);if(identity.version==='0.6.52')throw new Error('new frontend rejected');}});
  f.setRelease({tag_name:'v0.6.51'});assert.equal((await f.runtime.ensure()).phase,'ready');
  const oldImage=f.docker.container.Image;
  assert.match(oldImage,/^sha256:[a-f0-9]{64}$/);
  assert.equal(verified[0].imageId,oldImage);
  f.docker.container.State.Running=false;assert.equal((await f.runtime.ensure()).phase,'ready');
  assert.equal(verified[1].imageId,oldImage);
  f.setRelease({tag_name:'v0.6.52'});assert.equal((await f.runtime.update()).rolledBack,true);
  assert.match(verified[2].imageId,/^sha256:[a-f0-9]{64}$/);assert.notEqual(verified[2].imageId,oldImage);
  assert.equal(verified[3].imageId,oldImage);assert.equal(f.docker.container.Image,oldImage);
  assert(verified.every(identity=>identity.baseUrl==='http://127.0.0.1:54224'));
});

// Registry failures must not make every installer change their global Docker settings.
test('default setup pulls CNB directly and records the source that actually supplied the image',async t=>{
 const f=await fixture(t);assert.equal((await f.runtime.ensure()).phase,'ready');
 assert.deepEqual(f.docker.calls.filter(c=>c[0]==='pull'),[['pull','docker.cnb.cool/dbxio.com/dbx:0.6.52']]);
 assert.equal(f.docker.container.Config.Labels['io.skyfour.codex.dbx.repository'],'docker.cnb.cool/dbxio.com/dbx');
});
test('CNB failure falls back to Docker Hub and the resulting container stays reusable',async t=>{
 const f=await fixture(t),events=[];f.docker.failRepositories=['docker.cnb.cool/dbxio.com/dbx'];
 assert.equal((await f.runtime.ensure({onProgress:e=>events.push(e)})).phase,'ready');
 assert.deepEqual(f.docker.calls.filter(c=>c[0]==='pull').map(c=>c[1]),['docker.cnb.cool/dbxio.com/dbx:0.6.52','t8y2/dbx:0.6.52']);
 assert.equal(f.docker.container.Config.Labels['io.skyfour.codex.dbx.repository'],'t8y2/dbx');
 assert(events.some(e=>e.message.includes('t8y2/dbx')));assert.equal(JSON.stringify(events).includes('secret-value'),false);
 f.docker.calls.length=0;assert.equal((await f.runtime.ensure({allowDownload:false})).phase,'ready');assert.equal(f.docker.calls.some(c=>c[0]==='pull'),false);
});
test('an explicit Docker Hub primary can recover through CNB when its mirror denies access',async t=>{
 const f=await fixture(t,{imageRepository:'t8y2/dbx'});f.docker.failRepositories=['t8y2/dbx'];
 assert.equal((await f.runtime.ensure()).phase,'ready');
 assert.deepEqual(f.docker.calls.filter(c=>c[0]==='pull').map(c=>c[1]),['t8y2/dbx:0.6.52','docker.cnb.cool/dbxio.com/dbx:0.6.52']);
 assert.equal(f.docker.container.Config.Labels['io.skyfour.codex.dbx.repository'],'docker.cnb.cool/dbxio.com/dbx');
});
test('update can change registry while preserving data and reporting both sources when all pulls fail',async t=>{
 const f=await fixture(t);f.setRelease({tag_name:'v0.6.51'});await f.runtime.ensure();await writeFile(join(f.home,'data/dbx.db'),'existing data');
 f.docker.failRepositories=['docker.cnb.cool/dbxio.com/dbx'];f.setRelease({tag_name:'v0.6.52'});
 assert.equal((await f.runtime.update()).phase,'ready');assert.equal(f.docker.container.Config.Labels['io.skyfour.codex.dbx.repository'],'t8y2/dbx');assert.equal(await readFile(join(f.home,'data/dbx.db'),'utf8'),'existing data');
 const oldImage=f.docker.container.Image;f.docker.pullError='403 Forbidden secret-value-from-docker-error';f.docker.failPull=true;f.docker.calls.length=0;f.setRelease({tag_name:'v0.6.53'});const result=await f.runtime.update();
 assert.equal(result.code,'PULL_FAILED');assert.match(result.message,/403/);assert.match(result.message,/docker\.cnb\.cool/);assert.match(result.message,/t8y2\/dbx/);assert.equal(JSON.stringify(result).includes('secret-value'),false);assert.equal(f.docker.container.Image,oldImage);assert.equal(f.docker.calls.some(c=>['stop','rm','run'].includes(c[0])),false);
});

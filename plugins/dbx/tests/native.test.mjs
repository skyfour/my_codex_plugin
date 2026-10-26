import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import { NativeRuntime } from "../src/native-runtime.mjs";
import { nativeAsset } from "../src/native-artifacts.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "dbx-native-test-")),
    home = join(directory, "runtime"),
    binary = join(directory, "dbx-web");
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const source = (version) =>
    `#!${process.execPath}\nimport http from 'node:http';import fs from 'node:fs';if(process.argv.includes('--version')){console.log('dbx-web ${version}');process.exit(0);}if(process.env.DBX_BIND_ADDR!=='127.0.0.1')process.exit(90);if(!fs.existsSync(process.env.DBX_WEB_MCP_TOKEN_FILE))process.exit(91);http.createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify(q.url==='/api/auth/check'?{authenticated:true,required:false,setup_required:false}:{version:'${version}',demoMode:false}));}).listen(Number(process.env.DBX_PORT),process.env.DBX_BIND_ADDR);`;
  await writeFile(binary, source("1.2.3"), { mode: 0o700 });
  const runtime = new NativeRuntime({
    home,
    port,
    binary,
    healthTimeoutMs: 2000,
  });
  t.after(async () => {
    try {
      const record = JSON.parse(
        await readFile(join(home, "process.json"), "utf8"),
      );
      process.kill(record.pid, "SIGTERM");
    } catch {}
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, home, binary, runtime, source };
}
test("native mode starts and reuses an owned local process without Docker or network downloads", async (t) => {
  const f = await fixture(t),
    result = await f.runtime.ensure();
  assert.equal(result.phase, "ready");
  assert.equal(result.currentVersion, "1.2.3");
  const first = JSON.parse(
    await readFile(join(f.home, "process.json"), "utf8"),
  );
  const token = await f.runtime.token();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(
    (await f.runtime.ensure({ allowDownload: false })).phase,
    "ready",
  );
  assert.equal(
    JSON.parse(await readFile(join(f.home, "process.json"), "utf8")).pid,
    first.pid,
  );
  assert.equal(await f.runtime.token(), token);
});
test("native sidebar without installation reports setup required and does not access release metadata", async (t) => {
  const f = await fixture(t);
  const runtime = new NativeRuntime({
    home: f.home,
    port: 54333,
    fetchImpl: () => {
      throw Error("network must not run");
    },
  });
  assert.equal(
    (await runtime.ensure({ allowDownload: false })).code,
    "SETUP_REQUIRED",
  );
});
test("native launch refuses a port occupied by another service", async (t) => {
  const f = await fixture(t),
    port = Number(new URL(f.runtime.baseUrl).port),
    server = net.createServer();
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  assert.equal((await f.runtime.ensure()).code, "PORT_IN_USE");
});
test("native update copies a new executable and preserves data and the token", async (t) => {
  const f = await fixture(t);
  await f.runtime.ensure();
  await writeFile(join(f.home, "data", "example"), "user data");
  const token = await f.runtime.token();
  await writeFile(f.binary, f.source("1.2.4"));
  const result = await f.runtime.update();
  assert.equal(result.phase, "ready");
  assert.equal(result.currentVersion, "1.2.4");
  assert.equal(
    await readFile(join(f.home, "data", "example"), "utf8"),
    "user data",
  );
  assert.equal(await f.runtime.token(), token);
  assert.ok(result.backupPath);
});
test("native release assets select the matching platform and reject unsupported targets", () => {
  assert.equal(
    nativeAsset("0.6.55", "darwin", "arm64").name,
    "dbx-web_0.6.55_darwin-arm64.tar.gz",
  );
  assert.equal(
    nativeAsset("0.6.55", "linux", "arm64").name,
    "DBX_0.6.55_arm64-browser-static.tar.gz",
  );
  assert.throws(() => nativeAsset("0.6.55", "freebsd", "x64"), /支持/);
  assert.throws(() => nativeAsset("../bad", "darwin", "arm64"), /版本/);
});
test("native compatibility failure restores the old executable and data", async (t) => {
  const f = await fixture(t);
  await f.runtime.ensure();
  await writeFile(join(f.home, "data", "example"), "before");
  const token = await f.runtime.token();
  await writeFile(
    f.binary,
    f
      .source("1.2.4")
      .replace(
        "http.createServer",
        "fs.writeFileSync(process.env.DBX_DATA_DIR+'/example','changed by failed version');http.createServer",
      ),
  );
  const runtime = new NativeRuntime({
    home: f.home,
    port: Number(new URL(f.runtime.baseUrl).port),
    binary: f.binary,
    verifyWeb: async ({ version }) => {
      if (version === "1.2.4") throw Error("unsupported");
    },
  });
  const result = await runtime.update();
  assert.equal(result.rolledBack, true);
  assert.equal(result.currentVersion, "1.2.3");
  assert.equal(
    await readFile(join(f.home, "data", "example"), "utf8"),
    "before",
  );
  assert.equal(await runtime.token(), token);
  assert.equal((await runtime.status()).phase, "ready");
});
test("native process identity mismatch cannot authorize process reuse or termination", async (t) => {
  const f = await fixture(t);
  await f.runtime.ensure();
  const path = join(f.home, "process.json"),
    saved = await readFile(path, "utf8");
  try {
    const value = JSON.parse(saved);
    value.identity = "not this process";
    await writeFile(path, JSON.stringify(value));
    assert.equal((await f.runtime.ensure()).code, "PROCESS_CONFLICT");
  } finally {
    await writeFile(path, saved);
  }
});

test("fresh native setup downloads, verifies, installs and starts without a supplied executable", async (t) => {
  const f = await fixture(t),
    archive = join(f.directory, "package.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", f.directory, "dbx-web"]);
  const bytes = await readFile(archive),
    asset = nativeAsset("1.2.3");
  const url = `https://github.com/${asset.repository}/releases/download/${asset.tag}/${asset.name}`;
  let downloaded = 0;
  const fetchImpl = async (input, options) => {
    const target = String(input);
    if (target === "https://api.github.com/repos/t8y2/dbx/releases/latest")
      return new Response(JSON.stringify({ tag_name: "v1.2.3", assets: [] }));
    if (target.startsWith("https://api.github.com/repos/skyfour/"))
      return new Response(
        JSON.stringify({
          tag_name: asset.tag,
          assets: [
            {
              name: asset.name,
              browser_download_url: url,
              digest:
                "sha256:" + createHash("sha256").update(bytes).digest("hex"),
            },
          ],
        }),
      );
    if (target === url) {
      downloaded++;
      return new Response(bytes);
    }
    return fetch(input, options);
  };
  // This integration fixture exercises the macOS distribution format and real child process.
  if (process.platform !== "darwin")
    return t.skip("macOS native distribution fixture");
  const runtime = new NativeRuntime({
    home: f.home,
    port: Number(new URL(f.runtime.baseUrl).port),
    fetchImpl,
    healthTimeoutMs: 2000,
  });
  assert.equal((await runtime.ensure()).phase, "ready");
  assert.equal(downloaded, 1);
  assert.equal((await runtime.ensure({ allowDownload: false })).phase, "ready");
  assert.equal(downloaded, 1);
});

test("a faulted native process that cannot stop prevents data restoration", async (t) => {
  const f = await fixture(t);
  await f.runtime.ensure();
  await writeFile(join(f.home, "data", "example"), "before");
  await writeFile(
    f.binary,
    f
      .source("1.2.4")
      .replace(
        "http.createServer",
        "process.on('SIGTERM',()=>{});fs.writeFileSync(process.env.DBX_DATA_DIR+'/example','candidate data');http.createServer",
      ),
  );
  const runtime = new NativeRuntime({
    home: f.home,
    port: Number(new URL(f.runtime.baseUrl).port),
    binary: f.binary,
    verifyWeb: async () => {
      throw Error("unsupported");
    },
  });
  let pid;
  try {
    const result = await runtime.update();
    pid = JSON.parse(await readFile(join(f.home, "process.json"), "utf8")).pid;
    assert.equal(result.code, "STOP_FAILED");
    assert.equal(result.rolledBack, false);
    assert.equal(
      await readFile(join(f.home, "data", "example"), "utf8"),
      "candidate data",
    );
    assert.equal(
      await readFile(join(result.backupPath, "data", "example"), "utf8"),
      "before",
    );
  } finally {
    pid ??= JSON.parse(
      await readFile(join(f.home, "process.json"), "utf8"),
    ).pid;
    process.kill(pid, "SIGKILL");
  }
});

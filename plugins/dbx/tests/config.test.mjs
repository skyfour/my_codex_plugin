import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { configuredRuntime, verifyCachedWeb } from "../src/config.mjs";

test("compatibility attestation is reused only for the same immutable image and adapter code", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "dbx-preflight-cache-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const adapterFile = join(home, "adapter.js");
  await writeFile(adapterFile, "adapter v1");
  let calls = 0;
  const dependencies = {
    adapterFiles: [adapterFile],
    verify: async () => {
      calls++;
      return { fileCount: 502, dialogCalls: 42 };
    },
  };
  const options = {
    home,
    baseUrl: "http://127.0.0.1:54224",
    version: "0.6.52",
    imageId: "sha256:" + "a".repeat(64),
  };
  assert.equal((await verifyCachedWeb(options, dependencies)).cached, false);
  assert.equal(calls, 1);
  assert.equal((await verifyCachedWeb(options, dependencies)).cached, true);
  assert.equal(calls, 1);
  await writeFile(adapterFile, "adapter v2");
  assert.equal((await verifyCachedWeb(options, dependencies)).cached, false);
  assert.equal(calls, 2);
  assert.equal(
    (
      await verifyCachedWeb(
        { ...options, imageId: "sha256:" + "b".repeat(64) },
        dependencies,
      )
    ).cached,
    false,
  );
  assert.equal(calls, 3);
  const proof = await readFile(join(home, "frontend-verified.json"), "utf8");
  await assert.rejects(
    verifyCachedWeb(
      { ...options, imageId: "sha256:" + "c".repeat(64) },
      {
        ...dependencies,
        verify: async () => {
          throw Error("unsupported official frontend");
        },
      },
    ),
  );
  assert.equal(
    await readFile(join(home, "frontend-verified.json"), "utf8"),
    proof,
    "a failed candidate must preserve the prior proof for rollback",
  );
});

test("runtime configuration accepts explicit independent homes and rejects malformed ports", () => {
  const runtime = configuredRuntime({
    DBX_CODEX_DOCKER_HOME: "/tmp/dbx-config-example",
    DBX_CODEX_DOCKER_PORT: "55225",
  });
  assert.equal(runtime.home, join(realpathSync("/tmp"), "dbx-config-example"));
  assert.equal(runtime.baseUrl, "http://127.0.0.1:55225");
  assert.throws(
    () => configuredRuntime({ DBX_CODEX_DOCKER_PORT: "abc" }),
    /端口/,
  );
});

test("new installs default to native and Docker remains an explicit opt-in", () => {
  const native = configuredRuntime({
    CODEX_HOME: "/tmp/dbx-new-native-install",
  });
  assert.equal(native.constructor.name, "NativeRuntime");
  assert.equal(native.baseUrl, "http://127.0.0.1:54225");
  const docker = configuredRuntime({ DBX_CODEX_RUNTIME: "docker" });
  assert.equal(docker.constructor.name, "DockerRuntime");
  assert.throws(
    () => configuredRuntime({ DBX_CODEX_RUNTIME: "unknown" }),
    /模式/,
  );
});

test("existing Docker data remains in Docker mode unless native is explicitly selected", async (t) => {
  const codeHome = await mkdtemp(join(tmpdir(), "dbx-legacy-config-"));
  t.after(() => rm(codeHome, { recursive: true, force: true }));
  const data = join(codeHome, "dbx-docker", "data");
  await mkdir(data, { recursive: true });
  await writeFile(join(data, "dbx.db"), "existing database");
  assert.equal(
    configuredRuntime({ CODEX_HOME: codeHome }).constructor.name,
    "DockerRuntime",
  );
  assert.equal(
    configuredRuntime({ CODEX_HOME: codeHome, DBX_CODEX_RUNTIME: "native" })
      .constructor.name,
    "NativeRuntime",
  );
});

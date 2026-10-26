import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { installNative, nativeRelease } from "../src/native-artifacts.mjs";
async function archive(t, { link = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "dbx-native-archive-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const content = join(dir, "content");
  await mkdir(content);
  await writeFile(join(content, "dbx-web"), "synthetic executable");
  await writeFile(join(content, "LICENSE"), "upstream license");
  if (link) await symlink("/tmp/outside", join(content, "link"));
  const path = join(dir, "package.tar.gz");
  execFileSync("tar", ["-czf", path, "-C", content, "."]);
  const bytes = await readFile(path);
  return {
    dir,
    bytes,
    release: {
      version: "1.2.3",
      binary: "dbx-web",
      url: "https://github.com/skyfour/my_codex_plugin/releases/download/dbx-native-v1.2.3/dbx-web_1.2.3_darwin-arm64.tar.gz",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}
test("native installer validates and atomically installs the expected executable", async (t) => {
  const f = await archive(t),
    home = join(f.dir, "runtime"),
    result = await installNative(home, f.release, {
      fetchImpl: async () => new Response(f.bytes),
    });
  assert.equal(await readFile(result.binary, "utf8"), "synthetic executable");
  assert.equal(
    await readFile(join(result.binary, "..", "LICENSE"), "utf8"),
    "upstream license",
  );
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    (await readdir(join(home, "releases"))).some((name) =>
      name.startsWith(".download-"),
    ),
    false,
  );
});
test("native checksum mismatch rejects the candidate and leaves existing data alone", async (t) => {
  const f = await archive(t),
    home = join(f.dir, "runtime");
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data", "existing"), "keep");
  await assert.rejects(
    installNative(
      home,
      { ...f.release, sha256: "0".repeat(64) },
      { fetchImpl: async () => new Response(f.bytes) },
    ),
    /SHA-256/,
  );
  assert.equal(await readFile(join(home, "data", "existing"), "utf8"), "keep");
  assert.deepEqual(await readdir(join(home, "releases")), []);
});
test("native archive links are rejected before extraction", async (t) => {
  const f = await archive(t, { link: true });
  await assert.rejects(
    installNative(join(f.dir, "runtime"), f.release, {
      fetchImpl: async () => new Response(f.bytes),
    }),
    /链接/,
  );
});
test("native release lookup requires a stable matching tag and GitHub-provided SHA-256", async () => {
  const name = "dbx-web_1.2.3_darwin-arm64.tar.gz";
  let digest = "sha256:" + "a".repeat(64);
  const fetchImpl = async (url) =>
    new Response(
      JSON.stringify(
        String(url).endsWith("/latest")
          ? { tag_name: "v1.2.3" }
          : {
              tag_name: "dbx-native-v1.2.3",
              assets: [
                {
                  name,
                  digest,
                  browser_download_url:
                    "https://github.com/skyfour/my_codex_plugin/releases/download/dbx-native-v1.2.3/" +
                    name,
                },
              ],
            },
      ),
    );
  assert.equal(
    (await nativeRelease({ fetchImpl, platform: "darwin", arch: "arm64" }))
      .sha256,
    "a".repeat(64),
  );
  digest = null;
  await assert.rejects(
    nativeRelease({ fetchImpl, platform: "darwin", arch: "arm64" }),
    /校验/,
  );
});

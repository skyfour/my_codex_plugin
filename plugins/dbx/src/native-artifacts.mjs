import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  lstat,
  readdir,
  chmod,
} from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { runDocker as runCommand } from "./runtime.mjs";

export function nativeAsset(
  version,
  platform = process.platform,
  arch = process.arch,
) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw Error("原生 DBX 版本无效");
  if (platform === "darwin" && ["arm64", "x64"].includes(arch))
    return {
      repository: "skyfour/my_codex_plugin",
      tag: `dbx-native-v${version}`,
      name: `dbx-web_${version}_darwin-${arch}.tar.gz`,
      binary: "dbx-web",
    };
  if (platform === "linux" && ["arm64", "x64"].includes(arch))
    return {
      repository: "t8y2/dbx",
      tag: `v${version}`,
      name: `DBX_${version}_${arch === "x64" ? "x64" : "arm64"}-browser-static.tar.gz`,
      binary: `dbx-linux-${arch === "x64" ? "x64" : "arm64"}-browser-static/bin/dbx-web-bin`,
    };
  throw Error(
    `原生 DBX 暂不支持 ${platform}/${arch}；可显式选择 Docker 模式。`,
  );
}
export async function nativeRelease({
  fetchImpl = fetch,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const request = async (url) => {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "codex-dbx-plugin",
      },
      redirect: "error",
    });
    if (!response.ok) throw Error("无法获取官方原生 DBX 发布信息");
    return response.json();
  };
  const upstream = await request(
    "https://api.github.com/repos/t8y2/dbx/releases/latest",
  );
  const version = String(upstream.tag_name ?? "").replace(/^v/, "");
  if (upstream.draft || upstream.prerelease)
    throw Error("原生 DBX 只使用稳定发布版本");
  const spec = nativeAsset(version, platform, arch),
    release =
      spec.repository === "t8y2/dbx"
        ? upstream
        : await request(
            `https://api.github.com/repos/${spec.repository}/releases/tags/${spec.tag}`,
          );
  if (release.draft || release.prerelease || release.tag_name !== spec.tag)
    throw Error("原生 DBX 对应平台产物尚未发布");
  const asset = release.assets?.find((a) => a.name === spec.name),
    prefix = `https://github.com/${spec.repository}/releases/download/${spec.tag}/`;
  if (
    !asset ||
    asset.browser_download_url !== prefix + spec.name ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")
  )
    throw Error(
      `原生 DBX ${platform}/${arch} 缺少已校验发布包，请等待该平台产物发布`,
    );
  return {
    version,
    ...spec,
    url: asset.browser_download_url,
    sha256: asset.digest.slice(7),
  };
}
async function safeTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name),
      info = await lstat(path);
    if (
      info.isSymbolicLink() ||
      (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))
    )
      throw Error("原生 DBX 安装包包含不安全的链接或文件");
    if (info.isDirectory()) await safeTree(path);
  }
}
export async function installNative(
  home,
  release,
  { fetchImpl = fetch, run = runCommand, onProgress = () => {} } = {},
) {
  const releases = join(home, "releases");
  await mkdir(releases, { recursive: true, mode: 0o700 });
  const stage = join(releases, `.download-${randomUUID()}`);
  await mkdir(stage, { mode: 0o700 });
  try {
    onProgress({
      stage: "download",
      message: `正在下载原生 DBX v${release.version}…`,
    });
    const response = await fetchImpl(release.url, {
      signal: AbortSignal.timeout(600_000),
      redirect: "follow",
    });
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get("content-length")) > 512 * 1024 * 1024
    )
      throw Error("原生 DBX 下载失败或文件过大");
    let bytes = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 512 * 1024 * 1024) throw Error("原生 DBX 安装包超过大小上限");
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks),
      digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== release.sha256)
      throw Error("原生 DBX SHA-256 校验失败，未替换现有程序");
    const archive = join(stage, "package.tar.gz"),
      unpacked = join(stage, "unpacked");
    await writeFile(archive, buffer, { mode: 0o600 });
    await mkdir(unpacked, { mode: 0o700 });
    const listed = await run("tar", ["-tzf", archive]);
    const details = await run("tar", ["-tvzf", archive]);
    if (
      listed.code !== 0 ||
      details.code !== 0 ||
      details.stdout
        .trim()
        .split("\n")
        .some((line) => !/^[-d]/.test(line))
    )
      throw Error("原生 DBX 压缩包无效或包含链接");
    const names = listed.stdout.trim().split("\n");
    if (
      !names.length ||
      names.some(
        (name) =>
          !name ||
          isAbsolute(name) ||
          name.includes("\\") ||
          name.split("/").includes("..") ||
          /[\x00-\x1f]/.test(name),
      )
    )
      throw Error("原生 DBX 压缩包路径越界");
    const extracted = await run("tar", [
      "-xzf",
      archive,
      "--no-same-owner",
      "--no-same-permissions",
      "-C",
      unpacked,
    ]);
    if (extracted.code !== 0) throw Error("原生 DBX 解压失败");
    await safeTree(unpacked);
    const candidate = resolve(unpacked, release.binary);
    if (
      relative(unpacked, candidate).startsWith("..") ||
      !(await lstat(candidate)).isFile()
    )
      throw Error("原生 DBX 安装包缺少可执行程序");
    // Only the self-contained Web binary is installed; archive launch scripts are never executed.
    const data = await readFile(candidate),
      sha256 = createHash("sha256").update(data).digest("hex"),
      directory = join(releases, `${release.version}-${sha256.slice(0, 16)}`);
    const prepared = join(stage, "ready");
    await mkdir(prepared, { mode: 0o700 });
    await writeFile(join(prepared, "dbx-web"), data, { mode: 0o700 });
    const license = join(unpacked, "LICENSE");
    try {
      await writeFile(join(prepared, "LICENSE"), await readFile(license), {
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(prepared, directory);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      const existing = await readFile(join(directory, "dbx-web"));
      if (createHash("sha256").update(existing).digest("hex") !== sha256)
        throw Error("原生 DBX 本地缓存校验失败");
    }
    await chmod(join(directory, "dbx-web"), 0o700);
    return {
      version: release.version,
      binary: join(directory, "dbx-web"),
      sha256,
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

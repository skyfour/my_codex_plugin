import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { realpathSync } from "node:fs";
import {
  mkdir,
  lstat,
  chmod,
  readFile,
  writeFile,
  open,
  rename,
  rm,
  cp,
} from "node:fs/promises";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { runDocker as runCommand } from "./runtime.mjs";
import { nativeRelease, installNative } from "./native-artifacts.mjs";
const valid = (v) =>
  typeof v === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v);
const digest = (data) => createHash("sha256").update(data).digest("hex");
function canonical(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonical(parent), path.slice(parent.length));
  }
}
function failure(code, message) {
  return Object.assign(Error(message), { code });
}

export class NativeRuntime {
  #home;
  #port;
  #binary;
  #fetch;
  #verify;
  #timeout;
  constructor({
    home = join(homedir(), ".codex", "dbx-native"),
    port = 54225,
    binary,
    fetchImpl = fetch,
    verifyWeb = async () => {},
    healthTimeoutMs = 60_000,
  } = {}) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw Error("DBX 端口必须是 1024–65535 的整数");
    this.#home = canonical(resolve(home));
    if (this.#home === dirname(this.#home))
      throw Error("原生 DBX 需要独立数据目录");
    this.#port = port;
    this.#binary = binary ? resolve(binary) : null;
    this.#fetch = fetchImpl;
    this.#verify = verifyWeb;
    this.#timeout = healthTimeoutMs;
  }
  get home() {
    return this.#home;
  }
  get baseUrl() {
    return `http://127.0.0.1:${this.#port}`;
  }
  #result(phase, version = null, extra = {}) {
    return {
      phase,
      currentVersion: version,
      baseUrl: this.baseUrl,
      runtime: "native",
      ...extra,
    };
  }
  async #prepare() {
    for (const path of [
      this.#home,
      join(this.#home, "data"),
      join(this.#home, "secrets"),
      join(this.#home, "backups"),
      join(this.#home, "releases"),
    ]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      const item = await lstat(path);
      if (!item.isDirectory() || item.isSymbolicLink())
        throw failure("UNSAFE_PATH", "原生 DBX 目录不能是符号链接");
      await chmod(path, 0o700);
    }
  }
  async token() {
    await this.#prepare();
    const path = join(this.#home, "secrets", "mcp-token");
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(randomBytes(32).toString("hex"));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    } finally {
      await handle?.close();
    }
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw failure("TOKEN_FILE", "原生 DBX 令牌文件无效");
    await chmod(path, 0o600);
    const value = (await readFile(path, "utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(value))
      throw failure("TOKEN_FILE", "原生 DBX 令牌格式无效");
    return value;
  }
  async #json(name) {
    try {
      return JSON.parse(await readFile(join(this.#home, name), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw failure(
        "STATE_INVALID",
        "原生 DBX 状态文件无效，请保留数据并检查运行目录",
      );
    }
  }
  async #write(name, value) {
    const temporary = join(this.#home, `.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(value), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, join(this.#home, name));
  }
  async #checked(installed) {
    if (
      !installed ||
      !valid(installed.version) ||
      !/^[a-f0-9]{64}$/.test(installed.sha256 ?? "") ||
      typeof installed.binary !== "string" ||
      relative(join(this.#home, "releases"), installed.binary).startsWith("..")
    )
      throw failure("STATE_INVALID", "原生 DBX 程序记录无效");
    const info = await lstat(installed.binary);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      canonical(installed.binary) !== installed.binary ||
      digest(await readFile(installed.binary)) !== installed.sha256
    )
      throw failure(
        "BINARY_CHANGED",
        "原生 DBX 程序校验失败，未启动或替换任何服务",
      );
    return installed;
  }
  async #identity(pid) {
    if (!Number.isInteger(pid) || pid < 2) return null;
    const result = await runCommand(
      "ps",
      ["-p", String(pid), "-o", "lstart=", "-o", "command="],
      { timeoutMs: 5000 },
    );
    return result.code === 0 && result.stdout.trim()
      ? result.stdout.trim()
      : null;
  }
  async #owned() {
    const record = await this.#json("process.json");
    if (!record) return null;
    if (
      record.home !== this.#home ||
      record.port !== this.#port ||
      !valid(record.version) ||
      typeof record.identity !== "string"
    )
      throw failure("PROCESS_CONFLICT", "原生 DBX 进程记录不属于此目录或端口");
    const identity = await this.#identity(record.pid);
    if (!identity) return null;
    if (identity !== record.identity)
      throw failure(
        "PROCESS_CONFLICT",
        "原生 DBX 进程身份已变化，未操作该进程",
      );
    return record;
  }
  async #health(version) {
    try {
      const authResponse = await this.#fetch(this.baseUrl + "/api/auth/check", {
        signal: AbortSignal.timeout(2000),
        redirect: "error",
      });
      if (!authResponse.ok) return false;
      const auth = await authResponse.json();
      if (
        !["authenticated", "required", "setup_required"].every(
          (k) => typeof auth[k] === "boolean",
        )
      )
        return false;
      const response = await this.#fetch(this.baseUrl + "/api/version", {
        signal: AbortSignal.timeout(2000),
        redirect: "error",
      });
      if ([401, 403].includes(response.status))
        return !auth.authenticated && (auth.required || auth.setup_required);
      if (!response.ok) return false;
      const body = await response.json();
      return body.version === version && body.demoMode !== true;
    } catch {
      return false;
    }
  }
  async status() {
    try {
      const record = await this.#owned();
      if (!record)
        return this.#result(
          (await this.#json("installed.json")) ? "stopped" : "absent",
        );
      return this.#result(
        (await this.#health(record.version)) ? "ready" : "starting",
        record.version,
      );
    } catch (error) {
      return this.#result("error", null, {
        code: error.code ?? "NATIVE_ERROR",
        message: error.message,
      });
    }
  }
  async #wait(record, progress) {
    progress({ stage: "health", message: "正在等待本机原生 DBX 服务就绪…" });
    const deadline = Date.now() + this.#timeout;
    do {
      if (!(await this.#owned()))
        throw failure(
          "START_FAILED",
          "原生 DBX 程序已退出，请检查运行目录中的 workbench.log",
        );
      if (await this.#health(record.version)) {
        if (process.platform === "darwin") {
          const listener = await runCommand(
            "/usr/sbin/lsof",
            [
              "-nP",
              "-a",
              "-p",
              String(record.pid),
              "-iTCP:" + this.#port,
              "-sTCP:LISTEN",
              "-Fn",
            ],
            { timeoutMs: 5000 },
          );
          const addresses = listener.stdout
            .split("\n")
            .filter((line) => line.startsWith("n"));
          if (
            listener.code !== 0 ||
            !addresses.length ||
            addresses.some((line) => line !== `n127.0.0.1:${this.#port}`)
          )
            throw failure(
              "BIND_UNSAFE",
              "原生 DBX 未能确认仅监听本机，未接受该服务",
            );
        }
        progress({
          stage: "compatibility",
          message: "正在检查原生界面与 Codex 的兼容性…",
        });
        try {
          await this.#verify({
            baseUrl: this.baseUrl,
            version: record.version,
            imageId: "sha256:" + record.sha256,
          });
        } catch {
          throw failure(
            "WEB_COMPATIBILITY",
            "原生 DBX 界面未通过兼容检查，未接受该版本",
          );
        }
        return;
      }
      await delay(200);
    } while (Date.now() < deadline);
    throw failure("HEALTH_FAILED", "原生 DBX 启动未通过健康检查");
  }
  async #available() {
    const server = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.#port, "127.0.0.1", resolve);
      });
    } catch {
      throw failure(
        "PORT_IN_USE",
        `本机端口 ${this.#port} 已被其他服务占用，未停止该服务`,
      );
    } finally {
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
    }
  }
  async #terminate(record) {
    const identity = await this.#identity(record.pid);
    if (!identity) return;
    if (identity !== record.identity)
      throw failure(
        "PROCESS_CONFLICT",
        "原生 DBX 进程身份发生变化，未停止该进程",
      );
    process.kill(record.pid, "SIGTERM");
    for (let i = 0; i < 75; i++) {
      const current = await this.#identity(record.pid);
      if (!current || current !== record.identity) return;
      await delay(200);
    }
    throw failure("STOP_FAILED", "原生 DBX 未能正常停止，未继续更新");
  }
  async #stop(record) {
    const current = await this.#owned();
    if (
      current &&
      (current.pid !== record.pid || current.identity !== record.identity)
    )
      throw failure(
        "PROCESS_CONFLICT",
        "原生 DBX 进程身份发生变化，未停止该进程",
      );
    await this.#terminate(record);
    const saved = await this.#json("process.json");
    if (saved?.pid === record.pid && saved?.identity === record.identity)
      await rm(join(this.#home, "process.json"), { force: true });
  }
  async #launch(installed, progress) {
    await this.#checked(installed);
    await this.#available();
    await this.token();
    progress({
      stage: "start",
      message: `正在启动原生 DBX v${installed.version}…`,
    });
    const log = await open(join(this.#home, "workbench.log"), "a", 0o600);
    const env = {
      ...process.env,
      DBX_BIND_ADDR: "127.0.0.1",
      DBX_PORT: String(this.#port),
      DBX_DATA_DIR: join(this.#home, "data"),
      DBX_WEB_MCP_TOKEN_FILE: join(this.#home, "secrets", "mcp-token"),
      DBX_WEB_MCP_ALLOWED_HOSTS: `127.0.0.1:${this.#port}`,
    };
    delete env.DBX_DISABLE_PASSWORD;
    delete env.DBX_STATIC_DIR;
    let child;
    try {
      child = spawn(installed.binary, [], {
        cwd: this.#home,
        env,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        windowsHide: true,
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } finally {
      await log.close();
    }
    child.unref();
    let identity;
    for (let i = 0; i < 20 && !identity; i++) {
      identity = await this.#identity(child.pid);
      if (!identity) await delay(20);
    }
    if (!identity) {
      let alive = true;
      try {
        process.kill(child.pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") alive = false;
      }
      throw failure(
        alive ? "STOP_FAILED" : "START_FAILED",
        alive
          ? "原生 DBX 进程身份无法确认，保留数据与备份，请检查 workbench.log"
          : "原生 DBX 未能启动",
      );
    }
    const record = {
      ...installed,
      pid: child.pid,
      identity,
      home: this.#home,
      port: this.#port,
    };
    try {
      await this.#write("process.json", record);
      await this.#wait(record, progress);
      await this.#write("installed.json", installed);
      return record;
    } catch (error) {
      try {
        // Stop the child by its captured identity even if writing process.json failed.
        await this.#terminate(record);
        const saved = await this.#json("process.json");
        if (saved?.pid === record.pid && saved?.identity === record.identity)
          await rm(join(this.#home, "process.json"), { force: true });
      } catch {
        throw failure(
          "STOP_FAILED",
          "原生 DBX 故障进程未能确认停止，保留现有数据与备份",
        );
      }
      throw error;
    }
  }
  async latest() {
    if (this.#binary) {
      const info = await lstat(this.#binary);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
        throw Error("指定原生程序必须是独立普通文件");
      const result = await runCommand(this.#binary, ["--version"], {
          timeoutMs: 5000,
        }),
        match = result.stdout.trim().match(/^dbx-web (\d+\.\d+\.\d+)$/);
      if (result.code !== 0 || !match || !valid(match[1]))
        throw Error("指定程序不是有效的 dbx-web");
      return { version: match[1], binary: this.#binary };
    }
    return nativeRelease({ fetchImpl: this.#fetch });
  }
  async #candidate(progress) {
    const release = await this.latest();
    if (!this.#binary) {
      const installed = await installNative(this.#home, release, {
        fetchImpl: this.#fetch,
        onProgress: progress,
      });
      const checked = await runCommand(installed.binary, ["--version"], {
        timeoutMs: 5000,
      });
      if (
        checked.code !== 0 ||
        checked.stdout.trim() !== `dbx-web ${release.version}`
      )
        throw failure("VERSION_MISMATCH", "原生 DBX 安装包中的程序版本不匹配");
      return installed;
    }
    const data = await readFile(this.#binary),
      sha256 = digest(data),
      directory = join(
        this.#home,
        "releases",
        release.version + "-" + sha256.slice(0, 16),
      );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const binary = join(directory, "dbx-web");
    try {
      await writeFile(binary, data, { mode: 0o700, flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const installed = await this.#checked({
      version: release.version,
      binary,
      sha256,
    });
    const result = await runCommand(binary, ["--version"], { timeoutMs: 5000 });
    if (
      result.code !== 0 ||
      result.stdout.trim() !== `dbx-web ${release.version}`
    )
      throw failure("VERSION_MISMATCH", "指定原生程序在准备期间发生版本变化");
    return installed;
  }
  async #locked(work) {
    await this.#prepare();
    const lock = join(this.#home, ".operation-lock");
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST")
        return this.#result("busy", null, {
          code: "BUSY",
          message: "原生 DBX 正在启动或更新，请等待当前操作完成",
        });
      throw error;
    }
    try {
      await this.#write(".operation-lock/owner.json", {
        pid: process.pid,
        startedAt: new Date().toISOString(),
      });
      return await work();
    } catch (error) {
      return this.#result("error", null, {
        code: error.code ?? "NATIVE_ERROR",
        message: error.message,
      });
    } finally {
      await rm(lock, { recursive: true });
    }
  }
  async ensure({ allowDownload = true, onProgress = () => {} } = {}) {
    const progress = (e) => {
      try {
        onProgress(e);
      } catch {}
    };
    return this.#locked(async () => {
      const record = await this.#owned();
      if (record) {
        await this.#checked(record);
        await this.#wait(record, progress);
        return this.#result("ready", record.version);
      }
      let installed = await this.#json("installed.json");
      if (!installed) {
        if (!allowDownload && !this.#binary)
          throw failure(
            "SETUP_REQUIRED",
            "原生 DBX 尚未安装，请先运行 npm run setup:dbx；侧栏不会下载程序",
          );
        installed = await this.#candidate(progress);
      }
      const current = await this.#launch(installed, progress);
      progress({
        stage: "ready",
        message: `原生 DBX v${current.version} 已准备就绪`,
      });
      return this.#result("ready", current.version);
    });
  }
  async update({ onProgress = () => {} } = {}) {
    const progress = (e) => {
      try {
        onProgress(e);
      } catch {}
    };
    return this.#locked(async () => {
      const candidate = await this.#candidate(progress),
        previous = await this.#json("installed.json"),
        record = await this.#owned();
      if (!previous) {
        const result = await this.#launch(candidate, progress);
        return this.#result("ready", result.version);
      }
      const compare = (a, b) => {
        const x = a.split(".").map(Number),
          y = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
        return 0;
      };
      if (compare(candidate.version, previous.version) <= 0) {
        await this.#checked(previous);
        if (record) await this.#wait(record, progress);
        else await this.#launch(previous, progress);
        return this.#result("ready", previous.version, {
          latestVersion: candidate.version,
        });
      }
      await this.#checked(previous);
      if (record) await this.#stop(record);
      const backupPath = join(
        this.#home,
        "backups",
        new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID(),
      );
      await mkdir(backupPath, { mode: 0o700 });
      try {
        await cp(join(this.#home, "data"), join(backupPath, "data"), {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      } catch (error) {
        if (record) await this.#launch(previous, progress).catch(() => {});
        throw error;
      }
      try {
        const next = await this.#launch(candidate, progress);
        return this.#result("ready", next.version, {
          latestVersion: candidate.version,
          backupPath,
        });
      } catch (error) {
        let rolledBack = false;
        if (error.code === "STOP_FAILED")
          return this.#result("error", null, {
            code: error.code,
            message: error.message,
            backupPath,
            rolledBack: false,
          });
        try {
          await rename(
            join(this.#home, "data"),
            join(backupPath, "failed-data"),
          );
          await cp(join(backupPath, "data"), join(this.#home, "data"), {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
          await this.#launch(previous, progress);
          rolledBack = true;
        } catch {}
        return this.#result("error", rolledBack ? previous.version : null, {
          code: error.code ?? "NATIVE_ERROR",
          message: rolledBack
            ? "原生 DBX 更新失败，已恢复原版本与数据"
            : "原生 DBX 更新失败，备份和故障数据已保留，请检查运行目录",
          backupPath,
          rolledBack,
          servicePhase: rolledBack ? "ready" : "error",
        });
      }
    });
  }
}

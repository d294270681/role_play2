/** 工程内安装器：下载清单、独立 Python、ComfyUI、CUDA 依赖与模型。 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { AI_ROOT, runtimePaths } from "./profiles.js";
import { verifiedDownload } from "./download.js";
import { shouldCopyComfy } from "../../../scripts/image-import-plan.mjs";

const manifest = JSON.parse(fs.readFileSync(path.join(AI_ROOT, "downloads.json"), "utf8"));

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(`${file}.tmp`, file);
}

export function ownedPath(root, target) {
  const boundary = path.resolve(root);
  const full = path.resolve(target), relative = path.relative(boundary, full);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("安装路径不在工程内受管目录中");
  if (fs.existsSync(boundary) && fs.lstatSync(boundary).isSymbolicLink()) throw new Error("安装根目录不能是链接");
  let cursor = full;
  while (cursor.toLowerCase() !== boundary.toLowerCase()) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error("安装路径包含链接，请使用工程内独立目录");
    cursor = path.dirname(cursor);
  }
  return full;
}

export function runCommand(command, args, { signal, cwd, env, onLine = () => {}, timeoutMs = 3600000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", failed = null;
    const append = (chunk) => {
      const line = String(chunk); output = (output + line).slice(-128 * 1024);
      try { onLine(line.trim().slice(-600)); } catch (e) { failed = e; child.kill(); }
    };
    child.stdout.on("data", append); child.stderr.on("data", append);
    child.once("error", (e) => { failed = e; });
    const abort = () => { failed = signal.reason || new Error("安装已取消"); child.kill(); };
    const timer = setTimeout(() => { failed = new Error("安装步骤超时，请检查网络或环境后重试"); child.kill(); }, timeoutMs);
    timer.unref?.(); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.once("close", (code) => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (failed) reject(failed);
      else if (code !== 0) reject(new Error(`安装步骤失败（${code}）：${output.trim().slice(-1800)}`));
      else resolve(output);
    });
  });
}

export class LocalImageInstaller {
  constructor({ paths = runtimePaths(), downloads = manifest, download = verifiedDownload, command = runCommand } = {}) {
    this.paths = paths; this.downloads = downloads; this.download = download; this.command = command;
  }

  pythonEnv(device = 0) {
    const temp = ownedPath(this.paths.root, path.join(this.paths.data, "temp"));
    fs.mkdirSync(temp, { recursive: true });
    return { ...process.env, PYTHONHOME: path.dirname(this.paths.python), PYTHONPATH: "", PYTHONNOUSERSITE: "1", PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1",
      CUDA_VISIBLE_DEVICES: String(device), TEMP: temp, TMP: temp, PIP_CACHE_DIR: path.join(this.paths.data, "cache", "pip"),
      PIP_CONFIG_FILE: "NUL", PIP_DISABLE_PIP_VERSION_CHECK: "1", PIP_NO_INPUT: "1" };
  }

  async check({ signal, device, onProgress }) {
    onProgress({ phase: "validating", message: "校验独立运行环境与 GPU（不加载图像模型）" });
    const version = fs.readFileSync(path.join(this.paths.comfy, "comfyui_version.py"), "utf8").match(/__version__\s*=\s*["']([^"']+)["']/)?.[1];
    if (version !== this.downloads.comfy.version) throw new Error(`ComfyUI 缓存版本与项目配方不一致，需要 ${this.downloads.comfy.version}`);
    const output = await this.command(this.paths.python, ["-s", this.paths.bootstrap, "--check"], {
      signal, env: this.pythonEnv(device), cwd: this.paths.comfy, timeoutMs: 180000,
    });
    const line = output.trim().split(/\r?\n/).reverse().find((v) => v.startsWith("{"));
    const check = JSON.parse(line || "{}");
    if (!check.cuda || !check.dependencies || check.python !== this.downloads.python.version || check.torch !== this.downloads.torch || check.torchvision !== this.downloads.torchvision) throw new Error("运行环境校验失败：CUDA 不可用或 Python/PyTorch 版本与当前配方不一致");
    return check;
  }

  async extract(archive, target, { signal }) {
    ownedPath(this.paths.root, archive); ownedPath(this.paths.root, target);
    await this.command("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(AI_ROOT, "extract.ps1"), "-Archive", archive, "-Target", target], { signal, timeoutMs: 180000 });
  }

  async prepareRuntime(context) {
    const { signal, onProgress, device } = context;
    let previous = {};
    try { previous = JSON.parse(fs.readFileSync(this.paths.install, "utf8")); } catch { /* 首次安装 */ }
    if (previous.completed && fs.existsSync(this.paths.python) && fs.existsSync(path.join(this.paths.comfy, "main.py"))) {
      try { return { previous, check: await this.check(context) }; }
      catch (e) { signal?.throwIfAborted(); onProgress({ phase: "runtime", message: "已有环境未通过校验，正在修复" }); }
    }
    writeJson(this.paths.install, { ...previous, completed: false, started_at: new Date().toISOString() });
    const stage = ownedPath(this.paths.data, path.join(this.paths.data, "setup", randomUUID()));
    fs.mkdirSync(stage, { recursive: true });
    try {
      for (const name of ["python", "comfy", "pip"]) {
        onProgress({ phase: "runtime", message: `下载 ${name === "comfy" ? "ComfyUI" : name} 安装包` });
        const archive = ownedPath(this.paths.root, path.join(this.paths.data, "downloads", `${name}.zip`));
        await this.download(this.downloads[name], archive, { signal, onProgress: (download) => onProgress({ phase: "runtime", download }) });
        await this.extract(archive, path.join(stage, name), context);
      }
      onProgress({ phase: "runtime", download: null, message: "配置工程内 Python 与 ComfyUI" });
      const pythonRoot = ownedPath(this.paths.root, path.dirname(this.paths.python));
      fs.mkdirSync(pythonRoot, { recursive: true });
      fs.cpSync(path.join(stage, "python"), pythonRoot, { recursive: true });
      const packages = ownedPath(this.paths.root, path.join(pythonRoot, "Lib", "site-packages"));
      fs.mkdirSync(packages, { recursive: true });
      fs.cpSync(path.join(stage, "pip"), packages, { recursive: true });
      fs.writeFileSync(path.join(pythonRoot, "python310._pth"), "python310.zip\n.\nLib/site-packages\nimport site\n", "utf8");
      const sourceEntries = fs.readdirSync(path.join(stage, "comfy"), { withFileTypes: true }).filter((e) => e.isDirectory());
      if (sourceEntries.length !== 1) throw new Error("ComfyUI 源码压缩包结构不正确");
      const sourceRoot = path.join(stage, "comfy", sourceEntries[0].name);
      ownedPath(this.paths.root, this.paths.comfy);
      fs.cpSync(sourceRoot, this.paths.comfy, { recursive: true, filter: (src) => shouldCopyComfy(sourceRoot, src) });
      const env = this.pythonEnv(device);
      const pip = ["-s", "-m", "pip", "--isolated", "--cache-dir", path.join(this.paths.data, "cache", "pip"), "install", "--prefix", pythonRoot, "--disable-pip-version-check", "--no-warn-script-location", "--only-binary=:all:"];
      onProgress({ phase: "dependencies", message: "安装 CUDA 12.8 与 PyTorch；首次下载可能需要较长时间", download: null });
      await this.command(this.paths.python, [...pip, `torch==${this.downloads.torch}`, `torchvision==${this.downloads.torchvision}`, "--index-url", this.downloads.torch_index], {
        signal, cwd: pythonRoot, env, onLine: (line) => onProgress({ detail: line }),
      });
      onProgress({ phase: "dependencies", message: "安装 ComfyUI 依赖" });
      await this.command(this.paths.python, [...pip, "-r", path.join(AI_ROOT, "requirements.install.txt"), "--index-url", "https://pypi.org/simple"], {
        signal, cwd: pythonRoot, env, onLine: (line) => onProgress({ detail: line }),
      });
      signal?.throwIfAborted();
      return { previous, check: await this.check(context) };
    } finally {
      fs.rmSync(ownedPath(path.join(this.paths.data, "setup"), stage), { recursive: true, force: true });
    }
  }

  async install(profile, { signal, onProgress = () => {}, device = 0 } = {}) {
    ownedPath(this.paths.root, this.paths.install);
    const context = { signal, onProgress, device };
    const { previous, check } = await this.prepareRuntime(context);
    const base = { ...previous, version: 2, completed: true, python: check.python, torch: check.torch, cuda: check.cuda, device: check.device, comfy_version: this.downloads.comfy.version };
    writeJson(this.paths.install, base);
    const models = [...(previous.models || [])];
    for (const model of Object.values(profile.models).filter((m) => !m.optional)) {
      signal?.throwIfAborted();
      onProgress({ phase: "models", message: `检查并下载 ${model.file}`, download: null, detail: "" });
      const dest = ownedPath(this.paths.root, path.join(this.paths.models, model.directory, model.file));
      // 同一 Comfy-Org 发布者的 ModelScope 仓库可在本机网络直接访问。
      // 两个源共享固定大小与 SHA256，不接受页面传入下载地址。
      const urls = model.url.startsWith("https://huggingface.co/Comfy-Org/")
        ? [model.url.replace("https://huggingface.co/", "https://modelscope.cn/models/").replace("/resolve/main/", "/resolve/master/"), model.url]
        : [model.url];
      await this.download({ ...model, urls }, dest, { signal, onProgress: (download) => onProgress({ phase: "models", download }) });
      const relative = path.relative(this.paths.models, dest).replaceAll("\\", "/");
      const receipt = { path: relative, bytes: model.bytes, sha256: model.sha256 };
      const at = models.findIndex((m) => m.path === relative);
      if (at >= 0) models[at] = receipt; else models.push(receipt);
    }
    signal?.throwIfAborted();
    writeJson(this.paths.install, { ...base, models, completed_at: new Date().toISOString() });
    return { profile: profile.id, runtime: { python: check.python, torch: check.torch, device: check.device }, models: models.filter((m) => Object.values(profile.models).some((s) => `${s.directory}/${s.file}` === m.path)) };
  }
}

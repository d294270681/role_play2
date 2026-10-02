/** 项目内出图服务生命周期。只管理自己创建的进程，不关闭外部 ComfyUI。 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { imageSettings, listProfiles, runtimePaths } from "./profiles.js";

export class ImageRuntimeError extends Error {
  constructor(message) { super(message); this.name = "ImageRuntimeError"; this.status = 503; }
}

export class ImageRuntime {
  constructor({ paths = runtimePaths(), spawnProcess = spawn, fetcher = (...args) => fetch(...args), wait = sleep } = {}) {
    this.paths = paths;
    this.spawnProcess = spawnProcess;
    this.fetcher = fetcher;
    this.wait = wait;
    this.child = null;
    this.starting = null;
    this.port = null;
    this.error = "";
    this.stopping = false;
    this.stoppingTask = null;
    this.startedAt = null;
    this.lifecycle = 0;
  }

  installed() {
    try {
      return JSON.parse(fs.readFileSync(this.paths.install, "utf8")).completed === true
        && fs.existsSync(this.paths.python) && fs.existsSync(this.paths.bootstrap)
        && fs.existsSync(path.join(this.paths.comfy, "main.py"));
    } catch { return false; }
  }

  url(config) {
    const settings = imageSettings(config.image_generation);
    return settings.mode === "internal" ? `http://127.0.0.1:${settings.port}` : String(config.comfy_url || "").replace(/\/+$/, "");
  }

  async probe(url) {
    try {
      const res = await this.fetcher(`${url}/system_stats`, { signal: AbortSignal.timeout(2000) });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }

  belongsToProject(stats) {
    const args = stats?.system?.argv || [];
    const at = args.indexOf("--models-directory");
    return at >= 0 && typeof args[at + 1] === "string"
      && path.resolve(args[at + 1]).toLowerCase() === path.resolve(this.paths.models).toLowerCase();
  }

  async status(config) {
    const settings = imageSettings(config.image_generation);
    const profiles = listProfiles(this.paths.root);
    const selected = profiles.find((p) => p.id === settings.profile);
    const url = this.url(config);
    // 未配置时连端口探测也不执行，更不导入 torch 或启动 Python。
    const stats = settings.enabled ? await this.probe(url) : null;
    const ours = this.belongsToProject(stats);
    const online = Boolean(stats && (settings.mode === "external" || ours));
    const installed = this.installed();
    return {
      enabled: settings.enabled, configured_at: settings.configured_at,
      mode: settings.mode, url, online, installed,
      available: settings.enabled && (settings.mode === "external" ? online : installed && Boolean(selected?.available)),
      ready: online && (settings.mode === "external" || (installed && selected?.available)),
      state: !settings.enabled ? "disabled" : online ? "running" : this.starting ? "starting" : this.error ? "error" : "stopped",
      managed: Boolean(this.child), pid: this.child?.pid ?? null,
      profile: settings.profile, profiles,
      error: settings.enabled ? this.error || (stats && settings.mode === "internal" && !ours ? `端口 ${settings.port} 上运行的是另一个 ComfyUI` : "") : "",
      log: "ai/data/logs/comfyui.log", started_at: this.startedAt,
    };
  }

  async ensureReady(config) {
    const lifecycle = this.lifecycle;
    const settings = imageSettings(config.image_generation);
    if (!settings.enabled) throw new ImageRuntimeError("图片生成尚未配置，请在网页设置中选择模型并检测配置");
    const url = this.url(config);
    if (settings.mode === "external") {
      const online = await this.probe(url);
      if (lifecycle !== this.lifecycle) throw new ImageRuntimeError("本次出图启动已取消");
      if (!online) throw new ImageRuntimeError(`外部 ComfyUI 不可达：${url}`);
      return url;
    }
    if (!this.installed()) throw new ImageRuntimeError("项目内出图环境未安装完整，请在网页设置中重新检测配置");
    const profile = listProfiles(this.paths.root).find((p) => p.id === settings.profile);
    if (!profile?.available) throw new ImageRuntimeError(`模型组件未齐全：${profile?.models.filter((m) => !m.installed).map((m) => m.file).join("、") || settings.profile}`);
    if (this.child && this.port !== settings.port) throw new ImageRuntimeError(`项目内服务正在使用 ${this.port} 端口，请先停止后再修改端口`);
    if (this.starting) return this.starting;
    const existing = await this.probe(url);
    if (lifecycle !== this.lifecycle) throw new ImageRuntimeError("本次出图启动已取消");
    if (existing) {
      if (!this.belongsToProject(existing)) throw new ImageRuntimeError(`端口 ${settings.port} 已被其他 ComfyUI 使用，请更换内部端口或选择外部连接模式`);
      return url;
    }
    // 探测之后再抢单次启动任务，避免两个并发请求同时创建进程。
    if (this.starting) return this.starting;
    this.starting = this.start(settings, url, lifecycle).finally(() => { this.starting = null; });
    return this.starting;
  }

  async start(settings, url, lifecycle = this.lifecycle) {
    if (lifecycle !== this.lifecycle) throw new ImageRuntimeError("本次出图启动已取消");
    this.error = "";
    this.stopping = false;
    this.port = settings.port;
    for (const name of ["logs", "input", "output", "temp", "user", "cache"]) fs.mkdirSync(path.join(this.paths.data, name), { recursive: true });
    const args = ["-s", this.paths.bootstrap, "--listen", "127.0.0.1", "--port", String(settings.port),
      "--base-directory", this.paths.data, "--models-directory", this.paths.models,
      "--user-directory", path.join(this.paths.data, "user"), "--input-directory", path.join(this.paths.data, "input"),
      "--output-directory", path.join(this.paths.data, "output"), "--temp-directory", path.join(this.paths.data, "temp"),
      "--disable-auto-launch", "--disable-all-custom-nodes", "--disable-api-nodes", "--preview-method", "none", "--reserve-vram", "2"];
    const pythonRoot = path.dirname(this.paths.python);
    const child = this.spawnProcess(this.paths.python, args, {
      cwd: this.paths.comfy, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CUDA_VISIBLE_DEVICES: String(settings.device), PYTHONHOME: pythonRoot, PYTHONPATH: "", PYTHONNOUSERSITE: "1", PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", TEMP: path.join(this.paths.data, "temp"), TMP: path.join(this.paths.data, "temp"), TORCH_HOME: path.join(this.paths.data, "cache", "torch"), TORCHINDUCTOR_CACHE_DIR: path.join(this.paths.data, "cache", "inductor"), TRITON_CACHE_DIR: path.join(this.paths.data, "cache", "triton"), HF_HOME: path.join(this.paths.data, "cache", "huggingface"), HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
    });
    this.child = child;
    this.startedAt = new Date().toISOString();
    let tail = "";
    const write = (chunk) => {
      const text = String(chunk);
      tail = (tail + text).slice(-2000);
      try { fs.appendFileSync(this.paths.log, text); } catch { /* 日志失败不能终止 GPU 工作 */ }
    };
    try {
      if (fs.existsSync(this.paths.log) && fs.statSync(this.paths.log).size > 10 * 1024 * 1024) fs.renameSync(this.paths.log, `${this.paths.log}.1`);
      fs.appendFileSync(this.paths.log, `\n[${this.startedAt}] 项目启动 ComfyUI pid=${child.pid}\n`);
    } catch { /* 继续运行 */ }
    child.stdout?.on("data", write);
    child.stderr?.on("data", write);
    child.once("error", (e) => { this.error = `无法启动项目内 ComfyUI：${e.message}`; });
    child.once("exit", (code) => {
      if (!this.stopping && !this.error) this.error = `ComfyUI 已退出（${code}）：${tail.trim().slice(-800)}`;
      if (this.child === child) this.child = null;
    });
    const deadline = Date.now() + settings.startup_timeout * 1000;
    while (Date.now() < deadline) {
      if (this.stopping) throw new ImageRuntimeError("项目内出图启动已停止");
      if (this.error || child.exitCode !== null || child.signalCode) throw new ImageRuntimeError(this.error || "ComfyUI 启动时退出");
      const stats = await this.probe(url);
      if (this.stopping) throw new ImageRuntimeError("项目内出图启动已停止");
      if (this.belongsToProject(stats)) return url;
      await this.wait(500);
    }
    this.error = `项目内 ComfyUI 启动超时，请检查 ${this.paths.log}`;
    await this.stop();
    throw new ImageRuntimeError(this.error);
  }

  async stop() {
    this.lifecycle += 1;
    if (this.stoppingTask) return this.stoppingTask;
    this.stopping = true;
    const child = this.child;
    if (!child) return false;
    this.stoppingTask = (async () => {
      await new Promise((resolve) => {
        if (!child.pid || child.exitCode !== null || child.signalCode) { resolve(); return; }
        child.once("exit", resolve);
        if (!child.kill()) resolve();
      });
      if (this.child === child) this.child = null;
      return true;
    })().finally(() => { this.stoppingTask = null; });
    return this.stoppingTask;
  }
}

export const imageRuntime = new ImageRuntime();

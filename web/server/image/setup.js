/** 配置任务协调器：明确选择后检测 → 安装 → 启用；进度独立于游戏回合。 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { getProfile, runtimePaths } from "./profiles.js";
import { detectEnvironment } from "./hardware.js";
import { LocalImageInstaller, ownedPath, writeJson } from "./install.js";
import { imageRuntime } from "./runtime.js";
import * as configMod from "../config.js";

const ACTIVE = new Set(["checking", "installing"]);
const idleState = () => ({ status: "idle", active: false, phase: "", message: "尚未配置本地生图", environment: null, download: null, error: "" });

export class ImageSetup {
  constructor({ paths = runtimePaths(), detector = (id, options) => detectEnvironment(id, { paths, ...options }), installer = new LocalImageInstaller({ paths }),
    runtime = imageRuntime, loadConfig = configMod.loadConfig, updateConfig = configMod.updateConfig } = {}) {
    this.paths = paths; this.detector = detector; this.installer = installer; this.runtime = runtime;
    this.loadConfig = loadConfig; this.updateConfig = updateConfig;
    this.state = null; this.task = null; this.controller = null; this.lastWrite = 0; this.disabling = false;
  }

  status() {
    if (!this.state) {
      try {
        this.state = JSON.parse(fs.readFileSync(this.paths.setup, "utf8"));
        if (ACTIVE.has(this.state.status)) this.state = { ...this.state, status: "interrupted", active: false, error: "上次安装随服务退出而中断，点击检测并配置可续传", message: "安装已中断" };
      } catch { this.state = idleState(); }
    }
    return structuredClone(this.state);
  }

  change(patch, immediate = true) {
    this.state = { ...this.state, ...patch, updated_at: new Date().toISOString() };
    if (immediate || Date.now() - this.lastWrite > 500) {
      writeJson(ownedPath(this.paths.root, this.paths.setup), this.state); this.lastWrite = Date.now();
    }
  }

  start(profileId) {
    const profile = getProfile(profileId);
    if (this.disabling) throw Object.assign(new Error("正在关闭图片生成，请稍后再配置"), { status: 409 });
    if (this.task) {
      if (this.state.profile === profile.id) return this.status();
      throw Object.assign(new Error("已有安装任务正在进行，请先取消再选择其他模型"), { status: 409 });
    }
    this.controller = new AbortController();
    this.change({ ...idleState(), id: randomUUID(), profile: profile.id, status: "checking", active: true, phase: "hardware", message: "检查 GPU、内存、CPU 与磁盘", started_at: new Date().toISOString() });
    const signal = this.controller.signal;
    // 先占用任务，再开始任何检测回调；同一事件循环内也不能重入安装。
    this.task = Promise.resolve().then(() => this.run(profile, signal)).finally(() => { this.task = null; this.controller = null; });
    return this.status();
  }

  async run(profile, signal) {
    let preparing = false;
    try {
      signal.throwIfAborted();
      const environment = await this.detector(profile.id, { signal });
      signal.throwIfAborted();
      this.change({ environment });
      if (!environment.eligible) {
        this.change({ status: "unsupported", active: false, message: "环境未满足当前模型的安装门槛", finished_at: new Date().toISOString() });
        return;
      }
      this.updateConfig({ image_generation: { enabled: false } });
      preparing = true;
      await this.runtime.stop();
      const cfg = this.loadConfig();
      const stats = await this.runtime.probe(`http://127.0.0.1:${cfg.image_generation.port}`);
      if (this.runtime.belongsToProject(stats)) throw new Error("有手动启动的项目 ComfyUI 正在运行，请关闭它后重新配置");
      signal.throwIfAborted();
      this.change({ status: "installing", phase: "runtime", message: "准备本地生图环境" });
      const installed = await this.installer.install(profile, { signal, device: environment.device,
        onProgress: (patch) => { signal.throwIfAborted(); this.change(patch, Boolean(patch.message)); },
      });
      signal.throwIfAborted();
      const configured_at = new Date().toISOString();
      this.updateConfig({ image_generation: { enabled: true, configured_at, mode: "internal", profile: profile.id, device: environment.device } });
      this.change({ status: "ready", active: false, phase: "complete", message: "配置完成，生成图片时按需加载模型", installed, download: null, detail: "", finished_at: configured_at });
    } catch (e) {
      if (preparing) { try { this.updateConfig({ image_generation: { enabled: false } }); } catch { /* 保留原始错误 */ } }
      const patch = { status: signal.aborted ? "cancelled" : "failed", active: false, error: signal.aborted ? "" : e.message, message: signal.aborted ? "安装已取消，可重新配置并续传" : "配置失败，可重试", finished_at: new Date().toISOString() };
      try { this.change(patch); } catch { this.state = { ...this.state, ...patch }; }
    }
  }

  async cancel() {
    if (this.task) { this.controller.abort(new Error("用户取消了安装")); await this.task; }
    return this.status();
  }

  async disable() {
    this.disabling = true;
    try {
      await this.cancel();
      const cfg = this.updateConfig({ image_generation: { enabled: false } });
      await this.runtime.stop();
      this.change({ status: "disabled", active: false, message: "图片生成已关闭，文件保留供下次配置", download: null, detail: "", error: "" });
      return cfg;
    } finally { this.disabling = false; }
  }
}

export const imageSetup = new ImageSetup();

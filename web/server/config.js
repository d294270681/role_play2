/**
 * 配置读写：web/config.json（不存在时自动生成模板），api_key 只以掩码形式对外。
 *
 * 字段：
 *   base_url   OpenAI 兼容接口地址（默认 https://api.openai.com/v1）
 *   api_key    为空时 /api/turn 走回声调试模式
 *   model      模型名
 *   temperature 0–2
 *   comfy_url  本机 ComfyUI 地址（默认 http://127.0.0.1:8188）
 * 可选扩展键：stream（默认 true）、timeout（秒，默认 180）。
 *
 * 写盘与 web/engine/gm.py（M2）一致：先写 .tmp 再原子改名，JSON 为 ensure_ascii=False 风格（UTF-8 原样）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const WEB_DIR = path.resolve(__dirname, "..");
export const CONFIG_PATH = path.join(WEB_DIR, "config.json");

export const DEFAULT_CONFIG = {
  base_url: "https://api.openai.com/v1",
  api_key: "",
  model: "gpt-4o-mini",
  temperature: 0.8,
  comfy_url: "http://127.0.0.1:8188",
  stream: true,
  timeout: 180,
};

/** 模板里只写任务约定的五个键（stream / timeout 走默认值，不落盘）。 */
export function templateConfig() {
  return {
    base_url: DEFAULT_CONFIG.base_url,
    api_key: DEFAULT_CONFIG.api_key,
    model: DEFAULT_CONFIG.model,
    temperature: DEFAULT_CONFIG.temperature,
    comfy_url: DEFAULT_CONFIG.comfy_url,
  };
}

export function defaultConfig() {
  return { ...DEFAULT_CONFIG };
}

function toInt(v, dflt = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function toFloat(v, dflt = 0, lo = null, hi = null) {
  let out = Number.parseFloat(v);
  if (!Number.isFinite(out)) out = dflt;
  if (lo !== null) out = Math.max(lo, out);
  if (hi !== null) out = Math.min(hi, out);
  return out;
}

/** 补齐默认值、修剪字符串、钳制温度与超时。 */
export function normalizeConfig(config) {
  const cfg = defaultConfig();
  if (config && typeof config === "object" && !Array.isArray(config)) {
    for (const [k, v] of Object.entries(config)) {
      if (v !== null && v !== undefined) cfg[k] = v;
    }
  }
  cfg.base_url = String(cfg.base_url || DEFAULT_CONFIG.base_url).trim().replace(/\/+$/, "");
  cfg.api_key = String(cfg.api_key || "").trim();
  cfg.model = String(cfg.model || DEFAULT_CONFIG.model).trim();
  cfg.temperature = toFloat(cfg.temperature, DEFAULT_CONFIG.temperature, 0, 2);
  cfg.comfy_url = String(cfg.comfy_url || DEFAULT_CONFIG.comfy_url).trim().replace(/\/+$/, "");
  cfg.stream = cfg.stream !== false;
  cfg.timeout = Math.max(5, toInt(cfg.timeout, DEFAULT_CONFIG.timeout));
  return cfg;
}

function writeFile(p, cfg) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, p);
}

/** 读配置；文件不存在时按模板生成一份（写盘失败只警告，不阻塞启动）。 */
export function loadConfig(configPath = null) {
  const p = configPath ? path.resolve(String(configPath)) : CONFIG_PATH;
  if (fs.existsSync(p)) {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      raw = {};
    }
    return normalizeConfig(raw);
  }
  const cfg = defaultConfig();
  try {
    writeFile(p, templateConfig());
  } catch (e) {
    console.warn(`[rpg] 无法写入配置模板 ${p}：${e?.message ?? e}`);
  }
  return cfg;
}

export function saveConfig(config, configPath = null) {
  const p = configPath ? path.resolve(String(configPath)) : CONFIG_PATH;
  const cfg = normalizeConfig(config);
  writeFile(p, cfg);
  return p;
}

/** 合并白名单字段后落盘（api_key 传空串表示清除），返回规范化后的新配置。 */
export function updateConfig(patch, configPath = null) {
  const cfg = loadConfig(configPath);
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    for (const key of ["base_url", "api_key", "model", "temperature", "comfy_url", "stream", "timeout"]) {
      if (key in patch && patch[key] !== null && patch[key] !== undefined) cfg[key] = patch[key];
    }
  }
  saveConfig(cfg, configPath);
  return normalizeConfig(cfg);
}

/** 给前端的掩码视图：只暴露 has_key 与尾 4 位，绝不回传完整 api_key。 */
export function maskedConfig(config) {
  const cfg = normalizeConfig(config);
  const key = cfg.api_key || "";
  return {
    base_url: cfg.base_url,
    model: cfg.model,
    temperature: cfg.temperature,
    stream: cfg.stream,
    timeout: cfg.timeout,
    comfy_url: cfg.comfy_url,
    has_key: Boolean(key),
    api_key_tail: key.length >= 4 ? key.slice(-4) : (key ? "***" : ""),
    echo: !key,
  };
}

export function configHasKey(config = null) {
  const cfg = config && typeof config === "object" ? config : loadConfig();
  return Boolean(String(cfg.api_key || "").trim());
}

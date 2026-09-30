/**
 * 配置读写：web/config.json（不存在时自动生成模板），api_key 只以掩码形式对外。
 *
 * 字段：
 *   base_url   OpenAI 兼容接口地址（默认 https://api.openai.com/v1）
 *   api_key    为空时看 kimi_oauth：启用 OAuth 就走 Kimi 凭证，两者都没有才走回声调试模式
 *   model      模型名
 *   temperature 0–2
 *   comfy_url  本机 ComfyUI 地址（默认 http://127.0.0.1:8188）
 * 可选扩展键：stream（默认 true）、timeout（秒，默认 180）、
 *   kimi_oauth {enabled?, credentials_path?, token_url?, client_id?}（缺省值见 auth.js）。
 *
 * 想直接复用本机 Kimi Code 的 OAuth 凭证（不用手抄 api_key）时，web/config.json 这样写：
 *   {
 *     "base_url": "https://api.kimi.com/coding/v1",
 *     "api_key": "",
 *     "model": "k3",
 *     "temperature": 1,
 *     "kimi_oauth": { "credentials_path": "C:/Users/DMH/.kimi-code/credentials/kimi-code.json" }
 *   }
 * 注意 k3 只接受 temperature=1（写别的值模型接口会 400 报 invalid temperature）。
 * 省略 kimi_oauth 时也会自动检测默认凭证文件是否存在；写 { "enabled": false } 可强制关掉。
 * GET /api/config 的掩码视图只给 auth_mode / has_key / echo，绝不包含任何 token。
 *
 * 写盘与 web/engine/gm.py（M2）一致：先写 .tmp 再原子改名，JSON 为 ensure_ascii=False 风格（UTF-8 原样）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as authMod from "./auth.js";

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

/** 补齐默认值、修剪字符串、钳制温度与超时；kimi_oauth 规范化为 auth.js 的三字段结构。 */
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
  if ("kimi_oauth" in cfg) {
    const oauth = authMod.normalizeOAuthSettings(cfg.kimi_oauth);
    if (oauth) cfg.kimi_oauth = oauth;
    else delete cfg.kimi_oauth; // 写成 null / 字符串等无效值 → 退回「自动检测」
  }
  return cfg;
}

/**
 * Kimi OAuth 是否启用：配置里显式写了 kimi_oauth 就听它的（enabled:false 可关），
 * 没写则自动检测默认凭证文件在不在。
 */
export function oauthActive(config = null) {
  const cfg = config && typeof config === "object" ? normalizeConfig(config) : loadConfig();
  const oauth = cfg.kimi_oauth;
  if (oauth) return oauth.enabled !== false;
  return authMod.credentialsExist(null);
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

/**
 * 合并白名单字段后落盘（api_key 传空串表示清除；kimi_oauth 传 false 表示强制关掉 OAuth），
 * 返回规范化后的新配置。
 */
export function updateConfig(patch, configPath = null) {
  const cfg = loadConfig(configPath);
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    for (const key of ["base_url", "api_key", "model", "temperature", "comfy_url", "stream", "timeout", "kimi_oauth"]) {
      if (key in patch && patch[key] !== null && patch[key] !== undefined) cfg[key] = patch[key];
    }
  }
  saveConfig(cfg, configPath);
  return normalizeConfig(cfg);
}

/** 给前端的掩码视图：只暴露 has_key 与尾 4 位，绝不回传完整 api_key；OAuth 模式同样不回显任何 token。 */
export function maskedConfig(config) {
  const cfg = normalizeConfig(config);
  const key = cfg.api_key || "";
  const oauth = oauthActive(cfg);
  return {
    base_url: cfg.base_url,
    model: cfg.model,
    temperature: cfg.temperature,
    stream: cfg.stream,
    timeout: cfg.timeout,
    comfy_url: cfg.comfy_url,
    has_key: Boolean(key) || oauth,
    api_key_tail: key.length >= 4 ? key.slice(-4) : (key ? "***" : ""),
    echo: !key && !oauth,
    auth_mode: key ? "api-key" : (oauth ? "kimi-oauth" : "echo"),
  };
}

export function configHasKey(config = null) {
  const cfg = config && typeof config === "object" ? config : loadConfig();
  if (String(cfg.api_key || "").trim()) return true;
  return oauthActive(cfg);
}

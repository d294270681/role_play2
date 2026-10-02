/**
 * 配置读写：web/config.json（不存在时自动生成模板），api_key 只以掩码形式对外。
 *
 * 字段：
 *   llm_mode   api / kimi-oauth / demo；默认 api（未配置时演示）
 *   base_url   用户选择的 OpenAI 兼容接口地址；默认留空
 *   api_key    API 密钥，可选；无认证的本地兼容服务也可使用
 *   model      模型名
 *   temperature 0–2
 *   comfy_url  本机 ComfyUI 地址（默认 http://127.0.0.1:8188）
 * 可选扩展键：stream（默认 true）、timeout（秒，默认 180）、
 *   kimi_oauth {enabled?, credentials_path?, token_url?, client_id?}（缺省值见 auth.js）。
 *
 * Kimi 登录使用 llm_mode: "kimi-oauth"，凭证默认从当前用户目录读取。
 * 该专用模式维持既有 Kimi Code 接口与 temperature=1。
 * Kimi 登录必须明确选择，不因本机存在凭证而自动启用。
 * GET /api/config 的掩码视图只给 auth_mode / has_key / echo，绝不包含任何 token。
 *
 * 写盘与 web/engine/gm.py（M2）一致：先写 .tmp 再原子改名，JSON 为 ensure_ascii=False 风格（UTF-8 原样）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as authMod from "./auth.js";
import { imageSettings } from "./image/profiles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const WEB_DIR = path.resolve(__dirname, "..");
export const CONFIG_PATH = path.join(WEB_DIR, "config.json");
export const LLM_MODES = ["api", "kimi-oauth", "demo"];

export function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}

function validBaseUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export const DEFAULT_CONFIG = {
  llm_mode: "api",
  api_auth: "bearer",
  base_url: "",
  api_key: "",
  model: "",
  kimi_oauth: { enabled: false },
  temperature: 0.8,
  comfy_url: "http://127.0.0.1:8188",
  image_generation: imageSettings(),
  stream: true,
  timeout: 180,
};

/** 图片功能默认关闭；网页检测配置成功后才显式启用。 */
export function templateConfig() {
  return defaultConfig();
}

export function defaultConfig() {
  return { ...DEFAULT_CONFIG, kimi_oauth: { enabled: false }, image_generation: imageSettings() };
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
  const raw = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const cfg = defaultConfig();
  if (config && typeof config === "object" && !Array.isArray(config)) {
    for (const [k, v] of Object.entries(config)) {
      if (v !== null && v !== undefined) cfg[k] = v;
    }
  }
  // 保留旧文件明确启用的 Kimi 配置；不存在显式选择时不扫描本机登录。
  const legacyOAuth = authMod.normalizeOAuthSettings(raw.kimi_oauth);
  cfg.llm_mode = LLM_MODES.includes(raw.llm_mode) ? raw.llm_mode
    : legacyOAuth?.enabled && !String(raw.api_key || "").trim() && normalizeBaseUrl(raw.base_url) === authMod.KIMI_CHAT_BASE_URL ? "kimi-oauth" : "api";
  cfg.base_url = normalizeBaseUrl(cfg.base_url);
  cfg.api_auth = raw.api_auth === "none" ? "none" : "bearer";
  cfg.api_key = String(cfg.api_key || "").trim();
  cfg.model = String(cfg.model || "").trim();
  cfg.temperature = toFloat(cfg.temperature, DEFAULT_CONFIG.temperature, 0, 2);
  cfg.comfy_url = String(cfg.comfy_url || DEFAULT_CONFIG.comfy_url).trim().replace(/\/+$/, "");
  cfg.image_generation = imageSettings(cfg.image_generation);
  if (cfg.image_generation.mode === "internal") cfg.comfy_url = `http://127.0.0.1:${cfg.image_generation.port}`;
  cfg.stream = cfg.stream !== false;
  cfg.timeout = Math.max(5, toInt(cfg.timeout, DEFAULT_CONFIG.timeout));
  cfg.kimi_oauth = authMod.normalizeOAuthSettings(cfg.kimi_oauth) || authMod.normalizeOAuthSettings({ enabled: false });
  cfg.kimi_oauth.enabled = cfg.llm_mode === "kimi-oauth";
  if (cfg.llm_mode === "kimi-oauth") {
    cfg.base_url = authMod.KIMI_CHAT_BASE_URL;
    cfg.model ||= authMod.KIMI_MODEL;
    cfg.temperature = 1;
  }
  return cfg;
}

/**
 * 仅明确选择 Kimi 登录时启用，且登录 token 只发往 Kimi 固定接口。
 */
export function oauthActive(config = null) {
  const cfg = config && typeof config === "object" ? normalizeConfig(config) : loadConfig();
  return cfg.llm_mode === "kimi-oauth";
}

export function modelConfigured(config) {
  const cfg = normalizeConfig(config);
  if (cfg.llm_mode === "demo") return false;
  if (cfg.llm_mode === "kimi-oauth") return authMod.credentialsExist(cfg);
  return validBaseUrl(cfg.base_url) && Boolean(cfg.model) && (cfg.api_auth === "none" || Boolean(cfg.api_key));
}

/** 保存和测试共用相同的合并规则；测试不会写盘。 */
export function mergeConfigPatch(config, patch) {
  const previous = normalizeConfig(config);
  const cfg = structuredClone(previous);
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    if ("llm_mode" in patch && !LLM_MODES.includes(patch.llm_mode)) throw Object.assign(new Error("请选择通用 API、Kimi 登录或演示模式"), { status: 400 });
    if ("api_auth" in patch && !["bearer", "none"].includes(patch.api_auth)) throw Object.assign(new Error("API 认证方式必须是 bearer 或 none"), { status: 400 });
    for (const key of ["llm_mode", "api_auth", "base_url", "api_key", "model", "temperature", "comfy_url", "image_generation", "stream", "timeout", "kimi_oauth"]) {
      if (patch[key] !== null && patch[key] !== undefined) cfg[key] = key === "image_generation" ? imageSettings({ ...cfg.image_generation, ...patch[key] }) : patch[key];
    }
    const changed = cfg.llm_mode !== previous.llm_mode || cfg.api_auth !== previous.api_auth || normalizeBaseUrl(cfg.base_url) !== previous.base_url;
    if (changed && !("api_key" in patch)) cfg.api_key = "";
    if (cfg.llm_mode === "kimi-oauth" && cfg.llm_mode !== previous.llm_mode && !("model" in patch)) cfg.model = authMod.KIMI_MODEL;
  }
  const next = normalizeConfig(cfg);
  const llmChanged = ["llm_mode", "api_auth", "base_url", "api_key", "model", "kimi_oauth"].some((key) => patch && Object.hasOwn(patch, key));
  if (llmChanged && next.llm_mode === "api" && next.base_url && !validBaseUrl(next.base_url)) throw Object.assign(new Error("API 地址必须是 http/https 基础地址，不含账号密码、查询参数或片段"), { status: 400 });
  if (llmChanged && next.llm_mode === "api" && (next.base_url || next.model || next.api_key) && (!next.base_url || !next.model)) throw Object.assign(new Error("请同时填写 API 地址和模型 ID"), { status: 400 });
  return next;
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
 * 合并白名单字段后落盘；api_key 空串清除密钥，llm_mode 明确控制认证模式。
 * 返回规范化后的新配置。
 */
export function updateConfig(patch, configPath = null) {
  const cfg = mergeConfigPatch(loadConfig(configPath), patch);
  saveConfig(cfg, configPath);
  return normalizeConfig(cfg);
}

/** 给前端的掩码视图：只暴露 has_key 与尾 4 位，绝不回传完整 api_key；OAuth 模式同样不回显任何 token。 */
export function maskedConfig(config) {
  const cfg = normalizeConfig(config);
  const key = cfg.api_key || "";
  const configured = modelConfigured(cfg);
  const mode = cfg.llm_mode;
  return {
    llm_mode: mode,
    api_auth: cfg.api_auth,
    base_url: cfg.base_url,
    model: cfg.model,
    temperature: cfg.temperature,
    stream: cfg.stream,
    timeout: cfg.timeout,
    comfy_url: cfg.comfy_url,
    image_generation: { ...cfg.image_generation },
    configured,
    has_api_key: Boolean(key),
    has_key: configured, // 兼容旧前端字段：表示文字模型已配置。
    api_key_tail: key.length > 4 ? key.slice(-4) : (key ? "***" : ""),
    echo: !configured,
    auth_mode: mode === "demo" ? "echo" : !configured ? "unconfigured" : mode === "kimi-oauth" ? "kimi-oauth" : cfg.api_auth === "bearer" ? "api-key" : "no-auth",
    kimi_credentials_available: mode === "kimi-oauth" && authMod.credentialsExist(cfg),
    kimi_defaults: { base_url: authMod.KIMI_CHAT_BASE_URL, model: authMod.KIMI_MODEL },
  };
}

export function configHasKey(config = null) {
  return modelConfigured(config && typeof config === "object" ? config : loadConfig());
}

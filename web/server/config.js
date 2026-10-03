/** Local configuration. Secrets stay on the backend; model parameters follow provider capabilities. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { imageSettings } from "./image/profiles.js";
import { MODEL_FIELDS, PARAMETER_DEFAULTS, providerInfo, validateParameters } from "../shared/llm.js";
import { LLM_PROVIDERS, catalogView, modelInfo, storedModelInfo } from "./llm/catalog.js";

export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG_PATH = path.join(WEB_DIR, "config.json");
export const LLM_MODES = ["api", "demo"];
export const DEFAULT_CONFIG = {
  llm_mode: "api", llm_provider: "deepseek", api_auth: "bearer",
  base_url: providerInfo("deepseek").base_url, api_key: "", model: "",
  ...PARAMETER_DEFAULTS, stream: true, timeout: 180,
  comfy_url: "http://127.0.0.1:8188", image_generation: imageSettings(),
};
export const defaultConfig = () => ({ ...DEFAULT_CONFIG, image_generation: imageSettings() });
export const templateConfig = defaultConfig;

export function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").replace(/\/(chat\/completions|messages|responses|models)$/, "");
}
export function validBaseUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

/** Old generic keys keep their endpoint. Removed OAuth settings never read local credentials. */
export function normalizeConfig(config) {
  const raw = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const cfg = { ...defaultConfig(), ...raw };
  const removedLogin = raw.llm_mode === "kimi-oauth" || (!raw.llm_mode && raw.kimi_oauth?.enabled && !String(raw.api_key || "").trim() && /api\.kimi\.com/.test(raw.base_url || ""));
  const legacyApi = !raw.llm_provider && !removedLogin && ["base_url", "model", "api_key"].some((k) => Object.hasOwn(raw, k));
  cfg.llm_mode = raw.llm_mode === "demo" ? "demo" : "api";
  cfg.llm_provider = LLM_PROVIDERS.some((p) => p.id === raw.llm_provider) ? raw.llm_provider : legacyApi ? "openai-compatible" : "deepseek";
  const provider = providerInfo(cfg.llm_provider);
  cfg.base_url = normalizeBaseUrl(raw.base_url ?? (legacyApi ? "" : provider.base_url));
  cfg.api_auth = ["bearer", "x-api-key", "none"].includes(raw.api_auth) ? raw.api_auth : provider.auth;
  cfg.api_key = String(raw.api_key || "").trim();
  cfg.model = String(raw.model || "").trim();
  if (cfg.llm_provider === "opencode-go") cfg.model = cfg.model.replace(/^opencode-go\//, "");
  for (const [key, dflt] of Object.entries(PARAMETER_DEFAULTS)) {
    cfg[key] = raw[key] === null && ["temperature", "top_p"].includes(key) ? null : raw[key] === undefined ? dflt : typeof dflt === "string" ? String(raw[key]) : Number(raw[key]);
  }
  cfg.timeout = Math.min(900, Math.max(5, Number(cfg.timeout) || 180));
  cfg.stream = cfg.stream !== false;
  cfg.comfy_url = String(cfg.comfy_url || DEFAULT_CONFIG.comfy_url).trim().replace(/\/+$/, "");
  cfg.image_generation = imageSettings(cfg.image_generation);
  if (cfg.image_generation.mode === "internal") cfg.comfy_url = "http://127.0.0.1:" + cfg.image_generation.port;
  delete cfg.kimi_oauth;
  if (removedLogin) Object.assign(cfg, { llm_provider: "deepseek", base_url: providerInfo("deepseek").base_url, api_auth: "bearer", api_key: "", model: "", ...PARAMETER_DEFAULTS });
  return cfg;
}

export function modelConfigured(config) {
  const cfg = normalizeConfig(config);
  return cfg.llm_mode === "api" && validBaseUrl(cfg.base_url) && Boolean(cfg.model) && (cfg.api_auth === "none" || Boolean(cfg.api_key));
}

/** Saves, tests and catalog discovery share key isolation and candidate merging. */
export function mergeConfigPatch(config, patch, { allowIncomplete = false } = {}) {
  const previous = normalizeConfig(config), cfg = structuredClone(previous);
  const body = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
  if ("llm_mode" in body && !LLM_MODES.includes(body.llm_mode)) fail("请选择模型 API 或演示模式");
  if ("llm_provider" in body && !LLM_PROVIDERS.some((p) => p.id === body.llm_provider)) fail("请选择支持的模型服务");
  if ("api_auth" in body && !["bearer", "x-api-key", "none"].includes(body.api_auth)) fail("API 认证方式必须是 bearer、x-api-key 或 none");
  if (body.llm_provider && body.llm_provider !== previous.llm_provider) {
    const provider = providerInfo(body.llm_provider);
    Object.assign(cfg, { base_url: provider.base_url, api_auth: provider.auth, model: "", ...PARAMETER_DEFAULTS });
  } else if ("model" in body && String(body.model).trim().replace(/^opencode-go\//, "") !== previous.model) Object.assign(cfg, PARAMETER_DEFAULTS);
  for (const key of [...MODEL_FIELDS, "comfy_url", "image_generation"]) {
    if (Object.hasOwn(body, key) && body[key] !== undefined) cfg[key] = key === "image_generation" ? imageSettings({ ...cfg.image_generation, ...body[key] }) : body[key];
  }
  const changed = ["llm_mode", "llm_provider", "api_auth"].some((k) => cfg[k] !== previous[k]) || normalizeBaseUrl(cfg.base_url) !== previous.base_url;
  if ((changed && !Object.hasOwn(body, "api_key")) || cfg.api_auth === "none") cfg.api_key = "";
  const next = normalizeConfig(cfg);
  const llmChanged = MODEL_FIELDS.some((key) => Object.hasOwn(body, key));
  if (llmChanged && next.llm_mode === "api") {
    if (next.base_url && !validBaseUrl(next.base_url)) fail("API 地址必须是 http/https 基础地址，不含账号密码、查询参数或片段");
    if (!allowIncomplete && (next.base_url || next.model || next.api_key) && (!next.base_url || !next.model)) fail("请同时填写 API 地址和模型 ID");
    if (["deepseek", "opencode-go"].includes(next.llm_provider) && next.api_auth !== "bearer") fail("此官方接口使用 Bearer API Key 认证");
    if (next.api_auth === "x-api-key" && next.llm_provider !== "anthropic") fail("x-api-key 认证用于 Anthropic 兼容接口");
    if (next.llm_provider === "opencode-go" && next.base_url) {
      const url = new URL(next.base_url);
      if (url.hostname === "opencode.ai" && url.pathname !== "/zen/go/v1") fail("OpenCode Go 订阅必须使用 https://opencode.ai/zen/go/v1");
    }
    if (!allowIncomplete && next.model) validateParameters(next, modelInfo(next));
  }
  return next;
}
function writeFile(p, cfg) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}
export function loadConfig(configPath = null) {
  const p = configPath ? path.resolve(String(configPath)) : CONFIG_PATH;
  if (fs.existsSync(p)) {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* Preserve read behavior for a malformed file. */ }
    return normalizeConfig(raw);
  }
  const cfg = defaultConfig();
  try { writeFile(p, templateConfig()); } catch (error) { console.warn("[rpg] 无法写入配置模板 " + p + "：" + error.message); }
  return cfg;
}
export function saveConfig(config, configPath = null) {
  const p = configPath ? path.resolve(String(configPath)) : CONFIG_PATH;
  const cfg = normalizeConfig(config), info = storedModelInfo(cfg);
  if (info) cfg.llm_model_info = info;
  else delete cfg.llm_model_info;
  writeFile(p, cfg);
  return p;
}
export function updateConfig(patch, configPath = null) {
  const cfg = mergeConfigPatch(loadConfig(configPath), patch);
  saveConfig(cfg, configPath);
  return cfg;
}
export function maskedConfig(config) {
  const cfg = normalizeConfig(config), configured = modelConfigured(cfg), key = cfg.api_key;
  const fields = Object.fromEntries(MODEL_FIELDS.filter((k) => k !== "api_key").map((k) => [k, cfg[k]]));
  return {
    ...fields, comfy_url: cfg.comfy_url, image_generation: { ...cfg.image_generation },
    providers: LLM_PROVIDERS, model_info: modelInfo(cfg), model_catalog: catalogView(cfg),
    configured, has_api_key: Boolean(key), has_key: configured, echo: !configured,
    api_key_tail: key.length > 4 ? key.slice(-4) : key ? "***" : "",
    auth_mode: cfg.llm_mode === "demo" ? "echo" : !configured ? "unconfigured" : cfg.api_auth === "none" ? "no-auth" : "api-key",
  };
}
export function configHasKey(config = null) { return modelConfigured(config && typeof config === "object" ? config : loadConfig()); }

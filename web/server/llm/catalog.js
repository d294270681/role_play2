import fs from "node:fs";
import { createHash } from "node:crypto";
import { LLM_PROVIDERS, providerInfo } from "../../shared/llm.js";
import { redact } from "./redact.js";

const snapshot = JSON.parse(fs.readFileSync(new URL("./catalog.snapshot.json", import.meta.url), "utf8"));
const catalogs = new Map();
let goMetadata = null, metadataAt = 0, metadataRequest;
const scope = (cfg) => `${cfg.llm_provider}|${cfg.base_url}|${cfg.api_auth}|${createHash("sha256").update(cfg.api_key || "").digest("hex")}`;
const positive = (n) => Number.isInteger(n) && n > 0 ? n : null;
const supported = (v) => v === true || v?.supported === true;

export function apiHeaders(cfg) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (cfg.api_auth === "x-api-key" && cfg.api_key) headers["x-api-key"] = cfg.api_key;
  else if (cfg.api_auth === "bearer" && cfg.api_key) headers.Authorization = `Bearer ${cfg.api_key}`;
  if (cfg.llm_provider === "anthropic") headers["anthropic-version"] = "2023-06-01";
  return headers;
}

/** Go's published endpoints override generic models.dev transport hints. */
function goProtocol(id, meta) {
  if (/^(qwen3\.|minimax-)/.test(id)) return "messages";
  if (/^(gpt-|grok-|muse-spark-)/.test(id)) return "responses";
  return meta?.npm === "@ai-sdk/anthropic" ? "messages" : meta?.npm === "@ai-sdk/openai" ? "responses" : "chat";
}

export function describeModel(provider, raw, meta = {}) {
  const id = String(raw.id || "");
  const options = meta.reasoning_options || [];
  const budgetOption = options.find((o) => o.type === "budget_tokens");
  const toggle = options.some((o) => o.type === "toggle");
  const protocol = provider === "opencode-go" ? goProtocol(id, meta) : providerInfo(provider).protocol;
  const native = raw.capabilities;
  const thinkingTypes = native?.thinking?.types;
  let efforts = raw.effort?.supported_levels || options.find((o) => o.type === "effort")?.values || [];
  if (native?.effort) efforts = ["low", "medium", "high", "xhigh", "max"].filter((level) => supported(native.effort[level]));
  efforts = efforts.filter((v) => typeof v === "string");
  let budget = protocol === "messages" && budgetOption ? { min: budgetOption.min || 1024, max: positive(budgetOption.max) } : null;
  let modes = ["default"], defaultThinking = false;
  const reasoning = native?.thinking ? supported(native.thinking) : raw.effort ? true : Boolean(meta.reasoning);
  if (provider === "deepseek") { modes.push("enabled", "disabled"); defaultThinking = true; }
  else if (protocol === "messages") {
    if (thinkingTypes) {
      if (supported(thinkingTypes.adaptive)) modes.push("adaptive");
      if (supported(thinkingTypes.enabled)) { modes.push("enabled"); budget ||= { min: 1024, max: null }; }
      // New Claude generations always think. A disabled switch would be rejected.
      if (supported(thinkingTypes.enabled) || /claude-(sonnet-4-6|opus-4-6|sonnet-5)(?:-|$)/.test(id)) modes.push("disabled");
      defaultThinking = !supported(thinkingTypes.enabled) && supported(thinkingTypes.adaptive);
    } else if (reasoning) {
      if (budget) modes.push("enabled", "disabled");
      if (/claude-(sonnet-4-6|opus-4-6)/.test(id)) modes.push("adaptive");
      if (!budget && efforts.length) { modes.push("adaptive"); defaultThinking = true; if (toggle && !id.includes("sonnet-5-5")) modes.push("disabled"); }
      if (id === "minimax-m3") modes.push("adaptive", "disabled");
    }
    if (id.includes("claude-sonnet-5-5")) { modes = modes.filter((v) => v !== "disabled"); modes.push("between_tools"); defaultThinking = true; }
  } else if (toggle && /^(deepseek-|longcat-)/.test(id)) { modes.push("enabled", "disabled"); defaultThinking = true; }
  const known = provider === "openai-compatible" || meta.reasoning !== undefined || meta.temperature !== undefined || Boolean(native) || Boolean(raw.effort);
  const temperature = provider === "openai-compatible" ? true : Boolean(meta.temperature);
  return {
    id, name: raw.display_name || raw.name || meta.name || id, protocol, known,
    reasoning, thinking_modes: [...new Set(modes)], thinking_default: defaultThinking,
    efforts, budget, temperature, temperature_max: protocol === "messages" ? 1 : 2,
    top_p: temperature, max_output_tokens: positive(raw.max_output_tokens || raw.max_tokens || meta.limit?.output),
    context_tokens: positive(raw.context_window || raw.max_input_tokens || meta.limit?.context),
    sampling_rule: provider === "deepseek" ? "deepseek" : protocol === "messages" && id.startsWith("claude-") ? "anthropic" : id.startsWith("gpt-") && temperature && reasoning ? "gpt" : "plain",
    reasoning_field: meta.interleaved?.field || null,
  };
}

function metadataFor(provider, id) {
  const list = provider === "opencode-go" && goMetadata ? goMetadata : snapshot[provider] || [];
  return list.find((m) => m.id === id) || (provider === "anthropic" ? list.find((m) => id.startsWith(`${m.id}-20`)) : null) || {};
}

export function initialCatalog(provider) {
  return (snapshot[provider] || []).map((m) => describeModel(provider, m, m));
}

export function modelInfo(cfg) {
  const stored = cfg.llm_model_info;
  return catalogs.get(scope(cfg))?.models.find((m) => m.id === cfg.model)
    || (stored?.scope === scope(cfg) && stored.model?.id === cfg.model ? stored.model : null)
    || describeModel(cfg.llm_provider, { id: cfg.model }, metadataFor(cfg.llm_provider, cfg.model));
}

/** Persist only server-resolved capabilities so a newly listed model also works after restart. */
export function storedModelInfo(cfg) {
  const model = modelInfo(cfg);
  return cfg.model && model.known ? { scope: scope(cfg), model } : null;
}

export function catalogView(cfg) {
  const cached = catalogs.get(scope(cfg));
  return cached || { models: initialCatalog(cfg.llm_provider), source: "snapshot", updated_at: snapshot.updated_at, warning: "当前为随项目提供的模型目录，点击刷新可读取服务最新列表。" };
}

async function updateGoMetadata() {
  if (goMetadata && Date.now() - metadataAt < 3600000) return;
  metadataRequest ||= (async () => {
    // No API key is ever sent to the public capability registry.
    const res = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!res.ok) throw new Error(`模型能力目录返回 ${res.status}`);
    const data = await res.json(), provider = data["opencode-go"];
    if (!provider?.models) throw new Error("模型能力目录缺少 OpenCode Go");
    goMetadata = Object.values(provider.models).map((m) => ({ ...m, npm: m.provider?.npm || provider.npm }));
    metadataAt = Date.now();
  })().finally(() => { metadataRequest = null; });
  await metadataRequest;
}

/** Models lists are read-only; paginate to completion and never replace a live list with a fixed subset. */
export async function fetchModelCatalog(cfg) {
  if (cfg.llm_mode === "demo") return { models: [], source: "demo", warning: "演示模式不需要模型目录。" };
  if (!cfg.base_url) return { ...catalogView(cfg), warning: "请填写 API 基础地址后刷新。" };
  if (!cfg.api_key && cfg.api_auth !== "none" && cfg.llm_provider !== "opencode-go") return { ...catalogView(cfg), warning: "填写 API Key 后可读取账号的模型目录；当前展示参考目录。" };
  const entries = new Map(), cursors = new Set();
  let after = "", completed = false;
  try {
    for (let page = 0; page < 100; page += 1) {
      const url = new URL(`${cfg.base_url}/models`);
      if (cfg.llm_provider === "anthropic") url.searchParams.set("limit", "1000");
      if (after) url.searchParams.set("after_id", after);
      const res = await fetch(url, { headers: apiHeaders(cfg), signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!res.ok) {
        const detail = redact(await res.text(), [cfg.api_key]).replace(/\s+/g, " ").slice(0, 220);
        throw Object.assign(new Error(`读取模型目录失败（${res.status}）：${detail || res.statusText}`), { status: res.status === 401 || res.status === 403 ? res.status : 502 });
      }
      const data = await res.json();
      if (!Array.isArray(data.data)) throw new Error("模型目录没有返回 data 数组");
      for (const m of data.data) if (m && typeof m.id === "string" && m.id.trim()) entries.set(m.id, m);
      if (!data.has_more) { completed = true; break; }
      after = data.last_id || data.data.at(-1)?.id;
      if (!after || cursors.has(after)) throw new Error("模型目录分页游标重复，无法取得完整列表");
      cursors.add(after);
    }
    if (!completed) throw new Error("模型目录超过分页上限，未能取得完整列表");
    let warning = "";
    if (cfg.llm_provider === "opencode-go") {
      try { await updateGoMetadata(); } catch { warning = "模型列表已刷新；能力目录暂不可用，参数使用项目快照。"; }
    }
    const models = [...entries.values()].filter((m) => !cfg.api_key || !JSON.stringify(m).includes(cfg.api_key)).map((m) => describeModel(cfg.llm_provider, m, metadataFor(cfg.llm_provider, m.id)));
    const view = { models, source: "live", updated_at: new Date().toISOString(), warning };
    catalogs.set(scope(cfg), view);
    // Bound retained credential hashes and account-specific catalogs.
    if (catalogs.size > 32) catalogs.delete(catalogs.keys().next().value);
    return view;
  } catch (error) {
    const safe = Object.assign(new Error(redact(error.message, [cfg.api_key])), { status: error.status || 502 });
    if (error.status === 401 || error.status === 403) throw safe;
    return { ...catalogView(cfg), warning: `${safe.message}。${cfg.llm_provider === "anthropic" || cfg.llm_provider === "openai-compatible" ? "兼容服务可手填模型 ID。" : "保留上次目录，可稍后重试。"}` };
  }
}

export { LLM_PROVIDERS };

/** Provider-neutral settings. Only advertised model capabilities enable optional parameters. */
export const LLM_PROVIDERS = [
  { id: "deepseek", title: "DeepSeek 官方 API", base_url: "https://api.deepseek.com", auth: "bearer", protocol: "chat" },
  { id: "opencode-go", title: "OpenCode Go 订阅", base_url: "https://opencode.ai/zen/go/v1", auth: "bearer", protocol: "auto" },
  { id: "anthropic", title: "Anthropic 兼容 API", base_url: "https://api.anthropic.com/v1", auth: "x-api-key", protocol: "messages" },
  { id: "openai-compatible", title: "通用 OpenAI 兼容 API", base_url: "", auth: "bearer", protocol: "chat" },
];

export const PARAMETER_DEFAULTS = { temperature: 1, top_p: null, max_tokens: 8192, thinking: "default", reasoning_effort: "default", thinking_budget: 4096 };
export const MODEL_FIELDS = ["llm_mode", "llm_provider", "api_auth", "base_url", "api_key", "model", ...Object.keys(PARAMETER_DEFAULTS), "stream", "timeout"];
export const providerInfo = (id) => LLM_PROVIDERS.find((p) => p.id === id) || LLM_PROVIDERS[0];

export function thinkingActive(cfg, model) {
  if (!model?.reasoning) return false;
  if (["disabled", "between_tools"].includes(cfg.thinking) || cfg.reasoning_effort === "none") return false;
  if (cfg.thinking !== "default") return true;
  return Boolean(model.thinking_default);
}

/** The same rules drive disabled UI controls and outbound request construction. */
export function samplingControls(cfg, model) {
  if (!model) return { temperature: false, top_p: false, note: "请先选择模型，获取其参数能力。" };
  const active = thinkingActive(cfg, model);
  if (model.sampling_rule === "deepseek") return {
    temperature: !active, top_p: active,
    note: active ? "思考模式中 temperature 不生效；top_p 的有效范围为 0.95–1。" : "非思考模式中 temperature 生效；top_p 固定为 1。",
  };
  if (model.sampling_rule === "anthropic" && active) return { temperature: false, top_p: false, note: "思考开启时采用模型默认采样，不发送 temperature / top_p。" };
  if (model.sampling_rule === "gpt" && cfg.reasoning_effort !== "none") return { temperature: false, top_p: false, note: "该模型仅在思考等级 none 时支持采样参数。" };
  return { temperature: Boolean(model.temperature), top_p: Boolean(model.top_p), note: model.temperature ? "建议只调整 temperature 或 top_p 中的一项。" : "该模型不支持自定义采样参数，后端会省略这些字段。" };
}

export function validateParameters(cfg, model) {
  const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
  const integer = (value, min, max, name) => {
    if (!Number.isInteger(value) || value < min || (max && value > max)) fail(`${name} 必须是 ${min}${max ? `–${max}` : " 以上"} 的整数`);
  };
  integer(cfg.max_tokens, 1, model?.max_output_tokens || 1000000, "最大输出 tokens");
  const modes = model?.thinking_modes || ["default"];
  if (!modes.includes(cfg.thinking)) fail("所选模型不支持此思考模式，请重新选择");
  if (cfg.reasoning_effort !== "default" && !model?.efforts?.includes(cfg.reasoning_effort)) fail("所选模型不支持此思考等级，请按模型能力选择");
  if (["disabled", "between_tools"].includes(cfg.thinking) && cfg.reasoning_effort !== "default") {
    if (cfg.thinking !== "between_tools" || !["low", "medium", "high"].includes(cfg.reasoning_effort)) fail("当前思考模式与所选思考等级不能同时使用");
  }
  if (cfg.thinking === "enabled" && model?.budget) {
    integer(cfg.thinking_budget, model.budget.min || 1024, Math.min(model.budget.max || 1000000, cfg.max_tokens - 1), "思考预算 tokens");
    if (cfg.thinking_budget >= cfg.max_tokens) fail("思考预算必须小于最大输出 tokens，给剧情正文留出空间");
  }
  const controls = samplingControls(cfg, model);
  if (cfg.temperature !== null && (!Number.isFinite(cfg.temperature) || cfg.temperature < 0 || cfg.temperature > (controls.temperature ? model?.temperature_max || 2 : 2))) fail("temperature 超出所选模型允许的范围");
  if (cfg.top_p !== null && (!Number.isFinite(cfg.top_p) || cfg.top_p <= 0 || cfg.top_p > 1 || (controls.top_p && model?.sampling_rule === "deepseek" && cfg.top_p < 0.95))) fail("top_p 超出所选模型允许的范围");
}

import { PARAMETER_DEFAULTS, providerInfo, samplingControls } from "../../shared/llm.js";

/** Empty keys retain the saved key only within the same provider, endpoint and authentication. */
export function modelForm(cfg = {}) {
  const provider = cfg.llm_provider || (cfg.base_url ? "openai-compatible" : "deepseek");
  const fields = Object.fromEntries(Object.keys(PARAMETER_DEFAULTS).map((key) => [key, cfg[key] === undefined ? PARAMETER_DEFAULTS[key] : cfg[key]]));
  return {
    llm_mode: cfg.llm_mode === "demo" ? "demo" : "api", llm_provider: provider,
    api_auth: cfg.api_auth || providerInfo(provider).auth,
    base_url: cfg.base_url ?? providerInfo(provider).base_url, model: cfg.model || "",
    api_key: "", clear_api_key: false, ...fields,
    stream: cfg.stream !== false, timeout: Number(cfg.timeout ?? 180),
  };
}
export function selectProvider(form, id) {
  const provider = providerInfo(id);
  Object.assign(form, { llm_provider: id, base_url: provider.base_url, api_auth: provider.auth, api_key: "", clear_api_key: false, model: "", ...PARAMETER_DEFAULTS });
}
export function selectModel(form, model) {
  form.model = model?.id || "";
  Object.assign(form, PARAMETER_DEFAULTS);
  form.max_tokens = Math.min(PARAMETER_DEFAULTS.max_tokens, model?.max_output_tokens || PARAMETER_DEFAULTS.max_tokens);
}
export function modelPatch(form) {
  const patch = { llm_mode: form.llm_mode, stream: Boolean(form.stream), timeout: Number(form.timeout) };
  if (form.llm_mode !== "api") return patch;
  Object.assign(patch, { llm_provider: form.llm_provider, api_auth: form.api_auth, base_url: form.base_url.trim(), model: form.model.trim() });
  for (const key of Object.keys(PARAMETER_DEFAULTS)) patch[key] = form[key];
  if (form.clear_api_key || form.api_auth === "none") patch.api_key = "";
  else if (form.api_key.trim()) patch.api_key = form.api_key.trim();
  return patch;
}
export { samplingControls };

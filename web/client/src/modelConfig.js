/** 网页模型表单：空密钥留用同一接口的已存密钥，清除与切换由后端统一处理。 */
export function modelForm(cfg = {}) {
  return {
    llm_mode: cfg.llm_mode || "api", api_auth: cfg.api_auth || "bearer",
    base_url: cfg.llm_mode === "kimi-oauth" ? "" : cfg.base_url || "",
    api_key: "", clear_api_key: false,
    model: cfg.llm_mode === "kimi-oauth" ? "" : cfg.model || "",
    temperature: Number(cfg.temperature ?? 0.8), stream: cfg.stream !== false,
    timeout: Number(cfg.timeout ?? 180),
  };
}

export function modelPatch(form, cfg = {}) {
  const patch = { llm_mode: form.llm_mode, temperature: Number(form.temperature), stream: Boolean(form.stream), timeout: Number(form.timeout) };
  if (form.llm_mode === "api") {
    Object.assign(patch, { api_auth: form.api_auth, base_url: form.base_url.trim(), model: form.model.trim() });
    if (form.clear_api_key || form.api_auth === "none") patch.api_key = "";
    else if (form.api_key.trim()) patch.api_key = form.api_key.trim();
  } else if (form.llm_mode === "kimi-oauth") {
    Object.assign(patch, { base_url: cfg.kimi_defaults?.base_url || "https://api.kimi.com/coding/v1", model: cfg.llm_mode === "kimi-oauth" && cfg.model ? cfg.model : cfg.kimi_defaults?.model || "k3", temperature: 1 });
  }
  return patch;
}

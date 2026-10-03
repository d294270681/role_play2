/** Native transports. GM sees only final text; provider reasoning stays inside this turn's client. */
import { samplingControls, validateParameters } from "../../shared/llm.js";
import { apiHeaders, modelInfo } from "./catalog.js";
import { redact } from "./redact.js";

const textContent = (value) => typeof value === "string" ? value : Array.isArray(value) ? value.filter((v) => v.type === "text" || v.type === "output_text").map((v) => v.text || "").join("") : "";
const outputText = (data) => (data.output || []).filter((item) => item.type === "message").map((item) => textContent(item.content)).join("") || data.output_text || "";
const safeError = (error, cfg) => Object.assign(new Error(redact(error?.message || String(error), [cfg.api_key])), { status: error?.status });

/** SSE frames may span reads, use CRLF, contain multiple data lines, or end without a newline. */
export async function* sseData(body) {
  if (!body) throw new Error("模型接口没有返回响应流");
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "", lines = [];
  const consume = (line) => {
    if (!line) { const data = lines.join("\n"); lines = []; return data || null; }
    if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""));
    return null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        const frame = consume(line);
        if (frame) yield frame;
      }
      if (done) break;
    }
    if (buffer) { const frame = consume(buffer.replace(/\r$/, "")); if (frame) yield frame; }
    const tail = consume("");
    if (tail) yield tail;
  } finally {
    try { await reader.cancel(); } catch { /* The peer may already be closed. */ }
    reader.releaseLock();
  }
}

export function buildModelRequest(cfg, messages, replies = new Map()) {
  const model = modelInfo(cfg);
  validateParameters(cfg, model);
  const controls = samplingControls(cfg, model);
  const sampling = {};
  if (controls.temperature && cfg.temperature !== null) sampling.temperature = cfg.temperature;
  if (controls.top_p && cfg.top_p !== null) sampling.top_p = cfg.top_p;
  const system = messages.filter((m) => m.role === "system").map((m) => textContent(m.content)).join("\n\n");
  const dialogue = messages.filter((m) => m.role !== "system");
  let payload, path;
  const headers = apiHeaders(cfg);
  if (model.protocol === "messages") {
    path = "/messages";
    headers["anthropic-version"] = "2023-06-01";
    payload = { model: cfg.model, max_tokens: cfg.max_tokens, stream: cfg.stream, ...sampling,
      ...(system ? { system } : {}),
      messages: dialogue.map((m) => ({ role: m.role, content: m.role === "assistant" && replies.has(m.content) ? replies.get(m.content) : [{ type: "text", text: textContent(m.content) }] })),
    };
    if (cfg.thinking !== "default") payload.thinking = { type: cfg.thinking, ...(cfg.thinking === "enabled" && model.budget ? { budget_tokens: cfg.thinking_budget } : {}) };
    if (cfg.reasoning_effort !== "default") payload.output_config = { effort: cfg.reasoning_effort };
  } else if (model.protocol === "responses") {
    path = "/responses";
    payload = { model: cfg.model, max_output_tokens: cfg.max_tokens, stream: cfg.stream, store: false, ...sampling,
      ...(system ? { instructions: system } : {}),
      input: dialogue.flatMap((m) => m.role === "assistant" && replies.has(m.content) ? replies.get(m.content) : [{ role: m.role, content: textContent(m.content) }]),
    };
    if (model.reasoning) payload.include = ["reasoning.encrypted_content"];
    if (cfg.reasoning_effort !== "default") payload.reasoning = { effort: cfg.reasoning_effort };
  } else {
    path = "/chat/completions";
    payload = { model: cfg.model, max_tokens: cfg.max_tokens, stream: cfg.stream, ...sampling,
      messages: messages.map((m) => ({ role: m.role, content: textContent(m.content), ...(m.role === "assistant" ? replies.get(m.content) || {} : {}) })),
    };
    if (cfg.thinking !== "default") payload.thinking = { type: cfg.thinking };
    if (cfg.reasoning_effort !== "default") payload.reasoning_effort = cfg.reasoning_effort;
    if (cfg.llm_provider === "deepseek" && cfg.thinking === "disabled") payload.reasoning_effort = "none";
  }
  headers.Accept = cfg.stream ? "text/event-stream" : "application/json";
  return { url: cfg.base_url + path, headers, payload, model };
}

export class ModelClient {
  constructor(config) { this.config = config; this.replies = new Map(); }
  endpoint() { return this.config.base_url + ({ messages: "/messages", responses: "/responses" }[modelInfo(this.config).protocol] || "/chat/completions"); }

  async *streamChat(messages) {
    const cfg = this.config;
    try {
      const request = buildModelRequest(cfg, messages, this.replies);
      let res;
      try {
        res = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.payload), signal: AbortSignal.timeout(cfg.timeout * 1000), redirect: "error" });
      } catch (error) { throw new Error(`连接模型接口失败（${cfg.base_url}）：${error.message}`); }
      if (!res.ok) throw new Error(`模型接口返回 ${res.status}：${redact(await res.text(), [cfg.api_key]).replace(/\s+/g, " ").slice(0, 300) || res.statusText}`);
      const protocol = request.model.protocol;
      if (!cfg.stream || (res.headers.get("content-type") || "").includes("application/json")) {
        let data;
        try { data = await res.json(); } catch { throw new Error("模型接口返回的不是 JSON，请检查接口地址和协议"); }
        if (data.error) throw new Error(`模型接口错误：${JSON.stringify(data.error)}`);
        let text = "";
        if (protocol === "messages") { text = textContent(data.content); if (text) this.replies.set(text, data.content); if (data.stop_reason === "max_tokens") throw new Error("模型输出达到 token 上限，请增加最大输出 tokens 或降低思考设置后重试"); }
        else if (protocol === "responses") { text = outputText(data); if (text && data.output?.length) this.replies.set(text, data.output); if (data.status === "incomplete" || data.status === "failed") throw new Error(`模型未完成输出：${JSON.stringify(data.incomplete_details || data.error || data.status)}`); }
        else { const choice = data.choices?.[0]; text = textContent(choice?.message?.content); if (choice?.finish_reason === "length") throw new Error("模型输出达到 token 上限，请增加最大输出 tokens 后重试"); if (text && request.model.reasoning_field && choice?.message?.[request.model.reasoning_field]) this.replies.set(text, { [request.model.reasoning_field]: choice.message[request.model.reasoning_field] }); }
        if (text) yield text;
        return;
      }
      let text = "", reasoning = "", finished = false;
      const blocks = [], output = [];
      for await (const frame of sseData(res.body)) {
        if (frame === "[DONE]") { finished = true; break; }
        let data;
        try { data = JSON.parse(frame); } catch { throw new Error("模型流包含非法 JSON，已停止本次回合"); }
        if (data.error || data.type === "error" || ["response.failed", "response.incomplete"].includes(data.type)) throw new Error(`模型流错误：${JSON.stringify(data.error || data.response?.error || data.response?.incomplete_details || data)}`);
        let delta = "";
        if (protocol === "messages") {
          if (data.type === "content_block_start") { blocks[data.index] = structuredClone(data.content_block); delta = data.content_block?.type === "text" ? data.content_block.text || "" : ""; }
          if (data.type === "content_block_delta") {
            const block = blocks[data.index];
            if (data.delta?.type === "text_delta" && block?.type === "text") { delta = data.delta.text || ""; block.text = (block.text || "") + delta; }
            if (data.delta?.type === "thinking_delta" && block) block.thinking = (block.thinking || "") + (data.delta.thinking || "");
            if (data.delta?.type === "signature_delta" && block) block.signature = (block.signature || "") + (data.delta.signature || "");
          }
          if (data.type === "message_delta" && data.delta?.stop_reason === "max_tokens") throw new Error("模型输出达到 token 上限，请增加最大输出 tokens 或降低思考设置后重试");
          if (data.type === "message_stop") finished = true;
        } else if (protocol === "responses") {
          if (data.type === "response.output_text.delta") delta = data.delta || "";
          if (data.type === "response.refusal.delta") throw new Error("模型没有提供剧情回复：" + (data.delta || ""));
          if (data.type === "response.output_item.done") output[data.output_index] = data.item;
          if (data.type === "response.completed") { if (data.response?.status === "incomplete") throw new Error("模型输出达到 token 上限"); if (data.response?.output) output.splice(0, output.length, ...data.response.output); finished = true; }
        } else {
          const choice = data.choices?.[0];
          delta = textContent(choice?.delta?.content || choice?.message?.content);
          reasoning += choice?.delta?.[request.model.reasoning_field] || "";
          if (choice?.finish_reason === "length") throw new Error("模型输出达到 token 上限，请增加最大输出 tokens 后重试");
          if (choice?.finish_reason) finished = true;
        }
        if (delta) { text += delta; yield delta; }
        if (finished && protocol !== "chat") break;
      }
      if (!finished) throw new Error("模型流提前断开，未收到完成标记，请重试本次行动");
      if (text && protocol === "messages") this.replies.set(text, blocks.filter(Boolean));
      if (text && protocol === "responses") this.replies.set(text, output.filter(Boolean));
      if (text && protocol === "chat" && reasoning && request.model.reasoning_field) this.replies.set(text, { [request.model.reasoning_field]: reasoning });
    } catch (error) { throw safeError(error, cfg); }
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { normalizeConfig, mergeConfigPatch, maskedConfig } from "../config.js";
import { ModelClient, buildModelRequest } from "./client.js";
import { describeModel, fetchModelCatalog, initialCatalog, modelInfo, storedModelInfo } from "./catalog.js";
import { modelForm, modelPatch, selectModel, selectProvider } from "../../client/src/modelConfig.js";
import { samplingControls } from "../../shared/llm.js";

const key = "sk-local-protocol-test";
const messages = [{ role: "system", content: "扮演 GM，结尾输出 JSON。" }, { role: "user", content: "检查大门" }];
const cfg = (extra = {}) => normalizeConfig({ llm_provider: "deepseek", model: "deepseek-flash", api_key: key, ...extra });
const frame = (data) => `event: update\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const collect = async (client, input = messages) => { let text = ""; for await (const delta of client.streamChat(input)) text += delta; return text; };

async function upstream(t, responder) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
    res.setHeader("Content-Type", "application/json");
    await responder(req, res, requests.at(-1));
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { base_url: `http://127.0.0.1:${server.address().port}/v1`, requests };
}

test("DeepSeek 官方模型参数区分思考等级与采样，开启与关闭发送有效字段", () => {
  const on = cfg({ thinking: "enabled", reasoning_effort: "max", temperature: 0.4, top_p: 0.97, max_tokens: 16000 });
  const req = buildModelRequest(on, messages);
  assert.equal(req.url, "https://api.deepseek.com/chat/completions");
  assert.deepEqual(req.payload.thinking, { type: "enabled" });
  assert.equal(req.payload.reasoning_effort, "max"); assert.equal(req.payload.top_p, 0.97);
  assert.equal("temperature" in req.payload, false); assert.equal(req.payload.max_tokens, 16000);
  const off = buildModelRequest(cfg({ thinking: "disabled", temperature: 0.7, top_p: 0.96 }), messages);
  assert.equal(off.payload.reasoning_effort, "none"); assert.equal(off.payload.temperature, 0.7); assert.equal("top_p" in off.payload, false);
  for (const patch of [{ reasoning_effort: "medium" }, { reasoning_effort: "ultra" }, { top_p: 0.5 }, { max_tokens: 393217 }, { max_tokens: 1.5 }, { thinking: "adaptive" }]) assert.throws(() => mergeConfigPatch(cfg(), patch), (e) => e.status === 400);
});

test("Go 显示完整快照，Qwen/MiniMax 与 GPT/Grok 按 Go 专用端点分流", () => {
  const models = initialCatalog("opencode-go");
  assert.equal(models.length, 43); assert.ok(models.some((m) => m.id === "gpt-6-luna"));
  for (const m of models) {
    const request = buildModelRequest(cfg({ llm_provider: "opencode-go", base_url: "https://opencode.ai/zen/go/v1", model: m.id }), messages);
    assert.equal(request.payload.model, m.id); assert.equal(request.headers.Authorization, `Bearer ${key}`);
    assert.match(request.url, /^https:\/\/opencode\.ai\/zen\/go\/v1\//);
    if (/^(qwen3\.|minimax-)/.test(m.id)) assert.equal(request.model.protocol, "messages", m.id);
    if (/^(gpt-|grok-|muse-)/.test(m.id)) assert.equal(request.model.protocol, "responses", m.id);
  }
  const gpt = buildModelRequest(cfg({ llm_provider: "opencode-go", model: "gpt-5.6-luna", reasoning_effort: "xhigh" }), messages);
  assert.deepEqual(gpt.payload.reasoning, { effort: "xhigh" }); assert.equal("temperature" in gpt.payload, false);
  assert.equal(gpt.payload.store, false); assert.equal(gpt.payload.max_output_tokens, 8192);
  const qwen = buildModelRequest(cfg({ llm_provider: "opencode-go", model: "qwen3.8-max", thinking: "enabled", reasoning_effort: "xhigh" }), messages);
  assert.deepEqual(qwen.payload.thinking, { type: "enabled", budget_tokens: 4096 }); assert.deepEqual(qwen.payload.output_config, { effort: "xhigh" });
  assert.throws(() => mergeConfigPatch(cfg({ llm_provider: "opencode-go", model: "qwen3.8-max" }), { reasoning_effort: "high" }), /思考等级/);
  assert.throws(() => mergeConfigPatch(cfg({ llm_provider: "opencode-go", model: "glm-5.2" }), { base_url: "https://opencode.ai/zen/v1" }), /Go 订阅/);
});

test("Anthropic 新旧模型的 adaptive、预算、不可关闭思考与采样范围分别校验", () => {
  const old = cfg({ llm_provider: "anthropic", model: "claude-haiku-4-5", thinking: "enabled", thinking_budget: 2048 });
  const req = buildModelRequest(old, messages);
  assert.equal(req.headers["x-api-key"], key); assert.equal(req.headers["anthropic-version"], "2023-06-01");
  assert.equal(req.headers.Authorization, undefined); assert.equal(req.payload.system, messages[0].content);
  assert.equal(req.payload.messages.length, 1); assert.deepEqual(req.payload.thinking, { type: "enabled", budget_tokens: 2048 });
  assert.equal("temperature" in req.payload, false);
  assert.throws(() => mergeConfigPatch(old, { thinking_budget: 1000 }), /思考预算/);
  assert.throws(() => mergeConfigPatch(old, { thinking_budget: 8192 }), /思考预算/);
  const current = cfg({ llm_provider: "anthropic", model: "claude-opus-5-5", thinking: "adaptive", reasoning_effort: "max" });
  assert.deepEqual(buildModelRequest(current, messages).payload.output_config, { effort: "max" });
  assert.throws(() => mergeConfigPatch(current, { thinking: "disabled", reasoning_effort: "default" }), /思考模式/);
  assert.throws(() => mergeConfigPatch(current, { thinking: "enabled" }), /思考模式/);
  assert.throws(() => mergeConfigPatch(cfg({ llm_provider: "anthropic", model: "claude-haiku-4-5", thinking: "disabled" }), { temperature: 1.5 }), /temperature/);
  const sonnet = cfg({ llm_provider: "anthropic", model: "claude-sonnet-5-5", thinking: "between_tools", reasoning_effort: "high" });
  assert.equal(buildModelRequest(sonnet, messages).payload.thinking.type, "between_tools");
  assert.throws(() => mergeConfigPatch(sonnet, { reasoning_effort: "max" }), /不能同时使用/);
});

test("未声明高级能力的兼容模型只发送基础 Messages 请求，Bearer 与无认证均可用", () => {
  for (const auth of ["bearer", "none"]) {
    const req = buildModelRequest(cfg({ llm_provider: "anthropic", model: "gateway-custom-model", api_auth: auth }), messages);
    assert.equal("thinking" in req.payload, false); assert.equal("temperature" in req.payload, false); assert.equal("output_config" in req.payload, false);
    assert.equal(req.headers.Authorization, auth === "bearer" ? `Bearer ${key}` : undefined);
    assert.equal(req.headers["x-api-key"], undefined);
  }
});

test("Chat SSE 跨 UTF-8 包、CRLF 与尾帧解析，reasoning_content 不进入剧情", async (t) => {
  const fixture = await upstream(t, async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    const data = Buffer.from(frame({ choices: [{ delta: { reasoning_content: "私有推理内容" } }] }) + frame({ choices: [{ delta: { content: "门锁已经松动。" } }] }) + "data: [DONE]");
    for (let i = 0; i < data.length; i += 7) { res.write(data.subarray(i, i + 7)); await new Promise((r) => setImmediate(r)); }
    res.end();
  });
  assert.equal(await collect(new ModelClient(cfg({ base_url: fixture.base_url }))), "门锁已经松动。");
  assert.equal(fixture.requests[0].url, "/v1/chat/completions");
});

test("Messages SSE 隐藏思考，保留签名内容供骰子后的同回合继续使用", async (t) => {
  const fixture = await upstream(t, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.end([
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "私有思考" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "opaque-signature" } },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "请进行开锁判定。" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" },
    ].map(frame).join(""));
  });
  const client = new ModelClient(cfg({ llm_provider: "anthropic", model: "claude-haiku-4-5", base_url: fixture.base_url, thinking: "enabled" }));
  const text = await collect(client); assert.equal(text, "请进行开锁判定。");
  await collect(client, [...messages, { role: "assistant", content: text }, { role: "user", content: "判定成功，继续。" }]);
  const assistant = fixture.requests[1].body.messages[1];
  assert.deepEqual(assistant.content[0], { type: "thinking", thinking: "私有思考", signature: "opaque-signature" });
  assert.equal(assistant.content[1].text, text);
});

test("Responses 流仅返回正文并保留 encrypted reasoning，继续请求包含原始输出项", async (t) => {
  const output = [{ type: "reasoning", id: "rs_1", encrypted_content: "opaque-data", summary: [] }, { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "获得线索。", annotations: [] }] }];
  const fixture = await upstream(t, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.end(frame({ type: "response.reasoning_summary_text.delta", delta: "私有推理" }) + frame({ type: "response.output_text.delta", delta: "获得线索。" }) + frame({ type: "response.completed", response: { status: "completed", output } }));
  });
  const client = new ModelClient(cfg({ llm_provider: "opencode-go", model: "gpt-5.6-luna", base_url: fixture.base_url }));
  const text = await collect(client); assert.equal(text, "获得线索。");
  await collect(client, [...messages, { role: "assistant", content: text }, { role: "user", content: "继续" }]);
  assert.equal(fixture.requests[0].url, "/v1/responses");
  assert.deepEqual(fixture.requests[1].body.input.slice(1, 3), output);
});

test("各协议的非流式正文可用，思考块均不作为模型回复", async (t) => {
  const fixture = await upstream(t, (req, res) => {
    if (req.url.endsWith("/messages")) res.end(JSON.stringify({ content: [{ type: "thinking", thinking: "隐藏" }, { type: "text", text: "OK" }], stop_reason: "end_turn" }));
    else if (req.url.endsWith("/responses")) res.end(JSON.stringify({ status: "completed", output: [{ type: "reasoning", summary: [{ text: "隐藏" }] }, { type: "message", content: [{ type: "output_text", text: "OK" }] }] }));
    else res.end(JSON.stringify({ choices: [{ message: { reasoning_content: "隐藏", content: "OK" } }] }));
  });
  for (const options of [{}, { llm_provider: "anthropic", model: "claude-haiku-4-5" }, { llm_provider: "opencode-go", model: "gpt-5.6-luna" }]) assert.equal(await collect(new ModelClient(cfg({ ...options, base_url: fixture.base_url, stream: false }))), "OK");
});

test("流内错误、提前断开、输出截断会中止，异常中的长短密钥均脱敏", async (t) => {
  let response = frame({ type: "error", error: { message: `invalid ${key}` } });
  const fixture = await upstream(t, (req, res) => { res.setHeader("Content-Type", "text/event-stream"); res.end(response); });
  const client = new ModelClient(cfg({ base_url: fixture.base_url }));
  await assert.rejects(collect(client), (error) => /模型流错误/.test(error.message) && !error.message.includes(key));
  response = frame({ choices: [{ delta: { content: "半段叙述" } }] });
  await assert.rejects(collect(client), /提前断开/);
  response = frame({ choices: [{ delta: {}, finish_reason: "length" }] });
  await assert.rejects(collect(client), /token 上限/);
});

test("模型元数据覆盖旧快照：Anthropic advertised effort 与 thinking types 生效", () => {
  const model = describeModel("anthropic", { id: "new-claude", display_name: "New Claude", max_tokens: 16000, capabilities: { thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } }, effort: { low: { supported: true }, high: { supported: true }, max: { supported: false } } } });
  assert.deepEqual(model.efforts, ["low", "high"]); assert.deepEqual(model.thinking_modes, ["default", "adaptive"]);
  assert.equal(model.max_output_tokens, 16000);
});

test("网页切换服务或模型会重置参数和临时密钥，nullable 采样配置保持为空", () => {
  const form = modelForm(maskedConfig(cfg({ temperature: null, top_p: null })));
  assert.equal(form.temperature, null); assert.equal(form.api_key, ""); assert.equal("api_key" in modelPatch(form), false);
  form.api_key = "temporary-secret"; form.reasoning_effort = "max";
  selectProvider(form, "opencode-go");
  assert.equal(form.base_url, "https://opencode.ai/zen/go/v1"); assert.equal(form.api_key, ""); assert.equal(form.reasoning_effort, "default");
  selectModel(form, modelInfo(cfg({ llm_provider: "opencode-go", model: "glm-5.2" })));
  assert.equal(form.model, "glm-5.2"); assert.equal(form.thinking, "default");
  assert.equal(samplingControls(cfg({ thinking: "enabled" }), modelInfo(cfg())).temperature, false);
});

test("Go 动态目录展示返回的全部新模型，能力读取不会携带用户密钥", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url) === "https://models.dev/api.json") return Response.json({ "opencode-go": { npm: "@ai-sdk/openai-compatible", models: { "new-go-model": { id: "new-go-model", temperature: false, reasoning: true, reasoning_options: [{ type: "effort", values: ["high", "max"] }], limit: { output: 24000 } } } } });
    return Response.json({ data: [{ id: "glm-5.2" }, { id: "new-go-model" }] });
  });
  const config = cfg({ llm_provider: "opencode-go", base_url: "http://localhost:9888/v1", model: "new-go-model" });
  const result = await fetchModelCatalog(config);
  assert.equal(result.source, "live"); assert.deepEqual(result.models.map((m) => m.id), ["glm-5.2", "new-go-model"]);
  assert.equal(calls[0].url, "http://localhost:9888/v1/models"); assert.equal(calls[0].options.headers.Authorization, `Bearer ${key}`);
  assert.equal(calls[1].options.headers, undefined);
  const req = buildModelRequest({ ...config, reasoning_effort: "max" }, messages);
  assert.equal(req.payload.reasoning_effort, "max"); assert.equal("temperature" in req.payload, false);
  assert.equal(req.model.max_output_tokens, 24000);
  const saved = { ...config, llm_model_info: storedModelInfo(config) };
  const restarted = await import("./catalog.js?restart-fixture");
  assert.equal(restarted.modelInfo(saved).max_output_tokens, 24000);
  assert.deepEqual(restarted.modelInfo(saved).efforts, ["high", "max"]);
  assert.equal(restarted.modelInfo({ ...saved, base_url: "https://another.invalid/v1" }).known, false);
  assert.equal(restarted.modelInfo({ ...saved, api_key: "different-key" }).known, false);
  assert.equal(restarted.modelInfo({ ...saved, model: "another-model" }).known, false);
});

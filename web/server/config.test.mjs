import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createApp } from "./index.js";
import { CONFIG_PATH, defaultConfig, loadConfig, maskedConfig, mergeConfigPatch, modelConfigured, normalizeConfig, saveConfig, templateConfig, updateConfig } from "./config.js";
import { redact } from "./llm/redact.js";
import { GMClient } from "./gm.js";

const TEST_KEY = "sk-offline-config-test-76ab91";
const apiConfig = (extra = {}) => ({ llm_mode: "api", llm_provider: "openai-compatible", api_auth: "bearer", base_url: "https://example.invalid/v1", model: "test-model", api_key: TEST_KEY, ...extra });

function temporaryConfig(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-llm-config-"));
  t.after(() => {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("rpg-llm-config-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return path.join(dir, "config.json");
}

function closeServer(server) {
  return new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
}

/** 配置文件用内存替身，模型用真实本机 HTTP 假服务；不读写用户配置、不调用线上 API。 */
async function httpFixture(t, initial = defaultConfig()) {
  const files = new Map([[CONFIG_PATH, JSON.stringify(initial)]]);
  for (const method of ["existsSync", "readFileSync", "writeFileSync", "renameSync"]) {
    const original = fs[method].bind(fs);
    t.mock.method(fs, method, (...args) => {
      const p = String(args[0]);
      if (![CONFIG_PATH, `${CONFIG_PATH}.tmp`].includes(p)) return original(...args);
      if (method === "existsSync") return files.has(p);
      if (method === "readFileSync") return args[1] ? files.get(p) : Buffer.from(files.get(p));
      if (method === "writeFileSync") { files.set(p, String(args[1])); return; }
      files.set(String(args[1]), files.get(p)); files.delete(p);
    });
  }
  const calls = [], logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args.map(String).join(" ")));
  const upstream = { respond: (req, res) => res.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] })) };
  const provider = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
    res.setHeader("Content-Type", "application/json");
    upstream.respond(req, res);
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => provider.once("listening", resolve));
  t.after(() => closeServer(provider));
  const base_url = `http://127.0.0.1:${provider.address().port}/v1`;
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => closeServer(server));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (endpoint, body) => fetch(`${origin}${endpoint}`, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { files, calls, logs, upstream, base_url, request };
}

test("新模板不探测 Kimi 登录，未配置时使用演示回复", (t) => {
  const original = fs.existsSync.bind(fs);
  let credentialChecks = 0;
  t.mock.method(fs, "existsSync", (p) => {
    if (String(p).includes(".kimi-code")) { credentialChecks += 1; return true; }
    return original(p);
  });
  const cfg = templateConfig();
  assert.equal(cfg.llm_mode, "api");
  assert.equal(cfg.llm_provider, "deepseek");
  assert.equal(cfg.base_url, "https://api.deepseek.com"); assert.equal(cfg.model, ""); assert.equal(cfg.api_key, "");
  assert.equal(cfg.image_generation.enabled, false);
  assert.equal("kimi_oauth" in cfg, false);
  assert.equal(maskedConfig(cfg).auth_mode, "unconfigured");
  const client = new GMClient(cfg);
  assert.equal(client.echo, true); assert.equal("oauth" in client, false);
  assert.equal(credentialChecks, 0);
});

test("移除旧 Kimi 登录，迁移不转发旧凭证，通用 API 配置可继续使用", () => {
  for (const raw of [
    { llm_mode: "kimi-oauth", base_url: "https://api.kimi.com/coding/v1", model: "k3", api_key: "old-key", image_generation: { enabled: false, profile: "qwen-image-2512" } },
    { base_url: "https://api.kimi.com/coding/v1", kimi_oauth: { enabled: true } },
  ]) {
    const cfg = normalizeConfig(raw);
    assert.equal(cfg.llm_mode, "api"); assert.equal(cfg.llm_provider, "deepseek");
    assert.equal(cfg.model, ""); assert.equal(cfg.api_key, ""); assert.equal("kimi_oauth" in cfg, false);
    assert.equal(new GMClient(cfg).echo, true); assert.equal("kimi_defaults" in maskedConfig(cfg), false);
  }
  const cfg = normalizeConfig({ base_url: "https://example.invalid/v1", model: "a", api_key: TEST_KEY });
  assert.equal(cfg.llm_provider, "openai-compatible"); assert.equal(cfg.api_key, TEST_KEY);
  assert.throws(() => mergeConfigPatch(cfg, { llm_mode: "kimi-oauth" }), (e) => e.status === 400);
});

test("首次生成模板和保存后的重读使用同一 JSON 配置，文件外的密钥被掩码", (t) => {
  const file = temporaryConfig(t);
  const first = loadConfig(file);
  assert.equal(modelConfigured(first), false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).llm_mode, "api");
  updateConfig(apiConfig({ base_url: "https://example.invalid/v1/chat/completions/", model: " 测试模型 " }), file);
  const restarted = loadConfig(file);
  assert.equal(restarted.base_url, "https://example.invalid/v1");
  assert.equal(restarted.model, "测试模型"); assert.equal(restarted.api_key, TEST_KEY);
  assert.equal(modelConfigured(restarted), true);
  assert.equal(maskedConfig(restarted).api_key_tail, TEST_KEY.slice(-4));
  assert.equal(JSON.stringify(maskedConfig(restarted)).includes(TEST_KEY), false);
  assert.equal(maskedConfig(apiConfig({ api_key: "abcd" })).api_key_tail, "***");
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test("同一地址省略密钥会保留，换地址或接入方式会清除，显式新密钥和清除均可保存", (t) => {
  const file = temporaryConfig(t);
  saveConfig(apiConfig(), file);
  assert.equal(updateConfig({ model: "another-model" }, file).api_key, TEST_KEY);
  assert.equal(updateConfig({ base_url: "https://other.invalid/v1" }, file).api_key, "");
  assert.equal(modelConfigured(loadConfig(file)), false);
  assert.equal(updateConfig({ api_key: "new-service-key" }, file).api_key, "new-service-key");
  assert.equal(updateConfig({ base_url: "https://third.invalid", api_key: TEST_KEY }, file).api_key, TEST_KEY);
  assert.equal(updateConfig({ api_auth: "none" }, file).api_key, "");
  assert.equal(modelConfigured(loadConfig(file)), true);
  assert.equal(updateConfig({ api_auth: "bearer", api_key: TEST_KEY }, file).api_key, TEST_KEY);
  assert.equal(updateConfig({ llm_mode: "demo" }, file).api_key, "");
  assert.equal(maskedConfig(loadConfig(file)).auth_mode, "echo");
  assert.equal(updateConfig({ llm_mode: "api", api_key: TEST_KEY }, file).api_key, TEST_KEY);
  assert.equal(updateConfig({ api_key: "" }, file).api_key, "");
});

test("非法模式和地址不能覆盖文件，图片字段更新兼容旧的不完整文字配置", (t) => {
  const file = temporaryConfig(t);
  saveConfig(apiConfig(), file);
  const before = fs.readFileSync(file, "utf8");
  for (const patch of [{ llm_mode: "unknown" }, { api_auth: "basic" }, { base_url: "file:///config" },
    { base_url: "https://user:pass@example.invalid/v1" }, { base_url: "https://example.invalid/?key=secret" },
    { base_url: "https://example.invalid/#fragment" }, { model: "" }]) {
    assert.throws(() => updateConfig(patch, file), (e) => e.status === 400);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  }
  const legacy = { api_key: TEST_KEY, kimi_oauth: { enabled: false } };
  const imageOnly = mergeConfigPatch(legacy, { image_generation: { enabled: false, profile: "qwen-image-2512" } });
  assert.equal(imageOnly.api_key, TEST_KEY); assert.equal(imageOnly.image_generation.profile, "qwen-image-2512");
});

test("API 保存端点持久化配置，读取不泄露密钥，后续客户端使用相同地址和模型", async (t) => {
  const { request, files, base_url, calls } = await httpFixture(t);
  const response = await request("/api/config", apiConfig({ base_url }));
  assert.equal(response.status, 200);
  const view = await response.json();
  assert.equal(view.configured, true); assert.equal(view.auth_mode, "api-key");
  assert.equal(JSON.stringify(view).includes(TEST_KEY), false);
  assert.equal((await (await request("/api/config")).json()).model, "test-model");
  const cfg = loadConfig();
  assert.equal(JSON.parse(files.get(CONFIG_PATH)).api_key, TEST_KEY);
  const client = new GMClient({ ...cfg, stream: false });
  let reply = "";
  for await (const text of client.streamChat([{ role: "user", content: "offline test" }])) reply += text;
  assert.equal(reply, "OK");
  assert.equal(calls[0].url, "/v1/chat/completions");
  assert.equal(calls[0].body.model, "test-model");
  assert.equal(calls[0].headers.authorization, `Bearer ${TEST_KEY}`);
});

test("连接测试只验证候选配置，成功后也不保存文件或回传模型回复", async (t) => {
  const { request, files, base_url, calls, upstream } = await httpFixture(t);
  const before = files.get(CONFIG_PATH);
  upstream.respond = (req, res) => res.end(JSON.stringify({ choices: [{ message: { content: TEST_KEY } }] }));
  const response = await request("/api/config/test", apiConfig({ base_url, model: "candidate-model" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true); assert.equal(result.model, "candidate-model");
  assert.equal(JSON.stringify(result).includes(TEST_KEY), false);
  assert.equal(files.get(CONFIG_PATH), before);
  assert.equal((await (await request("/api/config")).json()).configured, false);
  assert.equal(calls[0].body.model, "candidate-model");
  assert.equal(calls[0].body.stream === true, false);
  assert.equal(calls[0].headers.authorization, `Bearer ${TEST_KEY}`);
});

test("已保存 API 的流式请求使用同一地址、模型和密钥，并读取 SSE 增量", async (t) => {
  const { request, base_url, calls, upstream } = await httpFixture(t);
  await request("/api/config", apiConfig({ base_url, stream: true }));
  upstream.respond = (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    for (const content of ["你好", "，冒险者。"]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  };
  const client = new GMClient(loadConfig());
  const chunks = [];
  for await (const chunk of client.streamChat([{ role: "user", content: "offline SSE test" }])) chunks.push(chunk);
  assert.deepEqual(chunks, ["你好", "，冒险者。"]);
  assert.equal(calls[0].body.stream, true); assert.equal(calls[0].body.model, "test-model");
  assert.equal(calls[0].url, "/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, `Bearer ${TEST_KEY}`);
});

test("测试相同接口可复用已存密钥，更换接口后不会携带旧密钥", async (t) => {
  const { request, base_url, calls } = await httpFixture(t);
  await request("/api/config", apiConfig({ base_url }));
  const same = await request("/api/config/test", { model: "updated-model" });
  assert.equal(same.status, 200); assert.equal(calls[0].headers.authorization, `Bearer ${TEST_KEY}`);
  const changed = await request("/api/config/test", { base_url: `${base_url}/other` });
  assert.equal(changed.status, 400);
  assert.equal(calls.length, 1);
});

test("无需认证的本地 API 可以保存和测试，Authorization 头不会发送", async (t) => {
  const { request, base_url, calls } = await httpFixture(t);
  const patch = apiConfig({ base_url, api_auth: "none", api_key: "" });
  const saved = await (await request("/api/config", patch)).json();
  assert.equal(saved.configured, true); assert.equal(saved.auth_mode, "no-auth"); assert.equal(saved.has_api_key, false);
  assert.equal((await request("/api/config/test", {})).status, 200);
  assert.equal(calls[0].headers.authorization, undefined);
});

test("模型错误、空回复和非法 JSON 都报告失败，长短密钥在响应和日志中脱敏", async (t) => {
  const { request, base_url, logs, upstream } = await httpFixture(t);
  for (const key of ["abc", `sk-${"longsecret-".repeat(48)}`]) {
    upstream.respond = (req, res) => { res.statusCode = 401; res.end(`Invalid key: ${key}`); };
    const response = await request("/api/config/test", apiConfig({ base_url, api_key: key }));
    assert.equal(response.status, 502);
    const error = await response.text();
    assert.match(error, /401/); assert.equal(error.includes(key.slice(0, 24)), false);
    assert.equal(logs.join("\n").includes(key.slice(0, 24)), false);
  }
  upstream.respond = (req, res) => res.end(JSON.stringify({ choices: [] }));
  const empty = await request("/api/config/test", apiConfig({ base_url }));
  assert.equal(empty.status, 502); assert.match((await empty.json()).error, /没有返回可用/);
  upstream.respond = (req, res) => res.end(`not-json${TEST_KEY}`);
  const invalid = await request("/api/config/test", apiConfig({ base_url }));
  assert.equal(invalid.status, 502);
  const invalidError = (await invalid.json()).error;
  assert.match(invalidError, /不是 JSON/); assert.equal(invalidError.includes(TEST_KEY.slice(0, 10)), false);
  assert.equal(redact("key abc", ["abc"]), "key ***");
});

test("缺少配置或演示模式不能触发连接请求，配置端点只接受 JSON", async (t) => {
  const { request, calls } = await httpFixture(t);
  assert.equal((await request("/api/config/test", {})).status, 400);
  assert.equal((await request("/api/config/test", { llm_mode: "demo" })).status, 400);
  const demo = await (await request("/api/config", { llm_mode: "demo" })).json();
  assert.equal(demo.echo, true); assert.equal(demo.llm_mode, "demo");
  assert.equal(calls.length, 0);
  const port = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => port.once("listening", resolve));
  t.after(() => closeServer(port));
  const origin = `http://127.0.0.1:${port.address().port}`;
  for (const endpoint of ["config", "config/test"]) {
    const wrong = await fetch(`${origin}/api/${endpoint}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(wrong.status, 415);
    const malformed = await fetch(`${origin}/api/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"api_key":"not-public",' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.text()).includes("not-public"), false);
  }
});

test("网页的环境指引地址返回中文说明，不被前端 SPA 回退覆盖", async (t) => {
  const { request } = await httpFixture(t);
  const response = await request("/guide");
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /text\/plain.*utf-8/i);
  const text = await response.text();
  assert.match(text, /RPG 项目环境配置指引/); assert.match(text, /安装项目依赖\.bat/);
  assert.match(text, /web\/config\.json/); assert.match(text, /无需密钥/);
  assert.equal(text.includes(TEST_KEY), false); assert.equal(text.includes('<div id="app">'), false);
});

test("Anthropic 模型目录完整分页，候选密钥只发往候选接口，目录读取不保存配置", async (t) => {
  const { request, files, base_url, calls, upstream } = await httpFixture(t);
  const before = files.get(CONFIG_PATH);
  upstream.respond = (req, res) => res.end(JSON.stringify(req.url.includes("after_id")
    ? { data: [{ id: "second-model", display_name: "第二个模型", max_tokens: 16000 }], has_more: false, last_id: "second-model" }
    : { data: [{ id: "first-model", display_name: "第一个模型", max_tokens: 8192 }], has_more: true, last_id: "first-model" }));
  const response = await request("/api/config/models", { llm_provider: "anthropic", base_url, api_key: TEST_KEY, model: "" });
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.source, "live"); assert.deepEqual(catalog.models.map((m) => m.id), ["first-model", "second-model"]);
  assert.equal(calls.length, 2); assert.match(calls[1].url, /after_id=first-model/);
  assert.equal(calls[0].headers["x-api-key"], TEST_KEY); assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].headers["anthropic-version"], "2023-06-01");
  assert.equal(calls[0].body, null); assert.equal(files.get(CONFIG_PATH), before); assert.equal(JSON.stringify(catalog).includes(TEST_KEY), false);
});

test("模型目录鉴权失败不伪装成功、不回显密钥，也不覆盖已存配置", async (t) => {
  const { request, files, base_url, upstream } = await httpFixture(t);
  const before = files.get(CONFIG_PATH);
  upstream.respond = (req, res) => { res.statusCode = 401; res.end(`Invalid ${TEST_KEY}`); };
  const response = await request("/api/config/models", apiConfig({ base_url }));
  assert.equal(response.status, 401); assert.equal((await response.text()).includes(TEST_KEY), false);
  assert.equal(files.get(CONFIG_PATH), before);
});

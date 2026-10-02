import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { buildProfileWorkflow, getProfile, imageSettings, listProfiles, runtimePaths } from "./profiles.js";
import { ImageRuntime, imageRuntime } from "./runtime.js";
import { executeWorkflow, validateWorkflow } from "./comfyClient.js";
import { normalizeConfig, updateConfig, maskedConfig, CONFIG_PATH } from "../config.js";
import { shouldCopyComfy } from "../../../scripts/image-import-plan.mjs";
import { createApp } from "../index.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-image-test-"));
  const paths = runtimePaths(root);
  const write = (file, value = "fixture") => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  for (const file of [paths.python, paths.bootstrap, path.join(paths.comfy, "main.py")]) write(file);
  write(paths.install, JSON.stringify({ completed: true }));
  for (const spec of Object.values(getProfile().models)) write(path.join(paths.models, spec.directory, spec.file));
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("rpg-image-test-")) throw new Error("测试清理路径越界");
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, paths, write };
}

function childProcess() {
  const child = new EventEmitter();
  Object.assign(child, { pid: 12345, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter(), kills: 0 });
  child.kill = () => { child.kills += 1; queueMicrotask(() => { child.exitCode = 0; child.emit("exit", 0); }); return true; };
  return child;
}

test("源码迁入只排除顶层权重目录，保留 comfy/ldm/models 的实现", () => {
  const root = path.resolve("source-comfy");
  assert.equal(shouldCopyComfy(root, path.join(root, "models", "weights.bin")), false);
  assert.equal(shouldCopyComfy(root, path.join(root, "comfy", "ldm", "models", "autoencoder.py")), true);
  assert.equal(shouldCopyComfy(root, path.join(root, "venv", "python.exe")), false);
  assert.equal(shouldCopyComfy(root, path.join(root, "comfy", "__pycache__", "old.pyc")), false);
  assert.equal(shouldCopyComfy(root, path.join(root, "..", "other.py")), false);
});

test("两个模型档案各自使用匹配的编码器、VAE、采样器和 LoRA", () => {
  const zit = buildProfileWorkflow({ prompt: "港口", seed: 42 });
  assert.equal(zit.workflow["2"].inputs.type, "lumina2");
  assert.equal(zit.workflow["4"].class_type, "LoraLoaderModelOnly");
  assert.equal(zit.workflow["7"].inputs.steps, 8);
  assert.equal(zit.workflow["7"].inputs.seed, 42);
  const qwen = buildProfileWorkflow({ profile: "qwen-image-2512", prompt: "港口", seed: 42 });
  assert.equal(qwen.workflow["2"].inputs.type, "qwen_image");
  assert.equal(qwen.workflow["3"].inputs.vae_name, "qwen_image_vae.safetensors");
  assert.equal(qwen.workflow["8"].inputs.steps, 50);
  assert.equal(Object.values(qwen.workflow).some((node) => node.class_type === "LoraLoaderModelOnly"), false);
  assert.equal(JSON.stringify(qwen.workflow).includes("{{"), false);
  assert.throws(() => buildProfileWorkflow({ profile: "../other" }), /未知生图/);
  assert.throws(() => buildProfileWorkflow({ width: 1025 }), /8 的倍数/);
  assert.throws(() => buildProfileWorkflow({ steps: 0 }), /采样步数/);
});

test("模型组件不全时不会显示为可用档案", (t) => {
  const { root } = fixture(t);
  const all = listProfiles(root);
  assert.equal(all.find((p) => p.id === "z-image-turbo").available, true);
  const qwen = all.find((p) => p.id === "qwen-image-2512");
  assert.equal(qwen.available, false);
  assert.equal(qwen.models.every((model) => !model.installed), true);
});

test("配置使用项目内服务为默认，外部模式保留地址，部分更新保留其他设置", (t) => {
  const { root } = fixture(t);
  assert.deepEqual(imageSettings({ port: -1, startup_timeout: 0, profile: "unknown" }), imageSettings());
  assert.deepEqual(imageSettings(null), imageSettings());
  assert.equal(normalizeConfig({ comfy_url: "http://host:9" }).comfy_url, "http://127.0.0.1:8188");
  const configPath = path.join(root, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ api_key: "test-config-value", kimi_oauth: { enabled: false }, comfy_url: "http://host:9", image_generation: { mode: "external", port: 9000, profile: "qwen-image-2512" } }));
  const config = updateConfig({ image_generation: { auto_start: false } }, configPath);
  assert.equal(config.image_generation.mode, "external");
  assert.equal(config.image_generation.port, 9000);
  assert.equal(config.image_generation.profile, "qwen-image-2512");
  assert.equal(config.comfy_url, "http://host:9");
  assert.equal(JSON.stringify(maskedConfig(config)).includes("test-config-value"), false);
});

test("并发出图请求只启动一次项目进程，启动参数和缓存均在工程内", async (t) => {
  const { paths } = fixture(t);
  const child = childProcess();
  let spawns = 0, online = false;
  const runtime = new ImageRuntime({ paths, wait: async () => {},
    fetcher: async () => ({ ok: online, json: async () => ({ system: { argv: ["main.py", "--models-directory", paths.models] } }) }),
    spawnProcess: (python, args, options) => {
      spawns += 1; online = true;
      assert.equal(python, paths.python);
      assert.equal(options.windowsHide, true);
      assert.equal(options.env.PYTHONHOME, path.dirname(paths.python));
      assert.equal(options.env.HF_HUB_OFFLINE, "1");
      assert.equal(args[args.indexOf("--models-directory") + 1], paths.models);
      return child;
    },
  });
  const cfg = normalizeConfig({});
  const result = await Promise.all([runtime.ensureReady(cfg), runtime.ensureReady(cfg)]);
  assert.equal(spawns, 1);
  assert.deepEqual(result, [cfg.comfy_url, cfg.comfy_url]);
  assert.equal((await runtime.status(cfg)).managed, true);
  await Promise.all([runtime.stop(), runtime.stop()]);
  assert.equal(child.kills, 1);
  assert.equal(await runtime.stop(), false);
});

test("内部端口被其他 ComfyUI 占用时拒绝接管，不创建或终止进程", async (t) => {
  const { paths } = fixture(t);
  const runtime = new ImageRuntime({ paths, spawnProcess: () => assert.fail("不应启动"),
    fetcher: async () => ({ ok: true, json: async () => ({ system: { argv: ["other-main.py"] } }) }),
  });
  await assert.rejects(runtime.ensureReady(normalizeConfig({})), /其他 ComfyUI/);
  assert.equal(await runtime.stop(), false);
  assert.equal((await runtime.status(normalizeConfig({}))).online, false);
});

test("外部模式只连接服务，项目未安装也不会自动创建内部进程", async (t) => {
  const { paths } = fixture(t);
  fs.unlinkSync(paths.install);
  const runtime = new ImageRuntime({ paths, spawnProcess: () => assert.fail("不应启动内部进程"),
    fetcher: async () => ({ ok: true, json: async () => ({ system: {} }) }),
  });
  const cfg = normalizeConfig({ comfy_url: "http://external:8188", image_generation: { mode: "external" } });
  assert.equal(await runtime.ensureReady(cfg), "http://external:8188");
  assert.equal((await runtime.status(cfg)).managed, false);
  assert.equal(await runtime.stop(), false);
});

test("关闭自动启动或缺少模型时返回明确错误，不伪造就绪状态", async (t) => {
  const { paths } = fixture(t);
  const runtime = new ImageRuntime({ paths, spawnProcess: () => assert.fail("不应启动"), fetcher: async () => ({ ok: false }) });
  await assert.rejects(runtime.ensureReady(normalizeConfig({ image_generation: { auto_start: false } })), /尚未启动/);
  await assert.rejects(runtime.ensureReady(normalizeConfig({ image_generation: { profile: "qwen-image-2512" } })), /模型组件未齐全/);
});

test("提交前校验节点与枚举，发现缺失组件便停止", async () => {
  const workflow = { 1: { class_type: "UNETLoader", inputs: { unet_name: "required-model" } } };
  await assert.rejects(validateWorkflow("http://test", workflow, async () => ({ ok: true, json: async () => ({}) })), /缺少节点/);
  await assert.rejects(validateWorkflow("http://test", workflow, async () => ({ ok: true, json: async () => ({ UNETLoader: { input: { required: { unet_name: [["other-model"]] } } } }) })), /不支持/);
});

test("HTTP 客户端处理队列、取得 PNG，任务失败与超时不会自动重复提交", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqQAAAABJRU5ErkJggg==", "base64");
  let submissions = 0, polls = 0;
  const fetcher = async (url) => {
    if (url.endsWith("/prompt")) { submissions += 1; return { ok: true, json: async () => ({ prompt_id: "p1", node_errors: {} }) }; }
    if (url.includes("/history/")) { polls += 1; return { ok: true, json: async () => polls === 1 ? {} : { p1: { status: { completed: true }, outputs: { 9: { images: [{ filename: "image.png" }] } } } } }; }
    return { ok: true, arrayBuffer: async () => png };
  };
  const result = await executeWorkflow("http://test", {}, { fetcher, wait: async () => {} });
  assert.deepEqual(result.buffer, png);
  assert.equal(submissions, 1);
  let time = 0;
  await assert.rejects(executeWorkflow("http://test", {}, {
    fetcher: async (url) => ({ ok: true, json: async () => url.endsWith("/prompt") ? { prompt_id: "p2" } : {} }),
    now: () => time, wait: async () => { time += 6; }, timeoutMs: 10,
  }), /任务 p2 可能仍在队列/);
  await assert.rejects(executeWorkflow("http://test", {}, {
    fetcher: async (url) => ({ ok: true, json: async () => url.endsWith("/prompt") ? { prompt_id: "p3" } : { p3: { status: { status_str: "error", messages: ["out of memory"] } } } }), wait: async () => {},
  }), /生成失败/);
});

test("运行时状态和启停 HTTP 接口不依赖玩家存档", async (t) => {
  const originalRead = fs.readFileSync.bind(fs);
  t.mock.method(fs, "readFileSync", (file, ...args) => String(file) === CONFIG_PATH ? JSON.stringify({ kimi_oauth: { enabled: false } }) : originalRead(file, ...args));
  let started = 0, stopped = 0;
  t.mock.method(imageRuntime, "status", async () => ({ mode: "internal", ready: started > stopped, profiles: [] }));
  t.mock.method(imageRuntime, "ensureReady", async () => { started += 1; });
  t.mock.method(imageRuntime, "stop", async () => { stopped += 1; return true; });
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/image`;
  assert.equal((await fetch(`${base}/status`)).status, 200);
  assert.equal((await (await fetch(`${base}/runtime/start`, { method: "POST" })).json()).ready, true);
  assert.equal((await (await fetch(`${base}/runtime/stop`, { method: "POST" })).json()).stopped, true);
  assert.equal(started, 1);
  assert.equal(stopped, 1);
});

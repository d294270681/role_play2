import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { assessHardware, detectEnvironment, GiB, parseNvidiaGpus } from "./hardware.js";
import { verifiedDownload } from "./download.js";
import { LocalImageInstaller, ownedPath, runCommand } from "./install.js";
import { ImageSetup, imageSetup } from "./setup.js";
import { getProfile, runtimePaths } from "./profiles.js";
import { CONFIG_PATH, normalizeConfig } from "../config.js";
import { createApp, main } from "../index.js";
import { imageRuntime } from "./runtime.js";
import { GMClient, runTurn } from "../gm.js";
import { loadModule } from "../engine/moduleLoader.js";
import { newGame } from "../engine/state.js";

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const blob = Buffer.from("good-weights");
const spec = { url: "https://huggingface.co/fixture/model.bin", bytes: blob.length, sha256: sha(blob) };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-setup-test-"));
  const paths = runtimePaths(root);
  const write = (file, value = "fixture") => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("rpg-setup-test-")) throw new Error("测试清理路径越界");
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, paths, write };
}

const hardware = () => ({ platform: "win32", arch: "x64", ram_bytes: 63.8 * GiB, free_ram_bytes: 32 * GiB,
  cpu: { name: "Test CPU", threads: 16 }, disk_free_bytes: 100 * GiB,
  gpus: [{ index: 0, name: "Test NVIDIA GPU", vram_bytes: 24 * GiB, free_bytes: 24 * GiB, driver: "616.64", compute_capability: 8.6 }] });

function jobFixture(t, options = {}) {
  const { paths, write } = fixture(t);
  let cfg = normalizeConfig({ kimi_oauth: { enabled: false } });
  const patches = [];
  const runtime = { stop: async () => false, probe: async () => null, belongsToProject: () => false, ensureReady: () => assert.fail("安装不得启动 ComfyUI") };
  const setup = new ImageSetup({ paths, runtime, loadConfig: () => cfg,
    updateConfig: (patch) => { patches.push(patch); cfg = normalizeConfig({ ...cfg, image_generation: { ...cfg.image_generation, ...patch.image_generation } }); return cfg; },
    detector: async (id) => assessHardware(hardware(), getProfile(id)), installer: { install: async () => ({ runtime: {}, models: [] }) }, ...options });
  return { setup, paths, write, cfg: () => cfg, patches };
}

test("检测逐项检查 GPU/内存/CPU，按模型给出要求并选实际使用的 GPU", () => {
  const hw = hardware();
  hw.gpus.unshift({ ...hw.gpus[0], index: 1, vram_bytes: 8 * GiB });
  assert.equal(assessHardware(hw, getProfile("qwen-image-2512")).device, 0);
  hw.ram_bytes = 31.8 * GiB;
  assert.equal(assessHardware(hw, getProfile()).eligible, true);
  const qwen = assessHardware(hw, getProfile("qwen-image-2512"));
  assert.equal(qwen.eligible, false);
  assert.match(qwen.checks.find((c) => c.id === "ram").reason, /48/);
  assert.match(qwen.recommendation, /图片 API 暂未接入/);
  hw.cpu.threads = 2; hw.gpus = [];
  const unsupported = assessHardware(hw, getProfile());
  assert.equal(unsupported.checks.find((c) => c.id === "cpu").passed, false);
  assert.equal(unsupported.checks.find((c) => c.id === "gpu").passed, false);
});

test("驱动/架构未知、非 Windows 和磁盘不足都不误判为可安装", () => {
  const hw = hardware(); hw.gpus[0].driver = "N/A"; hw.gpus[0].compute_capability = null;
  hw.platform = "linux"; hw.disk_free_bytes = GiB;
  const report = assessHardware(hw, getProfile(), { missingBytes: 20 * GiB });
  assert.equal(report.eligible, false);
  assert.deepEqual(report.checks.filter((c) => !c.passed).map((c) => c.id), ["platform", "compute", "driver", "disk"]);
  assert.deepEqual(parseNvidiaGpus('1, "NVIDIA RTX 3090", 24576, 20000, 616.64, 8.6')[0].index, 1);
  assert.equal(parseNvidiaGpus("bad output").length, 0);
});

test("硬件探测失败有明确建议，不调用 Python，资源只在显式检测时读取", async (t) => {
  const { paths } = fixture(t);
  const calls = [];
  const report = await detectEnvironment("z-image-turbo", { paths,
    system: { platform: () => "win32", arch: () => "x64", cpus: () => [{ model: "CPU" }], totalmem: () => 16 * GiB, freemem: () => GiB },
    run: async (cmd, args, opts) => { calls.push(cmd); assert.equal(opts.windowsHide, true); throw new Error("no driver"); },
    statfs: async () => { throw new Error("no disk"); },
  });
  assert.equal(report.eligible, false);
  assert.equal(report.hardware.gpus.length, 0);
  assert.equal(calls.every((cmd) => cmd.includes("nvidia-smi")), true);
  assert.match(report.recommendation, /图片 API/);
});

test("下载正确续传并校验，完成前不暴露最终文件，已完整文件不访问网络", async (t) => {
  const { root, write } = fixture(t), dest = path.join(root, "model.bin");
  write(`${dest}.part`, blob.subarray(0, 3));
  let calls = 0;
  await verifiedDownload(spec, dest, { fetcher: async (url, opts) => {
    calls += 1; assert.equal(opts.headers.Range, "bytes=3-"); assert.equal(fs.existsSync(dest), false);
    return new Response(blob.subarray(3), { status: 206, headers: { "content-range": `bytes 3-${blob.length - 1}/${blob.length}` } });
  } });
  assert.deepEqual(fs.readFileSync(dest), blob);
  assert.equal(fs.existsSync(`${dest}.part`), false);
  await verifiedDownload(spec, dest, { fetcher: () => assert.fail("已有校验正确文件不应下载") });
  assert.equal(calls, 1);
});

test("服务器忽略 Range 时重下；同大小损坏文件不能被当成缓存", async (t) => {
  const { root, write } = fixture(t), dest = path.join(root, "model.bin");
  write(dest, Buffer.alloc(blob.length)); write(`${dest}.part`, "bad");
  await verifiedDownload(spec, dest, { fetcher: async () => new Response(blob) });
  assert.deepEqual(fs.readFileSync(dest), blob);
});

test("一个官方源不可达时切到备用源，仍按同一哈希和大小验收", async (t) => {
  const { root } = fixture(t), dest = path.join(root, "model.bin"), calls = [];
  const sources = ["https://modelscope.cn/fixture", spec.url];
  await verifiedDownload({ ...spec, urls: sources }, dest, { wait: async () => {}, fetcher: async (url) => {
    calls.push(url); if (url === sources[0]) throw new Error("offline"); return new Response(blob);
  } });
  assert.deepEqual(calls, sources); assert.deepEqual(fs.readFileSync(dest), blob);
});

test("错误续传范围、网络失败与错误哈希不会生成完成文件", async (t) => {
  const { root, write } = fixture(t), dest = path.join(root, "model.bin");
  write(`${dest}.part`, blob.subarray(0, 2));
  let calls = 0;
  await assert.rejects(verifiedDownload(spec, dest, { wait: async () => {}, fetcher: async () => {
    calls += 1; return new Response(blob.subarray(2), { status: 206, headers: { "content-range": `bytes 1-${blob.length - 1}/${blob.length}` } });
  } }), /续传范围/);
  assert.equal(calls, 3); assert.equal(fs.existsSync(dest), false);
  await assert.rejects(verifiedDownload(spec, dest, { wait: async () => {}, fetcher: async () => new Response(Buffer.alloc(blob.length)) }), /SHA256/);
  assert.equal(fs.existsSync(dest), false); assert.equal(fs.existsSync(`${dest}.part`), false);
});

test("取消下载保留断点，下一次操作可续传，不额外复制权重", async (t) => {
  const { root } = fixture(t), dest = path.join(root, "model.bin"), controller = new AbortController();
  const body = new ReadableStream({ start(c) { c.enqueue(blob.subarray(0, 4)); c.enqueue(blob.subarray(4)); c.close(); } });
  await assert.rejects(verifiedDownload(spec, dest, { signal: controller.signal, fetcher: async () => new Response(body),
    onProgress: (p) => { if (p.stage === "downloading" && p.received === 4) controller.abort(new Error("cancelled")); },
  }), /cancelled/);
  assert.equal(fs.statSync(`${dest}.part`).size, 4); assert.equal(fs.existsSync(dest), false);
  await verifiedDownload(spec, dest, { fetcher: async (url, opts) => {
    assert.equal(opts.headers.Range, "bytes=4-");
    return new Response(blob.subarray(4), { status: 206, headers: { "content-range": `bytes 4-${blob.length - 1}/${blob.length}` } });
  } });
  assert.deepEqual(fs.readFileSync(dest), blob);
});

test("配置器初始化/状态查询不检测硬件、不安装、不写磁盘，旧任务标为中断", (t) => {
  const { setup, paths, write } = jobFixture(t, { detector: () => assert.fail("不能检测"), installer: { install: () => assert.fail("不能安装") } });
  assert.equal(setup.status().status, "idle"); assert.equal(fs.existsSync(paths.setup), false);
  write(paths.setup, JSON.stringify({ status: "installing", active: true, profile: "z-image-turbo" }));
  const restarted = new ImageSetup({ paths, detector: () => assert.fail("重启不能自动检测") });
  assert.equal(restarted.status().status, "interrupted"); assert.equal(restarted.status().active, false);
});

test("不达标时只返回建议，完全不安装、不启用、不停止其他服务", async (t) => {
  const { setup, patches } = jobFixture(t, { detector: async (id) => ({ ...assessHardware({ ...hardware(), gpus: [] }, getProfile(id)) }),
    installer: { install: () => assert.fail("环境不符不应安装") }, runtime: { stop: () => assert.fail("不应操作运行环境") } });
  setup.start("z-image-turbo"); await setup.task;
  assert.equal(setup.status().status, "unsupported"); assert.equal(patches.length, 0);
  assert.match(setup.status().environment.recommendation, /图片 API/);
});

test("达标后串行配置，全部完成才启用；并发点击复用同一个任务", async (t) => {
  const gate = deferred(); let installs = 0;
  const { setup, cfg } = jobFixture(t, { installer: { install: async (profile, options) => {
    installs += 1; assert.equal(cfg().image_generation.enabled, false);
    options.onProgress({ phase: "models", download: { received: 4, total: 10 } });
    await gate.promise; return { models: ["verified"] };
  } } });
  const first = setup.start("z-image-turbo"), again = setup.start("z-image-turbo");
  assert.equal(first.id, again.id);
  assert.throws(() => setup.start("qwen-image-2512"), /已有安装任务/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(setup.status().status, "installing"); assert.equal(cfg().image_generation.enabled, false);
  gate.resolve(); await setup.task;
  assert.equal(installs, 1); assert.equal(setup.status().status, "ready");
  assert.equal(cfg().image_generation.enabled, true); assert.equal(cfg().image_generation.profile, "z-image-turbo");
  assert.equal(Number.isFinite(Date.parse(cfg().image_generation.configured_at)), true);
});

test("安装失败或关闭功能都保持禁用，关闭期间拒绝新的配置任务", async (t) => {
  const { setup, cfg } = jobFixture(t, { installer: { install: async () => { throw new Error("网络中断"); } } });
  setup.start("z-image-turbo"); await setup.task;
  assert.equal(setup.status().status, "failed"); assert.match(setup.status().error, /网络中断/);
  assert.equal(cfg().image_generation.enabled, false);
  const gate = deferred();
  setup.installer = { install: async (p, { signal }) => { gate.resolve(); await new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); } };
  setup.start("z-image-turbo"); await gate.promise;
  const disabling = setup.disable();
  assert.throws(() => setup.start("z-image-turbo"), /正在关闭/);
  await disabling;
  assert.equal(setup.status().status, "disabled"); assert.equal(cfg().image_generation.enabled, false);
});

test("安装器复用校验合格运行环境，校验所选模型并跳过可选 LoRA", async (t) => {
  const { paths, write } = fixture(t);
  for (const file of [paths.python, paths.bootstrap, path.join(paths.comfy, "main.py")]) write(file);
  write(paths.install, JSON.stringify({ completed: true }));
  write(path.join(paths.comfy, "comfyui_version.py"), '__version__ = "0.37.0"');
  const downloaded = [];
  const profile = getProfile();
  for (const m of Object.values(profile.models).filter((m) => !m.optional)) Object.assign(m, spec);
  const installer = new LocalImageInstaller({ paths, command: async (cmd, args, opts) => {
    assert.deepEqual(args, ["-s", paths.bootstrap, "--check"]);
    assert.equal(opts.env.CUDA_VISIBLE_DEVICES, "1");
    return JSON.stringify({ python: "3.10.11", torch: "2.9.1+cu128", torchvision: "0.24.1+cu128", cuda: true, dependencies: { torch: "runtime/python/Lib/site-packages/torch" } });
  }, download: async (s, file, options) => { downloaded.push(path.basename(file)); return verifiedDownload(s, file, { ...options, fetcher: async () => new Response(blob) }); } });
  const result = await installer.install(profile, { device: 1 });
  assert.equal(downloaded.length, 3); assert.equal(downloaded.includes("NSFW_master_ZIT.safetensors"), false);
  assert.equal(result.models.length, 3);
  assert.equal(JSON.parse(fs.readFileSync(paths.install, "utf8")).completed, true);
});

test("首次环境安装失败不留下完成标记，临时目录清理有边界检查", async (t) => {
  const { paths } = fixture(t);
  const installer = new LocalImageInstaller({ paths, download: async () => { throw new Error("下载失败"); } });
  await assert.rejects(installer.install(getProfile()), /下载失败/);
  assert.equal(JSON.parse(fs.readFileSync(paths.install, "utf8")).completed, false);
  assert.deepEqual(fs.readdirSync(path.join(paths.data, "setup")), []);
  assert.throws(() => ownedPath(paths.root, path.join(paths.root, "..", "escape")), /受管目录/);
});

test("命令的进度回调在取消时抛错也会关闭进程，不让服务崩溃", async () => {
  await assert.rejects(runCommand(process.execPath, ["-e", "console.log('progress');setTimeout(()=>{},10000)"], {
    onLine: () => { throw new Error("取消进度"); }, timeoutMs: 3000,
  }), /取消进度/);
});

test("未配置的 GM 回合即使给了 image_prompt 也不发起生成，不显示失败噪声", async (t) => {
  t.mock.method(imageRuntime, "ensureReady", () => assert.fail("不能触发生图"));
  t.mock.method(GMClient.prototype, "streamChat", async function* () {
    yield '剧情继续。\n```json\n{"action_cost":0,"state_patch":{},"suggestions":[],"image_prompt":"harbor"}\n```';
  });
  const events = [];
  for await (const event of runTurn(loadModule("gangcheng"), newGame("gangcheng"), "观察", { api_key: "", kimi_oauth: { enabled: false } })) events.push(event);
  assert.equal(events.some((e) => e.type === "state"), true);
  assert.equal(events.some((e) => e.type === "image" || /正在生成插图|插图生成失败/.test(e.text || "")), false);
});

test("回合开始时启用了图片，结束前关闭后不会按旧配置加载", async (t) => {
  const original = fs.readFileSync.bind(fs);
  t.mock.method(fs, "readFileSync", (file, ...args) => String(file) === CONFIG_PATH ? JSON.stringify({ kimi_oauth: { enabled: false }, image_generation: { enabled: false } }) : original(file, ...args));
  t.mock.method(imageRuntime, "ensureReady", () => assert.fail("不能使用旧配置生成图片"));
  t.mock.method(GMClient.prototype, "streamChat", async function* () {
    yield '剧情继续。\n```json\n{"action_cost":0,"state_patch":{},"suggestions":[],"image_prompt":"harbor"}\n```';
  });
  const events = [];
  for await (const event of runTurn(loadModule("gangcheng"), newGame("gangcheng"), "观察", { api_key: "", kimi_oauth: { enabled: false }, image_generation: { enabled: true, configured_at: "2026-10-03T00:00:00Z" } })) events.push(event);
  assert.equal(events.some((e) => e.type === "state"), true);
  assert.equal(events.some((e) => e.type === "image" || /正在生成插图/.test(e.text || "")), false);
});

test("默认游戏启动不调用运行时，即使缓存齐全；配置 API 不能绕过安装启用", async (t) => {
  const original = fs.readFileSync.bind(fs);
  t.mock.method(fs, "readFileSync", (file, ...args) => String(file) === CONFIG_PATH ? JSON.stringify({ kimi_oauth: { enabled: false }, image_generation: { auto_start: true } }) : original(file, ...args));
  t.mock.method(imageRuntime, "ensureReady", () => assert.fail("启动游戏不应启动 ComfyUI"));
  t.mock.method(imageRuntime, "stop", async () => false);
  t.mock.method(imageSetup, "cancel", async () => ({}));
  const server = main(["0"]);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const status = await (await fetch(`${base}/image/status`)).json();
  assert.equal(status.enabled, false); assert.equal(status.state, "disabled");
  const bypass = await fetch(`${base}/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_generation: { enabled: true, configured_at: "2026-10-03T00:00:00Z" } }) });
  assert.equal(bypass.status, 409);
  const implicit = await fetch(`${base}/image/setup`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(implicit.status, 415);
  const unknown = await fetch(`${base}/image/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: "../escape" }) });
  assert.equal(unknown.status, 400);
  assert.equal((await (await fetch(`${base}/image/setup`)).json()).active, false);
});

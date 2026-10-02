/** 实机验证项目内运行时，生成一张普通场景图；不修改玩家槽位。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, normalizeConfig } from "../web/server/config.js";
import { imageRuntime, generateImage } from "../web/server/comfy.js";

const option = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const cfg = normalizeConfig({ ...loadConfig(), image_generation: { mode: "internal", auto_start: true, profile: "z-image-turbo", port: option("--port", 8188) } });
const size = option("--size", 512);
const started = Date.now();
try {
  console.log("[AI] 启动项目内 ComfyUI…");
  await imageRuntime.ensureReady(cfg);
  const status = await imageRuntime.status(cfg);
  assert.equal(status.ready, true);
  console.log(`[AI] 服务就绪：${status.url}，模型 ${status.profile}`);
  const output = await generateImage({ module: { name: "integration-smoke", title: "港城出图验证" }, kind: "scene",
    prompt: "A quiet rainy harbor street at dusk, wet cobblestones, warm shop windows, fishing boats in the distance, cinematic environment art, no people, no text",
    config: cfg, parameters: { width: size, height: size, seed: 20261003 } });
  const png = fs.readFileSync(output.file);
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
  assert.equal(output.profile, "z-image-turbo");
  const report = { ...output, file: path.relative(process.cwd(), output.file), seconds: Math.round((Date.now() - started) / 1000), runtime: { mode: status.mode, managed: status.managed, ready: status.ready } };
  fs.writeFileSync(path.join(imageRuntime.paths.data, "smoke-result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await imageRuntime.stop();
  console.log("[AI] 本次验证创建的出图进程已关闭。");
}

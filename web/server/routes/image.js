/**
 * 生图端点：
 *   POST /api/image/generate {module, slot, kind, prompt?, anime?, name?}
 *     kind = scene（用 prompt，即 GM 的 image_prompt）/ location（当前地点立绘）/ portrait（角色头像）
 *   返回 {url, file, kind, prompt, prompt_id, ...}
 *
 * ComfyUI 不在线时快速 503（ComfyUnavailableError → 错误中间件），不阻塞、不崩主服务。
 */

import { Router } from "express";

import * as configMod from "../config.js";
import * as comfy from "../comfy.js";
import { detectEnvironment } from "../image/hardware.js";
import { imageSetup } from "../image/setup.js";
import { ApiError, loadModuleChecked, loadSave, slotArg, withSlotLock } from "./shared.js";

const router = Router();

router.get("/image/status", async (req, res, next) => {
  try { res.json({ ...await comfy.imageRuntime.status(configMod.loadConfig()), setup: imageSetup.status() }); } catch (e) { next(e); }
});

router.post("/image/environment", async (req, res, next) => {
  try { res.json(await detectEnvironment(String(req.body?.profile || configMod.loadConfig().image_generation.profile))); } catch (e) { next(e); }
});

router.get("/image/setup", (req, res) => { res.json(imageSetup.status()); });

router.post("/image/setup", (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new ApiError(415, "配置请求必须使用 JSON");
    if (typeof req.body?.profile !== "string" || !req.body.profile.trim()) throw new ApiError(400, "请选择生图模型");
    res.status(202).json(imageSetup.start(req.body.profile.trim()));
  } catch (e) { next(e); }
});

router.post("/image/setup/cancel", async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new ApiError(415, "取消请求必须使用 JSON");
    res.json(await imageSetup.cancel());
  } catch (e) { next(e); }
});

router.post("/image/disable", async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new ApiError(415, "关闭请求必须使用 JSON");
    const cfg = await imageSetup.disable();
    res.json({ ...await comfy.imageRuntime.status(cfg), setup: imageSetup.status(), config: configMod.maskedConfig(cfg) });
  } catch (e) { next(e); }
});

router.post("/image/runtime/start", async (req, res, next) => {
  try {
    if (imageSetup.status().active) throw new ApiError(409, "环境正在配置，请完成后再启动服务");
    const cfg = configMod.loadConfig();
    await comfy.imageRuntime.ensureReady(cfg);
    res.json(await comfy.imageRuntime.status(cfg));
  } catch (e) { next(e); }
});

router.post("/image/runtime/stop", async (req, res, next) => {
  try {
    const stopped = await comfy.imageRuntime.stop();
    res.json({ ...await comfy.imageRuntime.status(configMod.loadConfig()), stopped });
  } catch (e) { next(e); }
});

router.post("/image/generate", async (req, res, next) => {
  try {
    if (imageSetup.status().active) throw new ApiError(409, "环境正在配置，请完成后再生成图片");
    const [mod, entry] = loadModuleChecked(req.body?.module);
    const slot = slotArg(req.body?.slot ?? 1);
    const kind = String(req.body?.kind ?? "scene").trim() || "scene";
    if (!comfy.KINDS.includes(kind)) {
      throw new ApiError(400, `kind 必须是 ${comfy.KINDS.join(" / ")}`);
    }
    const save = await withSlotLock(entry.name, slot, () => loadSave(entry, slot));
    const cfg = configMod.loadConfig();
    const out = await comfy.generateImage({
      module: mod,
      state: save,
      kind,
      prompt: String(req.body?.prompt ?? "").trim(),
      anime: req.body?.anime === true,
      name: String(req.body?.name ?? "").trim(),
      config: cfg,
    });
    res.json({ module: entry.name, slot, ...out });
  } catch (e) {
    next(e);
  }
});

export default router;

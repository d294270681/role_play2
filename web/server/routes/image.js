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
import { ApiError, loadModuleChecked, loadSave, slotArg, withSlotLock } from "./shared.js";

const router = Router();

router.get("/image/status", async (req, res, next) => {
  try { res.json(await comfy.imageRuntime.status(configMod.loadConfig())); } catch (e) { next(e); }
});

router.post("/image/runtime/start", async (req, res, next) => {
  try {
    const cfg = configMod.loadConfig();
    await comfy.imageRuntime.ensureReady(cfg, { force: true });
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

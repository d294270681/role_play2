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
import { ApiError, loadModuleChecked, loadSave, slotArg } from "./shared.js";

const router = Router();

router.post("/image/generate", async (req, res, next) => {
  try {
    const [mod, entry] = loadModuleChecked(req.body?.module);
    const slot = slotArg(req.body?.slot ?? 1);
    const kind = String(req.body?.kind ?? "scene").trim() || "scene";
    if (!comfy.KINDS.includes(kind)) {
      throw new ApiError(400, `kind 必须是 ${comfy.KINDS.join(" / ")}`);
    }
    const save = loadSave(entry, slot);
    const cfg = configMod.loadConfig();
    if (!(await comfy.isOnline(cfg.comfy_url))) {
      throw new comfy.ComfyUnavailableError(`ComfyUI 未在线或不可达：${cfg.comfy_url}（请先启动 ComfyUI，或在 /api/config 修改 comfy_url）`);
    }
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

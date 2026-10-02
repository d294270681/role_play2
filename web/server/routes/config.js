/**
 * 配置端点：
 *   GET  /api/config  掩码视图（has_key / 尾 4 位，绝不回传完整 api_key）
 *   POST /api/config  合并白名单字段后落盘 {base_url?, api_key?, model?, temperature?, comfy_url?, stream?, timeout?, kimi_oauth?}
 */

import { Router } from "express";

import * as configMod from "../config.js";
import { imageSetup } from "../image/setup.js";

const router = Router();

router.get("/config", (req, res) => {
  res.json(configMod.maskedConfig(configMod.loadConfig()));
});

router.post("/config", async (req, res, next) => {
  try {
    const patch = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const image = patch.image_generation;
    if (image && typeof image === "object") {
      const current = configMod.loadConfig().image_generation;
      const changed = ["profile", "mode", "port", "device"].some((key) => key in image && image[key] !== current[key]);
      if ("configured_at" in image || "device" in image || (image.enabled === true && (!current.enabled || changed)) || (current.enabled && changed)) {
        throw Object.assign(new Error("请通过网页的「检测并配置」启用或切换生图模型，不能跳过环境与安装校验"), { status: 409 });
      }
      if (image.enabled === false) await imageSetup.disable();
    }
    res.json(configMod.maskedConfig(configMod.updateConfig(patch)));
  } catch (e) {
    next(e);
  }
});

export default router;

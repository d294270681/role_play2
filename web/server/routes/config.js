/**
 * 配置端点：
 *   GET  /api/config  掩码视图（has_key / 尾 4 位，绝不回传完整 api_key）
 *   POST /api/config  合并白名单字段后落盘 {base_url?, api_key?, model?, temperature?, comfy_url?, stream?, timeout?}
 */

import { Router } from "express";

import * as configMod from "../config.js";

const router = Router();

router.get("/config", (req, res) => {
  res.json(configMod.maskedConfig(configMod.loadConfig()));
});

router.post("/config", (req, res, next) => {
  try {
    const patch = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    res.json(configMod.maskedConfig(configMod.updateConfig(patch)));
  } catch (e) {
    next(e);
  }
});

export default router;

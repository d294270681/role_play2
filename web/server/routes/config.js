/**
 * 配置端点：
 *   GET  /api/config  掩码视图（has_key / 尾 4 位，绝不回传完整 api_key）
 *   POST /api/config  合并白名单字段、校验模式与地址后原子落盘
 *   POST /api/config/test  使用候选配置测试对应模型协议，不保存
 *   POST /api/config/models  读取候选接口的全部模型与参数能力，不保存
 */

import { Router } from "express";

import * as configMod from "../config.js";
import { imageSetup } from "../image/setup.js";
import { GMClient } from "../gm.js";
import { redact } from "../llm/redact.js";
import { fetchModelCatalog } from "../llm/catalog.js";
import { MODEL_FIELDS } from "../../shared/llm.js";

const router = Router();

router.get("/config", (req, res) => {
  res.json(configMod.maskedConfig(configMod.loadConfig()));
});

router.post("/config", async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw Object.assign(new Error("保存配置必须使用 JSON"), { status: 415 });
    const patch = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    configMod.mergeConfigPatch(configMod.loadConfig(), patch);
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

router.post("/config/test", async (req, res, next) => {
  let cfg;
  try {
    if (!req.is("application/json")) throw Object.assign(new Error("连接测试必须使用 JSON"), { status: 415 });
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const patch = Object.fromEntries(MODEL_FIELDS.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
    cfg = configMod.mergeConfigPatch(configMod.loadConfig(), patch);
    if (!configMod.modelConfigured(cfg)) throw Object.assign(new Error(cfg.llm_mode === "demo" ? "演示模式不需要连接模型服务" : "请填写 API 地址、模型 ID 和所需密钥"), { status: 400 });
    const client = new GMClient({ ...cfg, stream: false, timeout: Math.min(cfg.timeout, 30) });
    let reply = "";
    for await (const chunk of client.streamChat([{ role: "user", content: "Reply with exactly OK." }])) reply += chunk;
    if (!reply.trim()) throw new Error("服务没有返回可用的聊天回复，请检查模型 ID 与接口协议");
    res.json({ ok: true, model: cfg.model, base_url: cfg.base_url, message: `连接成功：${cfg.model}。测试未保存配置。` });
  } catch (e) {
    // 服务返回文本可能包含密钥，先脱敏再给前端；不回传模型回复。
    const safe = Object.assign(new Error(redact(e?.message || "连接测试失败", [cfg?.api_key])), { status: e.status || 502 });
    next(safe);
  }
});

router.post("/config/models", async (req, res, next) => {
  let cfg;
  try {
    if (!req.is("application/json")) throw Object.assign(new Error("模型目录请求必须使用 JSON"), { status: 415 });
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const patch = Object.fromEntries(MODEL_FIELDS.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
    cfg = configMod.mergeConfigPatch(configMod.loadConfig(), patch, { allowIncomplete: true });
    res.json({ provider: cfg.llm_provider, ...await fetchModelCatalog(cfg) });
  } catch (error) {
    next(Object.assign(new Error(redact(error.message, [cfg?.api_key, req.body?.api_key])), { status: error.status || 502 }));
  }
});

export default router;

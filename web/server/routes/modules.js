/**
 * 模块与存档读取端点：
 *   GET /api/modules                   列出 modules/ 下的 RPG 本
 *   GET /api/game/slots?module=        列出 1-3 号槽位
 *   GET /api/game/state?module=&slot=  读存档 + 解析后的地图/角色/事件索引 + has_key + comfy 在线状态
 */

import path from "node:path";
import { Router } from "express";

import * as loader from "../engine/moduleLoader.js";
import * as stateMod from "../engine/state.js";
import * as configMod from "../config.js";
import * as comfy from "../comfy.js";
import { cardPublic, loadModuleChecked, loadSave, slotArg, statePublic, withSlotLock } from "./shared.js";

const router = Router();

router.get("/modules", (req, res) => {
  const out = [];
  const seen = new Set();
  for (const m of loader.listModules()) {
    const dirname = path.basename(m.dir);
    if (seen.has(dirname)) continue;
    seen.add(dirname);
    out.push({
      name: m.name || dirname,
      dir: dirname,
      title: m.title || dirname,
      engine: m.engine || "core",
      tone: m.tone || "",
      rating: m.rating || "",
      files_exist: m.files_exist || {},
    });
  }
  res.json({ modules: out });
});

router.get("/game/slots", (req, res, next) => {
  try {
    const [mod, entry] = loadModuleChecked(req.query.module);
    res.json({
      module: entry.name,
      title: mod.title || entry.title,
      slots: stateMod.slotInfo(entry.name),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/game/state", async (req, res, next) => {
  try {
    const [mod, entry] = loadModuleChecked(req.query.module);
    const slot = slotArg(req.query.slot ?? 1);
    const save = await withSlotLock(entry.name, slot, () => loadSave(entry, slot));
    const cfg = configMod.loadConfig();
    const hasKey = configMod.configHasKey(cfg);
    const imageStatus = await comfy.imageRuntime.status(cfg);
    res.json({
      module: {
        name: entry.name,
        dir: entry.dirname,
        title: mod.title || entry.title,
        engine: mod.engine,
        tone: mod.tone,
        rating: mod.rating,
        intro: mod.intro,
        periods: mod.periods,
        opening: mod.opening,
        warnings: (mod.warnings || []).slice(0, 20),
      },
      state: statePublic(save, mod),
      map: {
        locations: (mod.locations || []).map((loc) => {
          const { raw, ...rest } = loc;
          return rest;
        }),
        routes: mod.routes || [],
      },
      characters: (mod.characters || []).map((card) => cardPublic(card, save.character?.name)),
      events: (mod.events || []).map((e) => ({ code: e.code, name: e.name, special: Boolean(e.special) })),
      has_key: hasKey,
      echo: !hasKey,
      comfy: imageStatus,
    });
  } catch (e) {
    next(e);
  }
});

export default router;

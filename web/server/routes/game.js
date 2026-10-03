/**
 * 游戏端点：
 *   POST /api/game/new   开新档 {module, slot?, character?}
 *   POST /api/turn       一个 GM 回合（SSE：narrative/dice/note/state/image/done/error）
 *   POST /api/move       移动 {module, slot, to}
 *   POST /api/state/edit 玩家按规则成长 {module, slot, op: spend_xp}
 *
 * 同一 (module, slot) 的 turn / move / edit / new 走同一把 promise 链锁串行；
 * turn 先把新存档落盘，再发出 state 事件（客户端断开也会跑完并落盘）。
 */

import fs from "node:fs";
import { Router } from "express";

import * as stateMod from "../engine/state.js";
import { toInt } from "../engine/pycompat.js";
import * as configMod from "../config.js";
import * as gm from "../gm.js";
import { ApiError, loadModuleChecked, loadSave, nameMatch, slotArg, progressPublic, withSlotLock } from "./shared.js";
import { isPlayerEdit, WORLD_EDIT_MESSAGE } from "../../shared/playerActions.js";

const router = Router();

// ---------------------------------------------------------------------------
// 移动（/api/move）
// ---------------------------------------------------------------------------

function routeBetween(mod, src, dst) {
  if (src === null || dst === null) return null;
  for (const r of mod.routes || []) {
    const frm = String(r.from ?? "");
    const to = String(r.to ?? "");
    if (nameMatch(frm, src.name) && nameMatch(to, dst.name)) return r;
    if (nameMatch(to, src.name) && nameMatch(frm, dst.name)) return r;
  }
  return null;
}

function connected(src, target) {
  if (!src || typeof src !== "object") return false;
  for (const c of src.connections || []) {
    if (nameMatch(c, target)) return true;
  }
  return false;
}

function travelDanger(route, src, night) {
  let danger = null;
  if (route && Number.isInteger(route.danger)) danger = route.danger;
  if (danger === null) danger = src?.danger;
  danger = toInt(danger, 0);
  if (night && danger > 0) danger += 1;
  return Math.max(0, Math.min(5, danger));
}

/** 校验相邻/路线 → 按时段推进 → 途中事件判定 → 写日志。 */
export function doMove(mod, save, target) {
  const current = String(save.location ?? "");
  const src = gm.findLocation(mod, current);
  const dst = gm.findLocation(mod, target);
  if (dst === null) {
    const known = (mod.locations || []).map((loc) => String(loc.name ?? "")).join("、");
    throw new ApiError(400, `本册地图里没有地点「${target}」（可选：${known || "—"}）`);
  }
  if (src !== null && dst.name === src.name) throw new ApiError(400, `已经身处「${dst.name}」`);
  const route = routeBetween(mod, src, dst);
  if (route === null && !connected(src, dst.name)) {
    const conns = src ? (src.connections || []).join("、") : "";
    throw new ApiError(400, `「${current || "未知地点"}」到「${dst.name}」之间没有相邻路线（当前可去：${conns || "—"}）`);
  }
  const steps = route ? Math.max(1, toInt(route.time_slots, 1)) : 1;
  const changes = [`移动：${current || "未知地点"} → ${dst.name}（耗时 ${steps} 时段）`];
  const events = [];
  for (let i = 0; i < steps; i += 1) {
    const period = stateMod.currentPeriod(save);
    const danger = travelDanger(route, src, gm.isNight(period));
    const hit = gm.rollEvent(mod, save, danger);
    if (hit !== null && !hit.empty) {
      events.push({ code: hit.code, name: hit.name, shift: hit.shift });
      changes.push(`途中事件判定触发：${hit.code || ""} ${hit.name || ""}`.trim());
    }
    changes.push(...stateMod.advanceTime(save, 1));
  }
  save.location = dst.name;
  stateMod.addLog(save, `移动：${current || "未知地点"} → ${dst.name}（${steps} 时段）`, "移动");
  return { state: save, changes, events };
}

// ---------------------------------------------------------------------------
// SSE 工具
// ---------------------------------------------------------------------------

function startSse(res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
}

// ---------------------------------------------------------------------------
// 端点
// ---------------------------------------------------------------------------

router.post("/game/new", async (req, res, next) => {
  try {
    const [mod, entry] = loadModuleChecked(req.body?.module);
    const slot = slotArg(req.body?.slot ?? 1);
    const character = String(req.body?.character ?? "").trim() || null;
    const out = await withSlotLock(entry.name, slot, () => {
      const existed = fs.existsSync(stateMod.slotPath(entry.name, slot));
      const save = stateMod.newGame(entry.dirname, slot, character);
      const file = stateMod.save(save);
      return { ...progressPublic(save, mod), path: file, overwrote: existed };
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.post("/turn", async (req, res, next) => {
  let started = false;
  try {
    const [mod, entry] = loadModuleChecked(req.body?.module);
    const slot = slotArg(req.body?.slot ?? 1);
    const action = String(req.body?.action ?? "").trim();
    if (!action) throw new ApiError(400, "缺少行动文本 action");
    loadSave(entry, slot); // 先校验（缺失/损坏返回 JSON 错误），真正的读取在锁内做
    const cfg = configMod.loadConfig();
    const history = req.body?.history;

    startSse(res);
    started = true;
    let gone = false;
    res.on("close", () => {
      gone = true;
    });
    const send = (event) => {
      if (gone) return;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        gone = true;
      }
    };

    try {
      await withSlotLock(entry.name, slot, async () => {
        // 锁内重新读档：保证串行的回合基于上一回合落盘后的最新状态（读改写整体串行）
        const save = loadSave(entry, slot);
        send({ type: "started" });
        for await (const event of gm.runTurn(mod, save, action, cfg, history)) {
          if (event?.type === "state" && event.state) {
            try {
              stateMod.save(event.state);
            } catch (e) {
              throw new Error(`存档写入失败：${e?.message ?? e}`);
            }
            send({ ...event, ...progressPublic(event.state, mod) });
          } else {
            send(event);
          }
        }
      });
    } catch (e) {
      send({ type: "error", message: `${e?.name || "Error"}: ${e?.message ?? e}` });
      send({ type: "done" }); // 流总以 done 收尾，前端不必依赖超时兜底
    }
    res.end();
  } catch (e) {
    if (started) {
      try {
        res.end();
      } catch {
        // 客户端可能已断开
      }
    } else {
      next(e);
    }
  }
});

router.post("/move", async (req, res, next) => {
  try {
    const [mod, entry] = loadModuleChecked(req.body?.module);
    const slot = slotArg(req.body?.slot ?? 1);
    const target = String(req.body?.to ?? "").trim();
    if (!target) throw new ApiError(400, "缺少目标地点 to");
    const out = await withSlotLock(entry.name, slot, () => {
      const save = loadSave(entry, slot);
      const result = doMove(mod, save, target);
      result.path = stateMod.save(save);
      Object.assign(result, progressPublic(save, mod));
      return result;
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.post("/state/edit", async (req, res, next) => {
  try {
    const [mod, entry] = loadModuleChecked(req.body?.module);
    const slot = slotArg(req.body?.slot ?? 1);
    const op = req.body?.op;
    if (!op || typeof op !== "object" || Array.isArray(op)) throw new ApiError(400, "缺少编辑操作 op（对象）");
    if (!isPlayerEdit(op)) throw new ApiError(403, WORLD_EDIT_MESSAGE);
    const out = await withSlotLock(entry.name, slot, () => {
      const save = loadSave(entry, slot);
      const draft = structuredClone(save);
      const [ok, message] = stateMod.applyEdit(draft, op);
      const file = ok ? stateMod.save(draft) : null;
      return { ok: Boolean(ok), message, ...progressPublic(ok ? draft : save, mod), path: file };
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

export default router;

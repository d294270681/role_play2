/**
 * 路由共用工具：模块白名单校验、槽位参数、存档读取、per-slot 串行锁、公开视图。
 */

import path from "node:path";

import * as loader from "../engine/moduleLoader.js";
import * as stateMod from "../engine/state.js";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 目录名 / frontmatter 名 → 摘要。listModules() 是唯一白名单来源。 */
export function moduleIndex() {
  const index = new Map();
  for (const m of loader.listModules()) {
    const dirname = path.basename(m.dir);
    const entry = {
      dirname,
      name: m.name || dirname,
      title: m.title || dirname,
      engine: m.engine || "core",
      tone: m.tone || "",
      rating: m.rating || "",
      files_exist: m.files_exist || {},
    };
    index.set(dirname, entry);
    if (!index.has(entry.name)) index.set(entry.name, entry);
  }
  return index;
}

/** 校验模块名（白名单）并加载，返回 [module, 摘要]。 */
export function loadModuleChecked(key) {
  const entry = moduleIndex().get(String(key ?? "").trim());
  if (!entry) {
    throw new ApiError(404, `未知的 RPG 本：${JSON.stringify(key ?? null)}（只允许 modules/ 下列出的本）`);
  }
  try {
    return [loader.loadModule(entry.dirname), entry];
  } catch (e) {
    throw new ApiError(404, e?.message ?? String(e));
  }
}

export function slotArg(value) {
  let slot = Number.parseInt(value ?? 1, 10);
  if (!Number.isFinite(slot)) slot = 1;
  if (!(slot >= 1 && slot <= stateMod.SLOTS_PER_MODULE)) {
    throw new ApiError(400, `槽位必须是 1-${stateMod.SLOTS_PER_MODULE}`);
  }
  return slot;
}

export function loadSave(entry, slot) {
  try {
    return stateMod.load(entry.name, slot);
  } catch (e) {
    if (e?.name === "FileNotFoundError") {
      throw new ApiError(404, `${e.message}（先用 POST /api/game/new 开新档）`);
    }
    if (e?.name === "ValueError") {
      throw new ApiError(500, e.message);
    }
    throw e;
  }
}

// 同一个存档的读改写串行化（不同存档互不阻塞）。Node 单线程，但回合是异步流式的，
// 必须用 promise 链把同一 (module, slot) 的 turn / move / edit / new 排队。
const _slotChains = new Map();

export function withSlotLock(moduleName, slot, fn) {
  const key = `${moduleName}#${slot}`;
  const prev = _slotChains.get(key) ?? Promise.resolve();
  const run = prev.then(() => fn());
  const settled = run.then(() => undefined, () => undefined);
  _slotChains.set(key, settled);
  settled.then(() => {
    if (_slotChains.get(key) === settled) _slotChains.delete(key);
  });
  return run;
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(source || {}, key)).map((key) => [key, source[key]]));
}

const PUBLIC_CARD_KEYS = ["name", "title", "concept", "attributes", "skills", "gauges", "defense", "capacity", "armor", "attack", "traits", "statuses", "attitude"];
const PUBLIC_META_KEYS = ["身份", "年龄", "外貌", "说话方式", "特点"];
const PUBLIC_STATE_KEYS = ["version", "module", "slot", "title", "day", "period_index", "periods", "location", "character", "inventory", "funds", "relations", "clocks", "events_fired", "clues", "log", "pending_event", "pending_events"];

/** 玩家接口只发送明确定义的公开字段；原始卡片和存档仍供 GM 使用。 */
export function cardPublic(card, playerName = "") {
  const out = pick(card, PUBLIC_CARD_KEYS);
  out.meta = pick(card.meta, PUBLIC_META_KEYS);
  if (card.name === playerName) {
    Object.assign(out, pick(card, ["background", "goal", "weakness", "relations", "inventory", "funds", "xp", "xp_total"]));
  }
  return out;
}

export function statePublic(save, mod) {
  const out = pick(save, PUBLIC_STATE_KEYS);
  out.party = Object.fromEntries(Object.entries(save.party || {}).map(([name, member]) => {
    const card = (mod.characters || []).find((c) => c.name === name);
    // 旧档 notes 混有秘密，不能靠关键词删改；公开备注须由独立字段明确提供。
    const description = [card?.concept, card?.meta?.["外貌"], card?.meta?.["特点"]].filter(Boolean).join("；");
    return [name, {
      ...pick(member, ["gauges", "relation", "statuses"]),
      notes: String(member.public_notes ?? description),
    }];
  }));
  return structuredClone(out);
}

export function nameMatch(a, b) {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
}

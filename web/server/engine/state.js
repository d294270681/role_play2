/**
 * 存档状态：JSON 读写、开局、时间推进、GM 补丁（applyPatch）与编辑操作（applyEdit）。
 * 移植自 web/engine/state.py（M1），存档路径 web/saves/<本名>/slot<N>.json 与 Python 版一致，
 * 两个实现写出的存档可互相读取。
 *
 * 存档 schema（JSON）：
 *   {version, module, slot, title, day, period_index, periods[], location,
 *    character:{name, concept, background, goal, weakness, attributes{六项},
 *               skills{13 项}, defense, capacity, gauges{名:{value,max}},
 *               traits[], statuses[], xp, xp_total},
 *    party{NPC名:{gauges, relation, notes(GM私有), public_notes?}}, inventory[{name,qty,slots,note}],
 *    funds, relations[{npc,value,note}], clocks[{name,value,max,consequence}],
 *    events_fired[{code,name,day}], clues[{text,done}], log[{day,period,type,text}],
 *    pending_event?}
 *
 * load 会补齐缺省字段（宽容）；applyPatch / applyEdit 全部容错，仪表一律钳制在 0..max。
 * 错误名与 Python 版对齐：FileNotFoundError（存档/模块不存在）、ValueError（JSON 损坏、槽位非法）。
 * 文件 IO 与 Python 版一样是同步的；异步调用方自行包 Promise 即可。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as moduleLoader from "./moduleLoader.js";
import { ATTRS, SKILLS, clamp } from "./dice.js";
import { upgradeCost, updateDerived } from "./rules.js";
import {
  digitInt, fileNotFoundError, hasOwn, isDict, pyOr, pyStr, pyText, pyTruthy, toInt, valueError,
} from "./pycompat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SAVE_ROOT = path.resolve(__dirname, "..", "..", "saves");
export const SLOTS_PER_MODULE = 3;
export const STATE_VERSION = 1;
export const LOG_LIMIT = 1000;
export const DEFAULT_PERIODS = [...moduleLoader.DEFAULT_PERIODS];

const _DEFS_CACHE = new Map();

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function setDefault(obj, key, value) {
  if (!hasOwn(obj, key)) obj[key] = value;
}

function asList(v) {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return [...v];
  return [v];
}

function safeModuleName(module) {
  const name = pyText(module).replace(/[\\/:*?"<>|]+/g, "").trim();
  return name || "unnamed";
}

export function clearCaches() {
  _DEFS_CACHE.clear();
}

function moduleGaugeDefs(state) {
  const name = pyText(state.module);
  if (!name) return [];
  if (!_DEFS_CACHE.has(name)) {
    try {
      _DEFS_CACHE.set(name, moduleLoader.loadModule(name).gauge_defs || []);
    } catch {
      _DEFS_CACHE.set(name, []);
    }
  }
  return _DEFS_CACHE.get(name);
}

/** 新建仪表时推断上限：先看已有同名仪表，再看 module 的仪表定义，最后兜底 100。 */
function autoMax(state, name, valueHint = 0) {
  const ch = state.character || {};
  const g = (ch.gauges || {})[name];
  if (isDict(g) && toInt(g.max) > 0) return toInt(g.max);
  for (const d of moduleGaugeDefs(state)) {
    if (d.name === name) return toInt(d.max, 100);
  }
  if (name === "压力") return 10;
  return 100;
}

function gauge(container, name, maxHint = null) {
  let g = container[name];
  if (!isDict(g)) {
    g = { value: 0, max: 0 };
    container[name] = g;
  }
  g.value = toInt(g.value, 0);
  g.max = toInt(g.max, 0);
  if (maxHint && g.max <= 0) g.max = toInt(maxHint, 0);
  return g;
}

function applyGauge(g, { delta = null, value = null, maximum = null } = {}) {
  if (maximum !== null && maximum !== undefined) g.max = Math.max(0, toInt(maximum, g.max || 0));
  if (value !== null && value !== undefined) g.value = toInt(value, g.value);
  if (delta !== null && delta !== undefined) g.value = toInt(g.value, 0) + toInt(delta, 0);
  g.value = Math.max(0, g.value);
  if (g.max > 0) g.value = Math.min(g.value, g.max);
  return g;
}

function gaugeChange(name, before, g) {
  const diff = g.value - before;
  const sign = diff > 0 ? `+${diff}` : String(diff);
  return `${name} ${before} → ${g.value}（${sign}，上限 ${g.max}）`;
}

function matchPeriod(periods, value) {
  if (typeof value === "boolean") return null;
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value < periods.length ? value : null;
  }
  const s = pyText(value).trim();
  const i = digitInt(s);
  if (i !== null) return i >= 0 && i < periods.length ? i : null;
  for (let j = 0; j < periods.length; j += 1) {
    const p = periods[j];
    if (p === s || (s && (p.includes(s) || s.includes(p)))) return j;
  }
  return null;
}

function removeByText(lst, text) {
  let i = lst.findIndex((v) => pyStr(v) === text);
  if (i !== -1) return lst.splice(i, 1)[0];
  i = lst.findIndex((v) => text && pyStr(v).includes(text));
  if (i !== -1) return lst.splice(i, 1)[0];
  return null;
}

function findItem(inventory, name) {
  for (const it of inventory) {
    if (pyText(it.name) === name) return it;
  }
  for (const it of inventory) {
    const n = pyText(it.name);
    if (name && (n.includes(name) || name.includes(n))) return it;
  }
  return null;
}

function findClue(clues, key) {
  if (typeof key === "boolean") return null;
  if (typeof key === "number") {
    return Number.isInteger(key) && key >= 0 && key < clues.length ? clues[key] : null;
  }
  const s = pyText(key).trim();
  const i = digitInt(s);
  if (i !== null && i >= 0 && i < clues.length) return clues[i];
  for (const c of clues) {
    if (pyText(c.text) === s) return c;
  }
  for (const c of clues) {
    if (s && pyText(c.text).includes(s)) return c;
  }
  return null;
}

function clockBar(value, mx) {
  mx = Math.max(0, Math.min(toInt(mx, 0), 12));
  const v = Math.max(0, Math.min(toInt(value, 0), mx));
  return "■".repeat(v) + "□".repeat(mx - v);
}

function formatSigned(n) {
  return (n >= 0 ? "+" : "") + n;
}

function formatStamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getOr(obj, key, dflt) {
  return hasOwn(obj, key) ? obj[key] : dflt;
}

// ---------------------------------------------------------------------------
// 状态结构
// ---------------------------------------------------------------------------

function ensureCharacter(ch) {
  setDefault(ch, "name", "");
  for (const key of ["concept", "background", "goal", "weakness"]) setDefault(ch, key, "");
  for (const key of ["attributes", "skills", "gauges"]) {
    if (!isDict(ch[key])) ch[key] = {};
  }
  ch.defense = toInt(ch.defense, 0);
  ch.capacity = toInt(ch.capacity, 0);
  if (!Array.isArray(ch.traits)) ch.traits = [];
  if (!Array.isArray(ch.statuses)) ch.statuses = [];
  ch.xp = toInt(ch.xp, 0);
  ch.xp_total = toInt(ch.xp_total, ch.xp);
  return ch;
}

/** 就地补齐缺省字段并清洗嵌套结构（宽容，不抛异常）。 */
function ensureState(state) {
  state.version = state.version || STATE_VERSION;
  setDefault(state, "module", "");
  setDefault(state, "slot", 1);
  setDefault(state, "title", "");
  state.day = toInt(state.day, 1);
  let periods = state.periods;
  if (!Array.isArray(periods) || !periods.length) periods = [...DEFAULT_PERIODS];
  state.periods = periods.map((p) => pyStr(p));
  const i = toInt(state.period_index, 0);
  state.period_index = Math.max(0, Math.min(i, state.periods.length - 1));
  setDefault(state, "location", "");
  if (!isDict(state.character)) state.character = {};
  ensureCharacter(state.character);

  let party = state.party;
  if (!isDict(party)) party = {};
  for (const npc of Object.keys(party)) {
    const member = party[npc];
    if (!isDict(member)) {
      party[npc] = { gauges: {}, relation: 0, notes: "" };
      continue;
    }
    if (!isDict(member.gauges)) member.gauges = {};
    member.relation = clamp(toInt(member.relation, 0), -5, 5);
    setDefault(member, "notes", "");
  }
  state.party = party;

  const inv = state.inventory;
  state.inventory = (Array.isArray(inv) ? inv : [])
    .filter((it) => isDict(it) && pyTruthy(it.name))
    .map((it) => ({
      name: pyStr(it.name),
      qty: toInt(it.qty, 1),
      slots: toInt(it.slots, 1),
      note: pyText(it.note),
    }));
  state.funds = Math.max(0, toInt(state.funds, 0));

  const rels = state.relations;
  state.relations = (Array.isArray(rels) ? rels : [])
    .filter((r) => isDict(r) && pyTruthy(r.npc))
    .map((r) => ({
      npc: pyStr(r.npc),
      value: clamp(toInt(r.value, 0), -5, 5),
      note: pyText(r.note),
    }));

  const clocks = state.clocks;
  state.clocks = (Array.isArray(clocks) ? clocks : [])
    .filter((c) => isDict(c) && pyTruthy(c.name))
    .map((c) => ({
      name: pyStr(c.name),
      value: Math.max(0, toInt(c.value, 0)),
      max: Math.max(1, toInt(c.max, 6)),
      consequence: pyText(c.consequence),
    }));
  for (const c of state.clocks) c.value = Math.min(c.value, c.max);

  const events = state.events_fired;
  state.events_fired = (Array.isArray(events) ? events : [])
    .filter((e) => isDict(e))
    .map((e) => ({
      code: pyText(e.code),
      name: pyText(e.name),
      day: toInt(e.day, state.day),
    }));

  const clues = state.clues;
  state.clues = (Array.isArray(clues) ? clues : [])
    .filter((c) => isDict(c) && pyTruthy(c.text))
    .map((c) => ({ text: pyText(c.text), done: Boolean(c.done) }));

  const log = state.log;
  state.log = (Array.isArray(log) ? log : [])
    .filter((e) => isDict(e) && pyTruthy(e.text))
    .map((e) => ({
      day: toInt(e.day, state.day),
      period: pyText(e.period),
      type: pyText(pyOr(e.type, "note")),
      text: pyText(e.text),
    }));
  return state;
}

/** 返回补齐默认字段后的新状态（深拷贝，不修改入参）。 */
export function normalize(state) {
  if (!isDict(state)) throw valueError("存档不是合法的 JSON 对象");
  const out = structuredClone(state);
  ensureState(out);
  return out;
}

// ---------------------------------------------------------------------------
// 存档读写
// ---------------------------------------------------------------------------

export function slotPath(module, slot) {
  slot = toInt(slot, 1);
  if (!(slot >= 1 && slot <= SLOTS_PER_MODULE)) throw valueError(`槽位必须是 1-${SLOTS_PER_MODULE}`);
  return path.join(SAVE_ROOT, safeModuleName(module), `slot${slot}.json`);
}

/** 列出某本的 3 个槽位：是否存在、标题、天数、时段、地点、角色、更新时间。 */
export function slotInfo(module) {
  const out = [];
  for (let slot = 1; slot <= SLOTS_PER_MODULE; slot += 1) {
    const p = slotPath(module, slot);
    const info = { slot, exists: fs.existsSync(p), path: p };
    if (info.exists) {
      try {
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        const ch = isDict(data.character) ? data.character : {};
        Object.assign(info, {
          title: data.title || data.module || "",
          day: data.day ?? null,
          period: currentPeriod(data),
          location: data.location || "",
          character: ch.name || "",
          updated: formatStamp(fs.statSync(p).mtimeMs),
        });
      } catch (e) {
        info.error = `存档读取失败：${e?.message ?? e}`;
      }
    }
    out.push(info);
  }
  return out;
}

/** 写入 web/saves/<module>/slot<N>.json，返回文件路径（先写 .tmp 再原子改名）。
 *
 * 与 Python 版同格式（ensure_ascii=False / indent=2 的 JSON），文件可互相读取；
 * 唯一差别：Windows 上 Python 文本模式写 CRLF，Node 写 LF——JSON 解析不受影响。
 */
export function save(state, slot = null) {
  if (!isDict(state)) throw valueError("state 必须是 dict");
  if (slot !== null && slot !== undefined) state.slot = toInt(slot, state.slot || 1);
  ensureState(state);
  const p = slotPath(state.module, state.slot || 1);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, p);
  return p;
}

/** 读取并规范化存档。存档不存在抛 FileNotFoundError，JSON 损坏抛 ValueError。 */
export function load(module, slot) {
  const p = slotPath(module, slot);
  if (!fs.existsSync(p)) throw fileNotFoundError(`存档不存在：${p}`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    throw valueError(`存档 JSON 损坏：${p}（${e?.message ?? e}）`);
  }
  return normalize(data);
}

// ---------------------------------------------------------------------------
// 开局
// ---------------------------------------------------------------------------

function matchLocation(locations, raw) {
  raw = String(raw || "").trim();
  for (const loc of locations || []) {
    const n = String(loc.name || "").trim();
    if (n && raw && (n.includes(raw) || raw.includes(n))) return n;
  }
  if (raw) return raw;
  return locations && locations.length ? String(locations[0].name || "") : "";
}

function characterFromCard(card, mod = null) {
  card = card || {};
  const attrsRaw = card.attributes || {};
  const attrs = {};
  for (const a of ATTRS) attrs[a] = toInt(attrsRaw[a], 2);
  const skillsRaw = card.skills || {};
  const skills = {};
  for (const s of Object.keys(SKILLS)) skills[s] = toInt(skillsRaw[s], 0);
  const gauges = {};
  for (const [name, g] of Object.entries(card.gauges || {})) {
    if (isDict(g)) gauges[name] = { value: toInt(g.value, 0), max: toInt(g.max, 0) };
  }

  const hpMax = attrs["体魄"] * 2 + 4;
  const enMax = attrs["意志"] + 4;
  const willMax = attrs["意志"] * 2 + 4;

  const ensure = (name, value, mx) => {
    const g = gauges[name];
    if (g === undefined) {
      gauges[name] = { value, max: mx };
    } else {
      if (!g.max) g.max = mx;
      if (g.value === null || g.value === undefined) g.value = value;
    }
  };
  ensure("生命", hpMax, hpMax);
  ensure("精力", enMax, enMax);
  ensure("压力", 0, 10);
  ensure("决心", willMax, willMax);

  const defense = toInt(card.defense, 0) || (7 + attrs["敏捷"] + skills["运动"]);
  const capacity = toInt(card.capacity, 0) || (6 + attrs["体魄"]);
  const xp = toInt(card.xp, 0);
  const opening = (mod || {}).opening || {};
  return {
    name: card.name || opening.player || "主角",
    concept: card.concept || "",
    background: card.background || "",
    goal: card.goal || "",
    weakness: card.weakness || "",
    attributes: attrs,
    skills,
    defense,
    capacity,
    gauges,
    traits: [...(card.traits || [])],
    statuses: [...(card.statuses || [])],
    xp,
    xp_total: toInt(card.xp_total, xp),
  };
}

function partyEntry(card) {
  const gauges = {};
  for (const [name, g] of Object.entries(card.gauges || {})) {
    if (isDict(g)) gauges[name] = { value: toInt(g.value, 0), max: toInt(g.max, 0) };
  }
  const meta = card.meta || {};
  const notes = [
    card.concept, meta["外貌"], meta["特点"], meta["特殊能力"], meta["秘密"],
  ].filter(Boolean).join("；");
  return {
    gauges,
    relation: clamp(toInt(card.attitude, 0), -5, 5),
    notes: notes.slice(0, 300),
  };
}

function pickPlayerCard(mod, characterName = null) {
  const cards = mod.characters || [];
  if (characterName) {
    for (const c of cards) {
      if (c.name === characterName) return c;
    }
  }
  return mod.player_card || (cards.length ? cards[0] : null);
}

/** 按 module.md 的开局与玩家角色卡建一份初始状态（不落盘，调用方自行 save）。 */
export function newGame(moduleName, slot = 1, characterName = null) {
  const mod = moduleLoader.loadModule(moduleName);
  const periods = mod.periods && mod.periods.length ? [...mod.periods] : [...DEFAULT_PERIODS];
  const opening = mod.opening || {};
  const day = toInt(opening.day, 1);
  const period = opening.period || periods[0];
  const periodIndex = periods.includes(period) ? periods.indexOf(period) : 0;
  const location = matchLocation(mod.locations, opening.location);
  const card = pickPlayerCard(mod, characterName);
  const character = characterFromCard(card, mod);

  const party = {};
  for (const c of mod.characters || []) {
    if (c === card) continue;
    party[c.name] = partyEntry(c);
  }

  const relations = [];
  for (const r of (card || {}).relations || []) {
    relations.push({
      npc: pyText(r.npc),
      value: clamp(toInt(r.value, 0), -5, 5),
      note: pyText(r.note),
    });
  }
  for (const c of mod.characters || []) {
    if (c === card || c.attitude === null || c.attitude === undefined) continue;
    if (!relations.some((r) => r.npc === c.name)) {
      relations.push({
        npc: c.name,
        value: clamp(toInt(c.attitude, 0), -5, 5),
        note: "对主角态度",
      });
    }
  }

  const inventory = ((card || {}).inventory || [])
    .filter((it) => isDict(it) && it.name)
    .map((it) => ({
      name: pyStr(it.name),
      qty: toInt(it.qty, 1),
      slots: toInt(it.slots, 1),
      note: pyText(it.note),
    }));
  const funds = toInt((card || {}).funds, 10);
  const premise = opening.premise || `${mod.title || moduleName} 开局`;

  return {
    version: STATE_VERSION,
    module: mod.name || moduleName,
    slot: toInt(slot, 1),
    title: mod.title || moduleName,
    day,
    period_index: periodIndex,
    periods,
    location,
    character,
    party,
    inventory,
    funds,
    relations,
    clocks: [],
    events_fired: [],
    clues: [],
    log: [{
      day, period, type: "开场", text: premise,
    }],
  };
}

// ---------------------------------------------------------------------------
// 时间与摘要
// ---------------------------------------------------------------------------

export function currentPeriod(state) {
  const periods = state.periods || DEFAULT_PERIODS;
  if (!periods.length) return "";
  let i = toInt(state.period_index, 0);
  i = Math.max(0, Math.min(i, periods.length - 1));
  return periods[i];
}

/** 推进 N 个时段（跨天自动翻页），返回变更说明列表。 */
export function advanceTime(state, steps = 1) {
  ensureState(state);
  const changes = [];
  const periods = state.periods;
  let i = state.period_index;
  let day = state.day;
  const n = Math.max(0, toInt(steps, 0));
  for (let k = 0; k < n; k += 1) {
    i += 1;
    if (i >= periods.length) {
      i = 0;
      day += 1;
      changes.push(`跨天：进入第 ${day} 天`);
    }
    changes.push(`时间推进到 第 ${day} 天 · ${periods[i]}`);
  }
  state.day = day;
  state.period_index = i;
  return changes;
}

export function addLog(state, text, type_ = "note", day = null, period = null) {
  ensureState(state);
  const entry = {
    day: toInt(day !== null && day !== undefined ? day : state.day, state.day),
    period: pyText(pyOr(period, currentPeriod(state))),
    type: pyText(pyOr(type_, "note")),
    text: pyStr(text),
  };
  state.log.push(entry);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  return entry;
}

/** 生成给 LLM 的紧凑状态文本。 */
export function stateSummary(state, logTail = 6) {
  ensureState(state);
  const ch = state.character;
  const title = pyStr(pyOr(pyOr(state.title, state.module), "未命名"));
  const lines = [`《${title}》第 ${state.day} 天 · ${currentPeriod(state)}｜地点：${pyStr(pyOr(state.location, "未知"))}`];

  const gauges = ch.gauges || {};
  const gaugeTxt = Object.entries(gauges).map(([n, g]) => `${n} ${g.value}/${g.max}`).join(" ｜ ");
  lines.push(`角色 ${pyStr(pyOr(ch.name, "主角"))}：${gaugeTxt || "（无仪表）"}`);
  const attrs = ATTRS.filter((a) => ch.attributes[a]).map((a) => `${a}${toInt(ch.attributes[a], 0)}`).join(" ");
  const skills = Object.keys(SKILLS).filter((s) => ch.skills[s]).map((s) => `${s}${toInt(ch.skills[s], 0)}`).join(" ");
  lines.push(
    `属性：${attrs || "—"}｜技能：${skills || "—"}｜防御 ${ch.defense || 0}｜携带格 ${ch.capacity || 0}`,
  );
  if (ch.traits && ch.traits.length) lines.push(`特质：${ch.traits.map(pyStr).join("；")}`);
  if (ch.statuses && ch.statuses.length) lines.push(`状态：${ch.statuses.map(pyStr).join("；")}`);
  lines.push(`经验：${ch.xp ?? 0}（累计 ${ch.xp_total ?? 0}）｜资金：${state.funds ?? 0}`);

  const inv = state.inventory || [];
  if (inv.length) {
    const items = inv.map((i) => `${i.name}×${toInt(i.qty, 1)}`).join("、");
    const used = inv.reduce((sum, i) => sum + toInt(i.slots, 1), 0);
    lines.push(`物品（约 ${used}/${ch.capacity || 0} 格）：${items}`);
  }
  const rels = state.relations || [];
  if (rels.length) lines.push(`关系：${rels.map((r) => `${r.npc} ${formatSigned(toInt(r.value))}`).join("、")}`);
  for (const c of state.clocks || []) {
    const mx = Math.max(1, toInt(c.max, 6));
    const v = toInt(c.value, 0);
    lines.push(`进度钟 [${c.name}] ${clockBar(v, mx)} ${v}/${mx} — 满时：${c.consequence || "（未写）"}`);
  }
  const party = state.party || {};
  if (Object.keys(party).length) {
    const parts = [];
    for (const [npc, m] of Object.entries(party)) {
      const hp = (m.gauges || {})["生命"];
      const extra = isDict(hp) ? ` 生命 ${hp.value}/${hp.max}` : "";
      parts.push(`${npc}(关系${formatSigned(toInt(m.relation))}${extra})`);
    }
    lines.push(`同伴：${parts.join("、")}`);
  }
  const openClues = (state.clues || []).filter((c) => !c.done).map((c) => String(c.text));
  if (openClues.length) lines.push(`线索：${openClues.slice(0, 8).join("；")}`);
  const pe = state.pending_event;
  if (isDict(pe) && pyTruthy(pyOr(pe.code, pe.name))) {
    lines.push(`待处理事件：${pyStr(pyOr(pe.code, ""))} ${pyStr(pyOr(pe.name, ""))}`.trim());
  }
  const tail = Math.max(0, toInt(logTail, 0));
  for (const e of (state.log || []).slice(-tail)) {
    lines.push(`  D${e.day}·${e.period} [${e.type}] ${String(e.text).slice(0, 100)}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GM 补丁
// ---------------------------------------------------------------------------

/**
 * 按 GM 补丁更新存档，返回人类可读的变更说明列表。
 *
 * 支持的键：
 *   hp / energy / stress     数字=增量，或 {delta|set,max}，映射到生命/精力/压力
 *   gauges                   {名: 增量 或 {delta|set|value,max}}，自动建表
 *   party                    {NPC名: {gauges, relation, notes, ...其他字段}}
 *   funds / xp / xp_total    数字=增量，或 {set|delta}
 *   location / day / period 直接设置（day/period 也接受 {delta}/{set}）
 *   time_advance             N 个时段
 *   add_status / remove_status        字符串或数组
 *   items                    [{name, delta|set, slots, note}]
 *   relations                [{npc, delta|set, note}]，钳制 ±5
 *   clocks                   [{name, advance|set, create:{max,consequence}, remove}]
 *   clues_add / clues_done   字符串/数组（clues_done 也接受下标）
 *   events                   [{code,name}] 追加已触发事件
 *   pending_event            dict 或 null（清除）
 *   log                      字符串/数组，追加日志
 */
export function applyPatch(state, patch) {
  const changes = [];
  if (!isDict(patch)) return ["补丁必须是对象，已忽略"];
  ensureState(state);
  const ch = state.character;
  const gauges = ch.gauges;

  const readGaugeSpec = (spec) => {
    if (isDict(spec)) {
      return {
        delta: spec.delta ?? null,
        value: getOr(spec, "set", spec.value ?? null),
        maximum: spec.max ?? null,
      };
    }
    return { delta: spec, value: null, maximum: null };
  };

  for (const [key, name] of [["hp", "生命"], ["energy", "精力"], ["stress", "压力"]]) {
    if (key in patch && patch[key] !== null && patch[key] !== undefined) {
      const { delta, value, maximum } = readGaugeSpec(patch[key]);
      const g = gauge(gauges, name, autoMax(state, name, toInt(delta, 0)));
      const before = g.value;
      applyGauge(g, { delta, value, maximum });
      changes.push(gaugeChange(name, before, g));
    }
  }

  const gaugesPatch = patch.gauges;
  for (const [name, spec] of Object.entries(isDict(gaugesPatch) ? gaugesPatch : {})) {
    const { delta, value, maximum } = readGaugeSpec(spec);
    const g = gauge(gauges, name, autoMax(state, name, toInt(delta, 0)));
    const before = g.value;
    applyGauge(g, { delta, value, maximum });
    changes.push(gaugeChange(name, before, g));
  }

  const partyPatch = patch.party;
  for (const [npcRaw, spec] of Object.entries(isDict(partyPatch) ? partyPatch : {})) {
    const npc = String(npcRaw);
    let member = state.party[npc];
    if (!isDict(member)) {
      member = { gauges: {}, relation: 0, notes: "" };
      state.party[npc] = member;
    }
    if (!isDict(member.gauges)) member.gauges = {};
    setDefault(member, "relation", 0);
    setDefault(member, "notes", "");
    if (!isDict(spec)) continue;
    for (const [k, v] of Object.entries(spec)) {
      if (k === "gauges" && isDict(v)) {
        for (const [gname, gspec] of Object.entries(v)) {
          const { delta, value, maximum } = readGaugeSpec(gspec);
          const g = gauge(member.gauges, gname, autoMax(state, gname, toInt(delta, 0)));
          const before = g.value;
          applyGauge(g, { delta, value, maximum });
          changes.push(`${npc}·${gaugeChange(gname, before, g)}`);
        }
      } else if (k === "relation") {
        const before = toInt(member.relation, 0);
        let after;
        if (isDict(v)) {
          after = clamp(toInt(getOr(v, "set", getOr(v, "value", before)), before), -5, 5);
        } else {
          after = clamp(before + toInt(v, 0), -5, 5);
        }
        member.relation = after;
        changes.push(`${npc} 关系 ${formatSigned(before)} → ${formatSigned(after)}`);
      } else if (k === "notes") {
        const text = pyStr(v).trim();
        if (text) {
          member.notes = member.notes ? `${member.notes}；${text}` : text;
          changes.push(`${npc} 备注追加`);
        }
      } else {
        member[k] = v;
      }
    }
  }

  if (patch.funds !== null && patch.funds !== undefined) {
    const before = toInt(state.funds, 0);
    const spec = patch.funds;
    let after;
    if (isDict(spec)) {
      after = toInt(getOr(spec, "set", getOr(spec, "value", before + toInt(spec.delta, 0))), before);
    } else {
      after = before + toInt(spec, 0);
    }
    state.funds = Math.max(0, after);
    changes.push(`资金 ${before} → ${state.funds}`);
  }

  for (const key of ["xp", "xp_total"]) {
    if (patch[key] === null || patch[key] === undefined) continue;
    const before = toInt(ch[key], 0);
    const spec = patch[key];
    let after;
    if (isDict(spec)) {
      after = toInt(getOr(spec, "set", getOr(spec, "value", before + toInt(spec.delta, 0))), before);
    } else {
      after = before + toInt(spec, 0);
    }
    ch[key] = Math.max(0, after);
    if (key === "xp" && ch[key] > before) {
      ch.xp_total = toInt(ch.xp_total, 0) + (ch[key] - before);
    }
    changes.push(`经验 ${key} ${before} → ${ch[key]}`);
  }

  if (pyTruthy(patch.location)) {
    const before = state.location || "";
    state.location = pyStr(patch.location);
    changes.push(`地点 ${before || "—"} → ${state.location}`);
  }

  if (patch.day !== null && patch.day !== undefined) {
    const spec = patch.day;
    const before = state.day;
    let after;
    if (isDict(spec)) {
      after = "delta" in spec ? before + toInt(spec.delta, 0) : toInt(spec.set, before);
    } else {
      after = toInt(spec, before);
    }
    state.day = Math.max(0, after);
    changes.push(`日期 第 ${before} 天 → 第 ${state.day} 天`);
  }

  if (patch.period !== null && patch.period !== undefined) {
    const before = currentPeriod(state);
    const idx = matchPeriod(state.periods, patch.period);
    if (idx === null) {
      changes.push(`时段「${pyStr(patch.period)}」不在时段表，已忽略`);
    } else {
      state.period_index = idx;
      changes.push(`时段 ${before} → ${currentPeriod(state)}`);
    }
  }

  if (patch.time_advance) changes.push(...advanceTime(state, patch.time_advance));

  for (let s of asList(patch.add_status)) {
    s = pyStr(s).trim();
    if (!s) continue;
    if (ch.statuses.includes(s)) {
      changes.push(`状态「${s}」已存在（刷新）`);
    } else {
      ch.statuses.push(s);
      changes.push(`获得状态：${s}`);
    }
  }
  for (const s of asList(patch.remove_status)) {
    const t = pyStr(s).trim();
    const hit = removeByText(ch.statuses, t);
    changes.push(hit ? `解除状态：${hit}` : `未找到状态「${t}」`);
  }

  for (const it of asList(patch.items)) {
    if (!isDict(it)) continue;
    const name = pyText(it.name).trim();
    if (!name) continue;
    const delta = it.delta ?? null;
    const setTo = it.set ?? null;
    let item = findItem(state.inventory, name);
    if (item === null) {
      const qty = setTo !== null ? toInt(setTo, 0) : toInt(delta, 0);
      if (qty <= 0) {
        changes.push(`道具「${name}」不存在，已忽略`);
        continue;
      }
      item = {
        name, qty, slots: toInt(it.slots, 1), note: pyText(it.note),
      };
      state.inventory.push(item);
      changes.push(`获得道具：${name}×${qty}`);
    } else {
      const before = toInt(item.qty, 1);
      let qty;
      if (setTo !== null) qty = toInt(setTo, 0);
      else if (delta !== null) qty = before + toInt(delta, 0);
      else qty = before;
      if (qty <= 0) {
        state.inventory.splice(state.inventory.indexOf(item), 1);
        changes.push(`道具「${name}」×${before} 用尽，移出背包`);
        continue;
      }
      item.qty = qty;
      changes.push(`道具「${name}」${before} → ${qty}`);
    }
    if (it.slots !== null && it.slots !== undefined) item.slots = toInt(it.slots, 1);
    if (pyTruthy(it.note)) item.note = pyStr(it.note);
  }

  for (const rel of asList(patch.relations)) {
    if (!isDict(rel)) continue;
    const npc = pyText(rel.npc).trim();
    if (!npc) continue;
    let entry = state.relations.find((r) => r.npc === npc) ?? null;
    if (entry === null) {
      entry = { npc, value: 0, note: "" };
      state.relations.push(entry);
    }
    const before = toInt(entry.value, 0);
    let after;
    if (rel.set !== null && rel.set !== undefined) after = clamp(toInt(rel.set, before), -5, 5);
    else after = clamp(before + toInt(rel.delta, 0), -5, 5);
    entry.value = after;
    if (rel.note !== null && rel.note !== undefined) entry.note = pyStr(rel.note);
    changes.push(`关系 ${npc} ${formatSigned(before)} → ${formatSigned(after)}`);
  }

  for (const c of asList(patch.clocks)) {
    if (!isDict(c)) continue;
    const name = pyText(c.name).trim();
    if (!name) continue;
    let clock = state.clocks.find((x) => x.name === name) ?? null;
    if (pyTruthy(c.remove)) {
      if (clock !== null) {
        state.clocks.splice(state.clocks.indexOf(clock), 1);
        changes.push(`移除进度钟「${name}」`);
      } else {
        changes.push(`进度钟「${name}」不存在`);
      }
      continue;
    }
    const create = isDict(c.create) ? c.create : {};
    if (clock === null) {
      clock = {
        name,
        value: 0,
        max: Math.max(1, toInt(create.max, 6)),
        consequence: pyStr(pyOr(create.consequence, "")),
      };
      state.clocks.push(clock);
      changes.push(`新建进度钟「${name}」0/${clock.max}`);
    } else {
      if (create.max !== null && create.max !== undefined) {
        clock.max = Math.max(1, toInt(create.max, clock.max || 6));
      }
      if (pyTruthy(create.consequence)) clock.consequence = pyStr(create.consequence);
    }
    const mx = Math.max(1, toInt(clock.max, 6));
    clock.max = mx;
    const before = toInt(clock.value, 0);
    let after;
    if (c.advance !== null && c.advance !== undefined) after = clamp(before + toInt(c.advance, 0), 0, mx);
    else if (c.set !== null && c.set !== undefined) after = clamp(toInt(c.set, before), 0, mx);
    else after = before;
    clock.value = after;
    const suffix = after >= mx ? "（已满！）" : "";
    changes.push(`进度钟「${name}」${before}/${mx} → ${after}/${mx}${suffix}`);
  }

  for (const textRaw of asList(patch.clues_add)) {
    const text = pyStr(textRaw).trim();
    if (text) {
      state.clues.push({ text, done: false });
      changes.push(`新增线索：${text.slice(0, 40)}`);
    }
  }
  for (const key of asList(patch.clues_done)) {
    const clue = findClue(state.clues, key);
    if (clue === null) {
      changes.push(`未找到线索「${pyStr(key)}」`);
    } else {
      clue.done = true;
      changes.push(`线索完成：${String(clue.text).slice(0, 40)}`);
    }
  }

  for (const ev of asList(patch.events)) {
    let code;
    let name;
    if (isDict(ev)) {
      code = pyText(ev.code);
      name = pyText(ev.name);
    } else {
      code = "";
      name = pyStr(ev);
    }
    if (code || name) {
      state.events_fired.push({ code, name, day: state.day });
      changes.push(`记录事件：${code} ${name}`.trim());
    }
  }

  if ("pending_event" in patch) {
    if (pyTruthy(patch.pending_event)) {
      const pe = patch.pending_event;
      state.pending_event = isDict(pe) ? pe : { name: pyStr(pe) };
      const code = pyStr(pyOr(state.pending_event.code, ""));
      const name = pyStr(pyOr(state.pending_event.name, ""));
      changes.push(`待处理事件：${code} ${name}`.trim());
    } else {
      delete state.pending_event;
      changes.push("清除待处理事件");
    }
  }

  for (const entry of asList(patch.log)) {
    addLog(state, entry);
    changes.push(`日志：${pyStr(entry).slice(0, 40)}`);
  }

  return changes;
}

// ---------------------------------------------------------------------------
// 玩家编辑操作
// ---------------------------------------------------------------------------

/**
 * 执行一条结构化编辑，返回 [ok, msg]。op 形如 {"op": "set_gauge", ...}。
 *
 * 支持：set_gauge / set_attr / set_skill / set_funds / set_xp /
 * add_item / remove_item / set_item_qty / set_relation /
 * set_clock / add_clock / remove_clock / add_clue / toggle_clue / remove_clue /
 * add_status / remove_status / add_trait / remove_trait / set_location / set_time /
 * spend_xp（技能升 N 级花 N×3、属性升 N 花 N×5、新特质 6）。
 */
export function applyEdit(state, op) {
  if (!isDict(op)) return [false, "编辑操作必须是对象"];
  ensureState(state);
  const ch = state.character;
  const gauges = ch.gauges;
  const action = pyText(pyOr(op.op, op.action)).trim();

  if (action === "set_gauge") {
    const name = pyText(op.name).trim();
    if (!name) return [false, "缺少仪表名"];
    if (op.value === null || op.value === undefined) {
      if (op.max === null || op.max === undefined) return [false, "缺少 value 或 max"];
    }
    const g = gauge(gauges, name, autoMax(state, name, toInt(op.value, 0)));
    const before = g.value;
    applyGauge(g, { value: op.value ?? null, maximum: op.max ?? null });
    return [true, `${name} ${before} → ${g.value}（上限 ${g.max}）`];
  }

  if (action === "set_attr") {
    const name = pyText(op.name).trim();
    if (!ATTRS.includes(name) && !hasOwn(ch.attributes, name)) return [false, `未知属性：${name}`];
    let value = toInt(op.value, -1);
    if (value < 1) return [false, "属性最低 1"];
    const clamped = value > 5;
    value = Math.min(value, 5);
    const before = toInt(ch.attributes[name], 0);
    ch.attributes[name] = value;
    updateDerived(ch, "attr", name, before, value);
    return [true, `属性 ${name} ${before} → ${value}${clamped ? "（按上限 5 收敛）" : ""}`];
  }

  if (action === "set_skill") {
    const name = pyText(op.name).trim();
    if (!hasOwn(SKILLS, name) && !hasOwn(ch.skills, name)) return [false, `未知技能：${name}`];
    let value = toInt(op.value, -1);
    if (value < 0) return [false, "技能最低 0"];
    const clamped = value > 3;
    value = Math.min(value, 3);
    const before = toInt(ch.skills[name], 0);
    ch.skills[name] = value;
    updateDerived(ch, "skill", name, before, value);
    return [true, `技能 ${name} ${before} → ${value}${clamped ? "（按上限 3 收敛）" : ""}`];
  }

  if (action === "set_funds") {
    const value = toInt(op.value, -1);
    if (value < 0) return [false, "资金不能为负"];
    const before = toInt(state.funds, 0);
    state.funds = value;
    return [true, `资金 ${before} → ${value}`];
  }

  if (action === "set_xp") {
    const value = toInt(op.value, -1);
    if (value < 0) return [false, "经验不能为负"];
    const before = toInt(ch.xp, 0);
    ch.xp = value;
    if (value > toInt(ch.xp_total, 0)) ch.xp_total = value;
    return [true, `经验 ${before} → ${value}（累计 ${ch.xp_total}）`];
  }

  if (action === "add_item") {
    const name = pyText(op.name).trim();
    if (!name) return [false, "缺少道具名"];
    const qty = Math.max(1, toInt(op.qty, 1));
    const item = findItem(state.inventory, name);
    if (item !== null) {
      const before = toInt(item.qty, 1);
      item.qty = before + qty;
      if (op.slots !== null && op.slots !== undefined) item.slots = toInt(op.slots, 1);
      if (pyTruthy(op.note)) item.note = pyStr(op.note);
      return [true, `道具「${item.name}」${before} → ${item.qty}`];
    }
    state.inventory.push({
      name,
      qty,
      slots: toInt(op.slots, 1),
      note: pyText(op.note),
    });
    return [true, `获得道具：${name}×${qty}`];
  }

  if (action === "remove_item") {
    const name = pyText(op.name).trim();
    const item = findItem(state.inventory, name);
    if (item === null) return [false, `背包里没有「${name}」`];
    state.inventory.splice(state.inventory.indexOf(item), 1);
    return [true, `移除道具：${item.name}`];
  }

  if (action === "set_item_qty") {
    const name = pyText(op.name).trim();
    const qty = toInt(op.qty, -1);
    if (qty < 0) return [false, "数量不能为负"];
    const item = findItem(state.inventory, name);
    if (item === null) return [false, `背包里没有「${name}」`];
    if (qty === 0) {
      state.inventory.splice(state.inventory.indexOf(item), 1);
      return [true, `道具「${item.name}」数量归零，移出背包`];
    }
    const before = toInt(item.qty, 1);
    item.qty = qty;
    return [true, `道具「${item.name}」${before} → ${qty}`];
  }

  if (action === "set_relation") {
    const npc = pyText(op.npc).trim();
    if (!npc) return [false, "缺少 NPC 名"];
    const value = clamp(toInt(op.value, 0), -5, 5);
    let entry = state.relations.find((r) => r.npc === npc) ?? null;
    if (entry === null) {
      entry = { npc, value: 0, note: "" };
      state.relations.push(entry);
    }
    const before = toInt(entry.value, 0);
    entry.value = value;
    if (op.note !== null && op.note !== undefined) entry.note = pyStr(op.note);
    return [true, `关系 ${npc} ${formatSigned(before)} → ${formatSigned(value)}`];
  }

  if (action === "set_clock") {
    const name = pyText(op.name).trim();
    if (!name) return [false, "缺少进度钟名"];
    const value = toInt(op.value, -1);
    if (value < 0) return [false, "进度不能为负"];
    let clock = state.clocks.find((x) => x.name === name) ?? null;
    if (clock === null) {
      const mx0 = Math.max(1, toInt(op.max, 6));
      clock = {
        name, value: 0, max: mx0, consequence: pyText(op.consequence),
      };
      state.clocks.push(clock);
    }
    let mx = Math.max(1, toInt(clock.max, 6));
    if (op.max !== null && op.max !== undefined) {
      mx = Math.max(1, toInt(op.max, mx));
      clock.max = mx;
    }
    const before = toInt(clock.value, 0);
    clock.value = clamp(value, 0, mx);
    if (op.consequence !== null && op.consequence !== undefined) clock.consequence = pyStr(op.consequence);
    return [true, `进度钟「${name}」${before}/${mx} → ${clock.value}/${mx}`];
  }

  if (action === "add_clock") {
    const name = pyText(op.name).trim();
    if (!name) return [false, "缺少进度钟名"];
    const mx = Math.max(1, toInt(op.max, 6));
    const clock = state.clocks.find((x) => x.name === name) ?? null;
    if (clock !== null) {
      clock.max = mx;
      if (op.consequence !== null && op.consequence !== undefined) clock.consequence = pyStr(op.consequence);
      clock.value = Math.min(toInt(clock.value, 0), mx);
      return [true, `进度钟「${name}」已存在，更新为 ${clock.value}/${mx}`];
    }
    state.clocks.push({
      name, value: 0, max: mx, consequence: pyText(op.consequence),
    });
    return [true, `新建进度钟「${name}」0/${mx}`];
  }

  if (action === "remove_clock") {
    const name = pyText(op.name).trim();
    const clock = state.clocks.find((x) => x.name === name) ?? null;
    if (clock === null) return [false, `没有进度钟「${name}」`];
    state.clocks.splice(state.clocks.indexOf(clock), 1);
    return [true, `移除进度钟「${name}」`];
  }

  if (action === "add_clue") {
    const text = pyText(pyOr(op.text, op.name)).trim();
    if (!text) return [false, "缺少线索内容"];
    state.clues.push({ text, done: false });
    return [true, `新增线索：${text.slice(0, 40)}`];
  }

  if (action === "toggle_clue") {
    const clue = findClue(state.clues, getOr(op, "text", getOr(op, "index", op.name)));
    if (clue === null) return [false, "未找到线索"];
    clue.done = !clue.done;
    return [true, `线索${clue.done ? "已完成" : "重新打开"}：${String(clue.text).slice(0, 40)}`];
  }

  if (action === "remove_clue") {
    const clue = findClue(state.clues, getOr(op, "text", getOr(op, "index", op.name)));
    if (clue === null) return [false, "未找到线索"];
    state.clues.splice(state.clues.indexOf(clue), 1);
    return [true, `移除线索：${String(clue.text).slice(0, 40)}`];
  }

  if (action === "add_status") {
    const text = pyText(pyOr(op.text, op.name)).trim();
    if (!text) return [false, "缺少状态名"];
    if (ch.statuses.includes(text)) return [true, `状态「${text}」已存在（刷新）`];
    ch.statuses.push(text);
    return [true, `获得状态：${text}`];
  }

  if (action === "remove_status") {
    const text = pyText(pyOr(op.text, op.name)).trim();
    const hit = removeByText(ch.statuses, text);
    return hit ? [true, `解除状态：${hit}`] : [false, `没有状态「${text}」`];
  }

  if (action === "add_trait") {
    const text = pyText(pyOr(op.text, op.name)).trim();
    if (!text) return [false, "缺少特质名"];
    if (ch.traits.includes(text)) return [true, `特质「${text}」已存在`];
    if (ch.traits.length >= 4) return [false, "特质最多 4 个（core §6.3）"];
    ch.traits.push(text);
    return [true, `获得特质：${text}`];
  }

  if (action === "remove_trait") {
    const text = pyText(pyOr(op.text, op.name)).trim();
    const hit = removeByText(ch.traits, text);
    return hit ? [true, `移除特质：${hit}`] : [false, `没有特质「${text}」`];
  }

  if (action === "set_location") {
    const name = pyText(pyOr(op.name, op.value)).trim();
    if (!name) return [false, "缺少地点名"];
    const before = state.location || "";
    state.location = name;
    return [true, `地点 ${before || "—"} → ${name}`];
  }

  if (action === "set_time") {
    const hasPeriod = op.period !== null && op.period !== undefined;
    const idx = hasPeriod ? matchPeriod(state.periods, op.period) : null;
    if (hasPeriod && idx === null) return [false, `时段「${pyStr(op.period)}」不在时段表`];
    const parts = [];
    if (op.day !== null && op.day !== undefined) {
      const before = state.day;
      state.day = Math.max(0, toInt(op.day, before));
      parts.push(`第 ${before} 天 → 第 ${state.day} 天`);
    }
    if (hasPeriod) {
      const before = currentPeriod(state);
      state.period_index = idx;
      parts.push(`时段 ${before} → ${currentPeriod(state)}`);
    }
    if (!parts.length) return [false, "缺少 day 或 period"];
    return [true, `时间：${parts.join("，")}`];
  }

  if (action === "spend_xp") {
    const kind = pyText(op.kind).trim();
    const xp = toInt(ch.xp, 0);
    if (kind === "skill") {
      const name = pyText(op.name).trim();
      if (!hasOwn(SKILLS, name) && !hasOwn(ch.skills, name)) return [false, `未知技能：${name}`];
      const target = toInt(getOr(op, "to", op.level), 0);
      const cur = toInt(ch.skills[name], 0);
      if (target <= cur) return [false, `技能「${name}」当前 ${cur} 级，目标 ${target} 级无效`];
      if (target > 3) return [false, "技能上限 3 级"];
      const cost = upgradeCost(cur, target, 3);
      if (xp < cost) return [false, `经验不足：需要 ${cost}，当前 ${xp}`];
      ch.skills[name] = target;
      updateDerived(ch, "skill", name, cur, target);
      ch.xp = xp - cost;
      return [true, `技能「${name}」${cur} → ${target} 级，花费 ${cost} 经验（剩余 ${ch.xp}）`];
    }
    if (kind === "attr") {
      const name = pyText(op.name).trim();
      if (!ATTRS.includes(name) && !hasOwn(ch.attributes, name)) return [false, `未知属性：${name}`];
      const target = toInt(getOr(op, "to", op.level), 0);
      const cur = toInt(ch.attributes[name], 0);
      if (target <= cur) return [false, `属性 ${name} 当前 ${cur} 点，目标 ${target} 点无效`];
      if (target > 5) return [false, "属性上限 5"];
      const cost = upgradeCost(cur, target, 5);
      if (xp < cost) return [false, `经验不足：需要 ${cost}，当前 ${xp}`];
      ch.attributes[name] = target;
      updateDerived(ch, "attr", name, cur, target);
      ch.xp = xp - cost;
      return [true, `属性 ${name} ${cur} → ${target} 点，花费 ${cost} 经验（剩余 ${ch.xp}）`];
    }
    if (kind === "trait") {
      const text = pyText(pyOr(op.name, op.text)).trim();
      if (!text) return [false, "缺少特质名"];
      if (ch.traits.includes(text)) return [false, `特质「${text}」已存在`];
      if (ch.traits.length >= 4) return [false, "特质最多 4 个（core §6.3）"];
      const cost = 6;
      if (xp < cost) return [false, `经验不足：需要 ${cost}，当前 ${xp}`];
      ch.traits.push(text);
      ch.xp = xp - cost;
      return [true, `获得新特质「${text}」，花费 6 经验（剩余 ${ch.xp}）`];
    }
    return [false, `未知成长类型：${kind || "（空）"}`];
  }

  return [false, `未知操作：${action || "（空）"}`];
}

export const slot_path = slotPath;
export const slot_info = slotInfo;
export const new_game = newGame;
export const current_period = currentPeriod;
export const advance_time = advanceTime;
export const add_log = addLog;
export const state_summary = stateSummary;
export const apply_patch = applyPatch;
export const apply_edit = applyEdit;
export const clear_caches = clearCaches;

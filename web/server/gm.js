/**
 * GM（主持人）层：提示词组装、输出协议解析、LLM 客户端与回合循环。
 *
 * 设计对齐分支 feat/rpg-backend-gm-protocol-and-http-api-w2 的 web/engine/gm.py（M2，974 行），
 * 引擎部分改用 M4 的 Node 移植（web/server/engine/*.js）。本版新增：
 * - 协议 JSON 增加 image_prompt 键：非空时回合结束后异步调 comfy.js 生成插图并发 image 事件；
 * - LLM 客户端用 Node 22 原生 fetch 解析 SSE（无 api_key 时回声调试模式）；
 * - 凭证来源新增 Kimi OAuth：api_key 为空且启用 kimi_oauth 时，Authorization 头由 auth.js 提供
 *   （带 60s 余量自动刷新，过期写回凭证文件），静态 api_key 与回声模式行为不变。
 *
 * 对外接口：
 *   buildMessages(module, state, action, config, history) -> [messages, meta]
 *   parseReply(text) -> [narrative, data|null]
 *   new GMClient(config).streamChat(messages)   # async generator
 *   runTurn(module, state, action, config, history, opts) -> async generator，产出 SSE 事件
 *   findLocation / isNight / effectiveDanger / drawEvent / rollEvent（/api/move 也复用）
 *
 * SSE 事件契约（前端按 type 消费）：
 *   {type:"narrative", delta} / {type:"dice", result} / {type:"state", state, suggestions, changes}
 *   / {type:"note", text} / {type:"image", url, prompt} / {type:"done"} / {type:"error", message}
 */

import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import * as diceMod from "./engine/dice.js";
import * as loader from "./engine/moduleLoader.js";
import * as stateMod from "./engine/state.js";
import { isDict, toInt } from "./engine/pycompat.js";
import * as configMod from "./config.js";
import * as authMod from "./auth.js";
import * as comfy from "./comfy.js";

export const MAX_ROUNDS = 3; // 一次回合最多几轮「判定 → 续写」
export const TAIL_KEEP = 80; // 流式输出时保留的安全尾缓冲（防把协议 JSON 吐给前端）
export const PROTOCOL_KEYS = ["dice_request", "state_patch", "suggestions", "image_prompt"];

// 提示词各段的长度上限（字符），超长截断并标注
export const MAX_RULES = 20000;
export const MAX_OVERRIDES = 20000;
export const MAX_SETTING = 20000;
export const MAX_LOC_RAW = 4000;
export const MAX_EVENT_INDEX = 3600;
export const MAX_ITEMS = 4000;
export const MAX_CARD_RAW = 4000;
export const MAX_CARD_EACH = 1600;
export const MAX_CARDS_TOTAL = 16000;
export const MAX_EVENT_RAW = 2400;
export const MAX_HISTORY_ENTRIES = 8;
export const MAX_HISTORY_CHARS = 12000;

export const D66_CELLS = [];
for (let a = 1; a <= 6; a += 1) {
  for (let b = 1; b <= 6; b += 1) D66_CELLS.push(a * 10 + b);
}

export const SUGGESTION_POOL = [
  "先别急着动手，退到暗处看清对方有几个、站在哪。",
  "找最近的人打听一句，哪怕只是天气或码头上的闲话。",
  "回去把今天的发现记下来，再决定下一步往哪走。",
  "绕去另一个地点碰碰运气，也许线索在别处。",
  "当面把话挑明，看对方什么反应。",
  "先补给自己：吃喝、休息，把状态养回来。",
  "把手里那件道具用在刀刃上，别一直留着。",
  "盯住刚才那个可疑的人，别跟丢。",
];

// ---------------------------------------------------------------------------
// 文本工具
// ---------------------------------------------------------------------------

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function clip(text, limit, note = "\n…（此段按长度截断，更完整的内容以规则文件与存档为准）") {
  const s = text || "";
  if (limit && s.length > limit) return s.slice(0, limit).trimEnd() + note;
  return s;
}

// ---------------------------------------------------------------------------
// 事件牌：解析、索引、抽牌（含「顺延未定义格」）
// ---------------------------------------------------------------------------

const _DECK_HEAD_RE = /^(#{2,4})\s+(\d{2}|S[-–]\d{1,2}|M[-–]E\d{1,2})\s+(.+?)\s*$/;

/** 把事件牌文件按「### d66 名称」切成条目：[{code, code_num, name, raw}]。 */
export function deckEntries(text) {
  const lines = String(text || "").split(/\r?\n/);
  const marks = [];
  lines.forEach((line, i) => {
    const m = _DECK_HEAD_RE.exec(line);
    if (m) marks.push([i, m[2], m[3].trim()]);
  });
  const out = [];
  marks.forEach(([i, code, name], j) => {
    const end = j + 1 < marks.length ? marks[j + 1][0] : lines.length;
    out.push({
      code,
      code_num: /^\d+$/.test(code) ? Number.parseInt(code, 10) : null,
      name,
      special: !/^\d+$/.test(code),
      raw: lines.slice(i, end).join("\n").trim(),
    });
  });
  return out;
}

function coreDeckFromFile() {
  const out = {};
  const text = readText(path.join(loader.CORE_DIR, "event-deck.md"));
  for (const e of deckEntries(text)) {
    if (e.code_num && !(e.code_num in out)) out[e.code_num] = { ...e, source: "core/event-deck.md" };
  }
  return out;
}

/** 返回 [本册事件牌, core 事件牌]，键为 d66 数字；本册缺失时 core 来自 core/event-deck.md。 */
export function moduleDecks(module) {
  const modDeck = {};
  let coreDeck = {};
  const events = module?.events || [];
  const fromOwnDeck = Boolean(String(module?.events_raw || "").trim());
  if (fromOwnDeck) {
    for (const e of events) {
      if (e.code_num && !(e.code_num in modDeck)) modDeck[e.code_num] = { ...e, source: "event-deck.md" };
    }
    coreDeck = coreDeckFromFile();
  } else {
    for (const e of events) {
      if (e.code_num && !(e.code_num in coreDeck)) coreDeck[e.code_num] = { ...e, source: "core/event-deck.md" };
    }
    if (!Object.keys(coreDeck).length) coreDeck = coreDeckFromFile();
  }
  return [modDeck, coreDeck];
}

/** 按 d66 数字取事件（本册优先，回落 core）。 */
export function lookupEvent(module, cell) {
  const [modDeck, coreDeck] = moduleDecks(module);
  return modDeck[cell] || coreDeck[cell] || null;
}

/** 按事件编号取事件（数字 d66，或 S-1 / M-E1 这类特殊编号）。 */
export function lookupEventByCode(module, code) {
  const s = String(code ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return lookupEvent(module, Number.parseInt(s, 10));
  for (const e of module?.events || []) {
    if (String(e.code) === s) return e;
  }
  return null;
}

/** §4.2 抽牌：d66 → 未定义或已触发过的格子顺延到相邻格（+1，66 回到 11）。 */
export function drawEvent(module, work = null) {
  const [modDeck, coreDeck] = moduleDecks(module);
  const deck = { ...coreDeck, ...modDeck };
  if (!Object.keys(deck).length) return null;
  const fired = new Set((work?.events_fired || []).map((e) => String(e?.code ?? "")));
  const cell = diceMod.d66();
  const start = D66_CELLS.indexOf(cell) >= 0 ? D66_CELLS.indexOf(cell) : 0;
  let fallback = null;
  for (let offset = 0; offset < 36; offset += 1) {
    const c = D66_CELLS[(start + offset) % 36];
    const entry = deck[c];
    if (!entry) continue;
    if (fired.has(String(c))) {
      if (fallback === null) fallback = [c, entry, offset];
      continue;
    }
    return { ...entry, cell: c, code: String(c), name: entry.name || "", shift: offset, repeated: false };
  }
  if (fallback !== null) {
    const [c, entry, offset] = fallback;
    return { ...entry, cell: c, code: String(c), name: entry.name || "", shift: offset, repeated: true };
  }
  return null;
}

/**
 * §4.2 事件判定：1d6 ≤ 有效危险度则抽牌，写回 events_fired 与 pending_event。
 * 触发返回事件 dict（含 shift/repeated），未触发返回 null，触发但事件牌为空返回 {empty: true}。
 */
export function rollEvent(module, work, danger) {
  const d = Math.max(0, Math.min(5, toInt(danger, 0)));
  if (d <= 0) return null;
  if (!diceMod.eventTriggered(d)) return null;
  const entry = drawEvent(module, work);
  if (entry === null) return { code: "", name: "", raw: "", empty: true, shift: 0 };
  stateMod.applyPatch(work, {
    events: [{ code: entry.code, name: entry.name }],
    pending_event: { code: entry.code, name: entry.name, day: toInt(work?.day, 1) },
  });
  let text = `时段结束事件判定触发：抽中 ${entry.code || ""} ${entry.name || ""}`.trim();
  if (entry.shift) text += `（原格未定义或已触发，顺延 ${entry.shift} 格）`;
  stateMod.addLog(work, text, "事件");
  return entry;
}

// ---------------------------------------------------------------------------
// 地图 / 时间小工具（/api/move 也复用）
// ---------------------------------------------------------------------------

export function findLocation(module, name) {
  const target = String(name ?? "").trim();
  if (!target) return null;
  const locs = module?.locations || [];
  for (const loc of locs) {
    if (String(loc?.name ?? "").trim() === target) return loc;
  }
  for (const loc of locs) {
    const n = String(loc?.name ?? "").trim();
    if (n && (target.includes(n) || n.includes(target))) return loc;
  }
  return null;
}

export function isNight(period) {
  return String(period ?? "").includes("夜");
}

/** 有效危险度：本册写明「夜间 N」用它，否则夜间户外 +1，最终钳制 0–5。 */
export function effectiveDanger(loc, night = false) {
  if (!isDict(loc)) return 0;
  let d = toInt(loc.danger, 0);
  if (night && loc.night_danger !== null && loc.night_danger !== undefined) d = toInt(loc.night_danger, d);
  else if (night && d > 0) d += 1;
  return Math.max(0, Math.min(5, d));
}

// ---------------------------------------------------------------------------
// 提示词组装
// ---------------------------------------------------------------------------

const _STYLE_SPEC = `## 叙述要求
- 中文，第二人称「你」；具体感官细节（气味、声响、光线、温度），用身体语言代替抽象心情。
- 失败与代价要推动剧情：让事情变复杂、露出新苗头，不要写成「什么都没发生」。
- NPC 有自己的动机与秘密（见角色卡），会撒谎、会反悔、不会无缘无故讨好玩家。
- 只在本册地图、事件牌与角色卡的范围内即兴；要加新东西就通过 state_patch 的线索/进度钟/道具落地。
- 每次回复 3–6 段；不要替玩家做决定，结尾留出玩家下一步行动的空间。
- 除末尾的协议 JSON 块外，不要输出任何其他 JSON、代码块或系统说明。`;

const _PROTOCOL_SPEC = `## 输出协议（必须严格遵守）

你的每次回复 = 叙述正文 + 末尾一个 \`\`\`json 围栏块。JSON 块格式：

\`\`\`json
{
  "dice_request": null,
  "state_patch": {},
  "suggestions": ["下一步行动建议 1", "建议 2"],
  "image_prompt": null
}
\`\`\`

- **dice_request**：需要玩家判定时填 \`{"attr":"感知","skill":"察觉","difficulty":9,"reason":"为什么判定","advantage":false,"disadvantage":false}\`；
  attr/skill 用规则与角色卡上的名称（角色没有的项按 0 计），difficulty 见难度表（简单 7 / 普通 9 / 困难 11 / 极难 13 / 传奇 15）。
  不需要判定时填 null。系统会用真骰子结算并把结果发回给你续写——你绝不能自己编造骰子点数，叙述里也不要写掷骰数字（系统会展示）。
- **state_patch**：只写本回合发生变化的键，没有变化就写 {}。可用键：
  hp / energy / stress（数字=增量，或 {"delta":±N,"set":N,"max":N}）；
  gauges{仪表名: 增量 或 {delta|set, max}}；party{NPC名:{gauges:{仪表: 增量}, relation:±N, notes:"…"}}；
  funds（增量或 {set}）；xp（增量）；location（地点名）；day（{delta|set}）；period（时段名）；time_advance（推进几个时段）；
  add_status[] / remove_status[]；items[{name, delta|set, slots, note}]；
  relations[{npc, delta|set, note}]（钳制 ±5）；clocks[{name, advance|set, create:{max, consequence}, remove}]；
  clues_add[] / clues_done[]。
- **suggestions**：2–4 条给玩家选的具体行动建议，彼此要有区分度。
- **image_prompt**：需要剧情插图时填一段画面描述（供本机 Z-Image 生图引擎出图，优先英文关键词：人物外貌/动作、环境、光线、镜头、氛围；不要写画面文字或水印），
  例如 "young detective crouching by crates in a rainy harbor alley at dusk, lantern light, wet cobblestone, cinematic"。
  只在值得配图时给（进入新地点、关键事件、重要人物登场、气氛转折），多数普通回合填 null。
- 除末尾这一个 json 块外，不要再输出其它 json 或代码块。`;

function gmPreamble(module) {
  const title = module.title || module.name || "未命名";
  const lines = [
    `你是《${title}》的文字冒险 GM（主持人）。你扮演世界与所有 NPC：按规则裁决，按判定的结果档位叙述，维护存档状态。`,
  ];
  if (module.tone) lines.push(`基调：${module.tone}。`);
  if (module.rating) lines.push(`分级：${module.rating}（按这个尺度把握内容，不回避、不注水）。`);
  if (String(module.intro || "").trim()) lines.push(`简介：${String(module.intro).trim()}`);
  lines.push("回合流程：玩家宣言意图 → 需要时你提出判定（系统真掷骰）→ 你按结果档位叙述 → 用 state_patch 结算。");
  lines.push("系统会在每回合结束后自动推进 1 个时段并做 §4.2 事件判定（抽中的事件会注入全文给你演绎）；"
    + "若本回合行动本身更耗时（长途赶路、睡一觉等），在 state_patch.time_advance 里补写额外时段。");
  return `## GM 角色\n${lines.join("\n")}`;
}

function settingText(module) {
  if (module.engine !== "core") return ""; // 此时 rules_text 本身就是 setting.md
  const p = module.paths?.setting;
  if (p) return readText(p);
  const fallback = path.join(module.dir || "", "setting.md");
  return fs.existsSync(fallback) ? readText(fallback) : "";
}

function itemsText(module) {
  const p = module.paths?.items;
  if (p) return [readText(p), String(p)];
  const fallback = path.join(module.dir || "", "item-dex.md");
  if (fs.existsSync(fallback)) return [readText(fallback), String(fallback)];
  const core = path.join(loader.CORE_DIR, "item-dex.md");
  return [readText(core), String(core)];
}

function mapSection(module, save) {
  const locs = module.locations || [];
  const cur = findLocation(module, save.location);
  const lines = [];
  if (cur !== null) {
    let tag = `危险度 ${cur.danger !== null && cur.danger !== undefined ? cur.danger : "—"}`;
    if (cur.night_danger !== null && cur.night_danger !== undefined) tag += `（夜间 ${cur.night_danger}）`;
    lines.push(`### 当前地点 · ${cur.name}（${tag}）`);
    lines.push(clip(cur.raw || "", MAX_LOC_RAW));
  } else {
    lines.push(`### 当前地点 · ${save.location || "未知"}（不在本册地图表里）`);
  }
  const others = locs.filter((loc) => loc !== cur);
  if (others.length) {
    lines.push("### 其他地点（仅索引；移动的路线/耗时由系统处理）");
    for (const loc of others) {
      let tag = `危险度 ${loc.danger !== null && loc.danger !== undefined ? loc.danger : "—"}`;
      if (loc.night_danger !== null && loc.night_danger !== undefined) tag += `（夜间 ${loc.night_danger}）`;
      const desc = String(loc.desc || "").split(/\s+/).join(" ");
      lines.push(`- ${loc.name}（${tag}）：${desc}`);
    }
  }
  const routes = module.routes || [];
  if (routes.length) {
    lines.push("### 路线");
    for (const r of routes) {
      const note = r.note ? ` 备注：${r.note}` : "";
      lines.push(`- ${r.code || ""} ${r.from} → ${r.to}（耗时 ${r.time || "—"}，危险 ${r.danger !== null && r.danger !== undefined ? r.danger : "—"}）${note}`);
    }
  }
  return `## 地图\n${lines.join("\n")}`;
}

function eventsSection(module, save) {
  const [modDeck, coreDeck] = moduleDecks(module);
  const lines = [
    "## 事件牌（索引）",
    "系统已按 core §4.2 判定过是否触发事件并完成 d66 抽牌（未定义或已触发的格子会自动顺延）。"
    + "你不需要自己抽牌；抽中的事件全文会作为「本回合事件」注入。",
  ];
  const modCells = Object.keys(modDeck).map(Number).sort((a, b) => a - b);
  if (modCells.length) {
    lines.push("本册事件牌：");
    for (const cell of modCells) lines.push(`- ${cell} ${modDeck[cell].name}`);
  }
  const coreCells = Object.keys(coreDeck).map(Number).sort((a, b) => a - b);
  if (coreCells.length) {
    lines.push(`core 通用事件牌：${coreCells.map((c) => `${c} ${coreDeck[c].name}`).join("、")}`);
  }
  const fired = save?.events_fired || [];
  if (fired.length) {
    const codes = fired.slice(-12).map((e) => `${e?.code ?? ""} ${e?.name ?? ""}`.trim()).join("、");
    lines.push(`已触发过的事件（同一冒险不重复）：${codes}`);
  }
  return clip(lines.join("\n"), MAX_EVENT_INDEX, "\n…（事件索引截断）");
}

function itemsSection(module) {
  const [text, source] = itemsText(module);
  if (!text.trim()) return "";
  return `## 道具规则（来源：${source}）\n${clip(text, MAX_ITEMS, "\n…（道具文本过长，此处截首部）")}`;
}

function charactersSection(module) {
  const lines = ["## 角色卡（原文）"];
  const player = module.player_card;
  if (isDict(player)) {
    lines.push(`### 玩家角色 · ${player.name}`);
    lines.push(clip(player.raw || "", MAX_CARD_RAW));
  }
  let budget = MAX_CARDS_TOTAL;
  let skipped = 0;
  for (const card of module.party_cards || []) {
    const raw = clip(card.raw || "", MAX_CARD_EACH, "…（本卡截断）");
    if (budget - raw.length < 0) {
      skipped += 1;
      continue;
    }
    budget -= raw.length;
    lines.push(`### NPC · ${card.name}`);
    lines.push(raw);
  }
  if (skipped) lines.push(`（另有 ${skipped} 张 NPC 卡因长度上限省略，需要时以线索/备注方式在叙述里体现）`);
  return lines.join("\n");
}

function pendingEventSection(module, save) {
  const pe = save?.pending_event;
  if (!isDict(pe) || !(pe.code || pe.name)) return "";
  const entry = lookupEventByCode(module, pe.code) || {};
  const head = `### ${pe.code || ""} ${pe.name || entry.name || ""}`.trim();
  const lines = ["## 本回合事件（已抽中，必须在本回合叙述里处理；系统回合结束后清除）", head];
  if (entry.raw) lines.push(clip(entry.raw, MAX_EVENT_RAW, "…（事件全文截断）"));
  return lines.join("\n");
}

function sanitizeHistory(history) {
  const out = [];
  let total = 0;
  if (!Array.isArray(history)) return out;
  for (const m of history.slice(-MAX_HISTORY_ENTRIES)) {
    if (!isDict(m)) continue;
    const role = String(m.role || "");
    if (role !== "user" && role !== "assistant") continue;
    let content = String(m.content || "");
    if (!content) continue;
    if (total + content.length > MAX_HISTORY_CHARS) content = content.slice(0, Math.max(0, MAX_HISTORY_CHARS - total));
    total += content.length;
    out.push({ role, content });
    if (total >= MAX_HISTORY_CHARS) break;
  }
  return out;
}

/** 组装一次 GM 调用的对话，返回 [messages, meta]。 */
export function buildMessages(module, save, action, config = null, history = null) {
  const parts = [gmPreamble(module), _STYLE_SPEC];
  const rules = clip(module.rules_text || "", MAX_RULES, "\n…（规则文本截断）");
  if (rules.trim()) parts.push(`## 玩法规则（来源：${module.rules_source || "core/rules.md"}）\n${rules}`);
  const overrides = clip(module.overrides || "", MAX_OVERRIDES, "\n…（规则覆盖截断）");
  if (overrides.trim()) parts.push(`## 本册规则覆盖（优先于 core 对应章节）\n${overrides}`);
  const setting = clip(settingText(module), MAX_SETTING, "\n…（设定文本截断）");
  if (setting.trim()) parts.push(`## 世界观设定\n${setting}`);
  parts.push(mapSection(module, save));
  parts.push(eventsSection(module, save));
  const items = itemsSection(module);
  if (items) parts.push(items);
  parts.push(charactersSection(module));
  parts.push(`## 当前存档\n${stateMod.stateSummary(save, 8)}`);
  const pending = pendingEventSection(module, save);
  if (pending) parts.push(pending);
  parts.push(_PROTOCOL_SPEC);
  const messages = [{ role: "system", content: parts.join("\n\n") }];
  messages.push(...sanitizeHistory(history));
  messages.push({ role: "user", content: `【玩家行动】\n${action}` });
  return [messages, { pending_event: save?.pending_event ?? null, system_chars: messages[0].content.length }];
}

// ---------------------------------------------------------------------------
// 输出协议解析
// ---------------------------------------------------------------------------

const _FENCE_RE = /```[ \t]*[A-Za-z]*[ \t]*\r?\n?(.*?)(?:```|$)/gs;
const _TRAILING_COMMA_RE = /,\s*([}\]])/g;
const _BARE_JSON_LINE_RE = /^[ \t]*\{\s*["}]/m;

function decodeCandidate(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  for (const candidate of [s, s.replace(_TRAILING_COMMA_RE, "$1")]) {
    try {
      const obj = JSON.parse(candidate);
      if (isDict(obj)) return obj;
    } catch {
      // 换下一个候选
    }
  }
  return null;
}

function hasProtocol(obj) {
  return isDict(obj) && PROTOCOL_KEYS.some((k) => k in obj);
}

/** 从 start 处的 `{` 起找配平的花括号段并 JSON.parse，返回 {obj, end} 或 null。 */
function rawDecodeJson(s, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        for (const c of [candidate, candidate.replace(_TRAILING_COMMA_RE, "$1")]) {
          try {
            const obj = JSON.parse(c);
            if (isDict(obj)) return { obj, end: i + 1 - start };
          } catch {
            // 换下一个候选
          }
        }
        return null;
      }
      if (depth < 0) return null;
    }
  }
  return null;
}

/** 从模型全文提取 [叙述, 协议字典|None]。先试末尾的 ```json 栅栏，再试花括号配平。 */
export function parseReply(text) {
  const raw = text || "";
  const fences = [...raw.matchAll(_FENCE_RE)];
  for (let i = fences.length - 1; i >= 0; i -= 1) {
    const m = fences[i];
    const obj = decodeCandidate(m[1]);
    if (hasProtocol(obj)) return [raw.slice(0, m.index).trimEnd(), obj];
  }
  let best = null;
  const braces = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "{") braces.push(i);
  }
  for (let i = braces.length - 1; i >= 0; i -= 1) {
    const start = braces[i];
    const dec = rawDecodeJson(raw, start);
    if (dec === null || !hasProtocol(dec.obj)) continue;
    if (!raw.slice(start + dec.end).trim()) return [raw.slice(0, start).trimEnd(), dec.obj];
    if (best === null || start + dec.end > best.end) best = { end: start + dec.end, start, obj: dec.obj };
  }
  if (best !== null) return [raw.slice(0, best.start).trimEnd(), best.obj];
  return [raw.trim(), null];
}

export function normalizeData(data) {
  const out = {};
  const req = data?.dice_request;
  out.dice_request = isDict(req) && Object.keys(req).length ? req : null;
  out.state_patch = isDict(data?.state_patch) ? data.state_patch : {};
  const items = [];
  if (Array.isArray(data?.suggestions)) {
    for (const s of data.suggestions) {
      const t = String(s ?? "").trim();
      if (t) items.push(t.slice(0, 120));
    }
  }
  out.suggestions = items.slice(0, 4);
  const img = typeof data?.image_prompt === "string" ? data.image_prompt.trim() : "";
  out.image_prompt = img ? img.slice(0, 1000) : null;
  return out;
}

/**
 * 流式闸门：只在叙述段放行文本，遇到 ``` 栅栏立即截断；
 * 栅栏位置未确定前保留安全尾缓冲，避免把协议 JSON 当叙述吐给前端。
 */
export class FenceStream {
  constructor(tailKeep = TAIL_KEEP) {
    this.buf = "";
    this.pos = 0;
    this.cut = null;
    this.tailKeep = tailKeep;
  }

  feed(chunk) {
    this.buf += chunk;
    if (this.cut === null) {
      const candidates = [];
      const i = this.buf.indexOf("```");
      if (i >= 0) candidates.push(i);
      const m = _BARE_JSON_LINE_RE.exec(this.buf);
      if (m) candidates.push(m.index);
      if (candidates.length) this.cut = Math.min(...candidates);
    }
    return this._emit(this.cut !== null ? this.cut : Math.max(0, this.buf.length - this.tailKeep));
  }

  setCut(n) {
    if (n !== null && n !== undefined && (this.cut === null || n < this.cut)) {
      this.cut = Math.max(0, toInt(n, 0));
    }
    return this.finish();
  }

  finish() {
    return this._emit(this.cut !== null ? this.cut : this.buf.length);
  }

  _emit(limit) {
    if (limit <= this.pos) return "";
    const out = this.buf.slice(this.pos, limit);
    this.pos = limit;
    return out;
  }
}

// ---------------------------------------------------------------------------
// LLM 客户端（OpenAI 兼容；无 api_key 时为回声调试模式）
// ---------------------------------------------------------------------------

export const ECHO_ACTION_NOTE = "（回声调试模式：未配置 API Key，本回合叙述由本地演示引擎生成；在 /api/config 配置模型后可接入真 LLM。）";

const ECHO_IMAGE_PROMPT = "cinematic scene illustration, tense nighttime encounter in a narrow harbor alley, wet cobblestone, lantern light, crates, a determined young woman in a worn coat, moody atmosphere";

function sample(arr, n) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

export function echoReply(messages) {
  let action = "";
  let tier = null;
  for (const m of messages || []) {
    if (!isDict(m)) continue;
    const content = String(m.content || "");
    if (content.startsWith("【玩家行动】")) {
      action = content.split("\n").slice(1).join("\n").split(/\s+/).filter(Boolean).join(" ").slice(0, 80);
    }
    if (content.includes("【判定结果")) {
      const hit = /档位：(\S+)/.exec(content);
      tier = hit ? hit[1] : "成功";
    }
  }
  let narrative;
  let data;
  if (tier === null) {
    narrative = `${ECHO_ACTION_NOTE}\n\n`
      + `你决定行动：${action || "先看看四周"}。`
      + "风贴着墙根爬过来，带着铁锈和湿木头的气味。远处有东西被碰响，一下，两下，"
      + "像是有人在试探什么。你没有立刻动，先让眼睛适应了暗处——"
      + "才看清脚边石板缝里积着的水，映出一截晃动的人影。";
    data = {
      dice_request: {
        attr: "感知", skill: "察觉", difficulty: 9,
        reason: "分辨暗处的人影与动静", advantage: false, disadvantage: false,
      },
      state_patch: {},
      suggestions: sample(SUGGESTION_POOL, 3),
      image_prompt: null,
    };
  } else {
    narrative = `${ECHO_ACTION_NOTE}\n\n`
      + `骰子已经落地，档位是「${tier}」。`
      + "你把刚才看见的东西在脑子里又过了一遍：有些细节对上了，有些还差一块拼图。"
      + "巷口的灯晃了一下，有人走过去，又停了半步——那个人在等什么。";
    data = {
      dice_request: null,
      state_patch: { stress: 15, funds: { delta: 1 } },
      suggestions: sample(SUGGESTION_POOL, 3),
      image_prompt: ECHO_IMAGE_PROMPT,
    };
  }
  return `${narrative}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
}

async function* streamEcho(messages) {
  const text = echoReply(messages);
  for (let i = 0; i < text.length; i += 64) {
    yield text.slice(i, i + 64);
    await sleep(8);
  }
}

function extractDeltaText(obj) {
  const choices = obj?.choices || [];
  if (!choices.length) return null;
  const choice = choices[0] || {};
  const delta = choice.delta || {};
  if (isDict(delta) && delta.content) return String(delta.content);
  const message = choice.message || {};
  if (isDict(message) && message.content) return String(message.content);
  return null;
}

/** OpenAI 兼容的 chat/completions 客户端；既无 api_key 也无 Kimi OAuth 时自动回声调试。 */
export class GMClient {
  constructor(config = null) {
    const cfg = configMod.normalizeConfig(config || {});
    this.config = cfg;
    this.base_url = cfg.base_url;
    this.api_key = cfg.api_key;
    this.model = cfg.model;
    this.temperature = cfg.temperature;
    this.timeout = Math.max(5, toInt(cfg.timeout, 180));
    this.stream = cfg.stream !== false;
    // 显式 api_key 优先；api_key 为空且 OAuth 生效（显式配置或自动检测到凭证文件）时走 OAuth。
    this.oauth = !this.api_key && configMod.oauthActive(cfg) ? authMod.getProvider(cfg) : null;
    this.echo = !this.api_key && !this.oauth;
  }

  endpoint() {
    return `${this.base_url}/chat/completions`;
  }

  /**
   * Authorization 头里的凭证：OAuth 模式由 auth.js 供给（临近过期自动刷新，必要时写回凭证文件）；
   * 静态模式直接用 api_key。错误信息里不含 token。
   */
  async authorizationToken() {
    if (!this.oauth) return this.api_key;
    try {
      return await this.oauth.getToken();
    } catch (e) {
      throw new Error(`Kimi OAuth 凭证不可用：${authMod.redact(e?.message ?? e, [this.api_key])}`);
    }
  }

  /** 产出模型文本增量（回声模式为本地演示文本）。超时按整段响应计（AbortSignal.timeout）。 */
  async *streamChat(messages) {
    if (this.echo) {
      yield* streamEcho(messages);
      return;
    }
    const payload = { model: this.model, messages, temperature: this.temperature };
    if (this.stream) payload.stream = true;
    const token = await this.authorizationToken();
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
      Accept: this.stream ? "text/event-stream" : "application/json",
    };
    let res;
    try {
      res = await fetch(this.endpoint(), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout * 1000),
      });
    } catch (e) {
      throw new Error(`连接模型接口失败（${this.base_url}）：${e?.message ?? e}`);
    }
    if (!res.ok) {
      let body = "";
      try {
        body = authMod.redact((await res.text()).split(/\s+/).join(" ").slice(0, 300), [token]);
      } catch {
        body = "";
      }
      // 401 多半是 token 被顶掉了：丢掉内存缓存，下次 getToken() 会重新读盘并刷新。
      if (res.status === 401 && this.oauth) this.oauth.invalidate();
      throw new Error(`模型接口返回 ${res.status}：${body || res.statusText}`);
    }
    if (!this.stream) {
      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error(`模型接口返回的不是 JSON：${e?.message ?? e}`);
      }
      const text = extractDeltaText(data);
      if (text) yield text;
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "").trim();
        buf = buf.slice(idx + 1);
        if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
        const payloadLine = line.slice(5).trim();
        if (payloadLine === "[DONE]") return;
        let obj;
        try {
          obj = JSON.parse(payloadLine);
        } catch {
          continue;
        }
        const text = extractDeltaText(obj);
        if (text) yield text;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 回合循环
// ---------------------------------------------------------------------------

export function rollForRequest(work, request) {
  const ch = work?.character || {};
  const attrs = ch.attributes || {};
  const skills = ch.skills || {};
  const attrName = String(request.attr ?? "").trim();
  const skillName = String(request.skill ?? "").trim();
  const attrVal = toInt(attrs[attrName], 0);
  const skillVal = toInt(skills[skillName], 0);
  const difficulty = Math.max(3, Math.min(20, toInt(request.difficulty, 9)));
  const result = diceMod.rollCheck(
    attrVal, skillVal, difficulty,
    toInt(request.modifier, 0),
    Boolean(request.advantage),
    Boolean(request.disadvantage),
  );
  result.attr_name = attrName;
  result.skill_name = skillName;
  result.reason = String(request.reason ?? "").trim();
  return result;
}

export function diceReplyMessage(result) {
  const kept = (result.kept || []).map(String).join("、");
  const faces = (result.dice || []).map(String).join("、");
  const reason = result.reason || `${result.attr_name || ""}${result.skill_name || ""}`.trim() || "判定";
  return "【判定结果（系统真实掷骰，禁止改写）】\n"
    + `判定：${reason}\n`
    + `骰面：${faces} → 取 ${kept}（${result.mode}）\n`
    + `加值：属性 ${result.attr_name}${result.attr} + 技能 ${result.skill_name}${result.skill} + 修正 ${result.modifier} = ${result.bonus}\n`
    + `总值：${result.base} + ${result.bonus} = ${result.total}，难度 ${result.difficulty}（${result.difficulty_name}）→ 档位：${result.tier}\n`
    + "请继续输出本回合的叙述正文：承接上文，把这次判定的后果写完整（不要把骰子数字复述进叙述，系统会展示）；"
    + "末尾照常给出 ```json 块，dice_request 必须为 null。";
}

/** 协议解析失败时的一次纠正重试：只取 JSON 块，不重复输出叙述。 */
async function retryProtocol(client, messages, raw) {
  const retryMessages = [
    ...messages,
    { role: "assistant", content: raw },
    {
      role: "user",
      content: "你的上一条回复末尾缺少可解析的 ```json 协议块。"
        + "请只输出那一个 ```json 块（包含 dice_request / state_patch / suggestions / image_prompt），不要写别的文字。",
    },
  ];
  let text = "";
  try {
    for await (const chunk of client.streamChat(retryMessages)) text += chunk;
  } catch {
    return null;
  }
  const [, data] = parseReply(text);
  return data !== null ? normalizeData(data) : null;
}

/**
 * 完成一个 GM 回合，async generator 产出 SSE 事件 dict（见模块 docstring）。
 * opts.comfy === false 时跳过插图生成；opts.imageTimeoutMs 可覆盖生图超时。
 */
export async function* runTurn(module, state, action, config = null, history = null, opts = {}) {
  const work = isDict(state) ? structuredClone(state) : {};
  const act = String(action ?? "").trim();
  try {
    const cfg = configMod.normalizeConfig(config || configMod.loadConfig());
    const client = new GMClient(cfg);
    const [messages, meta] = buildMessages(module, work, act, cfg, history);
    const pendingUsed = isDict(meta.pending_event) ? meta.pending_event : null;
    if (pendingUsed && (pendingUsed.code || pendingUsed.name)) {
      yield { type: "note", text: `本回合注入已抽中事件：${pendingUsed.code || ""} ${pendingUsed.name || ""}`.trim() };
    }
    if (client.echo) {
      yield { type: "note", text: "未配置 API Key：本回合由回声调试模式生成（可在 /api/config 配置模型）。" };
    }

    let finalData = null;
    let suggestions = [];
    const narrativeParts = [];
    let degraded = false;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const stream = new FenceStream();
      let raw = "";
      for await (const chunk of client.streamChat(messages)) {
        raw += chunk;
        const out = stream.feed(chunk);
        if (out) yield { type: "narrative", delta: out };
      }
      let [narrative, data] = parseReply(raw);
      if (data === null) {
        const retried = await retryProtocol(client, messages, raw);
        if (retried === null) {
          degraded = true;
          narrative = raw.trim();
          const out = stream.finish();
          if (out) yield { type: "narrative", delta: out };
          narrativeParts.push(narrative);
          break;
        }
        data = retried;
      }
      const out = stream.setCut(narrative.length);
      if (out) yield { type: "narrative", delta: out };
      if (narrative) narrativeParts.push(narrative);
      data = normalizeData(data);
      if (data.suggestions.length) suggestions = data.suggestions;
      const request = data.dice_request;
      if (request && round < MAX_ROUNDS - 1) {
        const result = rollForRequest(work, request);
        yield { type: "dice", result };
        messages.push({ role: "assistant", content: raw });
        messages.push({ role: "user", content: diceReplyMessage(result) });
        continue;
      }
      if (request) yield { type: "note", text: "已达续写轮数上限，最后一次判定未执行。" };
      finalData = data;
      break;
    }

    if (degraded) {
      yield { type: "note", text: "本回合未能解析出协议 JSON：仅保留叙述，状态未改动。" };
      yield { type: "state", state: work, suggestions: [], changes: [] };
      yield { type: "done" };
      return;
    }

    if (pendingUsed) delete work.pending_event;
    const changes = stateMod.applyPatch(work, finalData?.state_patch || {});
    const endedPeriod = stateMod.currentPeriod(work);
    changes.push(...stateMod.advanceTime(work, 1));
    const loc = findLocation(module, work.location);
    const event = rollEvent(module, work, effectiveDanger(loc, isNight(endedPeriod)));
    if (event !== null) {
      if (event.empty) {
        yield { type: "note", text: "时段结束触发了事件判定，但事件牌为空，已跳过。" };
      } else {
        let text = `抽中事件 ${event.code || ""} ${event.name || ""}`.trim();
        if (event.shift) text += `（未定义/已触发的格子顺延到 ${event.code}）`;
        yield { type: "note", text };
      }
    }
    if (act) stateMod.addLog(work, act.slice(0, 200), "行动");
    const narrativeText = narrativeParts.filter(Boolean).join("\n").trim();
    if (narrativeText) stateMod.addLog(work, narrativeText.slice(0, 260), "叙事");
    if (changes.length) yield { type: "note", text: `结算：${changes.slice(0, 10).join("；")}` };
    yield { type: "state", state: work, suggestions, changes };

    const imagePrompt = finalData?.image_prompt;
    if (imagePrompt && opts.comfy !== false) {
      yield { type: "note", text: "正在生成插图（本机 ComfyUI）…" };
      try {
        const image = await comfy.generateImage({
          module,
          state: work,
          kind: "scene",
          prompt: imagePrompt,
          config: cfg,
          timeoutMs: opts.imageTimeoutMs,
        });
        yield { type: "image", url: image.url, prompt: image.prompt };
      } catch (e) {
        yield { type: "note", text: `插图生成跳过：${e?.message ?? e}` };
      }
    }
    yield { type: "done" };
  } catch (e) {
    yield { type: "error", message: `${e?.name || "Error"}: ${e?.message ?? e}` };
    yield { type: "done" };
  }
}

// 与 Python 版（web/engine/gm.py）逐名对应的 snake_case 别名
export const build_messages = buildMessages;
export const parse_reply = parseReply;
export const run_turn = runTurn;
export const find_location = findLocation;
export const is_night = isNight;
export const effective_danger = effectiveDanger;
export const draw_event = drawEvent;
export const roll_event = rollEvent;
export const lookup_event = lookupEvent;
export const lookup_event_by_code = lookupEventByCode;
export const deck_entries = deckEntries;
export const module_decks = moduleDecks;

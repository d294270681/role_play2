/**
 * RPG 本（module）的发现与解析。移植自 web/engine/module_loader.py（M1）。
 *
 * 目录约定（见 modules/README.md）：
 * - modules/<本名>/module.md 必需：frontmatter（name/title/engine/tone/rating）
 *   + 「简介 / 文件 / 规则覆盖 / 开局」四节
 * - world-map.md / event-deck.md / characters/*.md / setting.md / item-dex.md 可选
 *
 * 解析原则：宽容优先。匹配不到的结构保留 raw 原文并记入 warnings，绝不因格式差异抛异常；
 * 只有模块目录或 module.md 不存在时才抛 FileNotFoundError（调用方据此报 404）。
 * 文件 IO 与 Python 版一样是同步的；异步调用方自行包 Promise 即可。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ATTRS as CORE_ATTRS, SKILLS as CORE_SKILLS } from "./dice.js";
import {
  fileNotFoundError, hasOwn, pyListRepr, pySplitLines, stripChars, toInt,
} from "./pycompat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const MODULES_DIR = path.join(REPO_ROOT, "modules");
export const CORE_DIR = path.join(REPO_ROOT, "core");

export const DEFAULT_PERIODS = ["晨", "午", "暮", "夜"];

const _HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const _BULLET_RE = /^\s*[-*]\s+(.*)$/;
const _FRONTMATTER_RE = /^\s*---\s*\n([\s\S]*?)\n---\s*\n?/;
const _TABLE_LINE_RE = /^\s*\|.*\|\s*$/;

const _CARD_META_LABELS = [
  "身份", "年龄", "外貌", "说话方式", "动机", "秘密", "能提供",
  "翻脸条件", "会在什么情况下翻脸", "对主角的态度", "对主角态度",
  "特点", "特殊能力", "名场面", "宗旨铁律", "武器等级",
];

const _GAUGE_SKIP_NAMES = new Set([
  "防御值", "携带格", "护甲", "攻击", "资金", "年龄", "经验", "关系",
  "总计", "分配", "数量", "上限", "范围", "时段", "时间", "天", "等级",
  "其余", "武器等级", "合计", "小计", "价格", "重量",
]);

const _SEP_CELL_RE = /^(?::?-{2,}:?)$/;

// ---------------------------------------------------------------------------
// 基础文本工具
// ---------------------------------------------------------------------------

function readText(p) {
  try {
    const buf = fs.readFileSync(p);
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    return "";
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 等价 Python 的 Path(base) / rel：去掉末尾分隔符（win32 path.join 会保留它，Python 不会）。 */
function joinPy(base, rel) {
  const joined = path.join(base, String(rel));
  const trimmed = joined.replace(/[\\/]+$/, "");
  return trimmed || joined;
}

function stripMd(s) {
  s = String(s).replace(/\*\*(.+?)\*\*/g, "$1");
  s = s.replace(/`([^`]*)`/g, "$1");
  return s.trim();
}

function normLabel(s) {
  return String(s).replace(/[\s*`]+/g, "");
}

function stripParens(s) {
  return String(s).replace(/[（(][^（()）]*[）)]/g, "");
}

/** 过滤「无 / （无） / 未知」这类占位值。 */
function dropNone(v) {
  const s = String(v).trim();
  return /^[（(]?\s*(?:无|未知|none|None)/.test(s) ? "" : s;
}

function splitFrontmatter(text) {
  const m = _FRONTMATTER_RE.exec(text);
  if (!m) return [{}, text];
  const meta = {};
  for (const line of pySplitLines(m[1])) {
    const i = line.indexOf(":");
    if (i !== -1) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return [meta, text.slice(m.index + m[0].length)];
}

/**
 * 按标题切块，返回 [{level,title,body,raw}]。
 * 嵌套感知：每块包含自己的正文 + 所有更深层级的子标题内容，直到下一个层级 <= 自己的标题为止。
 */
function headingBlocks(text) {
  const lines = pySplitLines(text);
  const heads = [];
  lines.forEach((line, i) => {
    const m = _HEADING_RE.exec(line);
    if (m) heads.push([i, m[1].length, m[2].trim()]);
  });
  const blocks = [];
  heads.forEach(([i, level, title], j) => {
    let end = lines.length;
    for (let k = j + 1; k < heads.length; k += 1) {
      if (heads[k][1] <= level) {
        end = heads[k][0];
        break;
      }
    }
    const body = lines.slice(i + 1, end).join("\n").trim();
    const raw = lines.slice(i, end).join("\n").trim();
    blocks.push({ level, title, body, raw });
  });
  return blocks;
}

function bullets(text) {
  const out = [];
  for (const line of pySplitLines(text)) {
    const m = _BULLET_RE.exec(line);
    if (m) out.push(stripMd(m[1]).trim());
  }
  return out;
}

function sectionBlock(text, ...titles) {
  for (const b of headingBlocks(text)) {
    for (const t of titles) {
      if (b.title.includes(t)) return b;
    }
  }
  return null;
}

function sectionText(text, ...titles) {
  const b = sectionBlock(text, ...titles);
  return b ? b.body : "";
}

function sectionValue(text, ...titles) {
  const b = sectionBlock(text, ...titles);
  if (!b) return "";
  const found = bullets(b.body).map(dropNone).filter(Boolean);
  if (found.length) return found.join("；");
  const trimmed = b.body.trim();
  return trimmed ? pySplitLines(trimmed)[0].trim() : "";
}

/** 取「- 标签：值」或「- **标签**：值」形式字段的「值」。 */
function field(text, ...labels) {
  const wants = labels.map(normLabel);
  for (const line of pySplitLines(text)) {
    let s = line.trim().replace(/^[-*]+\s*/, "");
    s = stripMd(s);
    let head;
    let tail;
    const i1 = s.indexOf("：");
    const i2 = s.indexOf(":");
    if (i1 !== -1) {
      head = s.slice(0, i1);
      tail = s.slice(i1 + 1);
    } else if (i2 !== -1) {
      head = s.slice(0, i2);
      tail = s.slice(i2 + 1);
    } else {
      continue;
    }
    const headN = normLabel(head);
    tail = tail.trim();
    if (!tail) continue;
    for (const w of wants) {
      if (headN === w || headN.endsWith(w)) return tail;
    }
  }
  return "";
}

/** 宽容解析护栏：任何意外都降级为 warning + 默认值，绝不让解析抛异常。 */
function guard(fn, warnings, label, dflt) {
  try {
    return fn();
  } catch (e) {
    warnings.push(`${label} 解析失败（已跳过）：${e?.name || "Error"}: ${e?.message ?? e}`);
    return dflt;
  }
}

function tables(text) {
  const out = [];
  let cur = [];
  for (const line of pySplitLines(text)) {
    if (_TABLE_LINE_RE.test(line)) {
      cur.push(line);
    } else {
      if (cur.length) {
        out.push(cur);
        cur = [];
      }
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function splitCells(line) {
  return stripChars(line.trim(), "|").split("|").map((c) => c.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => _SEP_CELL_RE.test(c || "-"));
}

function intOrStr(s) {
  s = String(s || "").trim();
  if (/^\d{1,3}$/.test(s)) return parseInt(s, 10);
  return s || null;
}

function parseSlots(s) {
  s = String(s || "").trim();
  if (/^\d{1,2}$/.test(s)) return parseInt(s, 10);
  const m = /^(\d{1,2})\s*时段/.exec(s);
  return m ? parseInt(m[1], 10) : null;
}

// ---------------------------------------------------------------------------
// module.md
// ---------------------------------------------------------------------------

function parseFilesSection(body) {
  const files = {};
  for (const bullet of bullets(sectionText(body, "文件"))) {
    const i1 = bullet.indexOf("：");
    const i2 = bullet.indexOf(":");
    let k;
    let v;
    if (i1 !== -1) {
      k = bullet.slice(0, i1);
      v = bullet.slice(i1 + 1);
    } else if (i2 !== -1) {
      k = bullet.slice(0, i2);
      v = bullet.slice(i2 + 1);
    } else {
      continue;
    }
    k = k.trim();
    v = v.trim();
    if (k && v) files[k] = v;
  }
  return files;
}

const _GAUGE_DEF_RES = [
  /\*\*([\u4e00-\u9fff]{2,8})\*\*\s*[:：]?\s*(\d{1,3})\s*[-–—]\s*(\d{1,3})/g,
  /\*\*([\u4e00-\u9fff]{2,8})\s+(\d{1,3})\s*[-–—]\s*(\d{1,3})\*\*/g,
  /^[\s\-*>*]*([\u4e00-\u9fff]{2,8})\s*[:：]?\s*(\d{1,3})\s*[-–—]\s*(\d{1,3})/gm,
  /([\u4e00-\u9fff]{2,8})\s*[（(]\s*各\s*(\d{1,3})\s*[-–—]\s*(\d{1,3})\s*级?\s*[）)]/g,
];

/** 扫描 module.md 里的自定义仪表定义，如「淫度 0-100」「权限等级 1-5」「部位开发度（各 0-10 级）」。 */
function parseGaugeDefs(text) {
  const defs = [];
  const seen = new Set();
  for (const rx of _GAUGE_DEF_RES) {
    for (const m of text.matchAll(rx)) {
      const name = m[1].trim();
      const lo = parseInt(m[2], 10);
      const hi = parseInt(m[3], 10);
      if (seen.has(name) || lo > hi || hi > 1000) continue;
      seen.add(name);
      defs.push({ name, min: lo, max: hi });
    }
  }
  return defs;
}

const _PERIOD_TOKEN_RE = /([\u4e00-\u9fff]{2,4})\s*[（(]\s*(\d{1,2})(?::\d{2})?\s*[-–—~～至到]\s*(?:次日)?\s*(\d{1,2})(?::\d{2})?\s*[）)]/g;

/** 从规则覆盖里的时段链（如「清晨(6-8) → 上午(8-12) → …」）取时段表，取不到就用 core 默认。 */
function parsePeriods(overrides, fullText) {
  for (const source of [overrides, fullText]) {
    const names = [];
    for (const m of String(source || "").matchAll(_PERIOD_TOKEN_RE)) {
      const name = m[1].trim().replace(/时段$/, "");
      if (name && !names.includes(name)) names.push(name);
    }
    if (names.length >= 3) return [names, "规则覆盖"];
  }
  return [[...DEFAULT_PERIODS], "core 默认"];
}

function parseOpening(text, periods, warnings) {
  const opening = {
    day: null, period: "", period_index: 0, location: "", player: "", premise: "", card_ref: "", raw: String(text || "").trim(),
  };
  if (!String(text || "").trim()) {
    warnings.push("module.md 缺少「开局」节，按默认开局（第 1 天 · 第一个时段）处理");
    opening.day = 1;
    opening.period = periods[0];
    return opening;
  }
  let m = /第\s*(\d{1,4})\s*天/.exec(text);
  if (m) opening.day = parseInt(m[1], 10);
  m = /第\s*\d{1,4}\s*天\s*[·•.、]\s*([\u4e00-\u9fff]{1,4})/.exec(text);
  if (m) opening.period = m[1].trim();
  let loc = field(text, "起始地点");
  if (!loc) {
    m = /第\s*\d{1,4}\s*天\s*[·•]\s*[\u4e00-\u9fff]{1,4}\s*[，,]\s*([^。\n]+)/.exec(text);
    if (m) loc = m[1].trim();
  }
  opening.location = loc;
  m = /玩家角色[：:]\s*\**\s*([\u4e00-\u9fff]{2,4})/.exec(text);
  if (m) opening.player = m[1];
  opening.premise = field(text, "开场情境", "开场");
  m = /`([^`]*\.md)`/.exec(text);
  if (m) opening.card_ref = m[1];
  if (opening.day === null) {
    opening.day = 1;
    warnings.push("开局未写明「第 N 天」，按第 1 天处理");
  }
  if (!periods.includes(opening.period)) {
    if (opening.period) warnings.push(`开局时段「${opening.period}」不在时段表 ${pyListRepr(periods)}，回落到第一个时段`);
    opening.period = periods[0];
  }
  opening.period_index = periods.indexOf(opening.period);
  return opening;
}

// ---------------------------------------------------------------------------
// world-map.md
// ---------------------------------------------------------------------------

const _LOC_PREFIX_RE = /^\s*\d{1,3}\s*[·.、:：]\s*/;
const _LOC_TAIL_PAREN_RE = /[（(][^（()）]*[）)]\s*$/;
const _DANGER_RE = /危险度\**\s*[:：]?\s*\**\s*(\d)/;
const _NIGHT_RE = /夜间\**\s*[:：]?\s*\**\s*(\d)/;
const _SPLIT_RE = /[、，,；;/]/;

function cleanLocationName(title) {
  let name = title.trim().replace(_LOC_PREFIX_RE, "");
  name = name.replace(_LOC_TAIL_PAREN_RE, "").trim();
  return stripChars(name, " ··");
}

function looksLikeLocation(block) {
  const { title, body } = block;
  if (["路线", "事件", "规则", "说明", "列表", "目录", "图鉴"].some((k) => title.includes(k))) return false;
  if (body.includes("起点") && body.includes("终点")) return false;
  return /危险度|可用行动|常驻\s*NPC|连接|势力/.test(title + "\n" + body);
}

function parseActions(body) {
  const lines = pySplitLines(body);
  for (let i = 0; i < lines.length; i += 1) {
    const s = stripMd(lines[i].trim().replace(/^[-*]+\s*/, ""));
    const sep = s.includes("：") ? "：" : s.includes(":") ? ":" : "";
    const head = sep ? s.slice(0, s.indexOf(sep)) : s;
    const tail = sep ? s.slice(s.indexOf(sep) + sep.length) : "";
    if (normLabel(head).includes("可用行动")) {
      if (tail.trim()) return tail.split(_SPLIT_RE).map((x) => x.trim()).filter(Boolean);
      const out = [];
      for (let k = i + 1; k < lines.length; k += 1) {
        const nxt = lines[k];
        if (/^\s{2,}[-*]\s+/.test(nxt)) out.push(stripMd(nxt.replace(/^\s*[-*]+\s*/, "")).trim());
        else if (!nxt.trim()) continue;
        else break;
      }
      return out;
    }
  }
  return [];
}

function splitNames(value) {
  return String(value || "").split(_SPLIT_RE).map((x) => x.trim()).filter(Boolean);
}

function parseLocationBlock(block) {
  const { title, body } = block;
  let danger = null;
  let night = null;
  let m = _DANGER_RE.exec(title) || _DANGER_RE.exec(body);
  if (m) danger = parseInt(m[1], 10);
  m = _NIGHT_RE.exec(title) || _NIGHT_RE.exec(body);
  if (m) night = parseInt(m[1], 10);
  const npcs = splitNames(field(body, "常驻 NPC", "常驻NPC"));
  return {
    name: cleanLocationName(title),
    danger,
    night_danger: night,
    faction: field(body, "势力"),
    desc: field(body, "描述"),
    actions: parseActions(body),
    npcs,
    visitors: splitNames(field(body, "可来访")),
    connections: splitNames(field(body, "连接")),
    raw: block.raw,
  };
}

function parseRoutes(text) {
  const routes = [];
  for (const table of tables(text)) {
    const rows = table.map(splitCells);
    if (rows.length < 2) continue;
    const header = rows[0].map(normLabel);
    if (!header.some((h) => h.includes("起点")) || !header.some((h) => h.includes("终点"))) continue;
    const idx = {};
    header.forEach((h, i) => {
      if (h.includes("编号")) idx.code = i;
      else if (h.includes("起点")) idx.from = i;
      else if (h.includes("终点")) idx.to = i;
      else if (h.includes("耗时")) idx.time = i;
      else if (h.includes("危险")) idx.danger = i;
      else if (h.includes("备注") || h.includes("说明")) idx.note = i;
    });
    const cell = (row, key) => {
      const i = idx[key];
      return i !== undefined && i < row.length ? row[i].trim() : "";
    };
    for (const row of rows.slice(1)) {
      if (isSeparatorRow(row)) continue;
      const from = cell(row, "from");
      const to = cell(row, "to");
      if (!from || !to) continue;
      routes.push({
        code: cell(row, "code") || null,
        from,
        to,
        time: cell(row, "time"),
        time_slots: parseSlots(cell(row, "time")),
        danger: intOrStr(cell(row, "danger")),
        note: cell(row, "note"),
      });
    }
  }
  return routes;
}

function parseMap(text, warnings) {
  const locations = [];
  let routes = [];
  if (!String(text || "").trim()) {
    warnings.push("world-map.md 缺失或为空，地点/路线为空（可用 core/world-map.md 模板补写）");
    return [locations, routes];
  }
  for (const b of headingBlocks(text)) {
    if (b.level >= 2 && looksLikeLocation(b)) {
      const loc = guard(() => parseLocationBlock(b), warnings, `地点「${b.title}」`, null);
      if (loc) locations.push(loc);
    }
  }
  routes = guard(() => parseRoutes(text), warnings, "路线表", []) || [];
  if (!locations.length) warnings.push("world-map.md 未解析出地点");
  return [locations, routes];
}

// ---------------------------------------------------------------------------
// characters/*.md
// ---------------------------------------------------------------------------

function cleanCardName(title) {
  const name = title.replace(/[（(].*$/, "").trim();
  return stripChars(name, "*` ");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseAttributes(text) {
  const attrs = {};
  for (const line of pySplitLines(text)) {
    const stripped = stripParens(line);
    const found = {};
    for (const a of CORE_ATTRS) {
      const m = new RegExp(`${escapeRegExp(a)}\\s*[:：]?\\s*(\\d{1,2})`).exec(stripped);
      if (m) found[a] = parseInt(m[1], 10);
    }
    if (Object.keys(found).length >= 2) {
      for (const [k, v] of Object.entries(found)) if (!hasOwn(attrs, k)) attrs[k] = v;
    }
  }
  return attrs;
}

function parseSkills(text) {
  const skills = {};
  const multi = [];
  const single = [];
  for (const line of pySplitLines(text)) {
    const stripped = stripParens(line);
    const found = {};
    for (const s of Object.keys(CORE_SKILLS)) {
      const m = new RegExp(`${escapeRegExp(s)}\\s*[:：]?\\s*(\\d{1,2})`).exec(stripped);
      if (m) found[s] = parseInt(m[1], 10);
    }
    if (Object.keys(found).length >= 2) multi.push(found);
    else if (Object.keys(found).length) single.push(found);
  }
  for (const group of [...multi, ...single]) {
    for (const [k, v] of Object.entries(group)) if (!hasOwn(skills, k)) skills[k] = v;
  }
  return skills;
}

function gaugeMax(name, value, defs, hint, attrs) {
  const d = defs[name];
  if (d) return toInt(d.max);
  if (name === "压力") return 10;
  if (name === "生命" || name === "精力" || name === "决心") {
    const base = name === "生命" ? attrs["体魄"] || 0 : attrs["意志"] || 0;
    if (base) return name !== "精力" ? base * 2 + 4 : base + 4;
    return Math.max(toInt(value), 1);
  }
  if (hint) return toInt(hint);
  return 100;
}

function parseGauges(text, attrs, gaugeDefs) {
  const defs = {};
  for (const d of gaugeDefs || []) defs[d.name] = d;
  const gauges = {};

  for (const line of pySplitLines(text)) {
    const lineNp = stripParens(line);
    for (const m of lineNp.matchAll(/([\u4e00-\u9fff]{2,6})\s*[:：]?\s*(\d{1,3})\s*\/\s*(\d{1,3})/g)) {
      const nm = m[1];
      const val = parseInt(m[2], 10);
      const mx = parseInt(m[3], 10);
      if (CORE_ATTRS.includes(nm) || hasOwn(CORE_SKILLS, nm) || _GAUGE_SKIP_NAMES.has(nm)) continue;
      if (!hasOwn(gauges, nm)) gauges[nm] = { value: val, max: mx };
    }
  }

  let hint = null;
  for (const line of pySplitLines(text)) {
    let m = /各\s*0\s*[-–—]\s*(\d{1,3})/.exec(line);
    if (m) hint = parseInt(m[1], 10);
    let lineNp = stripParens(line);
    lineNp = lineNp.replace(/^\s*\*\*[^*]+\*\*\s*[：:]\s*/, "");
    const parts = lineNp.split(/[|｜]/);
    if (parts.length < 3) continue;
    const pairs = [];
    for (let p of parts) {
      p = stripMd(p).trim();
      m = /^([\u4e00-\u9fffA-Za-z]{1,8})\s*[:：]?\s*(\d{1,3})\s*$/.exec(p);
      if (m) pairs.push([m[1], parseInt(m[2], 10)]);
    }
    for (const [nm, val] of pairs) {
      if (CORE_ATTRS.includes(nm) || hasOwn(CORE_SKILLS, nm) || _GAUGE_SKIP_NAMES.has(nm)) continue;
      if (hasOwn(gauges, nm)) continue;
      gauges[nm] = { value: val, max: gaugeMax(nm, val, defs, hint, attrs) };
    }
  }
  return gauges;
}

const _RESOURCE_RE = {
  "生命": /生命\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/,
  "精力": /精力\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/,
  "压力": /压力\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/,
  "决心": /决心\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/,
  "防御值": /防御值\s*(\d{1,3})/,
  "携带格": /携带格\s*(\d{1,3})/,
  "护甲": /护甲\s*(\d{1,3})/,
  "攻击": /攻击\s*\+?\s*(\d{1,3})/,
  "资金": /资金\s*[:：]?\s*(\d{1,6})/,
};

function parseResources(text, warnings) {
  const res = {};
  const hpValues = new Set([...text.matchAll(/生命\s*(\d{1,3})/g)].map((m) => m[1]));
  if (hpValues.size > 1) {
    warnings.push("角色卡里出现多个不同的生命值（可能是多张简卡合并在一节），跳过资源解析");
    return res;
  }
  for (const [key, rx] of Object.entries(_RESOURCE_RE)) {
    const m = rx.exec(text);
    if (!m) continue;
    const val = parseInt(m[1], 10);
    const mx = m[2] ? parseInt(m[2], 10) : null;
    res[key] = { value: val, max: mx };
  }
  return res;
}

function parseListSection(text, titles, exact = false, limit = 120) {
  for (const b of headingBlocks(text)) {
    const tn = normLabel(b.title);
    const ok = exact
      ? titles.some((t) => tn === t || tn.startsWith(t))
      : titles.some((t) => b.title.includes(t));
    if (!ok) continue;
    const out = [];
    for (let bullet of bullets(b.body)) {
      bullet = dropNone(bullet);
      if (bullet) out.push(bullet.slice(0, limit));
    }
    return out;
  }
  return [];
}

function parseRelations(text) {
  const rels = [];
  for (const b of headingBlocks(text)) {
    const tn = normLabel(b.title);
    if (!(tn === "关系" || tn.startsWith("关系"))) continue;
    for (const bullet of bullets(b.body)) {
      const m = /^([^：:]{1,16})[：:]\s*([+-]?\d{1,2})\s*(.*)$/.exec(bullet);
      if (m) {
        rels.push({
          npc: m[1].trim(),
          value: parseInt(m[2], 10),
          note: stripChars(m[3].trim(), "（）() 　"),
        });
      }
    }
  }
  return rels;
}

function parseInventory(text) {
  const inv = [];
  let funds = null;
  for (const b of headingBlocks(text)) {
    if (!b.title.includes("装备") && !b.title.includes("物品")) continue;
    for (const bullet of bullets(b.body)) {
      const sep = bullet.includes("：") ? "：" : bullet.includes(":") ? ":" : "";
      if (!sep) continue;
      const i = bullet.indexOf(sep);
      const head = bullet.slice(0, i).trim();
      const tail = bullet.slice(i + sep.length).trim();
      if (head.includes("资金")) {
        const m = /(\d{1,6})/.exec(tail);
        if (m) funds = parseInt(m[1], 10);
        continue;
      }
      for (let item of tail.split(_SPLIT_RE)) {
        item = dropNone(item);
        if (item) inv.push({ name: item, qty: 1, slots: 1, note: head });
      }
    }
  }
  if (funds === null) {
    const m = /资金\s*[:：]?\s*(\d{1,6})/.exec(text);
    if (m) funds = parseInt(m[1], 10);
  }
  return [inv, funds];
}

function parseAttitude(text) {
  const pairs = [...text.matchAll(/关系([\u4e00-\u9fff]{1,4})\s*([+-]?\d{1,2})/g)]
    .map((m) => [m[1], parseInt(m[2], 10)]);
  const m = /关系值\s*([+-]?\d{1,2})/.exec(text);
  return { value: m ? parseInt(m[1], 10) : null, pairs };
}

function parseCard(name, title, body, filename, gaugeDefs, warnings) {
  const text = body;
  const cardWarnings = [];
  const attrs = parseAttributes(text);
  const skills = parseSkills(text);
  const gauges = parseGauges(text, attrs, gaugeDefs);
  const res = parseResources(text, cardWarnings);

  const defs = {};
  for (const d of gaugeDefs || []) defs[d.name] = d;
  for (const [key, g] of Object.entries(res)) {
    if (["防御值", "携带格", "护甲", "攻击", "资金"].includes(key)) continue;
    const mx = g.max || gaugeMax(key, g.value, defs, null, attrs);
    const cur = gauges[key];
    if (cur === undefined || ["生命", "精力", "压力", "决心"].includes(key)) {
      gauges[key] = { value: g.value, max: mx };
    } else if (!cur.max) {
      cur.max = mx;
    }
  }

  const traits = parseListSection(text, ["特质"]);
  const statuses = parseListSection(text, ["状态"], true);
  let weakness = field(text, "弱点 / 秘密", "弱点/秘密");
  if (!weakness) {
    const parts = [sectionValue(text, "弱点"), sectionValue(text, "秘密")].filter(Boolean);
    weakness = parts.join("；");
  }
  const concept = field(text, "概念", "身份") || sectionValue(text, "概念", "身份");
  const meta = {};
  for (const label of _CARD_META_LABELS) {
    const v = field(text, label);
    if (v) meta[label] = v;
  }
  const [inv, funds] = parseInventory(text);
  const m = /经验[：:]?\s*当前\s*(\d{1,4})(?:\s*[（(]累计\s*(\d{1,4})[）)])?/.exec(text);
  const xp = m ? parseInt(m[1], 10) : 0;
  const xpTotal = m && m[2] ? parseInt(m[2], 10) : xp;
  for (const w of cardWarnings) warnings.push(`${filename} · ${name}：${w}`);
  const defense = res["防御值"] ? res["防御值"].value : null;
  const capacity = res["携带格"] ? res["携带格"].value : null;
  return {
    name,
    title,
    file: filename,
    concept,
    background: field(text, "背景") || sectionValue(text, "背景"),
    goal: field(text, "目标", "动机") || sectionValue(text, "目标", "动机"),
    weakness,
    attributes: attrs,
    skills,
    gauges,
    defense,
    capacity,
    armor: res["护甲"] ? res["护甲"].value : null,
    attack: res["攻击"] ? res["攻击"].value : null,
    traits,
    statuses,
    relations: parseRelations(text),
    inventory: inv,
    funds,
    xp,
    xp_total: xpTotal,
    attitude: null,
    attitude_info: parseAttitude(text),
    meta,
    raw: `## ${title}\n${text}`.trim(),
    warnings: cardWarnings,
  };
}

function parseCharacters(text, filename, gaugeDefs, warnings) {
  const cards = [];
  for (const b of headingBlocks(text)) {
    if (b.level !== 2) continue;
    if (["说明", "目录", "模板", "索引"].some((k) => b.title.includes(k))) continue;
    if (!/概念|身份|属性|技能|生命|数值|背景|外貌|动机|态度/.test(b.title + b.body)) continue;
    const name = cleanCardName(b.title);
    if (name) {
      const card = guard(
        () => parseCard(name, b.title, b.body, filename, gaugeDefs, warnings),
        warnings,
        `${filename} · 角色卡「${name}」`,
        null,
      );
      if (card) cards.push(card);
    }
  }
  if (!cards.length) warnings.push(`${filename} 未解析出角色卡`);
  return cards;
}

// ---------------------------------------------------------------------------
// event-deck.md
// ---------------------------------------------------------------------------

const _EVENT_HEADING_RE = /^(\d{2}|S[-–]\d{1,2}|M-E\d{1,2})\s+(.+)$/;

function parseEvents(text, warnings) {
  const entries = [];
  for (const b of headingBlocks(text)) {
    if (b.level < 2) continue;
    const m = _EVENT_HEADING_RE.exec(b.title);
    if (!m) continue;
    const code = m[1];
    const name = m[2].trim();
    entries.push({
      code,
      code_num: /^\d+$/.test(code) ? parseInt(code, 10) : null,
      name,
      special: !/^\d+$/.test(code),
      raw: b.raw,
    });
  }
  if (!entries.length) warnings.push("event-deck.md 未解析出事件条目");
  return entries;
}

// ---------------------------------------------------------------------------
// 顶层接口
// ---------------------------------------------------------------------------

function compareStr(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 列出 modules/ 下所有 RPG 本（读 module.md frontmatter）。 */
export function listModules(root = null) {
  const rootDir = root ? path.resolve(String(root)) : MODULES_DIR;
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(rootDir);
  } catch {
    return out;
  }
  entries.sort(compareStr);
  for (const entry of entries) {
    const dirPath = joinPy(rootDir, entry);
    if (!isDir(dirPath)) continue;
    const modPath = joinPy(dirPath, "module.md");
    if (!fs.existsSync(modPath)) continue;
    const [meta, body] = splitFrontmatter(readText(modPath));
    const files = guard(() => parseFilesSection(body), [], `${entry} 文件节`, {});
    const filesExist = {};
    for (const [k, v] of Object.entries(files)) filesExist[k] = fs.existsSync(joinPy(dirPath, v));
    out.push({
      name: meta.name || entry,
      title: meta.title || meta.name || entry,
      engine: meta.engine || "core",
      tone: meta.tone || "",
      rating: meta.rating || "",
      dir: dirPath,
      path: modPath,
      files,
      files_exist: filesExist,
    });
  }
  return out;
}

function pickCard(cards, name) {
  if (!name) return null;
  for (const c of cards) if (c.name === name) return c;
  for (const c of cards) if (c.name.startsWith(name) || name.startsWith(c.name)) return c;
  for (const c of cards) if (name.includes(c.name) || c.name.includes(name)) return c;
  return null;
}

function attitudeToward(card, playerName) {
  if (!playerName) return null;
  for (const r of card.relations || []) {
    const npc = r.npc || "";
    if (npc && (npc === playerName || npc.includes(playerName) || playerName.includes(npc))) return r.value;
  }
  const att = card.attitude_info || {};
  for (const [npc, value] of att.pairs || []) {
    if (npc === playerName || npc.includes(playerName) || playerName.includes(npc)) return value;
  }
  return att.value ?? null;
}

/** 加载并解析一个 RPG 本。模块不存在时抛 FileNotFoundError；其余解析问题只记 warnings。 */
export function loadModule(name, root = null) {
  const rootDir = root ? path.resolve(String(root)) : MODULES_DIR;
  const d = joinPy(rootDir, name);
  if (!isDir(d) || !fs.existsSync(joinPy(d, "module.md"))) {
    throw fileNotFoundError(`未找到 RPG 本：${name}（${d}）`);
  }

  const warnings = [];
  const text = readText(joinPy(d, "module.md"));
  const [meta, body] = splitFrontmatter(text);
  const files = parseFilesSection(body);
  const overrides = sectionText(body, "规则覆盖");
  const [periods, periodsSource] = guard(
    () => parsePeriods(overrides, text),
    warnings,
    "时段表",
    [[...DEFAULT_PERIODS], "core 默认"],
  );
  const gaugeDefs = guard(() => parseGaugeDefs(text), warnings, "自定义仪表定义", []);
  const opening = guard(
    () => parseOpening(sectionText(body, "开局"), periods, warnings),
    warnings,
    "开局",
    {
      day: 1, period: periods[0], period_index: 0, location: "", player: "", premise: "", card_ref: "", raw: "",
    },
  );

  const mapText = readText(joinPy(d, "world-map.md"));
  const [locations, routes] = parseMap(mapText, warnings);

  const cards = [];
  const charsDir = joinPy(d, "characters");
  if (isDir(charsDir)) {
    const names = fs.readdirSync(charsDir).filter((n) => /\.md$/i.test(n));
    names.sort(compareStr);
    for (const fn of names) {
      cards.push(...guard(
        () => parseCharacters(readText(joinPy(charsDir, fn)), fn, gaugeDefs, warnings),
        warnings,
        `角色文件 ${fn}`,
        [],
      ));
    }
  } else {
    warnings.push("characters/ 目录缺失，角色卡为空");
  }

  let playerName = opening.player || "";
  let playerCard = playerName ? pickCard(cards, playerName) : (cards.length ? cards[0] : null);
  if (playerName && !playerCard) warnings.push(`开局指定的玩家角色「${playerName}」在 characters/ 中未找到`);
  if (!playerName && playerCard) playerName = playerCard.name;
  for (const c of cards) c.attitude = attitudeToward(c, playerName);
  const partyCards = cards.filter((c) => c !== playerCard);

  const eventsText = readText(joinPy(d, "event-deck.md"));
  let events;
  let eventSource;
  if (eventsText.trim()) {
    events = guard(() => parseEvents(eventsText, warnings), warnings, "事件牌", []);
    eventSource = "event-deck.md";
  } else {
    const coreEvents = readText(joinPy(CORE_DIR, "event-deck.md"));
    events = guard(() => parseEvents(coreEvents, []), warnings, "core 事件牌", []);
    eventSource = events.length ? "core/event-deck.md" : "";
    warnings.push("event-deck.md 缺失，事件牌回落到 core/event-deck.md");
  }

  const engine = meta.engine || "core";
  let rulesText;
  let rulesSource;
  if (engine === "core") {
    rulesText = readText(joinPy(CORE_DIR, "rules.md"));
    rulesSource = "core/rules.md";
  } else {
    const setting = readText(joinPy(d, "setting.md"));
    rulesText = setting;
    rulesSource = setting ? "setting.md" : "";
  }

  const paths = {};
  for (const [k, v] of Object.entries(files)) {
    const full = joinPy(d, v);
    paths[k] = fs.existsSync(full) ? full : null;
  }

  return {
    name: meta.name || path.basename(d),
    title: meta.title || meta.name || path.basename(d),
    engine,
    tone: meta.tone || "",
    rating: meta.rating || "",
    dir: d,
    path: joinPy(d, "module.md"),
    meta,
    intro: sectionText(body, "简介"),
    files,
    paths,
    overrides,
    rules_text: rulesText,
    rules_source: rulesSource,
    opening,
    locations,
    routes,
    characters: cards,
    player_name: playerName,
    player_card: playerCard,
    party_cards: partyCards,
    events,
    event_source: eventSource,
    gauge_defs: gaugeDefs,
    periods,
    periods_source: periodsSource,
    map_raw: mapText,
    events_raw: eventsText,
    warnings,
  };
}

export const list_modules = listModules;
export const load_module = loadModule;

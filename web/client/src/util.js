/**
 * 展示层工具：危险度 / 档位配色、仪表与进度钟的中文格式、localStorage 记忆。
 */

export const ATTRS = ["体魄", "敏捷", "智识", "感知", "意志", "魅力"];

/** 13 技能 → 对应属性（core/rules.md §1.3）。 */
export const SKILL_ATTR = {
  格斗: "体魄",
  运动: "体魄",
  射击: "敏捷",
  潜行: "敏捷",
  巧手: "敏捷",
  学识: "智识",
  医疗: "智识",
  工艺: "智识",
  察觉: "感知",
  生存: "感知",
  镇定: "意志",
  交涉: "魅力",
  欺瞒: "魅力",
};
export const SKILLS = Object.keys(SKILL_ATTR);

export const DIFFICULTY_NAMES = { 7: "简单", 9: "普通", 11: "困难", 13: "极难", 15: "传奇" };

/** 判定档位（core/rules.md §2.3）：索引 0–4 对应大失败…大成功。 */
export const TIER_META = [
  { key: "大失败", color: "#b83f45", glow: "rgba(184,63,69,0.45)" },
  { key: "失败", color: "#cf6a55", glow: "rgba(207,106,85,0.38)" },
  { key: "代价成功", color: "#c99a4a", glow: "rgba(201,154,74,0.35)" },
  { key: "成功", color: "#6fa96b", glow: "rgba(111,169,107,0.4)" },
  { key: "大成功", color: "#d4a94a", glow: "rgba(212,169,74,0.55)" },
];

export function tierMeta(tier, tierIndex) {
  if (Number.isInteger(tierIndex) && TIER_META[tierIndex]) return TIER_META[tierIndex];
  const i = TIER_META.findIndex((t) => t.key === String(tier ?? ""));
  return TIER_META[i >= 0 ? i : 2];
}

export function dangerClass(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `danger-${Math.max(0, Math.min(5, Math.round(n)))}`;
}

export function dangerColor(value) {
  return `var(--danger-${Math.max(0, Math.min(5, Math.round(Number(value) || 0)))})`;
}

/** 危险度 0–5 的中文档位词，用于地点列表着色说明。 */
export const DANGER_WORDS = ["安宁", "不宁", "戒备", "危险", "险恶", "致命"];

export function dangerWord(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return DANGER_WORDS[Math.max(0, Math.min(5, Math.round(n)))];
}

/** 夜间时段：与后端 gm.isNight 一致（时段名含「夜」）。 */
export function isNight(period) {
  return String(period ?? "").includes("夜");
}

/** 有效危险度：本册写明夜间值则用它，否则夜间 +1，钳制 0–5。 */
export function effectiveDanger(loc, night) {
  if (!loc) return 0;
  let d = Number(loc.danger);
  if (!Number.isFinite(d)) d = 0;
  if (night) {
    if (loc.night_danger !== null && loc.night_danger !== undefined && loc.night_danger !== "") {
      d = Number(loc.night_danger) || 0;
    } else if (d > 0) d += 1;
  }
  return Math.max(0, Math.min(5, Math.round(d)));
}

export function gaugePercent(gauge) {
  const max = Number(gauge?.max) || 0;
  const value = Number(gauge?.value) || 0;
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/** 仪表的配色语义：生命/精力/压力有专属色，其余走黄铜。 */
export function gaugeKind(name) {
  if (name === "生命") return "is-life";
  if (name === "精力") return "is-energy";
  if (name === "压力") return "is-stress";
  return "";
}

export function currentPeriod(state) {
  if (!state) return "";
  const periods = Array.isArray(state.periods) && state.periods.length ? state.periods : ["晨", "午", "暮", "夜"];
  const i = Math.max(0, Math.min(periods.length - 1, Number(state.period_index) || 0));
  return periods[i];
}

export function signed(n) {
  const v = Number(n) || 0;
  return v > 0 ? `+${v}` : String(v);
}

/** localStorage 记忆（后端不可用时静默降级）。 */
const LS_PREFIX = "rpg.client.";

export function loadLocal(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveLocal(key, value) {
  try {
    window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/** 取新数组里最后一条 id，用于故事流的 key。 */
let _seq = 0;
export function nextId(prefix = "id") {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq}`;
}

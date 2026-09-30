/**
 * 掷骰与判定，实现 core/rules.md §2 的公式：2d6 + 属性 + 技能 + 修正 >= 难度。
 *
 * 逐函数移植 web/engine/dice.py（M1）：
 * - §2.2 基本公式与难度表（修正合计在内部强制钳制到 ±3）
 * - §2.3 结果四档（双 1 大失败，双 6 大成功）
 * - §2.4 精力（全力以赴 +2；咬牙重来重掷一颗，消耗 2）
 * - §2.5 优势 / 劣势（3d6 取高/低两颗，同时存在互相抵消）
 * - §2.6 对抗判定（高者胜，平局按 tie_rule）
 * - §2.8 被动值（7 + 属性 + 技能）
 *
 * 导出同时保留 snake_case 别名（roll_check / tier_for / ...），与 Python 版逐名对应。
 */

import { pyTruthy, toInt, valueError } from "./pycompat.js";

export const ATTRS = ["体魄", "敏捷", "智识", "感知", "意志", "魅力"];

export const SKILLS = {
  "格斗": "体魄",
  "运动": "体魄",
  "射击": "敏捷",
  "潜行": "敏捷",
  "巧手": "敏捷",
  "学识": "智识",
  "医疗": "智识",
  "工艺": "智识",
  "察觉": "感知",
  "生存": "感知",
  "镇定": "意志",
  "交涉": "魅力",
  "欺瞒": "魅力",
};

export const DIFFICULTY_NAMES = { 7: "简单", 9: "普通", 11: "困难", 13: "极难", 15: "传奇" };

export const TIERS = ["大失败", "失败", "代价成功", "成功", "大成功"];

export const EXERTION_BONUS = 2;
export const EXERTION_COST = 1;
export const REROLL_COST = 2;
export const MODIFIER_CAP = 3;
export const MAX_DANGER = 5;

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** §2.2：情境修正合计不超过 ±cap。 */
export function clampModifier(value, cap = MODIFIER_CAP) {
  return clamp(toInt(value), -cap, cap);
}

function randInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function rollDice(n = 2, sides = 6) {
  const count = Math.max(0, toInt(n));
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(randInt(1, sides));
  if (out.length === 0) out.push(randInt(1, sides));
  return out;
}

function rollRaw(attr = 0, skill = 0, modifier = 0, advantage = false, disadvantage = false) {
  const modifierRaw = toInt(modifier);
  const mod = clampModifier(modifierRaw);
  let dice;
  let kept;
  let mode;
  if (pyTruthy(advantage) && !pyTruthy(disadvantage)) {
    dice = rollDice(3);
    kept = [...dice].sort((a, b) => b - a).slice(0, 2);
    mode = "优势";
  } else if (pyTruthy(disadvantage) && !pyTruthy(advantage)) {
    dice = rollDice(3);
    kept = [...dice].sort((a, b) => a - b).slice(0, 2);
    mode = "劣势";
  } else {
    dice = rollDice(2);
    kept = [...dice];
    mode = "普通";
  }
  const base = kept.reduce((a, b) => a + b, 0);
  const bonus = toInt(attr) + toInt(skill) + mod;
  return {
    dice,
    kept,
    mode,
    attr: toInt(attr),
    skill: toInt(skill),
    modifier: mod,
    modifier_raw: modifierRaw,
    modifier_clamped: mod !== modifierRaw,
    base,
    bonus,
    total: base + bonus,
  };
}

/** §2.3 四档：双 1 大失败；双 6 或总值 >= 难度+5 大成功；否则按差值分档。 */
export function tierFor(kept, total, difficulty) {
  const k = [...(kept ?? [])].sort((a, b) => a - b);
  if (k.length === 2 && k[0] === 1 && k[1] === 1) return "大失败";
  if ((k.length === 2 && k[0] === 6 && k[1] === 6) || toInt(total) >= toInt(difficulty) + 5) return "大成功";
  if (toInt(total) >= toInt(difficulty)) return "成功";
  if (toInt(total) >= toInt(difficulty) - 2) return "代价成功";
  return "失败";
}

/**
 * 掷一次判定，返回骰面、总值与四档结果。
 * exertion=true 表示「全力以赴」（§2.4）：在钳制后的修正之外再 +2，energy_cost=1 由状态层扣精力。
 */
export function rollCheck(attr = 0, skill = 0, difficulty = 9, modifier = 0,
  advantage = false, disadvantage = false, exertion = false) {
  const res = rollRaw(attr, skill, modifier, advantage, disadvantage);
  if (pyTruthy(exertion)) {
    res.bonus += EXERTION_BONUS;
    res.total += EXERTION_BONUS;
    res.exertion = true;
    res.energy_cost = EXERTION_COST;
  } else {
    res.exertion = false;
    res.energy_cost = 0;
  }
  difficulty = toInt(difficulty, 9);
  res.difficulty = difficulty;
  res.difficulty_name = DIFFICULTY_NAMES[difficulty] ?? String(difficulty);
  const tier = tierFor(res.kept, res.total, difficulty);
  res.tier = tier;
  res.tier_index = TIERS.indexOf(tier);
  res.success = tier === "大成功" || tier === "成功" || tier === "代价成功";
  return res;
}

/** §2.4 咬牙重来：重掷结果里的一颗骰子并重算档位（消耗 2 精力由调用方处理）。 */
export function rerollDie(result, index) {
  const dice = [...(result?.dice ?? [])];
  const idx = toInt(index, -1);
  if (dice.length === 0 || !(idx >= 0 && idx < dice.length)) throw valueError(`骰子下标越界：${idx}`);
  dice[idx] = randInt(1, 6);
  const mode = result?.mode || "普通";
  let kept;
  if (mode === "优势") kept = [...dice].sort((a, b) => b - a).slice(0, 2);
  else if (mode === "劣势") kept = [...dice].sort((a, b) => a - b).slice(0, 2);
  else kept = [...dice];
  const base = kept.reduce((a, b) => a + b, 0);
  const total = base + toInt(result?.bonus, 0);
  const difficulty = toInt(result?.difficulty, 9);
  const out = { ...result };
  const tier = tierFor(kept, total, difficulty);
  Object.assign(out, {
    dice,
    kept,
    base,
    total,
    tier,
    tier_index: TIERS.indexOf(tier),
    success: tier === "大成功" || tier === "成功" || tier === "代价成功",
    rerolled: idx,
    energy_cost: toInt(result?.energy_cost, 0) + REROLL_COST,
  });
  return out;
}

/** §2.6 对抗判定：双方各掷 2d6+属性+技能，高者胜；平局按 tie_rule（hold 维持现状 / cost 主动方代价成功）。 */
export function rollOpposed(attackerAttr = 0, attackerSkill = 0, defenderAttr = 0, defenderSkill = 0,
  attackerModifier = 0, defenderModifier = 0,
  attackerAdvantage = false, attackerDisadvantage = false,
  defenderAdvantage = false, defenderDisadvantage = false,
  tieRule = "hold") {
  const attacker = rollRaw(attackerAttr, attackerSkill, attackerModifier, attackerAdvantage, attackerDisadvantage);
  const defender = rollRaw(defenderAttr, defenderSkill, defenderModifier, defenderAdvantage, defenderDisadvantage);
  const margin = attacker.total - defender.total;
  let winner;
  if (margin > 0) winner = "attacker";
  else if (margin < 0) winner = "defender";
  else winner = tieRule === "cost" ? "attacker" : "tie";
  return { attacker, defender, winner, margin: Math.abs(margin), tie: margin === 0, tie_rule: tieRule };
}

/** §2.8 被动值：7 + 属性 + 技能，直接与难度比较。 */
export function passiveValue(attr, skill) {
  return 7 + toInt(attr) + toInt(skill);
}

/** 两颗 d6，第一颗十位第二颗个位（11–66 共 36 格）。 */
export function d66() {
  return randInt(1, 6) * 10 + randInt(1, 6);
}

/** 时段结束的随机事件判定：1d6 <= 有效危险度（§4.2）；危险度 0 不判定，夜间户外 +1，有效值最高 5。 */
export function eventTriggered(danger, night = false, extra = 0) {
  let effective = toInt(danger, 0) + (pyTruthy(night) ? 1 : 0) + toInt(extra, 0);
  effective = clamp(effective, 0, MAX_DANGER);
  if (effective <= 0) return false;
  return randInt(1, 6) <= effective;
}

export const roll_dice = rollDice;
export const roll_check = rollCheck;
export const tier_for = tierFor;
export const reroll_die = rerollDie;
export const roll_opposed = rollOpposed;
export const passive_value = passiveValue;
export const clamp_modifier = clampModifier;
export const event_triggered = eventTriggered;

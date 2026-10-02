/** core §2/§5/§6 的确定性规则；Python 对照实现见 web/engine/rules.py。 */
import { toInt } from "./pycompat.js";
import { tierFor, TIERS } from "./dice.js";

function named(entries, name) {
  return (Array.isArray(entries) ? entries : []).some((entry) => {
    const text = String(entry).trim();
    return text === name || (text.startsWith(name) && /^[：:（(\s]/u.test(text.slice(name.length)));
  });
}

/** 压力档位取最高一档；不同来源叠加，不占情境修正的 ±3。 */
export function checkEffects(character = {}, attrName = "", facingFear = false) {
  const modifiers = [];
  const disadvantages = [];
  const stress = toInt(character.gauges?.["压力"]?.value, 0);
  const calm = named(character.traits, "冷静");
  if (stress >= (calm ? 10 : 8)) modifiers.push({ source: "濒临极限", value: -1 });
  else if (stress >= (calm ? 7 : 5) && ["意志", "魅力"].includes(attrName)) {
    modifiers.push({ source: "焦虑", value: -1 });
  }
  const hp = character.gauges?.["生命"];
  // 有生命仪表时以当前生命为准，治疗后不因旧状态标签继续受罚。
  const wounded = hp && toInt(hp.max) > 0
    ? toInt(hp.value) <= toInt(hp.max) / 2
    : named(character.statuses, "受伤");
  if (wounded && ["体魄", "敏捷"].includes(attrName)) modifiers.push({ source: "受伤", value: -1 });
  if (named(character.statuses, "束缚") && ["体魄", "敏捷"].includes(attrName)) disadvantages.push("束缚");
  if (facingFear === true && named(character.statuses, "恐惧")) disadvantages.push("恐惧");
  return { modifiers, modifier: modifiers.reduce((sum, entry) => sum + entry.value, 0), disadvantages };
}

/** 从 current 提升到 target，逐级累计，跳级与分次升级总价相同。 */
export function upgradeCost(current, target, unit) {
  const from = toInt(current), to = toInt(target);
  return to > from ? ((from + 1 + to) * (to - from) / 2) * toInt(unit) : 0;
}

/** 给真实骰子结果加上规则修正，并重新分档；保留 bonus 供重掷复用。 */
export function applyCheckEffects(result, effects) {
  const bonus = toInt(result.bonus) + effects.modifier;
  const total = toInt(result.base) + bonus;
  const tier = tierFor(result.kept, total, result.difficulty);
  return { ...result, bonus, total, tier, tier_index: TIERS.indexOf(tier),
    success: ["大成功", "成功", "代价成功"].includes(tier),
    rule_modifier: effects.modifier, rule_modifiers: effects.modifiers,
    disadvantage_sources: effects.disadvantages };
}

/** 按差量同步派生数值，保留已有装备/特质/本专属修正，不凭升级补满资源。 */
export function updateDerived(character, kind, name, before, after) {
  const delta = toInt(after) - toInt(before);
  if (!delta) return;
  const shiftGauge = (label, amount) => {
    const g = character.gauges?.[label];
    if (!g || toInt(g.max) <= 0) return;
    g.max = Math.max(1, toInt(g.max) + amount);
    g.value = Math.max(0, Math.min(toInt(g.value), g.max));
  };
  if (kind === "attr" && name === "体魄") {
    shiftGauge("生命", delta * 2);
    character.capacity = Math.max(0, toInt(character.capacity) + delta);
  }
  if (kind === "attr" && name === "意志") {
    shiftGauge("精力", delta);
    shiftGauge("决心", delta * 2);
  }
  if ((kind === "attr" && name === "敏捷") || (kind === "skill" && name === "运动")) {
    character.defense = Math.max(0, toInt(character.defense) + delta);
  }
}

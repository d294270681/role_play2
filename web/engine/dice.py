"""掷骰与判定，实现 core/rules.md §2 的公式：2d6 + 属性 + 技能 + 修正 >= 难度。

- §2.2 基本公式与难度表
- §2.3 结果四档（大成功 / 成功 / 代价成功 / 失败；双 1 大失败，双 6 大成功）
- §2.4 精力的用法（全力以赴 +2；咬牙重来重掷一颗）
- §2.5 优势 / 劣势（3d6 取高/低两颗，同时存在互相抵消）
- §2.6 对抗判定（双方各掷，高者胜，平局维持现状或主动方代价成功）
- §2.8 被动值（7 + 属性 + 技能）
"""

import random

ATTRS = ["体魄", "敏捷", "智识", "感知", "意志", "魅力"]

SKILLS = {
    "格斗": "体魄", "运动": "体魄", "射击": "敏捷", "潜行": "敏捷",
    "巧手": "敏捷", "学识": "智识", "医疗": "智识", "工艺": "智识",
    "察觉": "感知", "生存": "感知", "镇定": "意志", "交涉": "魅力", "欺瞒": "魅力",
}

DIFFICULTY_NAMES = {7: "简单", 9: "普通", 11: "困难", 13: "极难", 15: "传奇"}

TIERS = ["大失败", "失败", "代价成功", "成功", "大成功"]

EXERTION_BONUS = 2
EXERTION_COST = 1
REROLL_COST = 2
MODIFIER_CAP = 3
MAX_DANGER = 5


def _int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def clamp_modifier(value, cap=MODIFIER_CAP):
    """§2.2：情境修正合计不超过 ±cap。"""
    return clamp(_int(value), -cap, cap)


def roll_dice(n=2, sides=6):
    return [random.randint(1, sides) for _ in range(max(0, _int(n)))] or [random.randint(1, sides)]


def _roll_raw(attr=0, skill=0, modifier=0, advantage=False, disadvantage=False):
    if advantage and not disadvantage:
        dice = roll_dice(3)
        kept = sorted(dice, reverse=True)[:2]
        mode = "优势"
    elif disadvantage and not advantage:
        dice = roll_dice(3)
        kept = sorted(dice)[:2]
        mode = "劣势"
    else:
        dice = roll_dice(2)
        kept = list(dice)
        mode = "普通"
    base = sum(kept)
    bonus = _int(attr) + _int(skill) + _int(modifier)
    return {
        "dice": dice, "kept": kept, "mode": mode,
        "attr": _int(attr), "skill": _int(skill), "modifier": _int(modifier),
        "base": base, "bonus": bonus, "total": base + bonus,
    }


def tier_for(kept, total, difficulty):
    """§2.3 四档：双 1 大失败；双 6 或总值 >= 难度+5 大成功；否则按差值分档。"""
    kept = sorted(kept)
    if kept == [1, 1]:
        return "大失败"
    if kept == [6, 6] or _int(total) >= _int(difficulty) + 5:
        return "大成功"
    if _int(total) >= _int(difficulty):
        return "成功"
    if _int(total) >= _int(difficulty) - 2:
        return "代价成功"
    return "失败"


def roll_check(attr=0, skill=0, difficulty=9, modifier=0,
               advantage=False, disadvantage=False, exertion=False):
    """掷一次判定，返回骰面、总值与四档结果的字典。

    exertion=True 表示「全力以赴」（§2.4）：本次 +2，结果里给出 energy_cost=1，由状态层扣精力。
    """
    res = _roll_raw(attr, skill, modifier, advantage, disadvantage)
    if exertion:
        res["bonus"] += EXERTION_BONUS
        res["total"] += EXERTION_BONUS
        res["exertion"] = True
        res["energy_cost"] = EXERTION_COST
    else:
        res["exertion"] = False
        res["energy_cost"] = 0
    difficulty = _int(difficulty, 9)
    res["difficulty"] = difficulty
    res["difficulty_name"] = DIFFICULTY_NAMES.get(difficulty, str(difficulty))
    tier = tier_for(res["kept"], res["total"], difficulty)
    res["tier"] = tier
    res["tier_index"] = TIERS.index(tier)
    res["success"] = tier in ("大成功", "成功", "代价成功")
    return res


def reroll_die(result, index):
    """§2.4 咬牙重来：重掷结果里的一颗骰子并重算档位（消耗 2 精力由调用方处理）。"""
    dice = list(result.get("dice") or [])
    index = _int(index, -1)
    if not dice or not 0 <= index < len(dice):
        raise ValueError(f"骰子下标越界：{index}")
    dice[index] = random.randint(1, 6)
    mode = result.get("mode") or "普通"
    if mode == "优势":
        kept = sorted(dice, reverse=True)[:2]
    elif mode == "劣势":
        kept = sorted(dice)[:2]
    else:
        kept = list(dice)
    total = sum(kept) + _int(result.get("bonus"), 0)
    difficulty = _int(result.get("difficulty"), 9)
    out = dict(result)
    tier = tier_for(kept, total, difficulty)
    out.update({
        "dice": dice, "kept": kept, "base": sum(kept), "total": total,
        "tier": tier, "tier_index": TIERS.index(tier),
        "success": tier in ("大成功", "成功", "代价成功"),
        "rerolled": index, "energy_cost": _int(result.get("energy_cost"), 0) + REROLL_COST,
    })
    return out


def roll_opposed(attacker_attr=0, attacker_skill=0, defender_attr=0, defender_skill=0,
                 attacker_modifier=0, defender_modifier=0,
                 attacker_advantage=False, attacker_disadvantage=False,
                 defender_advantage=False, defender_disadvantage=False,
                 tie_rule="hold"):
    """§2.6 对抗判定：双方各掷 2d6+属性+技能，高者胜。

    tie_rule="hold" 平局维持现状；tie_rule="cost" 平局由主动方获得代价成功。
    """
    attacker = _roll_raw(attacker_attr, attacker_skill, attacker_modifier,
                         attacker_advantage, attacker_disadvantage)
    defender = _roll_raw(defender_attr, defender_skill, defender_modifier,
                         defender_advantage, defender_disadvantage)
    margin = attacker["total"] - defender["total"]
    if margin > 0:
        winner = "attacker"
    elif margin < 0:
        winner = "defender"
    else:
        winner = "attacker" if tie_rule == "cost" else "tie"
    return {
        "attacker": attacker, "defender": defender,
        "winner": winner, "margin": abs(margin),
        "tie": margin == 0, "tie_rule": tie_rule,
    }


def passive_value(attr, skill):
    """§2.8 被动值：7 + 属性 + 技能（如被动察觉），直接与难度比较。"""
    return 7 + _int(attr) + _int(skill)


def d66():
    """两颗 d6，第一颗十位第二颗个位（11–66 共 36 格）。"""
    return random.randint(1, 6) * 10 + random.randint(1, 6)


def event_triggered(danger, night=False, extra=0):
    """时段结束的随机事件判定：1d6 <= 有效危险度（§4.2）。

    危险度 0 不判定；夜间户外 +1；带「通缉 / 暴露」等额外加值用 extra；有效值最高 5。
    """
    effective = _int(danger, 0) + (1 if night else 0) + _int(extra, 0)
    effective = clamp(effective, 0, MAX_DANGER)
    if effective <= 0:
        return False
    return random.randint(1, 6) <= effective

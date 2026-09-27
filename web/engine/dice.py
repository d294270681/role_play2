"""掷骰与判定，实现 core/rules.md §2 的公式：2d6 + 属性 + 技能 + 修正 >= 难度。"""

import random

ATTRS = ["体魄", "敏捷", "智识", "感知", "意志", "魅力"]

SKILLS = {
    "格斗": "体魄", "运动": "体魄", "射击": "敏捷", "潜行": "敏捷",
    "巧手": "敏捷", "学识": "智识", "医疗": "智识", "工艺": "智识",
    "察觉": "感知", "生存": "感知", "镇定": "意志", "交涉": "魅力", "欺瞒": "魅力",
}

DIFFICULTY_NAMES = {7: "简单", 9: "普通", 11: "困难", 13: "极难", 15: "传奇"}

_TIERS = ["大失败", "失败", "代价成功", "成功", "大成功"]


def roll_check(attr=0, skill=0, difficulty=9, modifier=0,
               advantage=False, disadvantage=False):
    """掷一次判定，返回含骰面与四档结果的字典（§2.3 / §2.5）。"""
    if advantage and not disadvantage:
        dice = [random.randint(1, 6) for _ in range(3)]
        kept = sorted(dice, reverse=True)[:2]
        mode = "优势"
    elif disadvantage and not advantage:
        dice = [random.randint(1, 6) for _ in range(3)]
        kept = sorted(dice)[:2]
        mode = "劣势"
    else:
        dice = [random.randint(1, 6) for _ in range(2)]
        kept = list(dice)
        mode = "普通"

    base = sum(kept)
    bonus = attr + skill + modifier
    total = base + bonus
    snake = sorted(kept) == [1, 1]
    boxcars = sorted(kept) == [6, 6]

    if snake:
        tier = "大失败"
    elif boxcars or total >= difficulty + 5:
        tier = "大成功"
    elif total >= difficulty:
        tier = "成功"
    elif total >= difficulty - 2:
        tier = "代价成功"
    else:
        tier = "失败"

    return {
        "dice": dice, "kept": kept, "mode": mode,
        "attr": attr, "skill": skill, "modifier": modifier,
        "base": base, "bonus": bonus, "total": total,
        "difficulty": difficulty,
        "difficulty_name": DIFFICULTY_NAMES.get(difficulty, str(difficulty)),
        "tier": tier, "tier_index": _TIERS.index(tier),
        "success": tier in ("大成功", "成功", "代价成功"),
    }


def d66():
    """两颗 d6，第一颗十位第二颗个位（11–66 共 36 格）。"""
    return random.randint(1, 6) * 10 + random.randint(1, 6)


def event_triggered(danger):
    """时段结束的随机事件判定：1d6 <= 危险度（§4.2）。"""
    if not danger or danger <= 0:
        return False
    return random.randint(1, 6) <= min(danger, 5)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))

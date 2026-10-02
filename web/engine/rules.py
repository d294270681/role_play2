"""core §2/§5/§6 的确定性规则，与 server/engine/rules.js 对齐。"""
import re
from .dice import _int, tier_for, TIERS


def _named(entries, name):
    if not isinstance(entries, list):
        return False
    for entry in entries:
        text = str(entry).strip()
        if text == name or (text.startswith(name) and re.match(r"[：:（(\s]", text[len(name):])):
            return True
    return False


def check_effects(character=None, attr_name="", facing_fear=False):
    character = character or {}
    modifiers, disadvantages = [], []
    gauges = character.get("gauges") or {}
    stress = _int((gauges.get("压力") or {}).get("value"), 0)
    calm = _named(character.get("traits"), "冷静")
    if stress >= (10 if calm else 8):
        modifiers.append({"source": "濒临极限", "value": -1})
    elif stress >= (7 if calm else 5) and attr_name in ("意志", "魅力"):
        modifiers.append({"source": "焦虑", "value": -1})
    hp = gauges.get("生命")
    wounded = _int(hp.get("value")) <= _int(hp.get("max")) / 2 if hp and _int(hp.get("max")) > 0 else _named(character.get("statuses"), "受伤")
    if wounded and attr_name in ("体魄", "敏捷"):
        modifiers.append({"source": "受伤", "value": -1})
    if _named(character.get("statuses"), "束缚") and attr_name in ("体魄", "敏捷"):
        disadvantages.append("束缚")
    if facing_fear is True and _named(character.get("statuses"), "恐惧"):
        disadvantages.append("恐惧")
    return {"modifiers": modifiers, "modifier": sum(entry["value"] for entry in modifiers), "disadvantages": disadvantages}


def upgrade_cost(current, target, unit):
    start, end = _int(current), _int(target)
    return ((start + 1 + end) * (end - start) // 2) * _int(unit) if end > start else 0


def apply_check_effects(result, effects):
    bonus = _int(result.get("bonus")) + effects["modifier"]
    total = _int(result.get("base")) + bonus
    tier = tier_for(result.get("kept"), total, result.get("difficulty"))
    return {**result, "bonus": bonus, "total": total, "tier": tier, "tier_index": TIERS.index(tier),
            "success": tier in ("大成功", "成功", "代价成功"),
            "rule_modifier": effects["modifier"], "rule_modifiers": effects["modifiers"],
            "disadvantage_sources": effects["disadvantages"]}


def update_derived(character, kind, name, before, after):
    delta = _int(after) - _int(before)
    if not delta:
        return

    def shift_gauge(label, amount):
        gauge = (character.get("gauges") or {}).get(label)
        if not gauge or _int(gauge.get("max")) <= 0:
            return
        gauge["max"] = max(1, _int(gauge["max"]) + amount)
        gauge["value"] = max(0, min(_int(gauge.get("value")), gauge["max"]))

    if kind == "attr" and name == "体魄":
        shift_gauge("生命", delta * 2)
        character["capacity"] = max(0, _int(character.get("capacity")) + delta)
    if kind == "attr" and name == "意志":
        shift_gauge("精力", delta)
        shift_gauge("决心", delta * 2)
    if (kind == "attr" and name == "敏捷") or (kind == "skill" and name == "运动"):
        character["defense"] = max(0, _int(character.get("defense")) + delta)

"""存档状态：JSON 读写、开局、时间推进、GM 补丁（apply_patch）与编辑操作（apply_edit）。

存档 schema（JSON）：
    {version, module, slot, title, day, period_index, periods[], location,
     character:{name, concept, background, goal, weakness, attributes{六项},
                skills{13 项}, defense, capacity, gauges{名:{value,max}},
                traits[], statuses[], xp, xp_total},
     party{NPC名:{gauges, relation, notes}}, inventory[{name,qty,slots,note}],
     funds, relations[{npc,value,note}], clocks[{name,value,max,consequence}],
     events_fired[{code,name,day}], clues[{text,done}], log[{day,period,type,text}],
     pending_event?}

存档路径：web/saves/<本名>/slot<1..3>.json。load 会补齐缺省字段（宽容）；
apply_patch / apply_edit 全部容错，仪表一律钳制在 0..max。
"""

from __future__ import annotations

import copy
import json
import re
from datetime import datetime
from pathlib import Path

from . import module_loader
from .dice import ATTRS, SKILLS, clamp

SAVE_ROOT = Path(__file__).resolve().parents[1] / "saves"
SLOTS_PER_MODULE = 3
STATE_VERSION = 1
LOG_LIMIT = 1000
DEFAULT_PERIODS = list(module_loader.DEFAULT_PERIODS)

_DEFS_CACHE = {}


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------

def _int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _as_list(v):
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        return list(v)
    return [v]


def _safe_module_name(module) -> str:
    name = re.sub(r'[\\/:*?"<>|]+', "", str(module or "").strip())
    return name or "unnamed"


def clear_caches():
    _DEFS_CACHE.clear()


def _module_gauge_defs(state):
    name = str(state.get("module") or "")
    if not name:
        return []
    if name not in _DEFS_CACHE:
        try:
            _DEFS_CACHE[name] = module_loader.load_module(name).get("gauge_defs") or []
        except Exception:
            _DEFS_CACHE[name] = []
    return _DEFS_CACHE[name]


def _auto_max(state, name, value_hint=0):
    """新建仪表时推断上限：先看已有同名仪表，再看 module 的仪表定义，最后兜底 100。"""
    ch = state.get("character") or {}
    g = (ch.get("gauges") or {}).get(name)
    if isinstance(g, dict) and _int(g.get("max")) > 0:
        return _int(g.get("max"))
    for d in _module_gauge_defs(state):
        if d.get("name") == name:
            return _int(d.get("max"), 100)
    if name == "压力":
        return 10
    return 100


def _gauge(container, name, max_hint=None):
    g = container.get(name)
    if not isinstance(g, dict):
        g = {"value": 0, "max": 0}
        container[name] = g
    g["value"] = _int(g.get("value"), 0)
    g["max"] = _int(g.get("max"), 0)
    if max_hint and g["max"] <= 0:
        g["max"] = _int(max_hint, 0)
    return g


def _apply_gauge(g, delta=None, value=None, maximum=None):
    if maximum is not None:
        g["max"] = max(0, _int(maximum, g.get("max") or 0))
    if value is not None:
        g["value"] = _int(value, g["value"])
    if delta is not None:
        g["value"] = _int(g["value"], 0) + _int(delta, 0)
    g["value"] = max(0, g["value"])
    if g["max"] > 0:
        g["value"] = min(g["value"], g["max"])
    return g


def _gauge_change(name, before, g):
    diff = g["value"] - before
    sign = f"+{diff}" if diff > 0 else str(diff)
    return f"{name} {before} → {g['value']}（{sign}，上限 {g['max']}）"


def _match_period(periods, value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 0 <= value < len(periods) else None
    s = str(value or "").strip()
    if s.isdigit():
        i = int(s)
        return i if 0 <= i < len(periods) else None
    for i, p in enumerate(periods):
        if p == s or (s and (s in p or p in s)):
            return i
    return None


def _remove_by_text(lst, text):
    for i, v in enumerate(lst):
        if str(v) == text:
            return lst.pop(i)
    for i, v in enumerate(lst):
        if text and text in str(v):
            return lst.pop(i)
    return None


def _find_item(inventory, name):
    for it in inventory:
        if str(it.get("name") or "") == name:
            return it
    for it in inventory:
        n = str(it.get("name") or "")
        if name and (name in n or n in name):
            return it
    return None


def _find_clue(clues, key):
    if isinstance(key, bool):
        return None
    if isinstance(key, int):
        return clues[key] if 0 <= key < len(clues) else None
    s = str(key or "").strip()
    if s.isdigit():
        i = int(s)
        if 0 <= i < len(clues):
            return clues[i]
    for c in clues:
        if str(c.get("text") or "") == s:
            return c
    for c in clues:
        if s and s in str(c.get("text") or ""):
            return c
    return None


def _clock_bar(value, mx):
    mx = max(0, min(_int(mx, 0), 12))
    v = max(0, min(_int(value, 0), mx))
    return "■" * v + "□" * (mx - v)


# ---------------------------------------------------------------------------
# 状态结构
# ---------------------------------------------------------------------------

def _ensure_character(ch):
    ch.setdefault("name", "")
    for key in ("concept", "background", "goal", "weakness"):
        ch.setdefault(key, "")
    for key in ("attributes", "skills", "gauges"):
        if not isinstance(ch.get(key), dict):
            ch[key] = {}
    ch["defense"] = _int(ch.get("defense"), 0)
    ch["capacity"] = _int(ch.get("capacity"), 0)
    if not isinstance(ch.get("traits"), list):
        ch["traits"] = []
    if not isinstance(ch.get("statuses"), list):
        ch["statuses"] = []
    ch["xp"] = _int(ch.get("xp"), 0)
    ch["xp_total"] = _int(ch.get("xp_total"), ch["xp"])
    return ch


def _ensure_state(state):
    """就地补齐缺省字段并清洗嵌套结构（宽容，不抛异常）。"""
    state["version"] = state.get("version") or STATE_VERSION
    state.setdefault("module", "")
    state.setdefault("slot", 1)
    state.setdefault("title", "")
    state["day"] = _int(state.get("day"), 1)
    periods = state.get("periods")
    if not isinstance(periods, list) or not periods:
        periods = list(DEFAULT_PERIODS)
    state["periods"] = [str(p) for p in periods]
    i = _int(state.get("period_index"), 0)
    state["period_index"] = max(0, min(i, len(state["periods"]) - 1))
    state.setdefault("location", "")
    if not isinstance(state.get("character"), dict):
        state["character"] = {}
    _ensure_character(state["character"])

    party = state.get("party")
    if not isinstance(party, dict):
        party = {}
    for npc, member in list(party.items()):
        if not isinstance(member, dict):
            party[npc] = {"gauges": {}, "relation": 0, "notes": ""}
            continue
        if not isinstance(member.get("gauges"), dict):
            member["gauges"] = {}
        member["relation"] = clamp(_int(member.get("relation"), 0), -5, 5)
        member.setdefault("notes", "")
    state["party"] = party

    inv = state.get("inventory")
    state["inventory"] = [
        {"name": str(it["name"]), "qty": _int(it.get("qty"), 1),
         "slots": _int(it.get("slots"), 1), "note": str(it.get("note") or "")}
        for it in (inv if isinstance(inv, list) else [])
        if isinstance(it, dict) and it.get("name")
    ]
    state["funds"] = max(0, _int(state.get("funds"), 0))

    rels = state.get("relations")
    state["relations"] = [
        {"npc": str(r.get("npc")), "value": clamp(_int(r.get("value"), 0), -5, 5),
         "note": str(r.get("note") or "")}
        for r in (rels if isinstance(rels, list) else [])
        if isinstance(r, dict) and r.get("npc")
    ]

    clocks = state.get("clocks")
    state["clocks"] = [
        {"name": str(c.get("name")), "value": max(0, _int(c.get("value"), 0)),
         "max": max(1, _int(c.get("max"), 6)), "consequence": str(c.get("consequence") or "")}
        for c in (clocks if isinstance(clocks, list) else [])
        if isinstance(c, dict) and c.get("name")
    ]
    for c in state["clocks"]:
        c["value"] = min(c["value"], c["max"])

    events = state.get("events_fired")
    state["events_fired"] = [
        {"code": str(e.get("code") or ""), "name": str(e.get("name") or ""),
         "day": _int(e.get("day"), state["day"])}
        for e in (events if isinstance(events, list) else [])
        if isinstance(e, dict)
    ]

    clues = state.get("clues")
    state["clues"] = [
        {"text": str(c.get("text") or ""), "done": bool(c.get("done"))}
        for c in (clues if isinstance(clues, list) else [])
        if isinstance(c, dict) and c.get("text")
    ]

    log = state.get("log")
    state["log"] = [
        {"day": _int(e.get("day"), state["day"]), "period": str(e.get("period") or ""),
         "type": str(e.get("type") or "note"), "text": str(e.get("text") or "")}
        for e in (log if isinstance(log, list) else [])
        if isinstance(e, dict) and e.get("text")
    ]
    return state


def normalize(state):
    """返回补齐默认字段后的新状态（深拷贝，不修改入参）。"""
    if not isinstance(state, dict):
        raise ValueError("存档不是合法的 JSON 对象")
    out = copy.deepcopy(state)
    _ensure_state(out)
    return out


# ---------------------------------------------------------------------------
# 存档读写
# ---------------------------------------------------------------------------

def slot_path(module, slot):
    slot = _int(slot, 1)
    if not 1 <= slot <= SLOTS_PER_MODULE:
        raise ValueError(f"槽位必须是 1-{SLOTS_PER_MODULE}")
    return SAVE_ROOT / _safe_module_name(module) / f"slot{slot}.json"


def slot_info(module):
    """列出某本的 3 个槽位：是否存在、标题、天数、时段、地点、角色、更新时间。"""
    out = []
    for slot in range(1, SLOTS_PER_MODULE + 1):
        p = slot_path(module, slot)
        info = {"slot": slot, "exists": p.exists(), "path": str(p)}
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                ch = data.get("character") if isinstance(data.get("character"), dict) else {}
                info.update({
                    "title": data.get("title") or data.get("module") or "",
                    "day": data.get("day"),
                    "period": current_period(data),
                    "location": data.get("location") or "",
                    "character": ch.get("name") or "",
                    "updated": datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
                })
            except (OSError, ValueError) as e:
                info["error"] = f"存档读取失败：{e}"
        out.append(info)
    return out


def save(state, slot=None):
    """写入 web/saves/<module>/slot<N>.json，返回文件路径。"""
    if not isinstance(state, dict):
        raise ValueError("state 必须是 dict")
    if slot is not None:
        state["slot"] = _int(slot, state.get("slot") or 1)
    _ensure_state(state)
    p = slot_path(state.get("module"), state.get("slot") or 1)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)
    return str(p)


def load(module, slot):
    """读取并规范化存档。存档不存在抛 FileNotFoundError，JSON 损坏抛 ValueError。"""
    p = slot_path(module, slot)
    if not p.exists():
        raise FileNotFoundError(f"存档不存在：{p}")
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"存档 JSON 损坏：{p}（{e}）") from e
    return normalize(data)


# ---------------------------------------------------------------------------
# 开局
# ---------------------------------------------------------------------------

def _match_location(locations, raw):
    raw = str(raw or "").strip()
    for loc in locations or []:
        n = str(loc.get("name") or "").strip()
        if n and raw and (n in raw or raw in n):
            return n
    if raw:
        return raw
    return str((locations or [{}])[0].get("name") or "") if locations else ""


def _character_from_card(card, mod=None):
    card = card or {}
    attrs_raw = card.get("attributes") or {}
    attrs = {a: _int(attrs_raw.get(a), 2) for a in ATTRS}
    skills_raw = card.get("skills") or {}
    skills = {s: _int(skills_raw.get(s), 0) for s in SKILLS}
    gauges = {}
    for name, g in (card.get("gauges") or {}).items():
        if isinstance(g, dict):
            gauges[name] = {"value": _int(g.get("value"), 0), "max": _int(g.get("max"), 0)}

    hp_max = attrs["体魄"] * 2 + 4
    en_max = attrs["意志"] + 4
    will_max = attrs["意志"] * 2 + 4

    def ensure(name, value, mx):
        g = gauges.get(name)
        if g is None:
            gauges[name] = {"value": value, "max": mx}
        else:
            if not g.get("max"):
                g["max"] = mx
            if g.get("value") is None:
                g["value"] = value

    ensure("生命", hp_max, hp_max)
    ensure("精力", en_max, en_max)
    ensure("压力", 0, 10)
    ensure("决心", will_max, will_max)

    defense = _int(card.get("defense"), 0) or (7 + attrs["敏捷"] + skills["运动"])
    capacity = _int(card.get("capacity"), 0) or (6 + attrs["体魄"])
    xp = _int(card.get("xp"), 0)
    opening = (mod or {}).get("opening") or {}
    return {
        "name": card.get("name") or opening.get("player") or "主角",
        "concept": card.get("concept") or "",
        "background": card.get("background") or "",
        "goal": card.get("goal") or "",
        "weakness": card.get("weakness") or "",
        "attributes": attrs,
        "skills": skills,
        "defense": defense,
        "capacity": capacity,
        "gauges": gauges,
        "traits": list(card.get("traits") or []),
        "statuses": list(card.get("statuses") or []),
        "xp": xp,
        "xp_total": _int(card.get("xp_total"), xp),
    }


def _party_entry(card):
    gauges = {}
    for name, g in (card.get("gauges") or {}).items():
        if isinstance(g, dict):
            gauges[name] = {"value": _int(g.get("value"), 0), "max": _int(g.get("max"), 0)}
    meta = card.get("meta") or {}
    notes = "；".join(x for x in [
        card.get("concept"), meta.get("外貌"), meta.get("特点"),
        meta.get("特殊能力"), meta.get("秘密"),
    ] if x)
    return {
        "gauges": gauges,
        "relation": clamp(_int(card.get("attitude"), 0), -5, 5),
        "notes": notes[:300],
    }


def _pick_player_card(mod, character_name=None):
    cards = mod.get("characters") or []
    if character_name:
        for c in cards:
            if c.get("name") == character_name:
                return c
    return mod.get("player_card") or (cards[0] if cards else None)


def new_game(module_name, slot=1, character_name=None):
    """按 module.md 的开局与玩家角色卡建一份初始状态（不落盘，调用方自行 save）。"""
    mod = module_loader.load_module(module_name)
    periods = list(mod.get("periods") or DEFAULT_PERIODS) or list(DEFAULT_PERIODS)
    opening = mod.get("opening") or {}
    day = _int(opening.get("day"), 1)
    period = opening.get("period") or periods[0]
    period_index = periods.index(period) if period in periods else 0
    location = _match_location(mod.get("locations"), opening.get("location"))
    card = _pick_player_card(mod, character_name)
    character = _character_from_card(card, mod)

    party = {}
    for c in mod.get("characters") or []:
        if c is card:
            continue
        party[c["name"]] = _party_entry(c)

    relations = []
    for r in (card or {}).get("relations") or []:
        relations.append({
            "npc": str(r.get("npc") or ""),
            "value": clamp(_int(r.get("value"), 0), -5, 5),
            "note": str(r.get("note") or ""),
        })
    for c in mod.get("characters") or []:
        if c is card or c.get("attitude") is None:
            continue
        if not any(r["npc"] == c["name"] for r in relations):
            relations.append({
                "npc": c["name"],
                "value": clamp(_int(c.get("attitude"), 0), -5, 5),
                "note": "对主角态度",
            })

    inventory = [
        {"name": str(it.get("name")), "qty": _int(it.get("qty"), 1),
         "slots": _int(it.get("slots"), 1), "note": str(it.get("note") or "")}
        for it in (card or {}).get("inventory") or []
        if isinstance(it, dict) and it.get("name")
    ]
    funds = _int((card or {}).get("funds"), 10)
    premise = opening.get("premise") or f"{mod.get('title') or module_name} 开局"

    return {
        "version": STATE_VERSION,
        "module": mod.get("name") or module_name,
        "slot": _int(slot, 1),
        "title": mod.get("title") or module_name,
        "day": day,
        "period_index": period_index,
        "periods": periods,
        "location": location,
        "character": character,
        "party": party,
        "inventory": inventory,
        "funds": funds,
        "relations": relations,
        "clocks": [],
        "events_fired": [],
        "clues": [],
        "log": [{"day": day, "period": period, "type": "开场", "text": premise}],
    }


# ---------------------------------------------------------------------------
# 时间与摘要
# ---------------------------------------------------------------------------

def current_period(state):
    periods = state.get("periods") or DEFAULT_PERIODS
    if not periods:
        return ""
    i = _int(state.get("period_index"), 0)
    i = max(0, min(i, len(periods) - 1))
    return periods[i]


def advance_time(state, steps=1):
    """推进 N 个时段（跨天自动翻页），返回变更说明列表。"""
    _ensure_state(state)
    changes = []
    periods = state["periods"]
    i, day = state["period_index"], state["day"]
    for _ in range(max(0, _int(steps, 0))):
        i += 1
        if i >= len(periods):
            i = 0
            day += 1
            changes.append(f"跨天：进入第 {day} 天")
        changes.append(f"时间推进到 第 {day} 天 · {periods[i]}")
    state["day"], state["period_index"] = day, i
    return changes


def add_log(state, text, type_="note", day=None, period=None):
    _ensure_state(state)
    entry = {
        "day": _int(day if day is not None else state["day"], state["day"]),
        "period": str(period or current_period(state)),
        "type": str(type_ or "note"),
        "text": str(text),
    }
    state["log"].append(entry)
    if len(state["log"]) > LOG_LIMIT:
        del state["log"][:len(state["log"]) - LOG_LIMIT]
    return entry


def state_summary(state, log_tail=6):
    """生成给 LLM 的紧凑状态文本。"""
    _ensure_state(state)
    ch = state["character"]
    title = state.get("title") or state.get("module") or "未命名"
    lines = [f"《{title}》第 {state['day']} 天 · {current_period(state)}｜地点：{state.get('location') or '未知'}"]

    gauges = ch.get("gauges") or {}
    gauge_txt = " ｜ ".join(f"{n} {g['value']}/{g['max']}" for n, g in gauges.items())
    lines.append(f"角色 {ch.get('name') or '主角'}：{gauge_txt or '（无仪表）'}")
    attrs = " ".join(f"{a}{_int(ch['attributes'].get(a), 0)}" for a in ATTRS if ch["attributes"].get(a))
    skills = " ".join(f"{s}{_int(ch['skills'].get(s), 0)}" for s in SKILLS if ch["skills"].get(s))
    lines.append(
        f"属性：{attrs or '—'}｜技能：{skills or '—'}｜"
        f"防御 {ch.get('defense') or 0}｜携带格 {ch.get('capacity') or 0}"
    )
    if ch.get("traits"):
        lines.append("特质：" + "；".join(str(t) for t in ch["traits"]))
    if ch.get("statuses"):
        lines.append("状态：" + "；".join(str(s) for s in ch["statuses"]))
    lines.append(f"经验：{ch.get('xp', 0)}（累计 {ch.get('xp_total', 0)}）｜资金：{state.get('funds', 0)}")

    inv = state.get("inventory") or []
    if inv:
        items = "、".join(f"{i.get('name')}×{_int(i.get('qty'), 1)}" for i in inv)
        used = sum(_int(i.get("slots"), 1) for i in inv)
        lines.append(f"物品（约 {used}/{ch.get('capacity') or 0} 格）：{items}")
    rels = state.get("relations") or []
    if rels:
        lines.append("关系：" + "、".join(f"{r.get('npc')} {_int(r.get('value')):+d}" for r in rels))
    for c in state.get("clocks") or []:
        mx = max(1, _int(c.get("max"), 6))
        v = _int(c.get("value"), 0)
        lines.append(f"进度钟 [{c.get('name')}] {_clock_bar(v, mx)} {v}/{mx} — 满时：{c.get('consequence') or '（未写）'}")
    party = state.get("party") or {}
    if party:
        parts = []
        for npc, m in party.items():
            hp = (m.get("gauges") or {}).get("生命")
            extra = f" 生命 {hp['value']}/{hp['max']}" if isinstance(hp, dict) else ""
            parts.append(f"{npc}(关系{_int(m.get('relation')):+d}{extra})")
        lines.append("同伴：" + "、".join(parts))
    open_clues = [str(c.get("text")) for c in state.get("clues") or [] if not c.get("done")]
    if open_clues:
        lines.append("线索：" + "；".join(open_clues[:8]))
    pe = state.get("pending_event")
    if isinstance(pe, dict) and (pe.get("code") or pe.get("name")):
        lines.append(f"待处理事件：{pe.get('code') or ''} {pe.get('name') or ''}".strip())
    for e in (state.get("log") or [])[-max(0, _int(log_tail, 0)):]:
        lines.append(f"  D{e.get('day')}·{e.get('period')} [{e.get('type')}] {str(e.get('text'))[:100]}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# GM 补丁
# ---------------------------------------------------------------------------

def apply_patch(state, patch):
    """按 GM 补丁更新存档，返回人类可读的变更说明列表。

    支持的键：
      hp / energy / stress     数字=增量，或 {delta|set,max}，映射到生命/精力/压力
      gauges                   {名: 增量 或 {delta|set|value,max}}，自动建表
      party                    {NPC名: {gauges, relation, notes, ...其他字段}}
      funds / xp / xp_total    数字=增量，或 {set|delta}
      location / day / period 直接设置（day/period 也接受 {delta}/{set}）
      time_advance             N 个时段
      add_status / remove_status        字符串或数组
      items                    [{name, delta|set, slots, note}]
      relations                [{npc, delta|set, note}]，钳制 ±5
      clocks                   [{name, advance|set, create:{max,consequence}, remove}]
      clues_add / clues_done   字符串/数组（clues_done 也接受下标）
      events                   [{code,name}] 追加已触发事件
      pending_event            dict 或 null（清除）
      log                      字符串/数组，追加日志
    """
    changes = []
    if not isinstance(patch, dict):
        return ["补丁必须是对象，已忽略"]
    _ensure_state(state)
    ch = state["character"]
    gauges = ch["gauges"]

    for key, name in (("hp", "生命"), ("energy", "精力"), ("stress", "压力")):
        if key in patch and patch[key] is not None:
            spec = patch[key]
            delta = value = maximum = None
            if isinstance(spec, dict):
                delta = spec.get("delta")
                value = spec.get("set", spec.get("value"))
                maximum = spec.get("max")
            else:
                delta = spec
            g = _gauge(gauges, name, _auto_max(state, name, _int(delta, 0)))
            before = g["value"]
            _apply_gauge(g, delta=delta, value=value, maximum=maximum)
            changes.append(_gauge_change(name, before, g))

    gauges_patch = patch.get("gauges")
    for name, spec in (gauges_patch if isinstance(gauges_patch, dict) else {}).items():
        delta = value = maximum = None
        if isinstance(spec, dict):
            delta = spec.get("delta")
            value = spec.get("set", spec.get("value"))
            maximum = spec.get("max")
        else:
            delta = spec
        g = _gauge(gauges, name, _auto_max(state, name, _int(delta, 0)))
        before = g["value"]
        _apply_gauge(g, delta=delta, value=value, maximum=maximum)
        changes.append(_gauge_change(name, before, g))

    party_patch = patch.get("party")
    for npc, spec in (party_patch if isinstance(party_patch, dict) else {}).items():
        npc = str(npc)
        member = state["party"].get(npc)
        if not isinstance(member, dict):
            member = {"gauges": {}, "relation": 0, "notes": ""}
            state["party"][npc] = member
        if not isinstance(member.get("gauges"), dict):
            member["gauges"] = {}
        member.setdefault("relation", 0)
        member.setdefault("notes", "")
        if not isinstance(spec, dict):
            continue
        for k, v in spec.items():
            if k == "gauges" and isinstance(v, dict):
                for gname, gspec in v.items():
                    delta = value = maximum = None
                    if isinstance(gspec, dict):
                        delta = gspec.get("delta")
                        value = gspec.get("set", gspec.get("value"))
                        maximum = gspec.get("max")
                    else:
                        delta = gspec
                    g = _gauge(member["gauges"], gname, _auto_max(state, gname, _int(delta, 0)))
                    before = g["value"]
                    _apply_gauge(g, delta=delta, value=value, maximum=maximum)
                    changes.append(f"{npc}·{_gauge_change(gname, before, g)}")
            elif k == "relation":
                before = _int(member.get("relation"), 0)
                if isinstance(v, dict):
                    after = clamp(_int(v.get("set", v.get("value", before)), before), -5, 5)
                else:
                    after = clamp(before + _int(v, 0), -5, 5)
                member["relation"] = after
                changes.append(f"{npc} 关系 {before:+d} → {after:+d}")
            elif k == "notes":
                text = str(v).strip()
                if text:
                    member["notes"] = f"{member['notes']}；{text}" if member["notes"] else text
                    changes.append(f"{npc} 备注追加")
            else:
                member[k] = v

    if patch.get("funds") is not None:
        before = _int(state.get("funds"), 0)
        spec = patch["funds"]
        if isinstance(spec, dict):
            after = _int(spec.get("set", spec.get("value", before + _int(spec.get("delta"), 0))), before)
        else:
            after = before + _int(spec, 0)
        state["funds"] = max(0, after)
        changes.append(f"资金 {before} → {state['funds']}")

    for key in ("xp", "xp_total"):
        if patch.get(key) is None:
            continue
        before = _int(ch.get(key), 0)
        spec = patch[key]
        if isinstance(spec, dict):
            after = _int(spec.get("set", spec.get("value", before + _int(spec.get("delta"), 0))), before)
        else:
            after = before + _int(spec, 0)
        ch[key] = max(0, after)
        if key == "xp" and ch[key] > before:
            ch["xp_total"] = _int(ch.get("xp_total"), 0) + (ch[key] - before)
        changes.append(f"经验 {key} {before} → {ch[key]}")

    if patch.get("location"):
        before = state.get("location") or ""
        state["location"] = str(patch["location"])
        changes.append(f"地点 {before or '—'} → {state['location']}")

    if patch.get("day") is not None:
        spec = patch["day"]
        before = state["day"]
        if isinstance(spec, dict):
            after = before + _int(spec.get("delta"), 0) if "delta" in spec else _int(spec.get("set"), before)
        else:
            after = _int(spec, before)
        state["day"] = max(0, after)
        changes.append(f"日期 第 {before} 天 → 第 {state['day']} 天")

    if patch.get("period") is not None:
        before = current_period(state)
        idx = _match_period(state["periods"], patch["period"])
        if idx is None:
            changes.append(f"时段「{patch['period']}」不在时段表，已忽略")
        else:
            state["period_index"] = idx
            changes.append(f"时段 {before} → {current_period(state)}")

    if patch.get("time_advance"):
        changes.extend(advance_time(state, patch["time_advance"]))

    for s in _as_list(patch.get("add_status")):
        s = str(s).strip()
        if not s:
            continue
        if s in ch["statuses"]:
            changes.append(f"状态「{s}」已存在（刷新）")
        else:
            ch["statuses"].append(s)
            changes.append(f"获得状态：{s}")
    for s in _as_list(patch.get("remove_status")):
        s = str(s).strip()
        hit = _remove_by_text(ch["statuses"], s)
        changes.append(f"解除状态：{hit}" if hit else f"未找到状态「{s}」")

    for it in _as_list(patch.get("items")):
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip()
        if not name:
            continue
        delta, set_to = it.get("delta"), it.get("set")
        item = _find_item(state["inventory"], name)
        if item is None:
            qty = _int(set_to, 0) if set_to is not None else _int(delta, 0)
            if qty <= 0:
                changes.append(f"道具「{name}」不存在，已忽略")
                continue
            item = {"name": name, "qty": qty,
                    "slots": _int(it.get("slots"), 1), "note": str(it.get("note") or "")}
            state["inventory"].append(item)
            changes.append(f"获得道具：{name}×{qty}")
        else:
            before = _int(item.get("qty"), 1)
            if set_to is not None:
                qty = _int(set_to, 0)
            elif delta is not None:
                qty = before + _int(delta, 0)
            else:
                qty = before
            if qty <= 0:
                state["inventory"].remove(item)
                changes.append(f"道具「{name}」×{before} 用尽，移出背包")
                continue
            item["qty"] = qty
            changes.append(f"道具「{name}」{before} → {qty}")
        if it.get("slots") is not None:
            item["slots"] = _int(it.get("slots"), 1)
        if it.get("note"):
            item["note"] = str(it.get("note"))

    for rel in _as_list(patch.get("relations")):
        if not isinstance(rel, dict):
            continue
        npc = str(rel.get("npc") or "").strip()
        if not npc:
            continue
        entry = next((r for r in state["relations"] if r.get("npc") == npc), None)
        if entry is None:
            entry = {"npc": npc, "value": 0, "note": ""}
            state["relations"].append(entry)
        before = _int(entry.get("value"), 0)
        if rel.get("set") is not None:
            after = clamp(_int(rel.get("set"), before), -5, 5)
        else:
            after = clamp(before + _int(rel.get("delta"), 0), -5, 5)
        entry["value"] = after
        if rel.get("note") is not None:
            entry["note"] = str(rel.get("note"))
        changes.append(f"关系 {npc} {before:+d} → {after:+d}")

    for c in _as_list(patch.get("clocks")):
        if not isinstance(c, dict):
            continue
        name = str(c.get("name") or "").strip()
        if not name:
            continue
        clock = next((x for x in state["clocks"] if x.get("name") == name), None)
        if c.get("remove"):
            if clock is not None:
                state["clocks"].remove(clock)
                changes.append(f"移除进度钟「{name}」")
            else:
                changes.append(f"进度钟「{name}」不存在")
            continue
        create = c.get("create") if isinstance(c.get("create"), dict) else {}
        if clock is None:
            clock = {"name": name, "value": 0, "max": max(1, _int(create.get("max"), 6)),
                     "consequence": str(create.get("consequence") or "")}
            state["clocks"].append(clock)
            changes.append(f"新建进度钟「{name}」0/{clock['max']}")
        else:
            if create.get("max") is not None:
                clock["max"] = max(1, _int(create.get("max"), clock.get("max") or 6))
            if create.get("consequence"):
                clock["consequence"] = str(create["consequence"])
        mx = max(1, _int(clock.get("max"), 6))
        clock["max"] = mx
        before = _int(clock.get("value"), 0)
        if c.get("advance") is not None:
            after = clamp(before + _int(c.get("advance"), 0), 0, mx)
        elif c.get("set") is not None:
            after = clamp(_int(c.get("set"), before), 0, mx)
        else:
            after = before
        clock["value"] = after
        suffix = "（已满！）" if after >= mx else ""
        changes.append(f"进度钟「{name}」{before}/{mx} → {after}/{mx}{suffix}")

    for text in _as_list(patch.get("clues_add")):
        text = str(text).strip()
        if text:
            state["clues"].append({"text": text, "done": False})
            changes.append(f"新增线索：{text[:40]}")
    for key in _as_list(patch.get("clues_done")):
        clue = _find_clue(state["clues"], key)
        if clue is None:
            changes.append(f"未找到线索「{key}」")
        else:
            clue["done"] = True
            changes.append(f"线索完成：{str(clue.get('text'))[:40]}")

    for ev in _as_list(patch.get("events")):
        if isinstance(ev, dict):
            code, name = str(ev.get("code") or ""), str(ev.get("name") or "")
        else:
            code, name = "", str(ev)
        if code or name:
            state["events_fired"].append({"code": code, "name": name, "day": state["day"]})
            changes.append(f"记录事件：{code} {name}".strip())

    if "pending_event" in patch:
        if patch["pending_event"]:
            pe = patch["pending_event"]
            state["pending_event"] = pe if isinstance(pe, dict) else {"name": str(pe)}
            changes.append(f"待处理事件：{state['pending_event'].get('code') or ''} {state['pending_event'].get('name') or ''}".strip())
        else:
            state.pop("pending_event", None)
            changes.append("清除待处理事件")

    for entry in _as_list(patch.get("log")):
        add_log(state, entry)
        changes.append(f"日志：{str(entry)[:40]}")

    return changes


# ---------------------------------------------------------------------------
# 玩家编辑操作
# ---------------------------------------------------------------------------

def apply_edit(state, op):
    """执行一条结构化编辑，返回 (ok, msg)。op 形如 {"op": "set_gauge", ...}。

    支持：set_gauge / set_attr / set_skill / set_funds / set_xp /
    add_item / remove_item / set_item_qty / set_relation /
    set_clock / add_clock / remove_clock / add_clue / toggle_clue / remove_clue /
    add_status / remove_status / add_trait / remove_trait / set_location / set_time /
    spend_xp（技能升 N 级花 N×3、属性升 N 花 N×5、新特质 6）。
    """
    if not isinstance(op, dict):
        return False, "编辑操作必须是对象"
    _ensure_state(state)
    ch = state["character"]
    gauges = ch["gauges"]
    action = str(op.get("op") or op.get("action") or "").strip()

    if action == "set_gauge":
        name = str(op.get("name") or "").strip()
        if not name:
            return False, "缺少仪表名"
        if op.get("value") is None and op.get("max") is None:
            return False, "缺少 value 或 max"
        g = _gauge(gauges, name, _auto_max(state, name, _int(op.get("value"), 0)))
        before = g["value"]
        _apply_gauge(g, value=op.get("value"), maximum=op.get("max"))
        return True, f"{name} {before} → {g['value']}（上限 {g['max']}）"

    if action == "set_attr":
        name = str(op.get("name") or "").strip()
        if name not in ATTRS and name not in ch["attributes"]:
            return False, f"未知属性：{name}"
        value = _int(op.get("value"), -1)
        if value < 1:
            return False, "属性最低 1"
        clamped = value > 5
        value = min(value, 5)
        before = _int(ch["attributes"].get(name), 0)
        ch["attributes"][name] = value
        return True, f"属性 {name} {before} → {value}" + ("（按上限 5 收敛）" if clamped else "")

    if action == "set_skill":
        name = str(op.get("name") or "").strip()
        if name not in SKILLS and name not in ch["skills"]:
            return False, f"未知技能：{name}"
        value = _int(op.get("value"), -1)
        if value < 0:
            return False, "技能最低 0"
        clamped = value > 3
        value = min(value, 3)
        before = _int(ch["skills"].get(name), 0)
        ch["skills"][name] = value
        return True, f"技能 {name} {before} → {value}" + ("（按上限 3 收敛）" if clamped else "")

    if action == "set_funds":
        value = _int(op.get("value"), -1)
        if value < 0:
            return False, "资金不能为负"
        before = _int(state.get("funds"), 0)
        state["funds"] = value
        return True, f"资金 {before} → {value}"

    if action == "set_xp":
        value = _int(op.get("value"), -1)
        if value < 0:
            return False, "经验不能为负"
        before = _int(ch.get("xp"), 0)
        ch["xp"] = value
        if value > _int(ch.get("xp_total"), 0):
            ch["xp_total"] = value
        return True, f"经验 {before} → {value}（累计 {ch['xp_total']}）"

    if action == "add_item":
        name = str(op.get("name") or "").strip()
        if not name:
            return False, "缺少道具名"
        qty = max(1, _int(op.get("qty"), 1))
        item = _find_item(state["inventory"], name)
        if item is not None:
            before = _int(item.get("qty"), 1)
            item["qty"] = before + qty
            if op.get("slots") is not None:
                item["slots"] = _int(op.get("slots"), 1)
            if op.get("note"):
                item["note"] = str(op.get("note"))
            return True, f"道具「{item['name']}」{before} → {item['qty']}"
        state["inventory"].append({
            "name": name, "qty": qty,
            "slots": _int(op.get("slots"), 1), "note": str(op.get("note") or ""),
        })
        return True, f"获得道具：{name}×{qty}"

    if action == "remove_item":
        name = str(op.get("name") or "").strip()
        item = _find_item(state["inventory"], name)
        if item is None:
            return False, f"背包里没有「{name}」"
        state["inventory"].remove(item)
        return True, f"移除道具：{item['name']}"

    if action == "set_item_qty":
        name = str(op.get("name") or "").strip()
        qty = _int(op.get("qty"), -1)
        if qty < 0:
            return False, "数量不能为负"
        item = _find_item(state["inventory"], name)
        if item is None:
            return False, f"背包里没有「{name}」"
        if qty == 0:
            state["inventory"].remove(item)
            return True, f"道具「{item['name']}」数量归零，移出背包"
        before = _int(item.get("qty"), 1)
        item["qty"] = qty
        return True, f"道具「{item['name']}」{before} → {qty}"

    if action == "set_relation":
        npc = str(op.get("npc") or "").strip()
        if not npc:
            return False, "缺少 NPC 名"
        value = clamp(_int(op.get("value"), 0), -5, 5)
        entry = next((r for r in state["relations"] if r.get("npc") == npc), None)
        if entry is None:
            entry = {"npc": npc, "value": 0, "note": ""}
            state["relations"].append(entry)
        before = _int(entry.get("value"), 0)
        entry["value"] = value
        if op.get("note") is not None:
            entry["note"] = str(op.get("note"))
        return True, f"关系 {npc} {before:+d} → {value:+d}"

    if action == "set_clock":
        name = str(op.get("name") or "").strip()
        if not name:
            return False, "缺少进度钟名"
        value = _int(op.get("value"), -1)
        if value < 0:
            return False, "进度不能为负"
        clock = next((x for x in state["clocks"] if x.get("name") == name), None)
        if clock is None:
            mx = max(1, _int(op.get("max"), 6))
            clock = {"name": name, "value": 0, "max": mx, "consequence": str(op.get("consequence") or "")}
            state["clocks"].append(clock)
        mx = max(1, _int(clock.get("max"), 6))
        if op.get("max") is not None:
            mx = max(1, _int(op.get("max"), mx))
            clock["max"] = mx
        before = _int(clock.get("value"), 0)
        clock["value"] = clamp(value, 0, mx)
        if op.get("consequence") is not None:
            clock["consequence"] = str(op.get("consequence"))
        return True, f"进度钟「{name}」{before}/{mx} → {clock['value']}/{mx}"

    if action == "add_clock":
        name = str(op.get("name") or "").strip()
        if not name:
            return False, "缺少进度钟名"
        mx = max(1, _int(op.get("max"), 6))
        clock = next((x for x in state["clocks"] if x.get("name") == name), None)
        if clock is not None:
            clock["max"] = mx
            if op.get("consequence") is not None:
                clock["consequence"] = str(op.get("consequence"))
            clock["value"] = min(_int(clock.get("value"), 0), mx)
            return True, f"进度钟「{name}」已存在，更新为 {clock['value']}/{mx}"
        state["clocks"].append({"name": name, "value": 0, "max": mx,
                                "consequence": str(op.get("consequence") or "")})
        return True, f"新建进度钟「{name}」0/{mx}"

    if action == "remove_clock":
        name = str(op.get("name") or "").strip()
        clock = next((x for x in state["clocks"] if x.get("name") == name), None)
        if clock is None:
            return False, f"没有进度钟「{name}」"
        state["clocks"].remove(clock)
        return True, f"移除进度钟「{name}」"

    if action == "add_clue":
        text = str(op.get("text") or op.get("name") or "").strip()
        if not text:
            return False, "缺少线索内容"
        state["clues"].append({"text": text, "done": False})
        return True, f"新增线索：{text[:40]}"

    if action == "toggle_clue":
        clue = _find_clue(state["clues"], op.get("text", op.get("index", op.get("name"))))
        if clue is None:
            return False, "未找到线索"
        clue["done"] = not clue.get("done")
        return True, f"线索{'已完成' if clue['done'] else '重新打开'}：{str(clue.get('text'))[:40]}"

    if action == "remove_clue":
        clue = _find_clue(state["clues"], op.get("text", op.get("index", op.get("name"))))
        if clue is None:
            return False, "未找到线索"
        state["clues"].remove(clue)
        return True, f"移除线索：{str(clue.get('text'))[:40]}"

    if action == "add_status":
        text = str(op.get("text") or op.get("name") or "").strip()
        if not text:
            return False, "缺少状态名"
        if text in ch["statuses"]:
            return True, f"状态「{text}」已存在（刷新）"
        ch["statuses"].append(text)
        return True, f"获得状态：{text}"

    if action == "remove_status":
        text = str(op.get("text") or op.get("name") or "").strip()
        hit = _remove_by_text(ch["statuses"], text)
        return (True, f"解除状态：{hit}") if hit else (False, f"没有状态「{text}」")

    if action == "add_trait":
        text = str(op.get("text") or op.get("name") or "").strip()
        if not text:
            return False, "缺少特质名"
        if text in ch["traits"]:
            return True, f"特质「{text}」已存在"
        if len(ch["traits"]) >= 4:
            return False, "特质最多 4 个（core §6.3）"
        ch["traits"].append(text)
        return True, f"获得特质：{text}"

    if action == "remove_trait":
        text = str(op.get("text") or op.get("name") or "").strip()
        hit = _remove_by_text(ch["traits"], text)
        return (True, f"移除特质：{hit}") if hit else (False, f"没有特质「{text}」")

    if action == "set_location":
        name = str(op.get("name") or op.get("value") or "").strip()
        if not name:
            return False, "缺少地点名"
        before = state.get("location") or ""
        state["location"] = name
        return True, f"地点 {before or '—'} → {name}"

    if action == "set_time":
        parts = []
        if op.get("day") is not None:
            before = state["day"]
            state["day"] = max(0, _int(op.get("day"), before))
            parts.append(f"第 {before} 天 → 第 {state['day']} 天")
        if op.get("period") is not None:
            before = current_period(state)
            idx = _match_period(state["periods"], op.get("period"))
            if idx is None:
                return False, f"时段「{op.get('period')}」不在时段表"
            state["period_index"] = idx
            parts.append(f"时段 {before} → {current_period(state)}")
        if not parts:
            return False, "缺少 day 或 period"
        return True, "时间：" + "，".join(parts)

    if action == "spend_xp":
        kind = str(op.get("kind") or "").strip()
        xp = _int(ch.get("xp"), 0)
        if kind == "skill":
            name = str(op.get("name") or "").strip()
            if name not in SKILLS and name not in ch["skills"]:
                return False, f"未知技能：{name}"
            target = _int(op.get("to", op.get("level")), 0)
            cur = _int(ch["skills"].get(name), 0)
            if target <= cur:
                return False, f"技能「{name}」当前 {cur} 级，目标 {target} 级无效"
            if target > 3:
                return False, "技能上限 3 级"
            cost = target * 3
            if xp < cost:
                return False, f"经验不足：需要 {cost}，当前 {xp}"
            ch["skills"][name] = target
            ch["xp"] = xp - cost
            return True, f"技能「{name}」{cur} → {target} 级，花费 {cost} 经验（剩余 {ch['xp']}）"
        if kind == "attr":
            name = str(op.get("name") or "").strip()
            if name not in ATTRS and name not in ch["attributes"]:
                return False, f"未知属性：{name}"
            target = _int(op.get("to", op.get("level")), 0)
            cur = _int(ch["attributes"].get(name), 0)
            if target <= cur:
                return False, f"属性 {name} 当前 {cur} 点，目标 {target} 点无效"
            if target > 5:
                return False, "属性上限 5"
            cost = target * 5
            if xp < cost:
                return False, f"经验不足：需要 {cost}，当前 {xp}"
            ch["attributes"][name] = target
            ch["xp"] = xp - cost
            return True, f"属性 {name} {cur} → {target} 点，花费 {cost} 经验（剩余 {ch['xp']}）"
        if kind == "trait":
            text = str(op.get("name") or op.get("text") or "").strip()
            if not text:
                return False, "缺少特质名"
            if text in ch["traits"]:
                return False, f"特质「{text}」已存在"
            if len(ch["traits"]) >= 4:
                return False, "特质最多 4 个（core §6.3）"
            cost = 6
            if xp < cost:
                return False, f"经验不足：需要 {cost}，当前 {xp}"
            ch["traits"].append(text)
            ch["xp"] = xp - cost
            return True, f"获得新特质「{text}」，花费 6 经验（剩余 {ch['xp']}）"
        return False, f"未知成长类型：{kind or '（空）'}"

    return False, f"未知操作：{action or '（空）'}"

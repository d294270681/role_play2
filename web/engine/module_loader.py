"""RPG 本（module）的发现与解析。

目录约定（见 modules/README.md）：
- modules/<本名>/module.md 必需：frontmatter（name/title/engine/tone/rating）
  + 「简介 / 文件 / 规则覆盖 / 开局」四节
- world-map.md / event-deck.md / characters/*.md / setting.md / item-dex.md 可选

解析原则：宽容优先。匹配不到的结构保留 raw 原文并记入 warnings，绝不因格式差异抛异常；
只有模块目录或 module.md 不存在时才抛 FileNotFoundError（调用方据此报 404）。
"""

from __future__ import annotations

import re
from pathlib import Path

from .dice import ATTRS as CORE_ATTRS, SKILLS as CORE_SKILLS

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULES_DIR = REPO_ROOT / "modules"
CORE_DIR = REPO_ROOT / "core"

DEFAULT_PERIODS = ["晨", "午", "暮", "夜"]

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
_BULLET_RE = re.compile(r"^\s*[-*]\s+(.*)$")
_FRONTMATTER_RE = re.compile(r"^\s*---\s*\n(.*?)\n---\s*\n?", re.S)
_TABLE_LINE_RE = re.compile(r"^\s*\|.*\|\s*$")

_CARD_META_LABELS = [
    "身份", "年龄", "外貌", "说话方式", "动机", "秘密", "能提供",
    "翻脸条件", "会在什么情况下翻脸", "对主角的态度", "对主角态度",
    "特点", "特殊能力", "名场面", "宗旨铁律", "武器等级",
]

_GAUGE_SKIP_NAMES = {
    "防御值", "携带格", "护甲", "攻击", "资金", "年龄", "经验", "关系",
    "总计", "分配", "数量", "上限", "范围", "时段", "时间", "天", "等级",
    "其余", "武器等级", "合计", "小计", "价格", "重量",
}


# ---------------------------------------------------------------------------
# 基础文本工具
# ---------------------------------------------------------------------------

def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def _strip_md(s: str) -> str:
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"`([^`]*)`", r"\1", s)
    return s.strip()


def _norm_label(s: str) -> str:
    return re.sub(r"[\s*`]+", "", s)


def _strip_parens(s: str) -> str:
    return re.sub(r"[（(][^（()）]*[）)]", "", s)


def _drop_none(v: str) -> str:
    """过滤「无 / （无） / 未知」这类占位值。"""
    return "" if re.match(r"^[（(]?\s*(无|未知|none|None)", v.strip()) else v.strip()


def _split_frontmatter(text: str):
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
    return meta, text[m.end():]


def _heading_blocks(text: str):
    """按标题切块，返回 [{level,title,body,raw}]。

    嵌套感知：每块包含自己的正文 + 所有更高级（数字更大）的子标题内容，
    直到下一个层级 <= 自己的标题为止。这样「## 角色卡」能带上它的「### 属性」小节。
    """
    lines = text.splitlines()
    heads = []
    for i, line in enumerate(lines):
        m = _HEADING_RE.match(line)
        if m:
            heads.append((i, len(m.group(1)), m.group(2).strip()))
    blocks = []
    for j, (i, level, title) in enumerate(heads):
        end = len(lines)
        for k in range(j + 1, len(heads)):
            if heads[k][1] <= level:
                end = heads[k][0]
                break
        body = "\n".join(lines[i + 1:end]).strip()
        raw = "\n".join(lines[i:end]).strip()
        blocks.append({"level": level, "title": title, "body": body, "raw": raw})
    return blocks


def _bullets(text: str):
    out = []
    for line in text.splitlines():
        m = _BULLET_RE.match(line)
        if m:
            out.append(_strip_md(m.group(1)).strip())
    return out


def _section_block(text: str, *titles: str):
    for b in _heading_blocks(text):
        for t in titles:
            if t in b["title"]:
                return b
    return None


def _section_text(text: str, *titles: str) -> str:
    b = _section_block(text, *titles)
    return b["body"] if b else ""


def _section_value(text: str, *titles: str) -> str:
    b = _section_block(text, *titles)
    if not b:
        return ""
    bullets = [_drop_none(x) for x in _bullets(b["body"])]
    bullets = [x for x in bullets if x]
    if bullets:
        return "；".join(bullets)
    return b["body"].strip().splitlines()[0].strip() if b["body"].strip() else ""


def _field(text: str, *labels: str) -> str:
    """取「- 标签：值」或「- **标签**：值」形式字段的「值」。"""
    wants = [_norm_label(lb) for lb in labels]
    for line in text.splitlines():
        s = re.sub(r"^[-*]+\s*", "", line.strip())
        s = _strip_md(s)
        if "：" in s:
            head, _, tail = s.partition("：")
        elif ":" in s:
            head, _, tail = s.partition(":")
        else:
            continue
        head_n = _norm_label(head)
        tail = tail.strip()
        if not tail:
            continue
        for w in wants:
            if head_n == w or head_n.endswith(w):
                return tail
    return ""


def _guard(fn, warnings, label, default):
    """宽容解析护栏：任何意外都降级为 warning + 默认值，绝不让解析抛异常。"""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 —— 宽容解析是刻意设计
        warnings.append(f"{label} 解析失败（已跳过）：{type(e).__name__}: {e}")
        return default


def _tables(text: str):
    tables, cur = [], []
    for line in text.splitlines():
        if _TABLE_LINE_RE.match(line):
            cur.append(line)
        else:
            if cur:
                tables.append(cur)
                cur = []
    if cur:
        tables.append(cur)
    return tables


def _split_cells(line: str):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _is_separator_row(cells) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{2,}:?", c or "-") for c in cells)


def _int_or_str(s: str):
    s = (s or "").strip()
    if re.fullmatch(r"\d{1,3}", s):
        return int(s)
    return s or None


def _parse_slots(s: str):
    s = (s or "").strip()
    if re.fullmatch(r"\d{1,2}", s):
        return int(s)
    m = re.match(r"^(\d{1,2})\s*时段", s)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------------------
# module.md
# ---------------------------------------------------------------------------

def _parse_files_section(body: str) -> dict:
    files = {}
    for bullet in _bullets(_section_text(body, "文件")):
        if "：" in bullet:
            k, _, v = bullet.partition("：")
        elif ":" in bullet:
            k, _, v = bullet.partition(":")
        else:
            continue
        k, v = k.strip(), v.strip()
        if k and v:
            files[k] = v
    return files


_GAUGE_DEF_RES = [
    re.compile(r"\*\*([\u4e00-\u9fff]{2,8})\*\*\s*[:：]?\s*(\d{1,3})\s*[-–—]\s*(\d{1,3})"),
    re.compile(r"\*\*([\u4e00-\u9fff]{2,8})\s+(\d{1,3})\s*[-–—]\s*(\d{1,3})\*\*"),
    re.compile(r"^[\s\-*>*]*([\u4e00-\u9fff]{2,8})\s*[:：]?\s*(\d{1,3})\s*[-–—]\s*(\d{1,3})", re.M),
    re.compile(r"([\u4e00-\u9fff]{2,8})\s*[（(]\s*各\s*(\d{1,3})\s*[-–—]\s*(\d{1,3})\s*级?\s*[）)]"),
]


def _parse_gauge_defs(text: str):
    """扫描 module.md 里的自定义仪表定义，如「淫度 0-100」「权限等级 1-5」「部位开发度（各 0-10 级）」。"""
    defs, seen = [], set()
    for rx in _GAUGE_DEF_RES:
        for m in rx.finditer(text):
            name = m.group(1).strip()
            lo, hi = int(m.group(2)), int(m.group(3))
            if name in seen or lo > hi or hi > 1000:
                continue
            seen.add(name)
            defs.append({"name": name, "min": lo, "max": hi})
    return defs


_PERIOD_TOKEN_RE = re.compile(
    r"([\u4e00-\u9fff]{2,4})\s*[（(]\s*(\d{1,2})(?::\d{2})?\s*[-–—~～至到]\s*(?:次日)?\s*(\d{1,2})(?::\d{2})?\s*[）)]"
)


def _parse_periods(overrides: str, full_text: str):
    """从规则覆盖里的时段链（如「清晨(6-8) → 上午(8-12) → …」）取时段表，取不到就用 core 默认。"""
    for source in (overrides, full_text):
        names = []
        for m in _PERIOD_TOKEN_RE.finditer(source or ""):
            name = re.sub(r"时段$", "", m.group(1).strip())
            if name and name not in names:
                names.append(name)
        if len(names) >= 3:
            return names, "规则覆盖"
    return list(DEFAULT_PERIODS), "core 默认"


def _parse_opening(text: str, periods, warnings):
    opening = {"day": None, "period": "", "period_index": 0, "location": "",
               "player": "", "premise": "", "card_ref": "", "raw": (text or "").strip()}
    if not (text or "").strip():
        warnings.append("module.md 缺少「开局」节，按默认开局（第 1 天 · 第一个时段）处理")
        opening["day"] = 1
        opening["period"] = periods[0]
        return opening
    m = re.search(r"第\s*(\d{1,4})\s*天", text)
    if m:
        opening["day"] = int(m.group(1))
    m = re.search(r"第\s*\d{1,4}\s*天\s*[·•.、]\s*([\u4e00-\u9fff]{1,4})", text)
    if m:
        opening["period"] = m.group(1).strip()
    loc = _field(text, "起始地点")
    if not loc:
        m = re.search(r"第\s*\d{1,4}\s*天\s*[·•]\s*[\u4e00-\u9fff]{1,4}\s*[，,]\s*([^。\n]+)", text)
        if m:
            loc = m.group(1).strip()
    opening["location"] = loc
    m = re.search(r"玩家角色[：:]\s*\**\s*([\u4e00-\u9fff]{2,4})", text)
    if m:
        opening["player"] = m.group(1)
    opening["premise"] = _field(text, "开场情境", "开场")
    m = re.search(r"`([^`]*\.md)`", text)
    if m:
        opening["card_ref"] = m.group(1)
    if opening["day"] is None:
        opening["day"] = 1
        warnings.append("开局未写明「第 N 天」，按第 1 天处理")
    if opening["period"] not in periods:
        if opening["period"]:
            warnings.append(f"开局时段「{opening['period']}」不在时段表 {periods}，回落到第一个时段")
        opening["period"] = periods[0]
    opening["period_index"] = periods.index(opening["period"])
    return opening


# ---------------------------------------------------------------------------
# world-map.md
# ---------------------------------------------------------------------------

_LOC_PREFIX_RE = re.compile(r"^\s*\d{1,3}\s*[·.、:：]\s*")
_LOC_TAIL_PAREN_RE = re.compile(r"[（(][^（()）]*[）)]\s*$")
_DANGER_RE = re.compile(r"危险度\**\s*[:：]?\s*\**\s*(\d)")
_NIGHT_RE = re.compile(r"夜间\**\s*[:：]?\s*\**\s*(\d)")
_SPLIT_RE = re.compile(r"[、，,；;/]")


def _clean_location_name(title: str) -> str:
    name = _LOC_PREFIX_RE.sub("", title.strip())
    name = _LOC_TAIL_PAREN_RE.sub("", name).strip()
    return name.strip(" ··")


def _looks_like_location(block) -> bool:
    title, body = block["title"], block["body"]
    if any(k in title for k in ("路线", "事件", "规则", "说明", "列表", "目录", "图鉴")):
        return False
    if "起点" in body and "终点" in body:
        return False
    return bool(re.search(r"危险度|可用行动|常驻\s*NPC|连接|势力", title + "\n" + body))


def _parse_actions(body: str):
    lines = body.splitlines()
    for i, line in enumerate(lines):
        s = _strip_md(re.sub(r"^[-*]+\s*", "", line.strip()))
        sep = "：" if "：" in s else (":" if ":" in s else "")
        head, tail = (s.partition(sep)[0], s.partition(sep)[2]) if sep else (s, "")
        if "可用行动" in _norm_label(head):
            if tail.strip():
                return [x.strip() for x in _SPLIT_RE.split(tail) if x.strip()]
            out = []
            for nxt in lines[i + 1:]:
                if re.match(r"^\s{2,}[-*]\s+", nxt):
                    out.append(_strip_md(re.sub(r"^\s*[-*]+\s*", "", nxt)).strip())
                elif not nxt.strip():
                    continue
                else:
                    break
            return out
    return []


def _split_names(value: str):
    return [x.strip() for x in _SPLIT_RE.split(value or "") if x.strip()]


def _parse_location_block(block) -> dict:
    title, body = block["title"], block["body"]
    danger = None
    night = None
    m = _DANGER_RE.search(title) or _DANGER_RE.search(body)
    if m:
        danger = int(m.group(1))
    m = _NIGHT_RE.search(title) or _NIGHT_RE.search(body)
    if m:
        night = int(m.group(1))
    npcs = _split_names(_field(body, "常驻 NPC", "常驻NPC"))
    return {
        "name": _clean_location_name(title),
        "danger": danger,
        "night_danger": night,
        "faction": _field(body, "势力"),
        "desc": _field(body, "描述"),
        "actions": _parse_actions(body),
        "npcs": npcs,
        "visitors": _split_names(_field(body, "可来访")),
        "connections": _split_names(_field(body, "连接")),
        "raw": block["raw"],
    }


def _parse_routes(text: str):
    routes = []
    for table in _tables(text):
        rows = [_split_cells(r) for r in table]
        if len(rows) < 2:
            continue
        header = [_norm_label(h) for h in rows[0]]
        if not any("起点" in h for h in header) or not any("终点" in h for h in header):
            continue
        idx = {}
        for i, h in enumerate(header):
            if "编号" in h:
                idx["code"] = i
            elif "起点" in h:
                idx["from"] = i
            elif "终点" in h:
                idx["to"] = i
            elif "耗时" in h:
                idx["time"] = i
            elif "危险" in h:
                idx["danger"] = i
            elif "备注" in h or "说明" in h:
                idx["note"] = i

        def cell(row, key):
            i = idx.get(key)
            return row[i].strip() if i is not None and i < len(row) else ""

        for row in rows[1:]:
            if _is_separator_row(row):
                continue
            frm, to = cell(row, "from"), cell(row, "to")
            if not frm or not to:
                continue
            routes.append({
                "code": cell(row, "code") or None,
                "from": frm,
                "to": to,
                "time": cell(row, "time"),
                "time_slots": _parse_slots(cell(row, "time")),
                "danger": _int_or_str(cell(row, "danger")),
                "note": cell(row, "note"),
            })
    return routes


def _parse_map(text: str, warnings):
    locations, routes = [], []
    if not (text or "").strip():
        warnings.append("world-map.md 缺失或为空，地点/路线为空（可用 core/world-map.md 模板补写）")
        return locations, routes
    for b in _heading_blocks(text):
        if b["level"] >= 2 and _looks_like_location(b):
            loc = _guard(lambda b=b: _parse_location_block(b), warnings, f"地点「{b['title']}」", None)
            if loc:
                locations.append(loc)
    routes = _guard(lambda: _parse_routes(text), warnings, "路线表", []) or []
    if not locations:
        warnings.append("world-map.md 未解析出地点")
    return locations, routes


# ---------------------------------------------------------------------------
# characters/*.md
# ---------------------------------------------------------------------------

def _clean_card_name(title: str) -> str:
    name = re.sub(r"[（(].*$", "", title).strip()
    return name.strip("*` ")


def _parse_attributes(text: str) -> dict:
    attrs = {}
    for line in text.splitlines():
        line = _strip_parens(line)
        found = {}
        for a in CORE_ATTRS:
            m = re.search(re.escape(a) + r"\s*[:：]?\s*(\d{1,2})", line)
            if m:
                found[a] = int(m.group(1))
        if len(found) >= 2:
            for k, v in found.items():
                attrs.setdefault(k, v)
    return attrs


def _parse_skills(text: str) -> dict:
    skills = {}
    multi, single = [], []
    for line in text.splitlines():
        line = _strip_parens(line)
        found = {}
        for s in CORE_SKILLS:
            m = re.search(re.escape(s) + r"\s*[:：]?\s*(\d{1,2})", line)
            if m:
                found[s] = int(m.group(1))
        if len(found) >= 2:
            multi.append(found)
        elif found:
            single.append(found)
    for group in multi + single:
        for k, v in group.items():
            skills.setdefault(k, v)
    return skills


def _gauge_max(name, value, defs, hint, attrs):
    d = defs.get(name)
    if d:
        return int(d["max"])
    if name == "压力":
        return 10
    if name in ("生命", "精力", "决心"):
        base = attrs.get("体魄", 0) if name == "生命" else attrs.get("意志", 0)
        if base:
            return base * 2 + 4 if name != "精力" else base + 4
        return max(int(value), 1)
    if hint:
        return int(hint)
    return 100


def _parse_gauges(text: str, attrs, gauge_defs):
    defs = {d["name"]: d for d in (gauge_defs or [])}
    gauges = {}

    for line in text.splitlines():
        line_np = _strip_parens(line)
        for m in re.finditer(
                r"([\u4e00-\u9fff]{2,6})\s*[:：]?\s*(\d{1,3})\s*/\s*(\d{1,3})", line_np):
            nm, val, mx = m.group(1), int(m.group(2)), int(m.group(3))
            if nm in CORE_ATTRS or nm in CORE_SKILLS or nm in _GAUGE_SKIP_NAMES:
                continue
            gauges.setdefault(nm, {"value": val, "max": mx})

    hint = None
    for line in text.splitlines():
        m = re.search(r"各\s*0\s*[-–—]\s*(\d{1,3})", line)
        if m:
            hint = int(m.group(1))
        line_np = _strip_parens(line)
        line_np = re.sub(r"^\s*\*\*[^*]+\*\*\s*[：:]\s*", "", line_np)
        parts = re.split(r"[|｜]", line_np)
        if len(parts) < 3:
            continue
        pairs = []
        for p in parts:
            p = _strip_md(p).strip()
            m = re.match(r"^([\u4e00-\u9fffA-Za-z]{1,8})\s*[:：]?\s*(\d{1,3})\s*$", p)
            if m:
                pairs.append((m.group(1), int(m.group(2))))
        for nm, val in pairs:
            if nm in CORE_ATTRS or nm in CORE_SKILLS or nm in _GAUGE_SKIP_NAMES:
                continue
            if nm in gauges:
                continue
            gauges[nm] = {"value": val, "max": _gauge_max(nm, val, defs, hint, attrs)}
    return gauges


_RESOURCE_RE = {
    "生命": re.compile(r"生命\s*(\d{1,3})(?:\s*/\s*(\d{1,3}))?"),
    "精力": re.compile(r"精力\s*(\d{1,3})(?:\s*/\s*(\d{1,3}))?"),
    "压力": re.compile(r"压力\s*(\d{1,3})(?:\s*/\s*(\d{1,3}))?"),
    "决心": re.compile(r"决心\s*(\d{1,3})(?:\s*/\s*(\d{1,3}))?"),
    "防御值": re.compile(r"防御值\s*(\d{1,3})"),
    "携带格": re.compile(r"携带格\s*(\d{1,3})"),
    "护甲": re.compile(r"护甲\s*(\d{1,3})"),
    "攻击": re.compile(r"攻击\s*\+?\s*(\d{1,3})"),
    "资金": re.compile(r"资金\s*[:：]?\s*(\d{1,6})"),
}


def _parse_resources(text: str, warnings):
    res = {}
    if len(set(re.findall(r"生命\s*(\d{1,3})", text))) > 1:
        warnings.append("角色卡里出现多个不同的生命值（可能是多张简卡合并在一节），跳过资源解析")
        return res
    for key, rx in _RESOURCE_RE.items():
        m = rx.search(text)
        if not m:
            continue
        val = int(m.group(1))
        mx = int(m.group(2)) if m.re.groups >= 2 and m.group(2) else None
        res[key] = {"value": val, "max": mx}
    return res


def _parse_list_section(text: str, titles, exact=False, limit=120):
    for b in _heading_blocks(text):
        tn = _norm_label(b["title"])
        if exact:
            ok = any(tn == t or tn.startswith(t) for t in titles)
        else:
            ok = any(t in b["title"] for t in titles)
        if not ok:
            continue
        out = []
        for bullet in _bullets(b["body"]):
            bullet = _drop_none(bullet)
            if bullet:
                out.append(bullet[:limit])
        return out
    return []


def _parse_relations(text: str):
    rels = []
    for b in _heading_blocks(text):
        tn = _norm_label(b["title"])
        if not (tn == "关系" or tn.startswith("关系")):
            continue
        for bullet in _bullets(b["body"]):
            m = re.match(r"^([^：:]{1,16})[：:]\s*([+-]?\d{1,2})\s*(.*)$", bullet)
            if m:
                rels.append({
                    "npc": m.group(1).strip(),
                    "value": int(m.group(2)),
                    "note": m.group(3).strip("（）() 　"),
                })
    return rels


def _parse_inventory(text: str):
    inv, funds = [], None
    for b in _heading_blocks(text):
        if "装备" not in b["title"] and "物品" not in b["title"]:
            continue
        for bullet in _bullets(b["body"]):
            sep = "：" if "：" in bullet else (":" if ":" in bullet else "")
            if not sep:
                continue
            head, tail = bullet.partition(sep)[0].strip(), bullet.partition(sep)[2].strip()
            if "资金" in head:
                m = re.search(r"(\d{1,6})", tail)
                if m:
                    funds = int(m.group(1))
                continue
            for item in _SPLIT_RE.split(tail):
                item = _drop_none(item)
                if item:
                    inv.append({"name": item, "qty": 1, "slots": 1, "note": head})
    if funds is None:
        m = re.search(r"资金\s*[:：]?\s*(\d{1,6})", text)
        if m:
            funds = int(m.group(1))
    return inv, funds


def _parse_attitude(text: str):
    pairs = re.findall(r"关系([\u4e00-\u9fff]{1,4})\s*([+-]?\d{1,2})", text)
    m = re.search(r"关系值\s*([+-]?\d{1,2})", text)
    return {"value": int(m.group(1)) if m else None,
            "pairs": [(n, int(v)) for n, v in pairs]}


def _parse_card(name, title, body, filename, gauge_defs, warnings):
    text = body
    card_warnings = []
    attrs = _parse_attributes(text)
    skills = _parse_skills(text)
    gauges = _parse_gauges(text, attrs, gauge_defs)
    res = _parse_resources(text, card_warnings)

    defs = {d["name"]: d for d in (gauge_defs or [])}
    for key, g in res.items():
        if key in ("防御值", "携带格", "护甲", "攻击", "资金"):
            continue
        mx = g["max"] or _gauge_max(key, g["value"], defs, None, attrs)
        cur = gauges.get(key)
        if cur is None or key in ("生命", "精力", "压力", "决心"):
            gauges[key] = {"value": g["value"], "max": mx}
        elif not cur.get("max"):
            cur["max"] = mx

    traits = _parse_list_section(text, ("特质",))
    statuses = _parse_list_section(text, ("状态",), exact=True)
    weakness = _field(text, "弱点 / 秘密", "弱点/秘密")
    if not weakness:
        parts = [v for v in (_section_value(text, "弱点"), _section_value(text, "秘密")) if v]
        weakness = "；".join(parts)
    concept = _field(text, "概念", "身份") or _section_value(text, "概念", "身份")
    meta = {}
    for label in _CARD_META_LABELS:
        v = _field(text, label)
        if v:
            meta[label] = v
    inv, funds = _parse_inventory(text)
    m = re.search(r"经验[：:]?\s*当前\s*(\d{1,4})(?:\s*[（(]累计\s*(\d{1,4})[）)])?", text)
    xp = int(m.group(1)) if m else 0
    xp_total = int(m.group(2)) if m and m.group(2) else xp
    for w in card_warnings:
        warnings.append(f"{filename} · {name}：{w}")
    return {
        "name": name,
        "title": title,
        "file": filename,
        "concept": concept,
        "background": _field(text, "背景") or _section_value(text, "背景"),
        "goal": _field(text, "目标", "动机") or _section_value(text, "目标", "动机"),
        "weakness": weakness,
        "attributes": attrs,
        "skills": skills,
        "gauges": gauges,
        "defense": res.get("防御值", {}).get("value"),
        "capacity": res.get("携带格", {}).get("value"),
        "armor": res.get("护甲", {}).get("value"),
        "attack": res.get("攻击", {}).get("value"),
        "traits": traits,
        "statuses": statuses,
        "relations": _parse_relations(text),
        "inventory": inv,
        "funds": funds,
        "xp": xp,
        "xp_total": xp_total,
        "attitude": None,
        "attitude_info": _parse_attitude(text),
        "meta": meta,
        "raw": f"## {title}\n{text}".strip(),
        "warnings": card_warnings,
    }


def _parse_characters(text: str, filename: str, gauge_defs, warnings):
    cards = []
    for b in _heading_blocks(text):
        if b["level"] != 2:
            continue
        if any(k in b["title"] for k in ("说明", "目录", "模板", "索引")):
            continue
        if not re.search(r"概念|身份|属性|技能|生命|数值|背景|外貌|动机|态度", b["title"] + b["body"]):
            continue
        name = _clean_card_name(b["title"])
        if name:
            card = _guard(lambda b=b, name=name: _parse_card(
                name, b["title"], b["body"], filename, gauge_defs, warnings),
                warnings, f"{filename} · 角色卡「{name}」", None)
            if card:
                cards.append(card)
    if not cards:
        warnings.append(f"{filename} 未解析出角色卡")
    return cards


# ---------------------------------------------------------------------------
# event-deck.md
# ---------------------------------------------------------------------------

_EVENT_HEADING_RE = re.compile(r"^(\d{2}|S[-–]\d{1,2}|M-E\d{1,2})\s+(.+)$")


def _parse_events(text: str, warnings):
    entries = []
    for b in _heading_blocks(text):
        if b["level"] < 2:
            continue
        m = _EVENT_HEADING_RE.match(b["title"])
        if not m:
            continue
        code, name = m.group(1), m.group(2).strip()
        entries.append({
            "code": code,
            "code_num": int(code) if code.isdigit() else None,
            "name": name,
            "special": not code.isdigit(),
            "raw": b["raw"],
        })
    if not entries:
        warnings.append("event-deck.md 未解析出事件条目")
    return entries


# ---------------------------------------------------------------------------
# 顶层接口
# ---------------------------------------------------------------------------

def list_modules(root=None):
    """列出 modules/ 下所有 RPG 本（读 module.md frontmatter）。"""
    root = Path(root) if root else MODULES_DIR
    out = []
    if not root.is_dir():
        return out
    for d in sorted(root.iterdir()):
        if not d.is_dir() or not (d / "module.md").exists():
            continue
        meta, body = _split_frontmatter(_read_text(d / "module.md"))
        files = _guard(lambda body=body: _parse_files_section(body), [], f"{d.name} 文件节", {})
        out.append({
            "name": meta.get("name") or d.name,
            "title": meta.get("title") or meta.get("name") or d.name,
            "engine": meta.get("engine") or "core",
            "tone": meta.get("tone") or "",
            "rating": meta.get("rating") or "",
            "dir": str(d),
            "path": str(d / "module.md"),
            "files": files,
            "files_exist": {k: (d / v).exists() for k, v in files.items()},
        })
    return out


def _pick_card(cards, name):
    if not name:
        return None
    for c in cards:
        if c["name"] == name:
            return c
    for c in cards:
        if c["name"].startswith(name) or name.startswith(c["name"]):
            return c
    for c in cards:
        if name in c["name"] or c["name"] in name:
            return c
    return None


def _attitude_toward(card, player_name):
    if not player_name:
        return None
    for r in card.get("relations") or []:
        npc = r.get("npc") or ""
        if npc and (npc == player_name or npc in player_name or player_name in npc):
            return r.get("value")
    att = card.get("attitude_info") or {}
    for npc, value in att.get("pairs") or []:
        if npc == player_name or npc in player_name or player_name in npc:
            return value
    return att.get("value")


def load_module(name, root=None):
    """加载并解析一个 RPG 本。模块不存在时抛 FileNotFoundError；其余解析问题只记 warnings。"""
    root = Path(root) if root else MODULES_DIR
    d = root / str(name)
    if not d.is_dir() or not (d / "module.md").exists():
        raise FileNotFoundError(f"未找到 RPG 本：{name}（{d}）")

    warnings = []
    text = _read_text(d / "module.md")
    meta, body = _split_frontmatter(text)
    files = _parse_files_section(body)
    overrides = _section_text(body, "规则覆盖")
    periods, periods_source = _guard(lambda: _parse_periods(overrides, text), warnings,
                                     "时段表", (list(DEFAULT_PERIODS), "core 默认"))
    gauge_defs = _guard(lambda: _parse_gauge_defs(text), warnings, "自定义仪表定义", [])
    opening = _guard(lambda: _parse_opening(_section_text(body, "开局"), periods, warnings), warnings,
                     "开局", {"day": 1, "period": periods[0], "period_index": 0, "location": "",
                              "player": "", "premise": "", "card_ref": "", "raw": ""})

    map_text = _read_text(d / "world-map.md")
    locations, routes = _parse_map(map_text, warnings)

    cards = []
    chars_dir = d / "characters"
    if chars_dir.is_dir():
        for p in sorted(chars_dir.glob("*.md")):
            cards.extend(_guard(lambda p=p: _parse_characters(_read_text(p), p.name, gauge_defs, warnings),
                                warnings, f"角色文件 {p.name}", []))
    else:
        warnings.append("characters/ 目录缺失，角色卡为空")

    player_name = opening.get("player") or ""
    player_card = _pick_card(cards, player_name) if player_name else (cards[0] if cards else None)
    if player_name and not player_card:
        warnings.append(f"开局指定的玩家角色「{player_name}」在 characters/ 中未找到")
    if not player_name and player_card:
        player_name = player_card["name"]
    for c in cards:
        c["attitude"] = _attitude_toward(c, player_name)
    party_cards = [c for c in cards if c is not player_card]

    events_text = _read_text(d / "event-deck.md")
    if events_text.strip():
        events = _guard(lambda: _parse_events(events_text, warnings), warnings, "事件牌", [])
        event_source = "event-deck.md"
    else:
        core_events = _read_text(CORE_DIR / "event-deck.md")
        events = _guard(lambda: _parse_events(core_events, []), warnings, "core 事件牌", [])
        event_source = "core/event-deck.md" if events else ""
        warnings.append("event-deck.md 缺失，事件牌回落到 core/event-deck.md")

    engine = meta.get("engine") or "core"
    if engine == "core":
        rules_text = _read_text(CORE_DIR / "rules.md")
        rules_source = "core/rules.md"
    else:
        setting = _read_text(d / "setting.md")
        rules_text = setting
        rules_source = "setting.md" if setting else ""

    return {
        "name": meta.get("name") or d.name,
        "title": meta.get("title") or meta.get("name") or d.name,
        "engine": engine,
        "tone": meta.get("tone") or "",
        "rating": meta.get("rating") or "",
        "dir": str(d),
        "path": str(d / "module.md"),
        "meta": meta,
        "intro": _section_text(body, "简介"),
        "files": files,
        "paths": {k: (str(d / v) if (d / v).exists() else None) for k, v in files.items()},
        "overrides": overrides,
        "rules_text": rules_text,
        "rules_source": rules_source,
        "opening": opening,
        "locations": locations,
        "routes": routes,
        "characters": cards,
        "player_name": player_name,
        "player_card": player_card,
        "party_cards": party_cards,
        "events": events,
        "event_source": event_source,
        "gauge_defs": gauge_defs,
        "periods": periods,
        "periods_source": periods_source,
        "map_raw": map_text,
        "events_raw": events_text,
        "warnings": warnings,
    }

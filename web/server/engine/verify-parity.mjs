#!/usr/bin/env node
/**
 * 深度 parity 验证：Node 引擎（web/server/engine/*.js）对照 Python 参照实现（web/engine/*.py）。
 *
 * 覆盖（同一份 fixture 同时喂给两边，结果深比较）：
 * - 两个真实本 listModules / loadModule 全字段（含 raw、warnings、gauge_defs、双格式地点、双列序路线、
 *   S-/M-E 事件扩展、时段链、开局）
 * - new_game 初始状态（默认玩家卡 + 指定角色卡）
 * - 同一 patch 序列（applyPatch 全键）与 edit 序列（applyEdit 全部 22 个 op，含非法/边界输入）后的
 *   状态、变更说明、state_summary 文本
 * - save→load 往返、跨实现互读（Node 写 Python 读、Python 写 Node 读）、slot_info、槽位错误
 * - dice 四档边界穷举（kept×total×difficulty 全组合）、clamp/passive/event_triggered 全表、
 *   rollCheck/rerollDie/rollOpposed 行为自检（两边各自断言不变量后比对）
 *
 * 用法：node web/server/engine/verify-parity.mjs [--python <python 可执行文件>]
 * 退出码 0 = 全绿；1 = 有差异（打印前若干条 diff）。
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as dice from "./dice.js";
import * as ml from "./moduleLoader.js";
import * as state from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PY_ENGINE_DIR = path.resolve(REPO_ROOT, "web", "engine");
const PYTHON = readArg("--python") || process.env.PYTHON || "python";
const MAX_DIFFS = 25;

// ---------------------------------------------------------------------------
// fixture：两边执行完全相同的操作序列
// ---------------------------------------------------------------------------

const MODULES = ["gangcheng", "lvmao-yinqi-diyu"];

const PATCHES_LVMAO = [
  { hp: -3, energy: 2, stress: { delta: 3, max: 20 } },
  { gauges: { 淫度: { delta: 25, max: 100 }, 心瘾度: 5, 新仪表: { set: 7, max: 13 } } },
  { gauges: { 淫度: { value: 33, max: 100 } } },
  { party: { 温稚宁: { gauges: { 淫度: { delta: 10 } }, relation: 2, notes: "第一次备注" } } },
  { party: { 温稚宁: { relation: { set: -2 }, notes: "第二次备注" }, 陆渊: { gauges: { 生命: -2 }, relation: -5 } } },
  { funds: 30 },
  { funds: { delta: -5 } },
  { funds: { set: 12 } },
  { xp: 5 },
  { xp_total: { delta: 3 } },
  { xp: { set: 2 } },
  { location: "小学·王主任教研室" },
  { day: { delta: 2 } },
  { day: { set: 4 } },
  { period: "傍晚" },
  { period: 2 },
  { period: true },
  { period: "不存在的时段" },
  { time_advance: 3 },
  { time_advance: 5 },
  { add_status: "通缉 / 暴露（码头帮）" },
  { add_status: ["走神微痒", "腿软漏蜜"] },
  { add_status: "走神微痒" },
  { remove_status: "腿软" },
  { remove_status: "不存在状态" },
  { items: [{ name: "暗网摄像设备", delta: 2, note: "摄影" }, { name: "新道具", set: 3, slots: 2, note: "测试" }] },
  { items: [{ name: "暗网摄像设备", delta: -1 }, { name: "新道具", set: 0 }] },
  { items: [{ name: "不存在的道具", delta: 2 }] },
  { relations: [{ npc: "陆渊", delta: 2, note: "布局者" }, { npc: "新NPC", set: 3 }] },
  { relations: [{ npc: "陆渊", set: 9 }] },
  { clocks: [{ name: "崩溃钟", create: { max: 6, consequence: "彻底沉沦" }, advance: 2 }] },
  { clocks: [{ name: "崩溃钟", advance: 9 }] },
  { clocks: [{ name: "崩溃钟", create: { max: 8 } }] },
  { clocks: [{ name: "暴露钟", set: 3, create: { max: 6 } }] },
  { clocks: [{ name: "暴露钟", remove: true }] },
  { clocks: [{ name: "不存在的钟", remove: true }] },
  { clues_add: ["线索一", "线索二"] },
  { clues_done: "线索一" },
  { clues_done: 1 },
  { clues_done: "不存在" },
  { events: [{ code: "S-01", name: "巨蝇登门" }, "纯字符串事件"] },
  { pending_event: { code: "M-E1", name: "抉择牌时刻" } },
  { log: "手工日志一条" },
  { log: ["批量一", "批量二"] },
  { pending_event: null },
];

const PATCHES_GANGCHENG = [
  { hp: 2 },
  { hp: { delta: -1, max: 12 } },
  { energy: { set: 5 } },
  { stress: 4 },
  { gauges: { 压力: { delta: 2, max: 10 } } },
  { party: { 阿澄: { gauges: { 生命: { delta: -1 } }, relation: -2, notes: "同行者" } } },
  { funds: 20 },
  { xp: 3 },
  { location: "旧码头" },
  { day: { delta: 1 } },
  { period: "夜" },
  { time_advance: 2 },
  { add_status: "通缉 / 暴露（码头帮）" },
  { items: [{ name: "旧手表", delta: 1, note: "遗物" }] },
  { relations: [{ npc: "老魏", delta: 1, note: "委托人" }] },
  { clocks: [{ name: "走私案", create: { max: 6, consequence: "真相大白" }, advance: 1 }] },
  { clues_add: ["仓库后墙的布鞋"] },
  { clues_done: 0 },
  { events: [{ code: "53", name: "老魏的儿子" }] },
  { pending_event: { code: "62", name: "码头帮搜人" } },
  { log: "追查布鞋的线索" },
];

const PATCHES_TRICKY = [
  { location: 0 },
  { location: "旧码头" },
  { hp: "abc" },
  { hp: true },
  { gauges: { 布尔表: true } },
  { gauges: { 空规格: {} } },
  { xp: "abc" },
  { add_status: true },
  { clues_add: 42 },
  { clues_done: true },
  { log: { a: 1 } },
  { items: [{ name: "道具", delta: 2, note: 7 }] },
  { pending_event: "裸字符串事件" },
  { pending_event: { code: {}, name: [] } },
  { pending_event: {} },
  { pending_event: [] },
  { pending_event: null },
  { clocks: [{ name: "崩溃钟", create: { max: 6 }, remove: {} }] },
  { clocks: [{ name: "空钟", create: {}, advance: 1 }] },
];

const OPS_LVMAO = [
  { op: "set_gauge", name: "淫度", value: 42, max: 100 },
  { op: "set_gauge", name: "新仪表X", value: 3 },
  { op: "set_gauge", name: "心瘾度", value: 61 },
  { op: "set_gauge", name: "权限等级", max: 5 },
  { op: "set_gauge" },
  { op: "set_gauge", name: "X" },
  { op: "set_attr", name: "体魄", value: 4 },
  { op: "set_attr", name: "体魄", value: 9 },
  { op: "set_attr", name: "敏捷", value: 0 },
  { op: "set_attr", name: "不存在", value: 3 },
  { op: "set_skill", name: "学识", value: 3 },
  { op: "set_skill", name: "学识", value: 7 },
  { op: "set_skill", name: "交涉", value: 9 },
  { op: "set_funds", value: 55 },
  { op: "set_funds", value: -1 },
  { op: "set_xp", value: 30 },
  { op: "set_xp", value: -2 },
  { op: "set_xp", value: 100 },
  { op: "add_item", name: "手稿", qty: 2, slots: 1, note: "诗" },
  { op: "add_item", name: "手稿", qty: 1 },
  { op: "set_item_qty", name: "手稿", qty: 0 },
  { op: "remove_item", name: "不存在" },
  { op: "set_relation", npc: "陆渊", value: 3, note: "布局者" },
  { op: "set_relation", npc: "陆渊", value: 9 },
  { op: "set_clock", name: "崩溃钟", value: 4, max: 6, consequence: "沉沦" },
  { op: "set_clock", name: "崩溃钟", value: 9 },
  { op: "add_clock", name: "崩溃钟", max: 8 },
  { op: "add_clock", name: "新钟", max: 4, consequence: "x" },
  { op: "remove_clock", name: "新钟" },
  { op: "remove_clock", name: "无钟" },
  { op: "add_clue", text: "第一条线索" },
  { op: "add_clue", text: "第二条线索" },
  { op: "toggle_clue", text: "第一条线索" },
  { op: "toggle_clue", index: 0 },
  { op: "remove_clue", text: "第二条线索" },
  { op: "remove_clue", text: "不存在" },
  { op: "add_status", text: "走神微痒" },
  { op: "add_status", name: "走神微痒" },
  { op: "remove_status", text: "走神" },
  { op: "remove_status", text: "无" },
  { op: "add_trait", text: "摄影署名" },
  { op: "add_trait", text: "摄影署名" },
  { op: "add_trait", text: "甲" },
  { op: "add_trait", text: "乙" },
  { op: "add_trait", text: "丙" },
  { op: "add_trait", text: "丁" },
  { op: "remove_trait", text: "摄影署名" },
  { op: "set_location", name: "小学·王主任教研室" },
  { op: "set_time", day: 3, period: "深夜" },
  { op: "set_time", period: "不存在" },
  { op: "set_time" },
  { op: "spend_xp", kind: "skill", name: "学识", to: 3 },
  { op: "spend_xp", kind: "skill", name: "学识", to: 2 },
  { op: "spend_xp", kind: "skill", name: "学识", to: 4 },
  { op: "spend_xp", kind: "attr", name: "体魄", to: 5 },
  { op: "spend_xp", kind: "attr", name: "体魄", to: 6 },
  { op: "spend_xp", kind: "trait", name: "新特质" },
  { op: "spend_xp", kind: "trait", name: "新特质" },
  { op: "spend_xp", kind: "nope" },
  { op: "unknown_op" },
  { op: "set_time", day: 1, period: 3 },
  { op: "set_time", period: true },
];

const OPS_GANGCHENG = [
  { op: "set_gauge", name: "压力", value: 3 },
  { op: "set_gauge", name: "自定义", value: 5, max: 20 },
  { op: "set_attr", name: "智识", value: 5 },
  { op: "spend_xp", kind: "trait", name: "线索嗅觉" },
  { op: "add_clue", name: "以 name 传线索" },
  { op: "toggle_clue", name: "以 name 传线索" },
];

const EVENT_CASES = [
  [0, false, 0], [-5, false, 0], [0, false, -2], [-3, true, 0], [1, false, -5], [-10, false, 9],
];

/** 确定性伪随机 fuzz：同一份 JSON 同时喂给两边，覆盖手写用例想不到的组合。 */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildFuzz() {
  const rnd = lcg(20260928);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const gauges = ["生命", "精力", "压力", "决心", "淫度", "心瘾度", "随机表"];
  const attrs = ["体魄", "敏捷", "智识", "感知", "意志", "魅力", "不存在"];
  const skills = ["格斗", "运动", "射击", "潜行", "巧手", "学识", "医疗", "工艺", "察觉", "生存", "镇定", "交涉", "欺瞒", "不存在"];
  const npcs = ["温稚宁", "陆渊", "王主任", "新NPC", "不存在"];
  const items = ["暗网摄像设备", "手稿", "新道具", "不存在"];
  const texts = ["走神微痒", "腿软漏蜜", "不存在状态", "新特质"];
  const periods = ["清晨", "深夜", "傍晚", 0, 3, true, "不存在"];

  const patches = [];
  for (let i = 0; i < 150; i += 1) {
    const p = {};
    switch (int(0, 11)) {
      case 0:
        p[pick(["hp", "energy", "stress"])] = pick([int(-4, 6), { delta: int(-4, 4) }, { set: int(0, 15) }, { max: int(1, 20) }, { delta: int(-2, 2), max: int(1, 12) }, "abc"]);
        break;
      case 1:
        p.gauges = { [pick(gauges)]: pick([int(-5, 5), { delta: int(-5, 5), max: int(1, 30) }, { set: int(0, 20) }, { value: int(0, 20), max: int(1, 20) }, {}]) };
        break;
      case 2:
        p.party = { [pick(npcs)]: { gauges: { [pick(gauges)]: int(-3, 3) }, relation: int(-9, 9), notes: pick(["备注一", "", 5]) } };
        break;
      case 3:
        p.funds = pick([int(-5, 10), { delta: int(-4, 4) }, { set: int(0, 30) }, "x"]);
        break;
      case 4:
        p[pick(["xp", "xp_total"])] = pick([int(-2, 6), { delta: int(-3, 3) }, { set: int(0, 20) }]);
        break;
      case 5:
        p[pick(["location", "period"])] = pick(["旧码头", "小学·王主任教研室", "不存在", 2, true, 0]);
        break;
      case 6:
        p.day = pick([int(-2, 6), { delta: int(-3, 3) }, { set: int(0, 9) }]);
        break;
      case 7:
        p.time_advance = int(-1, 7);
        break;
      case 8:
        p[pick(["add_status", "remove_status"])] = pick([pick(texts), [pick(texts), pick(texts)], "", 42]);
        break;
      case 9:
        p.items = [{ name: pick(items), [pick(["delta", "set"])]: int(-2, 4), slots: int(0, 3), note: pick(["注", ""]) }];
        break;
      case 10:
        if (rnd() < 0.5) {
          p.relations = [{ npc: pick(npcs), [pick(["delta", "set"])]: int(-8, 8), note: pick(["记", ""]) }];
        } else {
          p.clocks = [{ name: pick(["崩溃钟", "新钟", "不存在"]), advance: int(-1, 8), create: { max: int(0, 9), consequence: pick(["后果", ""]) } }];
        }
        break;
      default:
        p[pick(["clues_add", "clues_done", "events", "log", "pending_event"])] = pick([
          "线索甲", [0, 1, "线索甲"], { code: "S-01", name: "巨蝇登门" }, { name: "只有名字" }, { a: 1 }, "", 7, true, null,
        ]);
        break;
    }
    patches.push(p);
  }

  const ops = [];
  for (let i = 0; i < 250; i += 1) {
    const op = { op: pick(["set_gauge", "set_attr", "set_skill", "set_funds", "set_xp", "add_item", "remove_item", "set_item_qty", "set_relation", "set_clock", "add_clock", "remove_clock", "add_clue", "toggle_clue", "remove_clue", "add_status", "remove_status", "add_trait", "remove_trait", "set_location", "set_time", "spend_xp", "未知op"]) };
    const r = rnd();
    if (op.op === "set_gauge") Object.assign(op, { name: pick(gauges), value: r < 0.6 ? int(-3, 15) : undefined, max: int(1, 30) });
    else if (op.op === "set_attr") Object.assign(op, { name: pick(attrs), value: int(-1, 8) });
    else if (op.op === "set_skill") Object.assign(op, { name: pick(skills), value: int(-1, 5) });
    else if (op.op === "set_funds") op.value = int(-3, 40);
    else if (op.op === "set_xp") op.value = int(-3, 60);
    else if (op.op === "add_item") Object.assign(op, { name: pick(items), qty: int(0, 4), slots: int(0, 3), note: pick(["注", ""]) });
    else if (op.op === "remove_item" || op.op === "set_item_qty") Object.assign(op, { name: pick(items), qty: int(-1, 3) });
    else if (op.op === "set_relation") Object.assign(op, { npc: pick(npcs), value: int(-9, 9), note: pick(["记", ""]) });
    else if (op.op === "set_clock") Object.assign(op, { name: pick(["崩溃钟", "新钟"]), value: int(-1, 9), max: int(0, 9), consequence: pick(["后果", ""]) });
    else if (op.op === "add_clock") Object.assign(op, { name: pick(["崩溃钟", "新钟"]), max: int(0, 9), consequence: pick(["后果", ""]) });
    else if (op.op === "remove_clock") op.name = pick(["崩溃钟", "新钟", "不存在"]);
    else if (op.op === "add_clue" || op.op === "toggle_clue" || op.op === "remove_clue") op[pick(["text", "index", "name"])] = pick(["线索甲", "线索乙", 0, 1, "不存在"]);
    else if (op.op === "add_status" || op.op === "remove_status" || op.op === "add_trait" || op.op === "remove_trait") op[pick(["text", "name"])] = pick(texts);
    else if (op.op === "set_location") op.name = pick(["旧码头", "租屋", "不存在"]);
    else if (op.op === "set_time") Object.assign(op, { day: int(-1, 6), period: pick(periods) });
    else if (op.op === "spend_xp") Object.assign(op, { kind: pick(["skill", "attr", "trait", "nope"]), name: pick([...skills, ...attrs, ...texts]), to: int(-1, 6), level: int(0, 4) });
    ops.push(op);
  }
  return { patches, ops };
}

const FUZZ = buildFuzz();

const FIXTURE = {
  modules: MODULES,
  newGameCases: [
    { module: "gangcheng", slot: 1, character: null },
    { module: "gangcheng", slot: 3, character: "老魏" },
    { module: "gangcheng", slot: 1, character: "张三" },
    { module: "lvmao-yinqi-diyu", slot: 1, character: null },
    { module: "lvmao-yinqi-diyu", slot: 2, character: "温稚宁" },
    { module: "lvmao-yinqi-diyu", slot: 3, character: "江蘅" },
    { module: "lvmao-yinqi-diyu", slot: 1, character: "不存在的角色" },
  ],
  patchCases: [
    { id: "lvmao", module: "lvmao-yinqi-diyu", character: "沈亦舟", patches: PATCHES_LVMAO },
    { id: "gangcheng", module: "gangcheng", character: "老魏", patches: PATCHES_GANGCHENG },
    { id: "tricky", module: "gangcheng", character: "老魏", patches: PATCHES_TRICKY },
    { id: "nonDict", module: "gangcheng", character: null, patches: [null, "不是对象", 42] },
  ],
  editCases: [
    { id: "lvmao", module: "lvmao-yinqi-diyu", character: "沈亦舟", ops: OPS_LVMAO },
    { id: "gangcheng", module: "gangcheng", character: null, ops: OPS_GANGCHENG },
    { id: "nonDict", module: "gangcheng", character: null, ops: [null, "字符串", 42] },
  ],
  normalizeCases: [
    {
      id: "messy",
      state: {
        module: "gangcheng",
        slot: "2",
        day: "3",
        period_index: 99,
        periods: [],
        location: 5,
        character: {
          name: 7,
          defense: "x",
          gauges: { 生命: { value: "8", max: "11" } },
          traits: "不是数组",
          statuses: null,
          xp: -5,
        },
        party: { 阿澄: "不是对象", 老魏: { gauges: { 生命: { value: "3", max: "7" } }, relation: 9, notes: 5 } },
        inventory: [{ name: "刀", qty: "2" }, { name: "", qty: 1 }, "垃圾", { qty: 1 }],
        funds: -20,
        relations: [{ npc: "老魏", value: "9" }, { npc: "", value: 1 }, 42],
        clocks: [{ name: "钟", value: 9, max: 0 }, { name: "", max: 3 }],
        events_fired: [{ code: 5, name: null, day: "x" }, "坏"],
        clues: [{ text: "线索", done: 1 }, { done: true }],
        log: [{ day: "2", period: 5, type: null, text: "记录" }, { text: "" }, "坏"],
        pending_event: { code: "X" },
      },
      patch: { hp: -2, add_status: "被通缉", clues_add: "补记", period: "午", funds: 5 },
    },
    {
      id: "empty",
      state: {},
      patch: { hp: 1, add_status: "测试", period: "晨", day: { delta: 1 } },
    },
    {
      id: "weird",
      state: {
        version: 0,
        slot: "abc",
        periods: ["晨", 5],
        period_index: -3,
        character: [],
        inventory: {},
        relations: "x",
        clocks: null,
        events_fired: {},
        clues: "x",
        log: 5,
      },
      patch: { gauges: { 新表: { delta: 2 } }, period: "晨", day: { delta: 1 } },
    },
  ],
  slotPaths: [
    ["gangcheng", 1], ["gangcheng", 3], ["a/b:c*?\"<>|", 2], ["", 1], ["  spaced  ", 3], ["gangcheng", "abc"],
  ],
  slotPathErrors: [["gangcheng", 0], ["gangcheng", 4]],
  slotInfoModules: ["parity-tmp", "gangcheng"],
  dice: { eventCases: EVENT_CASES },
  fuzz: FUZZ,
  tempModule: "parity-tmp",
};

// ---------------------------------------------------------------------------
// Python 参照驱动（读取 stdin 的 fixture，输出 UTF-8 JSON）
// ---------------------------------------------------------------------------

const PY_DRIVER = String.raw`
import json, sys
sys.path.insert(0, sys.argv[1])
from web.engine import dice, module_loader
from web.engine import state as st

fixture = json.loads(sys.stdin.buffer.read().decode("utf-8"))
out = {}
temp_module = fixture["tempModule"]

out["module_list"] = module_loader.list_modules()
out["modules"] = {name: module_loader.load_module(name) for name in fixture["modules"]}

new_games = {}
for case in fixture["newGameCases"]:
    key = "%s#%s#%s" % (case["module"], case["slot"], case.get("character") or "")
    new_games[key] = st.new_game(case["module"], case["slot"], case.get("character"))
out["new_games"] = new_games

patch_runs = {}
for case in fixture["patchCases"]:
    s = st.new_game(case["module"], 1, case.get("character"))
    changes = [st.apply_patch(s, patch) for patch in case["patches"]]
    patch_runs[case["id"]] = {"changes": changes, "state": s, "summary": st.state_summary(s)}
out["patch_runs"] = patch_runs

edit_runs = {}
for case in fixture["editCases"]:
    s = st.new_game(case["module"], 1, case.get("character"))
    results = []
    for op in case["ops"]:
        ok, msg = st.apply_edit(s, op)
        results.append([ok, msg])
    edit_runs[case["id"]] = {"results": results, "state": s, "summary": st.state_summary(s)}
out["edit_runs"] = edit_runs

normalize_runs = {}
for case in fixture["normalizeCases"]:
    before = st.normalize(case["state"])
    after = st.normalize(before)
    changes = st.apply_patch(after, case["patch"])
    normalize_runs[case["id"]] = {"before": before, "after": after, "changes": changes, "summary": st.state_summary(after)}
out["normalize_runs"] = normalize_runs

# --- fuzz：同一份伪随机序列 ---
fz = st.new_game("lvmao-yinqi-diyu", 1, "沈亦舟")
fuzz_patch_changes = [st.apply_patch(fz, patch) for patch in fixture["fuzz"]["patches"]]
fuzz_edit_results = []
for op in fixture["fuzz"]["ops"]:
    ok, msg = st.apply_edit(fz, op)
    fuzz_edit_results.append([ok, msg])
out["fuzz_run"] = {
    "patch_changes": fuzz_patch_changes,
    "edit_results": fuzz_edit_results,
    "state": fz,
    "summary": st.state_summary(fz),
}

# --- dice 全表 ---
def roll_selfcheck():
    ok = True
    for _ in range(300):
        r = dice.roll_check(3, 2, 9, 7, True, True, True)
        ok = ok and len(r["dice"]) == 2 and r["mode"] == "普通"
        ok = ok and r["modifier"] == 3 and r["modifier_raw"] == 7 and r["modifier_clamped"] is True
        ok = ok and r["total"] == sum(r["kept"]) + r["attr"] + r["skill"] + r["modifier"] + 2
        ok = ok and r["base"] == sum(r["kept"]) and r["bonus"] == r["total"] - r["base"]
        ok = ok and r["energy_cost"] == 1 and r["exertion"] is True
        ok = ok and r["tier"] == dice.tier_for(r["kept"], r["total"], r["difficulty"])
        ok = ok and r["tier_index"] == dice.TIERS.index(r["tier"])
        ok = ok and r["success"] == (r["tier"] in ("大成功", "成功", "代价成功"))
        ok = ok and r["difficulty_name"] == dice.DIFFICULTY_NAMES.get(r["difficulty"], str(r["difficulty"]))
        r2 = dice.roll_check(2, 1, 9, 0, False, True)
        ok = ok and len(r2["dice"]) == 3 and r2["mode"] == "劣势" and r2["kept"] == sorted(r2["dice"])[:2]
        r3 = dice.reroll_die(r, 0)
        ok = ok and r3["rerolled"] == 0 and r3["energy_cost"] == r["energy_cost"] + 2
        ok = ok and 1 <= r3["dice"][0] <= 6 and r3["total"] == sum(r3["kept"]) + r3["bonus"]
        r4 = dice.roll_opposed(2, 1, 3, 2, 5, -5, False, False, True, False, "cost")
        ok = ok and r4["attacker"]["modifier"] == 3 and r4["defender"]["modifier"] == -3
        ok = ok and r4["margin"] == abs(r4["attacker"]["total"] - r4["defender"]["total"])
        ok = ok and r4["tie"] == (r4["attacker"]["total"] == r4["defender"]["total"])
        ok = ok and (r4["winner"] in ("attacker", "defender"))
        d = dice.d66()
        ok = ok and 11 <= d <= 66 and (d % 10) in range(1, 7) and (d // 10) in range(1, 7)
    try:
        dice.reroll_die({"dice": [3, 4]}, 5)
        ok = False
    except ValueError:
        pass
    return ok

def event_rate_ok():
    def rate(danger, night, extra, n=600):
        return sum(1 for _ in range(n) if dice.event_triggered(danger, night, extra))
    high = rate(5, False, 0)
    high_clamped = rate(9, True, 3)
    low = rate(1, False, 0)
    zero = rate(0, False, 0)
    return 400 <= high <= 600 and 400 <= high_clamped <= 600 and 0 <= low <= 250 and zero == 0

tiers = []
for i in range(1, 7):
    for j in range(1, 7):
        for total in range(0, 41):
            for diff in range(0, 21):
                tiers.append(dice.TIERS.index(dice.tier_for([i, j], total, diff)))
out["dice"] = {
    "tier_indices": tiers,
    "tier_samples": [
        [list(kept), total, diff, dice.tier_for(kept, total, diff)]
        for kept in ([1, 1], [1, 2], [2, 1], [6, 6], [6, 5], [5, 6], [1, 6], [3, 4], [2, 2], [4, 4], [5, 5])
        for total in (0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 30)
        for diff in (0, 7, 9, 11, 13, 15, 20)
    ],
    "clamps": [[v, dice.clamp_modifier(v)] for v in range(-10, 11)],
    "clamp_caps": [[v, dice.clamp_modifier(v, cap)] for v in (-5, -3, 0, 3, 5, 99) for cap in (1, 3, 5)],
    "passive": [[a, s, dice.passive_value(a, s)] for a in range(0, 7) for s in range(0, 5)],
    "event": [[d, n, e, dice.event_triggered(d, n, e)] for d, n, e in fixture["dice"]["eventCases"]],
    "event_rates": event_rate_ok(),
    "roll_selfcheck": roll_selfcheck(),
}

# --- 存档互读 ---
node_save_path = st.slot_path(temp_module, 1)
out["node_save_exists"] = node_save_path.exists()
if node_save_path.exists():
    out["node_save_loaded"] = st.load(temp_module, 1)

py_state = st.new_game("gangcheng", 1)
py_state["module"] = temp_module
py_state["title"] = "parity-python"
py_state["location"] = "旧码头"
st.apply_patch(py_state, {"hp": -1, "clues_add": "跨实现互读", "funds": 3})
saved = st.save(py_state, 2)
out["py_save_path"] = str(saved)
out["py_save_state"] = st.load(temp_module, 2)
def norm_slot_info(items):
    out_items = []
    for info in items:
        info = dict(info)
        if "error" in info:
            info["error"] = "<ERROR>"
        out_items.append(info)
    return out_items

out["slot_info"] = {m: norm_slot_info(st.slot_info(m)) for m in fixture["slotInfoModules"]}
out["slot_paths"] = [str(st.slot_path(m, s)) for m, s in fixture["slotPaths"]]

errors = []
for m, s in fixture["slotPathErrors"]:
    try:
        st.slot_path(m, s)
        errors.append("")
    except ValueError as e:
        errors.append("ValueError:" + str(e))
out["slot_path_errors"] = errors

def err_name(fn):
    try:
        fn()
        return ""
    except Exception as e:
        return type(e).__name__

out["load_errors"] = {
    "missing": err_name(lambda: st.load("no-such-module-parity", 1)),
    "corrupt": err_name(lambda: st.load(temp_module, 3)),
    "bad_slot": err_name(lambda: st.load(temp_module, 0)),
}

sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False).encode("utf-8"))
`;

// ---------------------------------------------------------------------------
// Node 侧执行同一份 fixture
// ---------------------------------------------------------------------------

function computeNodeSide() {
  const out = {};
  out.module_list = ml.listModules();
  out.modules = Object.fromEntries(MODULES.map((name) => [name, ml.loadModule(name)]));

  const newGames = {};
  for (const c of FIXTURE.newGameCases) {
    const key = `${c.module}#${c.slot}#${c.character || ""}`;
    newGames[key] = state.newGame(c.module, c.slot, c.character);
  }
  out.new_games = newGames;

  const patchRuns = {};
  for (const c of FIXTURE.patchCases) {
    const s = state.newGame(c.module, 1, c.character);
    const changes = c.patches.map((patch) => state.applyPatch(s, patch));
    patchRuns[c.id] = { changes, state: s, summary: state.stateSummary(s) };
  }
  out.patch_runs = patchRuns;

  const editRuns = {};
  for (const c of FIXTURE.editCases) {
    const s = state.newGame(c.module, 1, c.character);
    const results = c.ops.map((op) => state.applyEdit(s, op));
    editRuns[c.id] = { results, state: s, summary: state.stateSummary(s) };
  }
  out.edit_runs = editRuns;

  const normalizeRuns = {};
  for (const c of FIXTURE.normalizeCases) {
    const before = state.normalize(c.state);
    const after = state.normalize(before);
    const changes = state.applyPatch(after, c.patch);
    normalizeRuns[c.id] = { before, after, changes, summary: state.stateSummary(after) };
  }
  out.normalize_runs = normalizeRuns;

  const fz = state.newGame("lvmao-yinqi-diyu", 1, "沈亦舟");
  const fuzzPatchChanges = FIXTURE.fuzz.patches.map((patch) => state.applyPatch(fz, patch));
  const fuzzEditResults = FIXTURE.fuzz.ops.map((op) => state.applyEdit(fz, op));
  out.fuzz_run = {
    patch_changes: fuzzPatchChanges,
    edit_results: fuzzEditResults,
    state: fz,
    summary: state.stateSummary(fz),
  };

  out.dice = {
    tier_indices: nodeTierIndices(),
    tier_samples: nodeTierSamples(),
    clamps: range(-10, 10).map((v) => [v, dice.clampModifier(v)]),
    clamp_caps: [-5, -3, 0, 3, 5, 99].flatMap((v) => [1, 3, 5].map((cap) => [v, dice.clampModifier(v, cap)])),
    passive: range(0, 6).flatMap((a) => range(0, 4).map((s) => [a, s, dice.passiveValue(a, s)])),
    event: EVENT_CASES.map(([d, n, e]) => [d, n, e, dice.eventTriggered(d, n, e)]),
    event_rates: nodeEventRateOk(),
    roll_selfcheck: nodeRollSelfcheck(),
  };

  out.slot_paths = FIXTURE.slotPaths.map(([m, s]) => state.slotPath(m, s));
  out.slot_path_errors = FIXTURE.slotPathErrors.map(([m, s]) => {
    try {
      state.slotPath(m, s);
      return "";
    } catch (e) {
      return `${e.name}:${e.message}`;
    }
  });

  return out;
}

function range(lo, hi) {
  const out = [];
  for (let i = lo; i <= hi; i += 1) out.push(i);
  return out;
}

function nodeTierIndices() {
  const out = [];
  for (let i = 1; i <= 6; i += 1) {
    for (let j = 1; j <= 6; j += 1) {
      for (let total = 0; total <= 40; total += 1) {
        for (let diff = 0; diff <= 20; diff += 1) out.push(dice.TIERS.indexOf(dice.tierFor([i, j], total, diff)));
      }
    }
  }
  return out;
}

function nodeTierSamples() {
  const out = [];
  for (const kept of [[1, 1], [1, 2], [2, 1], [6, 6], [6, 5], [5, 6], [1, 6], [3, 4], [2, 2], [4, 4], [5, 5]]) {
    for (const total of [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 30]) {
      for (const diff of [0, 7, 9, 11, 13, 15, 20]) out.push([[...kept], total, diff, dice.tierFor(kept, total, diff)]);
    }
  }
  return out;
}

function nodeEventRateOk() {
  const rate = (danger, night, extra, n = 600) => {
    let count = 0;
    for (let i = 0; i < n; i += 1) if (dice.eventTriggered(danger, night, extra)) count += 1;
    return count;
  };
  const high = rate(5, false, 0);
  const highClamped = rate(9, true, 3);
  const low = rate(1, false, 0);
  const zero = rate(0, false, 0);
  return high >= 400 && high <= 600 && highClamped >= 400 && highClamped <= 600 && low >= 0 && low <= 250 && zero === 0;
}

function nodeRollSelfcheck() {
  let ok = true;
  for (let n = 0; n < 300; n += 1) {
    const r = dice.rollCheck(3, 2, 9, 7, true, true, true);
    ok = ok && r.dice.length === 2 && r.mode === "普通";
    ok = ok && r.modifier === 3 && r.modifier_raw === 7 && r.modifier_clamped === true;
    ok = ok && r.total === sum(r.kept) + r.attr + r.skill + r.modifier + 2;
    ok = ok && r.base === sum(r.kept) && r.bonus === r.total - r.base;
    ok = ok && r.energy_cost === 1 && r.exertion === true;
    ok = ok && r.tier === dice.tierFor(r.kept, r.total, r.difficulty);
    ok = ok && r.tier_index === dice.TIERS.indexOf(r.tier);
    ok = ok && r.success === ["大成功", "成功", "代价成功"].includes(r.tier);
    ok = ok && r.difficulty_name === (dice.DIFFICULTY_NAMES[r.difficulty] ?? String(r.difficulty));
    const r2 = dice.rollCheck(2, 1, 9, 0, false, true);
    ok = ok && r2.dice.length === 3 && r2.mode === "劣势" && arraysEqual(r2.kept, [...r2.dice].sort((a, b) => a - b).slice(0, 2));
    const r3 = dice.rerollDie(r, 0);
    ok = ok && r3.rerolled === 0 && r3.energy_cost === r.energy_cost + 2;
    ok = ok && r3.dice[0] >= 1 && r3.dice[0] <= 6 && r3.total === sum(r3.kept) + r3.bonus;
    const r4 = dice.rollOpposed(2, 1, 3, 2, 5, -5, false, false, true, false, "cost");
    ok = ok && r4.attacker.modifier === 3 && r4.defender.modifier === -3;
    ok = ok && r4.margin === Math.abs(r4.attacker.total - r4.defender.total);
    ok = ok && r4.tie === (r4.attacker.total === r4.defender.total);
    ok = ok && (r4.winner === "attacker" || r4.winner === "defender");
    const d = dice.d66();
    ok = ok && d >= 11 && d <= 66 && d % 10 >= 1 && d % 10 <= 6 && Math.floor(d / 10) >= 1 && Math.floor(d / 10) <= 6;
  }
  try {
    dice.rerollDie({ dice: [3, 4] }, 5);
    ok = false;
  } catch (e) {
    ok = ok && e.name === "ValueError";
  }
  return ok;
}

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------
// 比较与报告
// ---------------------------------------------------------------------------

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ROOT_RE = new RegExp(REPO_ROOT.split(/[\\/]+/).map(escapeRegex).join("[\\\\/]+"), "gi");

function normalizeValue(v) {
  if (typeof v === "string") return v.replace(ROOT_RE, "<ROOT>");
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = normalizeValue(val);
    return out;
  }
  return v;
}

function typeName(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function preview(v) {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

function collectDiffs(a, b, at, out) {
  if (out.length >= MAX_DIFFS) return;
  if (a === b) return;
  const ta = typeName(a);
  const tb = typeName(b);
  if (ta !== tb) {
    out.push(`${at}: Python=${ta} ${preview(a)} ≠ Node=${tb} ${preview(b)}`);
    return;
  }
  if (ta === "array") {
    if (a.length !== b.length) out.push(`${at}: 数组长度 ${a.length} ≠ ${b.length}`);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n && out.length < MAX_DIFFS; i += 1) collectDiffs(a[i], b[i], `${at}[${i}]`, out);
    return;
  }
  if (ta === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (out.length >= MAX_DIFFS) return;
      if (!(k in a)) out.push(`${at}.${k}: Node 多出字段 ${preview(b[k])}`);
      else if (!(k in b)) out.push(`${at}.${k}: Node 缺少字段（Python=${preview(a[k])}）`);
      else collectDiffs(a[k], b[k], `${at}.${k}`, out);
    }
    return;
  }
  out.push(`${at}: Python=${preview(a)} ≠ Node=${preview(b)}`);
}

const results = [];
function check(name, pyValue, nodeValue, note = "") {
  const diffs = [];
  collectDiffs(normalizeValue(pyValue), normalizeValue(nodeValue), name, diffs);
  results.push({ name, ok: diffs.length === 0, note, diffs });
}

function checkTrue(name, ok, note = "") {
  results.push({ name, ok: Boolean(ok), note, diffs: ok ? [] : [`${name}: 断言失败`] });
}

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(path.join(PY_ENGINE_DIR, "state.py"))) {
  fail(`找不到 Python 参照实现：${PY_ENGINE_DIR}`);
}

const tempDir = path.join(state.SAVE_ROOT, FIXTURE.tempModule);
fs.rmSync(tempDir, { recursive: true, force: true });

const node = computeNodeSide();

// 1) Node 先写自己的存档（供 Python 读取）
const nodeSaveState = state.newGame("lvmao-yinqi-diyu", 2, "温稚宁");
nodeSaveState.module = FIXTURE.tempModule;
nodeSaveState.title = "parity-node";
nodeSaveState.location = "暗网（虚拟地图）";
state.applyPatch(nodeSaveState, { gauges: { 淫度: { delta: 12 } }, clues_add: "由 Node 写入" });
const nodeSavePath = state.save(nodeSaveState, 1);
const nodeSaveFileContent = JSON.parse(fs.readFileSync(nodeSavePath, "utf8"));
const expectedFileContent = JSON.parse(JSON.stringify(nodeSaveState));

// 2) 写一份损坏 JSON（两边都应报 ValueError）
fs.writeFileSync(path.join(tempDir, "slot3.json"), "{ 不是合法 JSON", "utf8");

// 3) 跑 Python 参照
const pyRun = spawnSync(PYTHON, ["-c", PY_DRIVER, REPO_ROOT], {
  input: JSON.stringify(FIXTURE),
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
});
if (pyRun.error) fail(`无法运行 Python（${PYTHON}）：${pyRun.error.message}`);
if (pyRun.status !== 0) {
  fail(`Python 参照实现退出码 ${pyRun.status}\n--- stderr ---\n${pyRun.stderr}\n--- stdout ---\n${(pyRun.stdout || "").slice(0, 4000)}`);
}
let py;
try {
  py = JSON.parse(pyRun.stdout);
} catch (e) {
  fail(`Python 输出不是合法 JSON：${e.message}\n${(pyRun.stdout || "").slice(0, 2000)}`);
}

// 4) 逐节比较
check("module_list", py.module_list, node.module_list, "list_modules 全字段");
check("modules", py.modules, node.modules, "两个真实本 load_module 全字段（含 raw/warnings）");
check("new_games", py.new_games, node.new_games, "new_game 初始状态");
check("patch_runs", py.patch_runs, node.patch_runs, "applyPatch 全键序列：变更说明 + 状态 + 摘要");
check("edit_runs", py.edit_runs, node.edit_runs, "applyEdit 22 个 op 序列：结果 + 状态 + 摘要");
check("normalize_runs", py.normalize_runs, node.normalize_runs, "normalize 清洗分支 + 清洗后再打补丁");
check("fuzz_run", py.fuzz_run, node.fuzz_run, "伪随机 fuzz：150 patch + 250 edit 序列（结果 + 状态 + 摘要）");
check("dice.tier_indices", py.dice.tier_indices, node.dice.tier_indices, "四档穷举 kept(36)×total(41)×difficulty(21)");
check("dice.tier_samples", py.dice.tier_samples, node.dice.tier_samples, "四档边界样本");
check("dice.clamps", py.dice.clamps, node.dice.clamps, "clamp_modifier ±10 全表");
check("dice.clamp_caps", py.dice.clamp_caps, node.dice.clamp_caps, "clamp_modifier 自定义 cap");
check("dice.passive", py.dice.passive, node.dice.passive, "passive_value 全表");
check("dice.event", py.dice.event, node.dice.event, "event_triggered 确定性边界（危险度≤0 不判定）");
check("dice.event_rates", py.dice.event_rates, node.dice.event_rates, "event_triggered 概率行为（危险度 5 必判、夜间+1、封顶 5）");
check("dice.roll_selfcheck", py.dice.roll_selfcheck, node.dice.roll_selfcheck, "rollCheck/rerollDie/rollOpposed 行为自检");

check("slot_paths", py.slot_paths, node.slot_paths, "slot_path（含非法字符/空名/数字字符串）");
check("slot_path_errors", py.slot_path_errors, node.slot_path_errors, "槽位越界 ValueError 文案");

// save→load 往返 + 跨实现互读
checkTrue("node_save_file_content", JSON.stringify(nodeSaveFileContent) === JSON.stringify(expectedFileContent), "Node 写出的文件内容 = 预期 JSON");
checkTrue("python_saw_node_save", py.node_save_exists === true, "Python 能发现 Node 写的存档");
check("node_save_loaded_by_python", py.node_save_loaded, state.load(FIXTURE.tempModule, 1), "Python 读 Node 存档 = Node 读自己的存档");
check("py_save_loaded_by_node", state.load(FIXTURE.tempModule, 2), py.py_save_state, "Node 读 Python 存档 = Python 读自己的存档");
const jsRoundtrip = state.load(FIXTURE.tempModule, 1);
check("node_roundtrip", jsRoundtrip, state.normalize(JSON.parse(JSON.stringify(nodeSaveState))), "Node save→load 往返一致");
check("slot_info", py.slot_info, {
  [FIXTURE.tempModule]: normSlotInfo(state.slotInfo(FIXTURE.tempModule)),
  gangcheng: normSlotInfo(state.slotInfo("gangcheng")),
}, "slot_info（含更新时间）");
check("load_errors", py.load_errors, {
  missing: nodeErrName(() => state.load("no-such-module-parity", 1)),
  corrupt: nodeErrName(() => state.load(FIXTURE.tempModule, 3)),
  bad_slot: nodeErrName(() => state.load(FIXTURE.tempModule, 0)),
}, "缺失/损坏/越界存档的错误类型名");

// 覆盖度自检：保证上面的深比较不是拿空数据在比
const gg = py.modules.gangcheng;
const lm = py.modules["lvmao-yinqi-diyu"];
checkTrue(
  "coverage_sanity",
  gg.locations.length >= 3 && gg.routes.length >= 2 && gg.characters.length >= 2 && gg.events.length >= 2
    && gg.rules_text.length > 1000 && gg.periods.length === 4
    && gg.routes.some((r) => r.code !== null) && gg.opening.player === "阿澄"
    && lm.locations.length >= 10 && lm.routes.length >= 8 && lm.characters.length >= 10 && lm.events.length >= 50
    && lm.gauge_defs.length >= 5 && lm.periods.length === 6
    && lm.events.some((e) => e.special) && lm.routes.some((r) => r.time_slots !== null)
    && lm.player_name === "沈亦舟"
    && py.dice.tier_indices.length === 36 * 41 * 21
    && py.patch_runs.lvmao.changes.length === PATCHES_LVMAO.length
    && py.patch_runs.lvmao.changes.every((c) => c.length > 0)
    && py.edit_runs.lvmao.results.length === OPS_LVMAO.length
    && py.normalize_runs.messy.before.periods.length === 4
    && py.normalize_runs.messy.before.relations.length === 1
    && py.normalize_runs.messy.before.clocks.length === 1,
  "fixture 覆盖两个真实本全部结构且数据非空",
);

// fuzz 覆盖度：确认伪随机序列真的打到了大量分支
const fuzzStats = {
  editsOk: py.fuzz_run.edit_results.filter(([ok]) => ok).length,
  editMsgs: new Set(py.fuzz_run.edit_results.map(([, m]) => m)).size,
  patchMsgs: new Set(py.fuzz_run.patch_changes.flat()).size,
  patchTotal: py.fuzz_run.patch_changes.flat().length,
};
checkTrue(
  "fuzz_coverage",
  fuzzStats.editsOk >= 80 && fuzzStats.editMsgs >= 50 && fuzzStats.patchMsgs >= 100 && fuzzStats.patchTotal >= 150,
  `fuzz 分支覆盖：${fuzzStats.editsOk} 次成功编辑 / ${fuzzStats.editMsgs} 种编辑结果 / ${fuzzStats.patchMsgs} 种补丁说明 / 共 ${fuzzStats.patchTotal} 条补丁说明`,
);

function nodeErrName(fn) {
  try {
    fn();
    return "";
  } catch (e) {
    return e.name;
  }
}

function normSlotInfo(items) {
  return items.map((info) => {
    const out = { ...info };
    if ("error" in out) out.error = "<ERROR>";
    return out;
  });
}

// 5) 清理临时存档
fs.rmSync(tempDir, { recursive: true, force: true });

// 6) 报告
console.log("RPG Node 引擎 parity 验证（对照 web/engine/*.py）");
console.log(`Python: ${PYTHON}   Node: ${process.version}`);
let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  ✔ ${r.name}${r.note ? ` — ${r.note}` : ""}`);
  } else {
    failed += 1;
    console.log(`  ✘ ${r.name}${r.note ? ` — ${r.note}` : ""}`);
    for (const d of r.diffs) console.log(`      ${d}`);
  }
}
const total = results.length;
console.log(failed === 0 ? `全绿：${total}/${total} 项通过` : `失败：${failed}/${total} 项不一致`);
process.exit(failed === 0 ? 0 : 1);

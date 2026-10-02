import test from "node:test";
import assert from "node:assert/strict";
import { newGame, applyEdit, currentPeriod } from "./state.js";
import { checkEffects, applyCheckEffects, upgradeCost } from "./rules.js";
import { rerollDie, tierFor } from "./dice.js";
import { loadModule } from "./moduleLoader.js";
import { normalizeData, rollForRequest, rollEvent, settleTurn, runTurn, GMClient, buildMessages, echoReply, parseReply } from "../gm.js";
import { doMove } from "../routes/game.js";

const module = loadModule("gangcheng");
const config = { api_key: "", kimi_oauth: { enabled: false } };

test("跳级与分次升级费用一致，经验不足时不扣款不改卡", () => {
  assert.equal(upgradeCost(0, 3, 3), 18);
  assert.equal(upgradeCost(2, 4, 5), 35);
  for (const unit of [3, 5]) for (let from = 0; from < 5; from += 1) {
    for (let to = from + 1; to <= 5; to += 1) {
      let cost = 0;
      for (let level = from + 1; level <= to; level += 1) cost += level * unit;
      assert.equal(upgradeCost(from, to, unit), cost);
    }
  }
  const state = newGame("gangcheng");
  state.character.xp = 17;
  const before = structuredClone(state.character);
  assert.equal(applyEdit(state, { op: "spend_xp", kind: "skill", name: "射击", to: 3 })[0], false);
  assert.deepEqual(state.character, before);
  state.character.xp = 18;
  assert.equal(applyEdit(state, { op: "spend_xp", kind: "skill", name: "射击", to: 3 })[0], true);
  assert.equal(state.character.xp, 0);
});

test("成长和直接编辑同步派生数值，保留自定义上限，不免费治疗", () => {
  const state = newGame("gangcheng"), ch = state.character;
  ch.gauges.生命 = { value: 5, max: 11 }; // 体魄 2，已有额外 +3。
  ch.xp = 100;
  const capacity = ch.capacity;
  assert.equal(applyEdit(state, { op: "spend_xp", kind: "attr", name: "体魄", to: 4 })[0], true);
  assert.equal(ch.xp, 65);
  assert.deepEqual(ch.gauges.生命, { value: 5, max: 15 });
  assert.equal(ch.capacity, capacity + 2);
  const energy = structuredClone(ch.gauges.精力), resolve = structuredClone(ch.gauges.决心);
  applyEdit(state, { op: "set_attr", name: "意志", value: 4 });
  assert.equal(ch.gauges.精力.max, energy.max + 2);
  assert.equal(ch.gauges.精力.value, energy.value);
  assert.equal(ch.gauges.决心.max, resolve.max + 4);
  const defense = ch.defense;
  applyEdit(state, { op: "set_attr", name: "敏捷", value: 4 });
  applyEdit(state, { op: "set_skill", name: "运动", value: 3 });
  assert.equal(ch.defense, defense + 3);
  applyEdit(state, { op: "set_attr", name: "体魄", value: 1 });
  assert.deepEqual(ch.gauges.生命, { value: 5, max: 9 });
});

test("压力只取最高档，冷静延迟两点，受伤以治疗后的生命为准", () => {
  const ch = newGame("gangcheng").character;
  ch.gauges.压力.value = 5;
  assert.equal(checkEffects(ch, "魅力").modifier, -1);
  assert.equal(checkEffects(ch, "敏捷").modifier, 0);
  ch.gauges.压力.value = 8;
  assert.deepEqual(checkEffects(ch, "魅力").modifiers, [{ source: "濒临极限", value: -1 }]);
  ch.gauges.生命.value = 4;
  assert.equal(checkEffects(ch, "敏捷").modifier, -2);
  ch.statuses = ["受伤"];
  ch.gauges.生命.value = 5;
  assert.equal(checkEffects(ch, "敏捷").modifier, -1);
  ch.traits = ["冷静：惩罚推迟两点"];
  ch.gauges.压力.value = 6;
  assert.equal(checkEffects(ch, "魅力").modifier, 0);
  ch.gauges.压力.value = 7;
  assert.equal(checkEffects(ch, "魅力").modifier, -1);
  ch.gauges.压力.value = 9;
  assert.equal(checkEffects(ch, "敏捷").modifier, 0);
  ch.gauges.压力.value = 10;
  assert.equal(checkEffects(ch, "敏捷").modifier, -1);
});

test("束缚和恐惧只作用于相关行动，多个劣势不叠加，与优势抵消", (t) => {
  const state = newGame("gangcheng");
  state.character.statuses = ["束缚（绳索）", "恐惧"];
  assert.deepEqual(checkEffects(state.character, "智识").disadvantages, []);
  assert.deepEqual(checkEffects(state.character, "智识", true).disadvantages, ["恐惧"]);
  t.mock.method(Math, "random", () => 0.4);
  const check = rollForRequest(state, { attr: "敏捷", skill: "潜行", facing_fear: true });
  assert.equal(check.mode, "劣势");
  assert.equal(check.dice.length, 3);
  assert.deepEqual(check.disadvantage_sources, ["束缚", "恐惧"]);
  assert.equal(rollForRequest(state, { attr: "敏捷", advantage: true }).mode, "普通");
  assert.equal(rollForRequest(state, { attr: "敏捷" }, false).mode, "普通");
});

test("状态惩罚不受情境 ±3 钳制，修改总值后重新分档，重掷保留惩罚", (t) => {
  const state = newGame("gangcheng");
  state.character.gauges.生命.value = 3;
  state.character.gauges.压力.value = 8;
  t.mock.method(Math, "random", () => 0.4); // [3,3]
  const result = rollForRequest(state, { attr: "敏捷", skill: "潜行", modifier: 99, difficulty: 15 });
  assert.equal(result.modifier, 3);
  assert.equal(result.rule_modifier, -2);
  assert.equal(result.bonus, 6);
  assert.equal(result.total, 12);
  assert.equal(result.tier, "失败");
  const rerolled = rerollDie(result, 0);
  assert.equal(rerolled.bonus, 6);
  assert.equal(rerolled.rule_modifier, -2);
  assert.equal(rerolled.tier, tierFor(rerolled.kept, rerolled.total, 15));
  const effects = { modifiers: [{ source: "受伤", value: -1 }], modifier: -1, disadvantages: [] };
  assert.equal(applyCheckEffects({ kept: [1, 1], base: 2, bonus: 30, difficulty: 7 }, effects).tier, "大失败");
  assert.equal(applyCheckEffects({ kept: [6, 6], base: 12, bonus: 0, difficulty: 20 }, effects).tier, "大成功");
});

test("普通难度成功率与规则中的概率说明一致", () => {
  for (const [bonus, clean, any] of [[2, 21, 30], [5, 33, 35]]) {
    let successes = 0, withCost = 0;
    for (let a = 1; a <= 6; a += 1) for (let b = 1; b <= 6; b += 1) {
      const tier = tierFor([a, b], a + b + bonus, 9);
      if (["成功", "大成功"].includes(tier)) successes += 1;
      if (["成功", "大成功", "代价成功"].includes(tier)) withCost += 1;
    }
    assert.equal(successes, clean);
    assert.equal(withCost, any);
  }
});

test("零耗时无事件；长行动按消耗的时段逐个判风险，跨日正确", () => {
  const state = newGame("gangcheng");
  state.period_index = 3;
  const mod = { locations: [{ name: state.location, danger: 2 }] };
  const calls = [];
  const eventRoll = (_, work, danger) => { calls.push([work.day, currentPeriod(work), danger]); return null; };
  assert.equal(settleTurn(mod, state, { action_cost: 0 }, eventRoll).action_cost, 0);
  assert.equal(state.period_index, 3);
  assert.equal(calls.length, 0);
  settleTurn(mod, state, { action_cost: 3, state_patch: { day: 99, period: "午", time_advance: 9 } }, eventRoll);
  assert.deepEqual(calls, [[1, "夜", 3], [2, "晨", 2], [2, "午", 2]]);
  assert.equal(state.day, 2);
  assert.equal(currentPeriod(state), "暮");
});

test("旧协议额外耗时保持兼容，非法耗时不能倒流或无限循环", () => {
  const eventRoll = () => null;
  for (const invalid of [-1, 1.5, "0", true, 99, null, undefined]) {
    assert.equal(normalizeData({ action_cost: invalid }).action_cost, null);
    assert.equal(settleTurn(module, newGame("gangcheng"), { action_cost: invalid }, eventRoll).action_cost, 1);
  }
  assert.equal(normalizeData({ action_cost: 0 }).action_cost, 0);
  assert.equal(settleTurn(module, newGame("gangcheng"), { state_patch: { time_advance: 2 } }, eventRoll).action_cost, 3);
  assert.equal(settleTurn(module, newGame("gangcheng"), { state_patch: { time_advance: 10000 } }, eventRoll).action_cost, 12);
});

test("多次事件抽取按队列保留，不覆盖之前等待演绎的事件", (t) => {
  t.mock.method(Math, "random", () => 0);
  const state = newGame("gangcheng");
  const mod = { events_raw: "本事件表", events: [11, 12, 13].map((code) => ({ code_num: code, name: `事件${code}`, raw: "描述" })) };
  for (let i = 0; i < 3; i += 1) rollEvent(mod, state, 5);
  assert.equal(state.pending_event.code, "11");
  assert.deepEqual(state.pending_events.map((e) => e.code), ["12", "13"]);
  assert.equal(state.events_fired.length, 3);
});

test("赶路的夜间风险取出发时段，事件标记发生当天而非翌日", (t) => {
  t.mock.method(Math, "random", () => 0.5); // d6=4，只有夜间危险度 4 触发。
  const state = newGame("gangcheng");
  state.location = "起点";
  state.period_index = 3;
  const mod = { locations: [{ name: "起点", danger: 3 }, { name: "终点", danger: 0 }],
    routes: [{ from: "起点", to: "终点", danger: 3, time_slots: 1 }] };
  const result = doMove(mod, state, "终点");
  assert.equal(result.events.length, 1);
  assert.equal(state.events_fired[0].day, 1);
  assert.equal(state.day, 2);
  assert.equal(currentPeriod(state), "晨");
  assert.equal(state.location, "终点");
});

test("完整 SSE 回合只结算一次，消费一个待办事件后保留后续事件", async (t) => {
  t.mock.method(GMClient.prototype, "streamChat", async function* () {
    yield `你收起笔记本。\n\`\`\`json\n${JSON.stringify({ dice_request: null, action_cost: 0, state_patch: { funds: 2 }, suggestions: ["继续调查"] })}\n\`\`\``;
  });
  const state = newGame("gangcheng");
  state.pending_event = { code: "11", name: "当前事件" };
  state.pending_events = [{ code: "12", name: "下一个事件" }];
  const before = structuredClone(state);
  const events = [];
  for await (const event of runTurn(module, state, "收起笔记本", config, [], { comfy: false })) events.push(event);
  assert.equal(events.some((e) => e.type === "error"), false);
  const final = events.find((e) => e.type === "state").state;
  assert.equal(final.funds, before.funds + 2);
  assert.equal(final.day, before.day);
  assert.equal(final.period_index, before.period_index);
  assert.equal(final.pending_event.code, "12");
  assert.deepEqual(final.pending_events, []);
  assert.deepEqual(state, before);
  assert.equal(events.at(-1).type, "done");
});

test("判定续写沿用最终耗时，并将自动状态惩罚传给主持模型", async (t) => {
  const state = newGame("gangcheng");
  state.character.gauges.压力.value = 8;
  let calls = 0;
  t.mock.method(Math, "random", () => 0.4);
  t.mock.method(GMClient.prototype, "streamChat", async function* (messages) {
    calls += 1;
    if (calls === 2) assert.match(messages.at(-1).content, /状态来源：濒临极限 -1/);
    const data = calls === 1 ? { dice_request: { attr: "感知", skill: "察觉", difficulty: 11 }, action_cost: 1 }
      : { dice_request: null, action_cost: 1, state_patch: {} };
    yield `你查看门锁。\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;
  });
  const events = [];
  for await (const event of runTurn(module, state, "查看门锁", config, [], { comfy: false })) events.push(event);
  assert.equal(events.some((e) => e.type === "error"), false);
  assert.equal(calls, 2);
  assert.equal(events.filter((e) => e.type === "dice").length, 1);
  assert.equal(events.find((e) => e.type === "state").state.period_index, 1);
  const [messages] = buildMessages(module, state, "查看门锁", config, []);
  assert.match(messages[0].content, /action_cost/);
  assert.match(messages[0].content, /不要重复计入/);
});

test("协议失败不推进时间，也不丢失等待处理的事件", async (t) => {
  t.mock.method(GMClient.prototype, "streamChat", async function* () { yield "仅叙述，没有协议"; });
  const state = newGame("gangcheng");
  state.pending_event = { code: "11", name: "等待处理" };
  const before = structuredClone(state);
  const events = [];
  for await (const event of runTurn(module, state, "调查", config, [], { comfy: false })) events.push(event);
  assert.deepEqual(events.find((e) => e.type === "state").state, before);
});

test("续写漏写耗时时沿用首次宣告的总耗时", async (t) => {
  let calls = 0;
  t.mock.method(GMClient.prototype, "streamChat", async function* () {
    calls += 1;
    const data = calls === 1 ? { dice_request: { attr: "智识", skill: "学识", difficulty: 9 }, action_cost: 2 }
      : { dice_request: null, state_patch: {} };
    yield `你翻查档案。\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;
  });
  const events = [];
  for await (const event of runTurn(module, newGame("gangcheng"), "翻查档案", config, [], { comfy: false })) events.push(event);
  assert.equal(events.some((e) => e.type === "error"), false);
  assert.equal(events.find((e) => e.type === "state").state.period_index, 2);
});

test("本地演示遵守单次代价规则，不会每回合压力 +15 或凭空发钱", () => {
  for (const tier of ["大成功", "成功", "代价成功", "失败", "大失败"]) {
    const [, data] = parseReply(echoReply([{ role: "user", content: `【判定结果】\n档位：${tier}` }]));
    assert.equal(data.action_cost, 1);
    assert.deepEqual(data.state_patch, ["代价成功", "失败", "大失败"].includes(tier) ? { stress: 1 } : {});
  }
});

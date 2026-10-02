import test from "node:test";
import assert from "node:assert/strict";
import api from "./api.js";
import { applyEdit, canSend, clearStream, game, newGame, openSlot, reloadState, selectModule, sendAction, generateImage, abortTurn, loadImageStatus, controlImageRuntime } from "./store.js";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function payload(module = "alpha", slot = 1) {
  return {
    module: { dir: module, title: module, opening: { premise: `${module} 开场` } },
    state: { module, slot, day: 1, log: [{ day: 1, period: "晨", text: `${module} 槽位 ${slot} 的日志` }] },
    map: { locations: [{ name: `${module} 地点` }], routes: [{ from: "A", to: "B" }] },
    characters: [{ name: `${module} NPC` }], events: [{ code: "11", name: `${module} 事件` }], echo: false,
  };
}

test.beforeEach((t) => {
  clearStream();
  Object.assign(game, { module: "alpha", slot: 1, loaded: false, loading: false, busy: false, turnStreaming: false,
    moduleInfo: null, state: null, map: { locations: [], routes: [] }, characters: [], events: [],
    slots: [], suggestions: [], portraitUrl: "", locationImage: {}, lastError: "", toasts: [] });
  // 提示条和打字动画不需要在无界面的测试中等待。
  t.mock.method(globalThis, "setTimeout", () => 0);
  t.mock.method(globalThis, "setInterval", () => 0);
});

test("首次新建回读完整快照，地图、NPC、事件和开场立即可用", async (t) => {
  const calls = [];
  t.mock.method(api, "newGame", async (...args) => { calls.push(args); return { state: payload().state }; });
  t.mock.method(api, "getState", async (module, slot) => payload(module, slot));
  t.mock.method(api, "listSlots", async () => ({ slots: [{ slot: 2, exists: true }] }));
  assert.equal(await newGame({ slot: 2 }), true);
  assert.deepEqual(calls, [["alpha", 2, ""]]);
  assert.equal(game.loaded, true);
  assert.equal(game.busy, false);
  assert.equal(game.state.slot, 2);
  assert.equal(game.map.locations.length, 1);
  assert.equal(game.characters.length, 1);
  assert.equal(game.events.length, 1);
  assert.equal(game.stream.some((e) => e.source === "opening"), true);
});

test("新档已落盘但快照读取失败时显示已占用槽位，并提示重新载入", async (t) => {
  t.mock.method(api, "newGame", async () => ({ state: payload().state }));
  t.mock.method(api, "listSlots", async () => ({ slots: [{ slot: 1, exists: true }] }));
  t.mock.method(api, "getState", async () => { throw new Error("读取失败"); });
  assert.equal(await newGame(), false);
  assert.equal(game.slots[0].exists, true);
  assert.equal(game.loaded, false);
  assert.equal(game.busy, false);
  assert.equal(game.loading, false);
  assert.match(game.lastError, /新档已保存.*重新载入槽位 1/);
});

test("换槽清除旧剧情与建议，迟到的快照不能覆盖新槽", async (t) => {
  const first = deferred(), second = deferred();
  t.mock.method(api, "getState", (module, slot) => slot === 1 ? first.promise : second.promise);
  game.stream.push({ kind: "narrative", text: "旧剧情" });
  game.suggestions = ["旧建议"];
  const read1 = openSlot(1);
  const read2 = openSlot(2);
  assert.equal(game.stream.length, 0);
  assert.equal(game.suggestions.length, 0);
  assert.equal(game.state, null);
  second.resolve(payload("alpha", 2));
  assert.equal(await read2, true);
  first.resolve(payload("alpha", 1));
  assert.equal(await read1, false);
  assert.equal(game.state.slot, 2);
  assert.equal(game.stream.some((e) => e.text.includes("槽位 1")), false);
});

test("无存档的新模块立即清空旧面板、图片，忽略旧回读与生图响应", async (t) => {
  const image = deferred(), oldRead = deferred();
  t.mock.method(api, "getState", () => oldRead.promise);
  t.mock.method(api, "generateImage", () => image.promise);
  t.mock.method(api, "listSlots", async () => ({ slots: [] }));
  Object.assign(game, { loaded: true, state: payload().state, map: payload().map, characters: payload().characters,
    events: payload().events, portraitUrl: "旧头像", locationImage: { old: "旧图片" } });
  const pendingRead = reloadState();
  const pendingImage = generateImage({ kind: "portrait" });
  await selectModule("beta");
  oldRead.resolve(payload());
  image.resolve({ url: "旧会话的新头像" });
  assert.equal(await pendingRead, false);
  assert.equal(await pendingImage, null);
  assert.equal(game.state, null);
  assert.equal(game.moduleInfo, null);
  assert.deepEqual(game.map, { locations: [], routes: [] });
  assert.equal(game.characters.length, 0);
  assert.equal(game.events.length, 0);
  assert.equal(game.portraitUrl, "");
  assert.deepEqual(game.locationImage, {});
});

test("当前操作未完成时 store 拦截新建、换本、换槽与编辑", async (t) => {
  game.busy = true;
  game.loaded = true;
  for (const method of ["newGame", "getState", "listSlots", "edit"]) {
    t.mock.method(api, method, () => assert.fail(`${method} 不应被调用`));
  }
  assert.equal(await newGame(), false);
  assert.equal(await selectModule("beta"), false);
  assert.equal(await openSlot(2), false);
  assert.equal(await applyEdit({ op: "set_funds", value: 2 }), false);
  assert.equal(game.module, "alpha");
  assert.equal(game.slot, 1);
});

test("当前行动不会重复进入历史，被拒绝的编辑不替换本地状态", async (t) => {
  game.loaded = true;
  game.state = payload().state;
  game.stream.push({ kind: "action", text: "上一轮行动" });
  t.mock.method(api, "streamTurn", async function* (module, slot, action, history) {
    assert.equal(action, "当前行动");
    assert.deepEqual(history, [{ role: "user", content: "上一轮行动" }]);
    yield { type: "state", state: payload().state };
    yield { type: "done" };
  });
  await sendAction("当前行动");
  t.mock.method(api, "edit", async () => ({ ok: false, state: { day: 999 } }));
  assert.equal(await applyEdit({ op: "set_time", period: "不存在" }), false);
  assert.equal(game.state.day, 1);
});

test("同一槽位的旧回读也不能覆盖后来完成的回合", async (t) => {
  game.loaded = true;
  game.state = payload().state;
  const old = deferred();
  t.mock.method(api, "getState", () => old.promise);
  const pending = reloadState();
  const settled = payload().state;
  settled.day = 3;
  t.mock.method(api, "streamTurn", async function* () {
    yield { type: "state", state: settled };
    yield { type: "done" };
  });
  await sendAction("查账");
  old.resolve(payload());
  assert.equal(await pending, false);
  assert.equal(game.state.day, 3);
});

test("停止显示后等待存档回读，同步完成前不能再次行动", async (t) => {
  const reading = deferred(), committed = deferred();
  game.loaded = true;
  game.state = payload().state;
  t.mock.method(api, "streamTurn", async function* (module, slot, action, history, signal) {
    yield { type: "narrative", delta: "未完成的剧情" };
    abortTurn();
    assert.equal(signal.aborted, true);
  });
  t.mock.method(api, "getState", () => { reading.resolve(); return committed.promise; });
  const turn = sendAction("检查账本");
  await reading.promise;
  assert.equal(game.busy, true);
  assert.equal(game.turnStreaming, false);
  assert.equal(canSend(), false);
  const snapshot = payload();
  snapshot.state.day = 2;
  committed.resolve(snapshot);
  await turn;
  assert.equal(game.busy, false);
  assert.equal(canSend(), true);
  assert.equal(game.state.day, 2);
  assert.equal(game.stream.some((e) => e.text.includes("未完成的剧情")), false);
});

test("断流且回读失败时保持不可行动，避免在旧状态上继续", async (t) => {
  game.loaded = true;
  game.state = payload().state;
  t.mock.method(api, "streamTurn", async function* () { yield { type: "narrative", delta: "半段" }; });
  t.mock.method(api, "getState", async () => { throw new Error("离线"); });
  await sendAction("查看门口");
  assert.equal(game.busy, false);
  assert.equal(canSend(), false);
  assert.match(game.lastError, /离线/);
});

test("SSE 消费方提前结束迭代时取消响应流并释放读取锁", async (t) => {
  let canceled = 0;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"started"}\n\ndata: {"type":"done"}\n\n'));
    },
    cancel() { canceled += 1; },
  });
  t.mock.method(globalThis, "fetch", async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
  for await (const event of api.streamTurn("alpha", 1, "检查门口", [], new AbortController().signal)) {
    if (event.type === "done") break;
  }
  assert.equal(canceled, 1);
  assert.equal(body.locked, false);
});

test("出图状态的迟到检测不能覆盖新检测或停止操作的结果", async (t) => {
  const first = deferred(), second = deferred();
  let reads = 0;
  t.mock.method(api, "imageStatus", () => ++reads === 1 ? first.promise : second.promise);
  const older = loadImageStatus(), newer = loadImageStatus();
  second.resolve({ online: true, ready: true, mode: "internal" });
  await newer;
  first.resolve({ online: false, ready: false });
  await older;
  assert.equal(game.comfy.ready, true);
  const late = deferred();
  t.mock.method(api, "imageStatus", () => late.promise);
  t.mock.method(api, "stopImageRuntime", async () => ({ online: false, ready: false, stopped: true }));
  const pending = loadImageStatus();
  await controlImageRuntime("stop");
  late.resolve({ online: true, ready: true });
  await pending;
  assert.equal(game.comfy.online, false);
});

test("存档快照中的旧出图状态不能覆盖独立运行时检测", async (t) => {
  t.mock.method(api, "imageStatus", async () => ({ online: true, ready: true, profiles: [] }));
  await loadImageStatus();
  const snapshot = payload();
  snapshot.comfy = { online: false, ready: false };
  t.mock.method(api, "getState", async () => snapshot);
  await openSlot(1);
  assert.equal(game.comfy.ready, true);
});

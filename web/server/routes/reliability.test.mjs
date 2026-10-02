import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createApp } from "../index.js";
import { CONFIG_PATH } from "../config.js";
import { GMClient, buildMessages } from "../gm.js";
import { loadModule } from "../engine/moduleLoader.js";
import * as state from "../engine/state.js";
import { cardPublic, statePublic } from "./shared.js";

const module = loadModule("gangcheng");
const SECRET = "仅供 GM 的测试秘密 4f8c";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/** 所有存档 IO 留在内存中；模型、ComfyUI 和认证均使用离线替身。 */
async function serverFixture(t, { failCommit = false, stream = null } = {}) {
  const files = new Map();
  const save = state.newGame("gangcheng");
  save.party.老魏.notes = SECRET;
  save.gm_private = { secret: SECRET };
  const slotPath = state.slotPath("gangcheng", 1);
  files.set(slotPath, JSON.stringify(save));
  const isSave = (p) => typeof p === "string" && path.resolve(p).startsWith(`${state.SAVE_ROOT}${path.sep}`);
  for (const method of ["existsSync", "readFileSync", "mkdirSync", "writeFileSync", "renameSync", "statSync"]) {
    const original = fs[method].bind(fs);
    t.mock.method(fs, method, (...args) => {
      const p = String(args[0]);
      if (p === CONFIG_PATH) {
        if (method === "existsSync") return true;
        if (method === "readFileSync") return JSON.stringify({ api_key: "", kimi_oauth: { enabled: false } });
      }
      if (!isSave(p)) return original(...args);
      if (method === "existsSync") return files.has(p);
      if (method === "readFileSync") {
        if (!files.has(p)) throw Object.assign(new Error("not found"), { code: "ENOENT" });
        return args[1] ? files.get(p) : Buffer.from(files.get(p));
      }
      if (method === "mkdirSync") return;
      if (method === "writeFileSync") { files.set(p, String(args[1])); return; }
      if (method === "renameSync") {
        if (failCommit) throw new Error("模拟磁盘写入失败");
        files.set(String(args[1]), files.get(p));
        files.delete(p);
        return;
      }
      if (method === "statSync") return { mtimeMs: 1700000000000 };
      throw new Error(`未处理的存档 IO：${method}`);
    });
  }
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fetchLocal = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (url, opts) => String(url).startsWith(`${origin}/`)
    ? fetchLocal(url, opts) : Promise.resolve({ ok: false }));
  t.mock.method(GMClient.prototype, "streamChat", stream || async function* () {
    yield '叙述已完成。\n```json\n{"action_cost":0,"state_patch":{"funds":{"set":50}},"suggestions":["检查账本"]}\n```';
  });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const request = async (endpoint, body = null) => {
    const response = await fetch(`${origin}/api${endpoint}`, body ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    } : {});
    assert.equal(response.status, 200);
    return response;
  };
  return { files, slotPath, save, request };
}

function sseEvents(text) {
  return text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
}

test("玩家视图隐藏角色秘密、混合旧备注和未声明字段，GM 保留私有资料", () => {
  const card = { name: "测试 NPC", concept: "档案员", raw: SECRET, background: SECRET, goal: SECRET,
    meta: { 外貌: "灰色外套", 特点: "认真", 秘密: SECRET, 动机: SECRET }, gauges: {} };
  const save = state.newGame("gangcheng");
  save.party[card.name] = { notes: `公开描述；${SECRET}`, relation: 1, gauges: {}, gm_secret: SECRET };
  save.private = SECRET;
  const mod = { ...module, characters: [...module.characters, card] };
  const snapshot = JSON.stringify(save);
  assert.equal(JSON.stringify(cardPublic(card)).includes(SECRET), false);
  assert.equal(JSON.stringify(statePublic(save, mod)).includes(SECRET), false);
  assert.equal(statePublic(save, mod).party[card.name].notes, "档案员；灰色外套；认真");
  save.party[card.name].public_notes = "玩家发现的身份";
  assert.equal(statePublic(save, mod).party[card.name].notes, "玩家发现的身份");
  delete save.party[card.name].public_notes;
  assert.equal(JSON.stringify(save), snapshot);
  assert.equal(buildMessages(mod, save, "检查档案")[0][0].content.includes(SECRET), true);
});

test("读取、编辑、移动、新建及 SSE 状态使用同一公开视图", async (t) => {
  const { request, files, slotPath } = await serverFixture(t);
  const read = await (await request("/game/state?module=gangcheng&slot=1")).json();
  assert.equal(JSON.stringify(read).includes(SECRET), false);
  assert.equal("秘密" in read.characters.find((c) => c.name === "老魏").meta, false);
  const edit = await (await request("/state/edit", { module: "gangcheng", op: { op: "set_funds", value: 20 } })).json();
  assert.equal(JSON.stringify(edit).includes(SECRET), false);
  assert.equal(JSON.parse(files.get(slotPath)).party.老魏.notes, SECRET);
  const move = await (await request("/move", { module: "gangcheng", to: "老街" })).json();
  assert.equal(JSON.stringify(move).includes(SECRET), false);
  const turn = sseEvents(await (await request("/turn", { module: "gangcheng", action: "检查账本" })).text());
  assert.equal(JSON.stringify(turn).includes(SECRET), false);
  assert.equal(turn.find((e) => e.type === "state").state.funds, 50);
  assert.equal(JSON.parse(files.get(slotPath)).funds, 50);
  assert.equal(JSON.parse(files.get(slotPath)).party.老魏.notes, SECRET);
  const created = await (await request("/game/new", { module: "gangcheng", slot: 2 })).json();
  const originalSecret = module.characters.find((c) => c.name === "老魏").meta.秘密;
  assert.equal(JSON.stringify(created).includes(originalSecret), false);
  assert.equal(JSON.parse(files.get(state.slotPath("gangcheng", 2))).party.老魏.notes.includes(originalSecret), true);
});

test("非法时间编辑不修改返回状态或已保存文件，合法时间编辑同时生效", async (t) => {
  const { request, files, slotPath, save } = await serverFixture(t);
  const before = files.get(slotPath);
  const response = await (await request("/state/edit", { module: "gangcheng", op: { op: "set_time", day: 9, period: "不存在" } })).json();
  assert.equal(response.ok, false);
  assert.deepEqual(response.state, statePublic(save, module));
  assert.equal(files.get(slotPath), before);
  const copy = structuredClone(save);
  assert.equal(state.applyEdit(copy, { op: "set_time", day: 9, period: "不存在" })[0], false);
  assert.deepEqual(copy, save);
  assert.equal(state.applyEdit(copy, { op: "set_time", day: 9, period: "午" })[0], true);
  assert.equal(copy.day, 9);
  assert.equal(state.currentPeriod(copy), "午");
});

test("落盘失败发送 error/done，不发布未提交的 state，也不覆盖旧档", async (t) => {
  const { request, files, slotPath } = await serverFixture(t, { failCommit: true });
  const before = files.get(slotPath);
  const events = sseEvents(await (await request("/turn", { module: "gangcheng", action: "检查账本" })).text());
  assert.equal(events.some((e) => e.type === "state"), false);
  assert.match(events.find((e) => e.type === "error").message, /存档写入失败/);
  assert.equal(events.at(-1).type, "done");
  assert.equal(files.get(slotPath), before);
});

test("客户端断开 SSE 后回合继续结算，回读能取得最终存档", async (t) => {
  const gate = deferred(), entered = deferred();
  t.after(() => gate.resolve());
  const { request, files, slotPath } = await serverFixture(t, { stream: async function* () {
    entered.resolve();
    await gate.promise;
    yield '账本已核验。\n```json\n{"action_cost":0,"state_patch":{"funds":{"set":70}}}\n```';
  } });
  const response = await request("/turn", { module: "gangcheng", action: "断开显示测试" });
  await entered.promise;
  await response.body.cancel();
  const read = (async () => (await request("/game/state?module=gangcheng&slot=1")).json())();
  gate.resolve();
  assert.equal((await read).state.funds, 70);
  assert.equal(JSON.parse(files.get(slotPath)).funds, 70);
});

test("存档回读等待同槽位回合完成，其他槽位可独立读取", async (t) => {
  const gate = deferred(), entered = deferred();
  t.after(() => gate.resolve());
  const { request } = await serverFixture(t, { stream: async function* () {
    entered.resolve();
    await gate.promise;
    yield '已结算。\n```json\n{"action_cost":0,"state_patch":{"funds":{"set":60}}}\n```';
  } });
  const turn = (async () => (await request("/turn", { module: "gangcheng", action: "等待结算" })).text())();
  await entered.promise;
  let readFinished = false;
  const read = (async () => {
    const data = await (await request("/game/state?module=gangcheng&slot=1")).json();
    readFinished = true;
    return data;
  })();
  // 完整走一次独立槽位请求，确保读取请求已有机会到达服务端。
  await request("/game/new", { module: "gangcheng", slot: 2 });
  assert.equal(readFinished, false);
  gate.resolve();
  await turn;
  assert.equal((await read).state.funds, 60);
});

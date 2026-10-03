import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createApp } from "../index.js";
import { CONFIG_PATH } from "../config.js";
import { GMClient, buildMessages } from "../gm.js";
import { loadModule } from "../engine/moduleLoader.js";
import * as state from "../engine/state.js";
import { cardPublic, statePublic, progressPublic } from "./shared.js";

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
  save.character.xp = 12;
  save.character.xp_total = 12;
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
  const request = async (endpoint, body = null, expectedStatus = 200) => {
    const response = await fetch(`${origin}/api${endpoint}`, body ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    } : {});
    assert.equal(response.status, expectedStatus);
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
  save.relations.push({ npc: card.name, value: 1, note: "调查时认识" });
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
  const edit = await (await request("/state/edit", { module: "gangcheng", op: { op: "spend_xp", kind: "trait", name: "调查习惯" } })).json();
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

test("玩家不能直接修改时间，内部编辑工具仍验证时间后再修改", async (t) => {
  const { request, files, slotPath, save } = await serverFixture(t);
  const before = files.get(slotPath);
  await request("/state/edit", { module: "gangcheng", op: { op: "set_time", day: 9, period: "不存在" } }, 403);
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

test("玩家端拒绝直接改世界状态，伪造 GM 标记不绕过权限；合法成长扣除真实经验", async (t) => {
  const {request,files,slotPath}=await serverFixture(t);
  const before=files.get(slotPath);
  const blocked=["add_item","remove_item","set_item_qty","set_funds","set_relation","add_clock","set_clock","remove_clock","add_clue","toggle_clue","remove_clue","set_attr","set_skill","set_gauge","set_xp","add_trait","remove_trait","add_status","remove_status","set_location","set_time","unknown"];
  for(const op of blocked){
    const response=await request("/state/edit",{module:"gangcheng",mode:"gm",admin:true,op:{op,name:"测试",npc:"测试人物",text:"测试",value:999}},403);
    assert.match((await response.json()).error,/随探索、对话和事件结算更新/);
    assert.equal(files.get(slotPath),before,op+" 不应改写存档");
  }
  const upgraded=await (await request("/state/edit",{module:"gangcheng",op:{op:"spend_xp",kind:"skill",name:"格斗",to:2}})).json();
  assert.equal(upgraded.ok,true);
  assert.equal(upgraded.state.character.xp,6);
  assert.equal(upgraded.state.character.skills.格斗,2);
  const after=files.get(slotPath);
  const rejected=await (await request("/state/edit",{module:"gangcheng",op:{op:"spend_xp",kind:"attr",name:"体魄",to:5}})).json();
  assert.equal(rejected.ok,false);
  assert.equal(files.get(slotPath),after);
});

test("新档只登记角色原有关系；未知 NPC 与未触发事件不会提前公开，旧默认态度不算解锁", () => {
  const save=state.newGame("gangcheng");
  assert.deepEqual(save.relations.map(relation=>relation.npc),module.player_card.relations.map(relation=>relation.npc));
  const card={name:"未见档案员",concept:"档案室值班员",attitude:-1,meta:{外貌:"灰色外套",秘密:SECRET},raw:SECRET};
  const mod={...module,characters:[...module.characters,card]};
  save.party[card.name]={gauges:{生命:{value:8,max:8}},notes:SECRET,relation:-1};
  const before=JSON.stringify(save);
  const locked=progressPublic(save,mod);
  assert.equal(locked.characters.some(person=>person.name===card.name),false);
  assert.equal(card.name in locked.state.party,false);
  assert.deepEqual(locked.unlocked_events,[]);
  assert.equal(JSON.stringify(save),before);
  save.relations.push({npc:card.name,value:-1,note:"对主角态度"});
  assert.equal(progressPublic(save,mod).characters.some(person=>person.name===card.name),false);
  state.applyPatch(save,{relations:[{npc:card.name,set:0,note:"在档案室交谈后相识"}],events:[{code:"53",name:"老魏的儿子"}]});
  const unlocked=progressPublic(save,mod);
  assert.equal(unlocked.characters.find(person=>person.name===card.name).meta.外貌,"灰色外套");
  assert.equal(card.name in unlocked.state.party,true);
  assert.deepEqual(unlocked.unlocked_events.map(event=>event.code),["53"]);
  assert.equal(JSON.stringify(unlocked).includes(SECRET),false);
  assert.equal(buildMessages(mod,save,"询问档案")[0][0].content.includes("初次实际认识一个人物时"),true);
});

test("真实 GM 回合自动获得物品、认识人物、发现线索和建立进度，后续回合消耗与解决后持久化", async (t) => {
  let turn=0;
  const stream=async function* (){
    turn+=1;
    const patch=turn===1
      ? {items:[{name:"调查绷带",delta:2,slots:1,note:"仓库里找到的医用品"}],relations:[{npc:"仓库看守",set:0,note:"在门口相识"}],clocks:[{name:"仓库调查",create:{max:4,consequence:"查清货物去向"},advance:1}],clues_add:["追踪仓库货物"]}
      : {items:[{name:"调查绷带",delta:-1}],relations:[{npc:"仓库看守",delta:1,note:"提供了帮助"}],clocks:[{name:"仓库调查",advance:1}],clues_done:["追踪仓库货物"]};
    yield "本回合的探索已经结算。\n"+String.fromCharCode(96).repeat(3)+"json\n"+JSON.stringify({action_cost:0,state_patch:patch})+"\n"+String.fromCharCode(96).repeat(3);
  };
  const {request,files,slotPath}=await serverFixture(t,{stream});
  const first=sseEvents(await (await request("/turn",{module:"gangcheng",action:"调查仓库"})).text()).find(event=>event.type==="state");
  assert.equal(first.state.inventory.find(item=>item.name==="调查绷带").qty,2);
  assert.equal(first.state.relations.find(relation=>relation.npc==="仓库看守").value,0);
  assert.equal(first.state.clocks.find(clock=>clock.name==="仓库调查").value,1);
  assert.equal(first.state.clues.find(clue=>clue.text==="追踪仓库货物").done,false);
  assert.ok(Array.isArray(first.characters));
  assert.ok(Array.isArray(first.unlocked_events));
  const second=sseEvents(await (await request("/turn",{module:"gangcheng",action:"使用绷带帮助看守，继续调查"})).text()).find(event=>event.type==="state");
  const committed=JSON.parse(files.get(slotPath));
  assert.equal(second.state.inventory.find(item=>item.name==="调查绷带").qty,1);
  assert.equal(second.state.relations.find(relation=>relation.npc==="仓库看守").value,1);
  assert.equal(second.state.clocks.find(clock=>clock.name==="仓库调查").value,2);
  assert.equal(second.state.clues.find(clue=>clue.text==="追踪仓库货物").done,true);
  assert.deepEqual(statePublic(committed,module),second.state);
  const read=await (await request("/game/state?module=gangcheng&slot=1")).json();
  assert.deepEqual(read.state,second.state);
});

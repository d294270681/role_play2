/**
 * 全局游戏状态与动作（单例 reactive store）。
 *
 * 剧情流是「扁平条目数组」：narrative / dice / image / note / system 五种 kind 混排，
 * 按到达顺序渲染。后端 SSE 边到边追加；narrative 条目带 pending 队列，
 * 由本文件的打字机定时器按节奏吐出，实现增量打字渲染（点剧情流可跳过动画）。
 *
 * 所有玩家编辑（属性/技能/仪表/道具/关系/线索/进度钟/时间/经验加点）统一走
 * /api/state/edit，服务端返回的新存档直接覆盖本地 state，保证前后端一致。
 */

import { reactive } from "vue";

import api, { ApiError } from "./api.js";
import { currentPeriod, isNight, effectiveDanger, loadLocal, nextId, saveLocal } from "./util.js";

const TYPE_TICK_MS = 24;
const TYPE_DIVISOR = 10;
const HISTORY_KEEP = 8;

export const game = reactive({
  // 连接与选择
  modules: [],
  module: "",           // 当前 RPG 本（目录名）
  slot: 1,
  slots: [],
  // 载入数据
  loaded: false,
  moduleInfo: null,
  state: null,
  map: { locations: [], routes: [] },
  characters: [],
  events: [],
  hasKey: false,
  echo: true,
  comfy: { online: false, url: "" },
  // 界面
  stream: [],
  suggestions: [],
  busy: false,
  lastError: "",
  toasts: [],
  config: null,
  portraitUrl: "",       // 角色头像（本地记忆）
  locationImage: {},    // 地点名 → 立绘 URL（本地记忆）
  lightbox: null,       // {url, prompt}
  rightTab: "character",
  settingsOpen: false,
  leftCollapsed: false,
  rightCollapsed: false,
  pendingAction: "",   // 右栏「行动按钮」投递到输入框的文本
});

// ---------------------------------------------------------------------------
// 打字机：把 narrative 的 pending 队列按节奏搬进 text
// ---------------------------------------------------------------------------
let _typeTimer = null;

function stopTyper() {
  if (_typeTimer !== null) {
    clearInterval(_typeTimer);
    _typeTimer = null;
  }
}

function tickTyper() {
  const targets = game.stream.filter((e) => e.kind === "narrative" && e.pending);
  if (!targets.length) {
    stopTyper();
    return;
  }
  for (const entry of targets) {
    const step = Math.max(1, Math.round(entry.pending.length / TYPE_DIVISOR));
    entry.text += entry.pending.slice(0, step);
    entry.pending = entry.pending.slice(step);
  }
}

function ensureTyper() {
  if (_typeTimer === null) _typeTimer = setInterval(tickTyper, TYPE_TICK_MS);
}

/** 点剧情流 / 点「跳过」：把待打出的字一次性落下。 */
export function skipTyping() {
  for (const entry of game.stream) {
    if (entry.kind === "narrative" && entry.pending) {
      entry.text += entry.pending;
      entry.pending = "";
    }
  }
  stopTyper();
}

function pushStream(entry) {
  const item = { id: nextId("s"), kind: "note", text: "", ...entry };
  game.stream.push(item);
  return item;
}

export function clearStream() {
  skipTyping();
  game.stream.length = 0;
}

// ---------------------------------------------------------------------------
// 提示条
// ---------------------------------------------------------------------------
export function notify(text, level = "info", ms = 4200) {
  const item = { id: nextId("t"), text: String(text ?? ""), level };
  game.toasts.push(item);
  if (ms > 0) setTimeout(() => dismissToast(item.id), ms);
  return item;
}

export function dismissToast(id) {
  const i = game.toasts.findIndex((t) => t.id === id);
  if (i >= 0) game.toasts.splice(i, 1);
}

function reportError(e) {
  const message = e instanceof ApiError ? e.message : `操作失败：${e?.message ?? e}`;
  game.lastError = message;
  pushStream({ kind: "note", level: "error", text: message });
  notify(message, "error", 6000);
  return message;
}

// ---------------------------------------------------------------------------
// 载入 / 选择
// ---------------------------------------------------------------------------
function remember() {
  saveLocal("module", game.module);
  saveLocal("slot", game.slot);
}

function absorb(payload) {
  game.moduleInfo = payload.module || null;
  game.state = payload.state || null;
  game.map = payload.map || { locations: [], routes: [] };
  game.characters = payload.characters || [];
  game.events = payload.events || [];
  game.hasKey = Boolean(payload.has_key);
  game.echo = Boolean(payload.echo);
  game.comfy = payload.comfy || { online: false, url: "" };
}

/** 当前地点卡（用后端同一套匹配规则做模糊定位）。 */
export function currentLocation() {
  const name = String(game.state?.location ?? "").trim();
  if (!name) return null;
  const locs = game.map.locations || [];
  let hit = locs.find((l) => String(l.name ?? "").trim() === name) || null;
  if (!hit) hit = locs.find((l) => String(l.name ?? "").includes(name) || name.includes(String(l.name ?? ""))) || null;
  return hit;
}

export function locationDanger(loc) {
  return effectiveDanger(loc, isNight(currentPeriod(game.state)));
}

export async function loadModules() {
  const data = await api.listModules();
  game.modules = data.modules || [];
  const remembered = loadLocal("module", "");
  if (!game.module || !game.modules.some((m) => m.dir === game.module)) {
    const first = game.modules[0];
    game.module = remembered && game.modules.some((m) => m.dir === remembered) ? remembered : (first?.dir || "");
  }
  return game.modules;
}

export async function refreshSlots() {
  if (!game.module) {
    game.slots = [];
    return game.slots;
  }
  const data = await api.listSlots(game.module);
  game.slots = data.slots || [];
  return game.slots;
}

export async function selectModule(dir) {
  if (!dir || dir === game.module) return;
  game.module = dir;
  game.slot = Number(loadLocal("slot", 1)) || 1;
  clearStream();
  game.suggestions = [];
  game.loaded = false;
  remember();
  await refreshSlots();
  const hit = game.slots.find((s) => s.slot === game.slot && s.exists);
  if (!hit) {
    const anySave = game.slots.find((s) => s.exists);
    game.slot = anySave ? anySave.slot : game.slot;
  }
  const target = game.slots.find((s) => s.slot === game.slot && s.exists);
  if (target) {
    await openSlot(game.slot, { silent: true });
  } else {
    game.loaded = false;
    notify(`《${game.modules.find((m) => m.dir === game.module)?.title || game.module}》还没有存档，点「＋ 新建存档」开一档。`, "info", 6000);
  }
}

/** 打开某个槽位；不存在则返回 false（由调用方提示「先开新档」）。 */
export async function openSlot(slot, { silent = false } = {}) {
  game.slot = Number(slot) || 1;
  remember();
  try {
    const data = await api.getState(game.module, game.slot);
    absorb(data);
    game.loaded = true;
    if (!silent) notify(`已载入 ${data.module?.title || game.module} · 槽位 ${game.slot}`, "success");
    if (!game.stream.length) seedOpening();
    return true;
  } catch (e) {
    game.loaded = false;
    if (!silent) reportError(e);
    return false;
  }
}

/** 开局：把 module 的开局信息铺成剧情流的第一屏。 */
function seedOpening() {
  const info = game.moduleInfo;
  const state = game.state;
  if (!state) return;
  const premise = String(info?.opening?.premise || "").trim();
  const lines = [];
  if (info?.opening?.raw) lines.push(info.opening.raw);
  else if (premise) lines.push(premise);
  if (lines.length) {
    pushStream({ kind: "narrative", text: lines.join("\n"), pending: "", source: "opening" });
  }
  if (state.log?.length) {
    for (const entry of state.log) {
      pushStream({
        kind: "narrative",
        text: `［第 ${entry.day} 天 · ${entry.period}］${entry.text}`,
        pending: "",
        source: "log",
        dim: true,
      });
    }
  }
  for (const warn of info?.warnings || []) pushStream({ kind: "note", level: "warn", text: `本册提示：${warn}` });
  if (game.echo) {
    pushStream({ kind: "note", text: "演示模式：尚未配置 API Key，叙述由本地回声引擎生成。可在右上角「设置」里填写。" });
  }
}

// ---------------------------------------------------------------------------
// 开新档
// ---------------------------------------------------------------------------
export async function newGame({ character = "", slot = null } = {}) {
  const target = Number(slot) || game.slot || 1;
  try {
    const data = await api.newGame(game.module, target, character);
    game.slot = target;
    game.state = data.state;
    game.loaded = true;
    clearStream();
    remember();
    await refreshSlots();
    seedOpening();
    notify(`已开新档：槽位 ${target}${data.overwrote ? "（覆盖了旧档）" : ""}`, "success");
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 回合（SSE）
// ---------------------------------------------------------------------------
let _turnAbort = null;

/** 送给后端的对话历史：最近的玩家行动 + 叙述。 */
function buildHistory() {
  const out = [];
  for (const entry of game.stream) {
    if (entry.kind === "action" && entry.text) {
      out.push({ role: "user", content: entry.text });
    } else if (entry.kind === "narrative" && entry.source !== "log" && entry.text) {
      out.push({ role: "assistant", content: entry.text });
    }
  }
  return out.slice(-HISTORY_KEEP);
}

export function canSend() {
  return Boolean(game.loaded && game.module && !game.busy);
}

export async function sendAction(text) {
  const action = String(text ?? "").trim();
  if (!action || !canSend()) return;
  game.busy = true;
  game.suggestions = [];
  pushStream({ kind: "action", text: action });

  const narrative = pushStream({ kind: "narrative", text: "", pending: "", streaming: true });
  let notes = 0;
  let sawDone = false;

  try {
    _turnAbort = new AbortController();
    for await (const ev of api.streamTurn(game.module, game.slot, action, buildHistory(), _turnAbort.signal)) {
      switch (ev?.type) {
        case "narrative": {
          const delta = String(ev.delta ?? "");
          if (delta) {
            narrative.pending += delta;
            ensureTyper();
          }
          break;
        }
        case "dice": {
          // 判定卡插在叙述流中间：先把正在打的字落定，再插卡
          narrative.pending && (narrative.text += narrative.pending);
          narrative.pending = "";
          pushStream({ kind: "dice", result: ev.result || {} });
          pushStream({ kind: "narrative", text: "", pending: "", streaming: true });
          break;
        }
        case "state": {
          if (ev.state) game.state = ev.state;
          game.suggestions = Array.isArray(ev.suggestions) ? ev.suggestions : [];
          // 结算明细由后端紧跟着发一条 note("结算：…")，这里不再重复渲染 changes
          break;
        }
        case "note": {
          if (ev.text) {
            notes += 1;
            pushStream({ kind: "note", level: notes > 1 ? "plain" : "info", text: String(ev.text) });
          }
          break;
        }
        case "image": {
          if (ev.url) pushStream({ kind: "image", url: ev.url, prompt: String(ev.prompt ?? "") });
          break;
        }
        case "error": {
          pushStream({ kind: "note", level: "error", text: String(ev.message ?? "回合出错") });
          break;
        }
        case "done": {
          sawDone = true;
          break;
        }
        default:
          break;
      }
      if (sawDone) break;
    }
  } catch (e) {
    if (e?.name !== "AbortError") reportError(e);
  } finally {
    _turnAbort = null;
    narrative.pending && (narrative.text += narrative.pending);
    narrative.pending = "";
    narrative.streaming = false;
    // 判定卡前后会插入占位叙述块，空的不留痕
    for (let i = game.stream.length - 1; i >= 0; i -= 1) {
      const e = game.stream[i];
      if (e.kind === "narrative" && !e.text.trim() && !e.pending) game.stream.splice(i, 1);
    }
    game.busy = false;
  }
}

export function abortTurn() {
  if (_turnAbort) {
    _turnAbort.abort();
    _turnAbort = null;
  }
}

// ---------------------------------------------------------------------------
// 移动
// ---------------------------------------------------------------------------
export async function moveTo(target) {
  if (game.busy || !game.loaded) return false;
  const to = String(target ?? "").trim();
  if (!to) return false;
  game.busy = true;
  try {
    const data = await api.move(game.module, game.slot, to);
    if (data.state) game.state = data.state;
    pushStream({ kind: "system", text: `移动 → ${to}` });
    for (const change of data.changes || []) pushStream({ kind: "note", level: "settle", text: change });
    for (const ev of data.events || []) {
      if (ev?.name) pushStream({ kind: "note", level: "warn", text: `途中触发事件：${ev.code || ""} ${ev.name}`.trim() });
    }
    notify(`已移动到「${to}」`, "success");
    return true;
  } catch (e) {
    reportError(e);
    return false;
  } finally {
    game.busy = false;
  }
}

// ---------------------------------------------------------------------------
// 结构化编辑（/api/state/edit）
// ---------------------------------------------------------------------------
export async function applyEdit(op, { silent = false } = {}) {
  if (!game.loaded) {
    if (!silent) notify("还没有载入存档", "warn");
    return false;
  }
  try {
    const data = await api.edit(game.module, game.slot, op);
    if (data.state) game.state = data.state;
    if (!silent) {
      if (data.ok) notify(data.message || "已保存", "success", 2600);
      else notify(data.message || "编辑被拒绝", "warn", 4200);
    }
    return Boolean(data.ok);
  } catch (e) {
    if (!silent) reportError(e);
    return false;
  }
}

/** 编辑后的存档回读（多步操作时保持面板与后端一致）。 */
export async function reloadState() {
  if (!game.module || !game.slot) return;
  try {
    const data = await api.getState(game.module, game.slot);
    absorb(data);
  } catch (e) {
    reportError(e);
  }
}

// ---------------------------------------------------------------------------
// 生图
// ---------------------------------------------------------------------------
let _imgBusy = false;

/** kind: scene | location | portrait；成功后回传 URL（失败返回 null）。 */
export async function generateImage({ kind = "scene", prompt = "", name = "", anime = false } = {}) {
  if (!game.module || _imgBusy) return null;
  _imgBusy = true;
  try {
    const data = await api.generateImage(game.module, game.slot, { kind, prompt, name, anime });
    const url = data?.url ? String(data.url) : "";
    if (!url) return null;
    if (kind === "portrait") game.portraitUrl = url;
    if (kind === "location" && name) game.locationImage = { ...game.locationImage, [name]: url };
    return data;
  } catch (e) {
    reportError(e);
    return null;
  } finally {
    _imgBusy = false;
  }
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
export async function loadConfig() {
  try {
    game.config = await api.getConfig();
    game.hasKey = Boolean(game.config?.has_key);
    game.echo = Boolean(game.config?.echo);
    game.comfy = { online: game.comfy?.online ?? false, url: game.config?.comfy_url || game.comfy?.url || "" };
    return game.config;
  } catch (e) {
    reportError(e);
    return null;
  }
}

export async function saveConfig(patch) {
  try {
    game.config = await api.saveConfig(patch);
    game.hasKey = Boolean(game.config?.has_key);
    game.echo = Boolean(game.config?.echo);
    notify("配置已保存", "success");
    // 重新探测 ComfyUI（后端 /api/game/state 才会回 comfy.online）
    if (game.loaded) {
      try {
        const data = await api.getState(game.module, game.slot);
        game.comfy = data.comfy || game.comfy;
      } catch {
        /* 忽略：配置已落盘 */
      }
    }
    return game.config;
  } catch (e) {
    reportError(e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
export async function bootstrap() {
  try {
    await loadModules();
    if (!game.module) {
      game.loaded = false;
      return;
    }
    await refreshSlots();
    const preferred = Number(loadLocal("slot", 1)) || 1;
    const hit = game.slots.find((s) => s.slot === preferred && s.exists) || game.slots.find((s) => s.exists);
    game.slot = hit ? hit.slot : preferred;
    remember();
    await loadConfig();
    if (hit) {
      await openSlot(hit.slot, { silent: true });
    } else {
      game.loaded = false;
      notify("这个本还没有存档，请在左侧「新建」开一档。", "info", 6000);
    }
  } catch (e) {
    reportError(e);
  }
}

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
  loading: false,
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
  turnStreaming: false,
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
let _sessionVersion = 0;
let _slotsRequest = 0;
let _stateRevision = 0;
let _snapshotRequest = 0;

function session() {
  return { version: _sessionVersion, module: game.module, slot: game.slot };
}

function isCurrent(context) {
  return context.version === _sessionVersion && context.module === game.module && context.slot === game.slot;
}

function beginSession(module, slot) {
  _sessionVersion += 1;
  game.module = module;
  game.slot = Number(slot) || 1;
  game.loaded = false;
  game.loading = false;
  game.moduleInfo = null;
  game.state = null;
  game.map = { locations: [], routes: [] };
  game.characters = [];
  game.events = [];
  game.suggestions = [];
  game.portraitUrl = "";
  game.locationImage = {};
  game.lightbox = null;
  game.pendingAction = "";
  game.lastError = "";
  clearStream();
  remember();
  return session();
}

function selectionBlocked() {
  if (!game.busy) return false;
  notify("当前操作尚未完成，请等待存档同步后再切换或新建。", "warn");
  return true;
}

function remember() {
  saveLocal("module", game.module);
  saveLocal("slot", game.slot);
}

function absorb(payload) {
  _stateRevision += 1;
  game.moduleInfo = payload.module || null;
  game.state = payload.state || null;
  game.map = payload.map || { locations: [], routes: [] };
  game.characters = payload.characters || [];
  game.events = payload.events || [];
  game.hasKey = Boolean(payload.has_key);
  game.echo = Boolean(payload.echo);
  // 独立状态检测已建立后，存档快照里的旧服务状态不再覆盖它。
  if (!game.comfy?.profiles) game.comfy = payload.comfy || { online: false, url: "" };
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

// ---------------------------------------------------------------------------
// 出图记忆：后端只管把 PNG 存到 /assets，谁对应哪个角色/地点由前端记
// ---------------------------------------------------------------------------
const portraitKey = () => `portrait.${game.module}.${game.slot}`;
const locationKey = () => `location.${game.module}.${game.slot}`;

function loadImages() {
  game.portraitUrl = String(loadLocal(portraitKey(), "") || "");
  const map = loadLocal(locationKey(), {});
  game.locationImage = map && typeof map === "object" ? map : {};
}

function rememberPortrait(url) {
  game.portraitUrl = url;
  saveLocal(portraitKey(), url);
}

function rememberLocationImage(name, url) {
  game.locationImage = { ...game.locationImage, [name]: url };
  saveLocal(locationKey(), game.locationImage);
}

function forgetImages() {
  game.portraitUrl = "";
  game.locationImage = {};
  saveLocal(portraitKey(), "");
  saveLocal(locationKey(), {});
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

export async function refreshSlots(context = session()) {
  if (!context.module) {
    game.slots = [];
    return game.slots;
  }
  const request = ++_slotsRequest;
  const data = await api.listSlots(context.module);
  if (isCurrent(context) && request === _slotsRequest) game.slots = data.slots || [];
  return data.slots || [];
}

export async function selectModule(dir) {
  if (!dir || dir === game.module || selectionBlocked()) return false;
  const context = beginSession(dir, loadLocal("slot", 1));
  game.slots = [];
  game.loading = true;
  try {
    const slots = await refreshSlots(context);
    if (!isCurrent(context)) return false;
    const target = slots.find((s) => s.slot === game.slot && s.exists) || slots.find((s) => s.exists);
    if (target) return await openSlot(target.slot, { silent: true });
    notify(`《${game.modules.find((m) => m.dir === dir)?.title || dir}》还没有存档，点「＋ 新建存档」开一档。`, "info", 6000);
    return false;
  } catch (e) {
    if (isCurrent(context)) reportError(e);
    return false;
  } finally {
    if (isCurrent(context)) game.loading = false;
  }
}

/** 打开某个槽位；不存在则返回 false（由调用方提示「先开新档」）。 */
export async function openSlot(slot, { silent = false } = {}) {
  if (!game.module || selectionBlocked()) return false;
  const context = beginSession(game.module, slot);
  game.loading = true;
  try {
    const data = await api.getState(context.module, context.slot);
    if (!isCurrent(context)) return false;
    absorb(data);
    loadImages();
    game.loaded = true;
    if (!silent) notify(`已载入 ${data.module?.title || game.module} · 槽位 ${game.slot}`, "success");
    seedOpening();
    return true;
  } catch (e) {
    if (isCurrent(context)) {
      game.loaded = false;
      if (!silent) reportError(e);
    }
    return false;
  } finally {
    if (isCurrent(context)) game.loading = false;
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
  if (!game.module || selectionBlocked()) return false;
  const target = Number(slot) || game.slot || 1;
  const context = beginSession(game.module, target);
  game.busy = true;
  game.loading = true;
  let created = null;
  try {
    created = await api.newGame(context.module, target, character);
    if (!isCurrent(context)) return false;
    // 新档是另一个冒险，之前记的头像/地点图不再对应
    forgetImages();
    // 先刷新槽位，即使随后完整快照载入失败，也让已创建的档显示为占用。
    try { await refreshSlots(context); } catch (e) { notify(`存档已创建，槽位列表刷新失败：${e?.message ?? e}`, "warn"); }
    const data = await api.getState(context.module, target);
    if (!isCurrent(context)) return false;
    absorb(data);
    game.loaded = true;
    seedOpening();
    notify(`已开新档：槽位 ${target}${created.overwrote ? "（覆盖了旧档）" : ""}`, "success");
    return true;
  } catch (e) {
    if (isCurrent(context)) reportError(created
      ? new Error(`新档已保存，但完整数据载入失败：${e?.message ?? e}。请重新载入槽位 ${target}。`)
      : e);
    return false;
  } finally {
    if (isCurrent(context)) {
      game.busy = false;
      game.loading = false;
    }
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
  const context = session();
  const history = buildHistory();
  const controller = new AbortController();
  _turnAbort = controller;
  _stateRevision += 1;
  game.busy = true;
  // 收到后端确认才允许停止显示，确保回读能排在本回合的槽位锁之后。
  game.turnStreaming = false;
  game.suggestions = [];
  game.lastError = "";
  pushStream({ kind: "action", text: action });

  // 正在接收 delta 的叙述块。判定事件会把它换成新的一块（判定卡插在叙述流中间），
  // 所以这里必须用可变引用，不能开局捕获一次就用到底。
  let current = pushStream({ kind: "narrative", text: "", pending: "", streaming: true });
  let notes = 0;
  let sawDone = false;
  let sawState = false;
  let failed = false;

  try {
    for await (const ev of api.streamTurn(context.module, context.slot, action, history, controller.signal)) {
      if (!isCurrent(context)) break;
      if (!controller.signal.aborted) game.turnStreaming = true;
      switch (ev?.type) {
        case "narrative": {
          const delta = String(ev.delta ?? "");
          if (delta) {
            current.pending += delta;
            ensureTyper();
          }
          break;
        }
        case "dice": {
          // 判定卡插在叙述流中间：先把正在打的字落定，再插卡，后面的续写另起一块
          current.pending && (current.text += current.pending);
          current.pending = "";
          current.streaming = false;
          pushStream({ kind: "dice", result: ev.result || {} });
          current = pushStream({ kind: "narrative", text: "", pending: "", streaming: true });
          break;
        }
        case "state": {
          if (ev.state) {
            _stateRevision += 1;
            game.state = ev.state;
            sawState = true;
          }
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
          failed = true;
          game.lastError = String(ev.message ?? "回合出错");
          pushStream({ kind: "note", level: "error", text: game.lastError });
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
    failed = true;
    if (isCurrent(context) && e?.name !== "AbortError") reportError(e);
  } finally {
    if (_turnAbort === controller) _turnAbort = null;
    if (!isCurrent(context)) return;
    game.turnStreaming = false;
    // 落定本回合所有还在流式输出的叙述块（判定后重指向的 current 也在其中）
    for (const e of game.stream) {
      if (e.kind === "narrative" && e.streaming) {
        e.text += e.pending;
        e.pending = "";
        e.streaming = false;
      }
    }
    // 空叙述块（判定后没等到续写就中断等）不留痕
    for (let i = game.stream.length - 1; i >= 0; i -= 1) {
      const e = game.stream[i];
      if (e.kind === "narrative" && !e.text.trim() && !e.pending) game.stream.splice(i, 1);
    }
    if (!sawDone || !sawState || failed) {
      // GET /state 与回合共用槽位锁，等后端结算结束再恢复可操作状态。
      game.loaded = false;
      game.loading = true;
      const recovered = await reloadState(context);
      if (recovered) {
        clearStream();
        game.suggestions = [];
        seedOpening();
        if (game.lastError) pushStream({ kind: "note", level: "error", text: game.lastError });
        notify("回合显示未完成，已同步服务端存档并恢复已保存的日志。", "info", 6000);
      }
    }
    if (isCurrent(context)) {
      game.busy = false;
      game.loading = false;
    }
  }
}

export function abortTurn() {
  if (_turnAbort) {
    _turnAbort.abort();
    game.turnStreaming = false;
    notify("已停止接收剧情。服务器仍会完成本回合，正在等待存档同步。", "info", 6000);
  }
}

// ---------------------------------------------------------------------------
// 移动
// ---------------------------------------------------------------------------
export async function moveTo(target) {
  if (game.busy || !game.loaded) return false;
  const to = String(target ?? "").trim();
  if (!to) return false;
  const context = session();
  _stateRevision += 1;
  game.busy = true;
  try {
    const data = await api.move(context.module, context.slot, to);
    if (!isCurrent(context)) return false;
    if (data.state) {
      _stateRevision += 1;
      game.state = data.state;
    }
    pushStream({ kind: "system", text: `移动 → ${to}` });
    for (const change of data.changes || []) pushStream({ kind: "note", level: "settle", text: change });
    for (const ev of data.events || []) {
      if (ev?.name) pushStream({ kind: "note", level: "warn", text: `途中触发事件：${ev.code || ""} ${ev.name}`.trim() });
    }
    notify(`已移动到「${to}」`, "success");
    return true;
  } catch (e) {
    if (isCurrent(context)) reportError(e);
    return false;
  } finally {
    if (isCurrent(context)) game.busy = false;
  }
}

// ---------------------------------------------------------------------------
// 结构化编辑（/api/state/edit）
// ---------------------------------------------------------------------------
export async function applyEdit(op, { silent = false } = {}) {
  if (game.busy) {
    if (!silent) notify("当前操作尚未完成，请等待存档同步后再编辑。", "warn");
    return false;
  }
  if (!game.loaded) {
    if (!silent) notify("还没有载入存档", "warn");
    return false;
  }
  const context = session();
  _stateRevision += 1;
  game.busy = true;
  try {
    const data = await api.edit(context.module, context.slot, op);
    if (!isCurrent(context)) return false;
    if (data.ok && data.state) {
      _stateRevision += 1;
      game.state = data.state;
    }
    if (!silent) {
      if (data.ok) notify(data.message || "已保存", "success", 2600);
      else notify(data.message || "编辑被拒绝", "warn", 4200);
    }
    return Boolean(data.ok);
  } catch (e) {
    if (isCurrent(context) && !silent) reportError(e);
    return false;
  } finally {
    if (isCurrent(context)) game.busy = false;
  }
}

/** 编辑后的存档回读（多步操作时保持面板与后端一致）。 */
export async function reloadState(context = session()) {
  if (!context.module || !context.slot) return false;
  const revision = _stateRevision;
  const request = ++_snapshotRequest;
  try {
    const data = await api.getState(context.module, context.slot);
    if (!isCurrent(context) || revision !== _stateRevision || request !== _snapshotRequest) return false;
    absorb(data);
    game.loaded = true;
    return true;
  } catch (e) {
    if (isCurrent(context) && revision === _stateRevision && request === _snapshotRequest) reportError(e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 生图
// ---------------------------------------------------------------------------
let _imgBusy = false;

/** kind: scene | location | portrait；成功后回传 URL（失败返回 null）。 */
export async function generateImage({ kind = "scene", prompt = "", name = "", anime = false } = {}) {
  if (!game.module || _imgBusy) return null;
  const context = session();
  _imgBusy = true;
  try {
    const data = await api.generateImage(context.module, context.slot, { kind, prompt, name, anime });
    if (!isCurrent(context)) return null;
    const url = data?.url ? String(data.url) : "";
    if (!url) return null;
    if (kind === "portrait") rememberPortrait(url);
    if (kind === "location" && name) rememberLocationImage(name, url);
    return data;
  } catch (e) {
    if (isCurrent(context)) reportError(e);
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
    void watchImageStartup();
    return game.config;
  } catch (e) {
    reportError(e);
    return null;
  }
}

let _imageStatusRequest = 0;
let _imageWatch = null;

/** 出图服务检测与存档独立，没有开档时也能管理运行时。 */
export async function loadImageStatus({ silent = false } = {}) {
  const request = ++_imageStatusRequest;
  try {
    const status = await api.imageStatus();
    if (request === _imageStatusRequest) game.comfy = status;
    return game.comfy;
  } catch (e) { if (!silent && request === _imageStatusRequest) reportError(e); return null; }
}

/** 冷启动完成后自动更新出图按钮，不要求玩家手动回读存档。 */
function watchImageStartup() {
  if (_imageWatch) return _imageWatch;
  _imageWatch = (async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const status = await loadImageStatus({ silent: true });
      if (!status || status.state !== "starting") return;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  })().finally(() => { _imageWatch = null; });
  return _imageWatch;
}

export async function controlImageRuntime(action) {
  try {
    const status = action === "start" ? await api.startImageRuntime() : await api.stopImageRuntime();
    _imageStatusRequest += 1;
    game.comfy = status;
    notify(action === "start" ? "出图服务已就绪" : game.comfy.stopped ? "项目内出图服务已停止" : "当前没有由游戏管理的出图进程", "info");
    return game.comfy;
  } catch (e) { reportError(e); return null; }
}

export async function saveConfig(patch) {
  try {
    game.config = await api.saveConfig(patch);
    game.hasKey = Boolean(game.config?.has_key);
    game.echo = Boolean(game.config?.echo);
    notify("配置已保存", "success");
    await loadImageStatus();
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
    const initial = session();
    await refreshSlots(initial);
    if (!isCurrent(initial)) return;
    const preferred = Number(loadLocal("slot", 1)) || 1;
    const hit = game.slots.find((s) => s.slot === preferred && s.exists) || game.slots.find((s) => s.exists);
    game.slot = hit ? hit.slot : preferred;
    remember();
    const context = session();
    await loadConfig();
    if (!isCurrent(context)) return;
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

/**
 * 后端 API 客户端。
 *
 * 端点契约以 web/server/routes/ 为准：
 *   GET  /api/modules                     {modules:[{name,dir,title,engine,tone,rating,files_exist}]}
 *   GET  /api/game/slots?module=           {module,title,slots:[{slot,exists,title,day,period,location,character,updated}]}
 *   GET  /api/game/state?module=&slot=     {module,state,map,characters,events,has_key,echo,comfy}
 *   POST /api/game/new                     {module,slot?,character?} → {state,path,overwrote}
 *   POST /api/turn                         {module,slot,action,history?} → SSE 事件流
 *   POST /api/move                         {module,slot,to} → {state,changes,events,path}
 *   POST /api/state/edit                   {module,slot,op} → {ok,message,state,path}
 *   GET  /api/config                       掩码配置
 *   POST /api/config                       合并白名单字段
 *   POST /api/image/generate               {module,slot,kind,prompt?,anime?,name?} → {url,file,kind,prompt,prompt_id}
 *
 * 错误统一抛 ApiError(message, status)，界面直接展示 message。
 */

/** 带后端错误文本的异常。 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json; charset=utf-8" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(`连不上后端（${e?.message ?? e}）。请确认 node web/server/index.js 已在 8000 端口运行。`, 0);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `请求失败：${res.status} ${res.statusText}`;
    throw new ApiError(String(message), res.status);
  }
  if (data === null) throw new ApiError(`后端返回的不是 JSON（${res.status}）`, res.status);
  return data;
}

const q = (obj) => new URLSearchParams(Object.entries(obj).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  listModules() {
    return request("/api/modules");
  },
  listSlots(module) {
    return request(`/api/game/slots?${q({ module })}`);
  },
  getState(module, slot) {
    return request(`/api/game/state?${q({ module, slot })}`);
  },
  newGame(module, slot, character) {
    return request("/api/game/new", { method: "POST", body: { module, slot, character: character || "" } });
  },
  move(module, slot, to) {
    return request("/api/move", { method: "POST", body: { module, slot, to } });
  },
  edit(module, slot, op) {
    return request("/api/state/edit", { method: "POST", body: { module, slot, op } });
  },
  getConfig() {
    return request("/api/config");
  },
  saveConfig(patch) {
    return request("/api/config", { method: "POST", body: patch });
  },
  testModelConfig(patch) { return request("/api/config/test", { method: "POST", body: patch }); },
  listModelConfig(patch) { return request("/api/config/models", { method: "POST", body: patch }); },
  imageStatus() { return request("/api/image/status"); },
  imageEnvironment(profile) { return request("/api/image/environment", { method: "POST", body: { profile } }); },
  imageSetupStatus() { return request("/api/image/setup"); },
  setupImage(profile) { return request("/api/image/setup", { method: "POST", body: { profile } }); },
  cancelImageSetup() { return request("/api/image/setup/cancel", { method: "POST", body: {} }); },
  disableImage() { return request("/api/image/disable", { method: "POST", body: {} }); },
  startImageRuntime() { return request("/api/image/runtime/start", { method: "POST", body: {} }); },
  stopImageRuntime() { return request("/api/image/runtime/stop", { method: "POST", body: {} }); },
  generateImage(module, slot, { kind, prompt, anime, name }) {
    return request("/api/image/generate", { method: "POST", body: { module, slot, kind, prompt, anime, name } });
  },

  /**
   * 一个 GM 回合（SSE）。POST + text/event-stream，用 fetch 读流，
   * 逐条吐出后端事件：started / narrative / dice / state / note / image / done / error。
   */
  async *streamTurn(module, slot, action, history, signal) {
    let res;
    try {
      res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Accept: "text/event-stream" },
        body: JSON.stringify({ module, slot, action, history }),
        signal,
      });
    } catch (e) {
      if (e?.name === "AbortError") return;
      throw new ApiError(`回合请求失败：${e?.message ?? e}`, 0);
    }
    if (!res.ok) {
      let message = `回合请求失败：${res.status}`;
      try {
        const body = await res.json();
        message = body?.error || message;
      } catch {
        /* 保持默认文案 */
      }
      throw new ApiError(String(message), res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              yield JSON.parse(payload);
            } catch {
              /* 半包或非 JSON 心跳：跳过 */
            }
          }
        }
      }
      const tail = buf.trim();
      if (tail.startsWith("data:")) {
        try {
          yield JSON.parse(tail.slice(5).trim());
        } catch {
          /* 忽略残包 */
        }
      }
    } finally {
      // 消费方收到 done 后会提前结束迭代，也必须释放响应流。
      try { await reader.cancel(); } catch { /* 连接可能已被 AbortController 关闭 */ }
      reader.releaseLock();
    }
  },
};

export default api;

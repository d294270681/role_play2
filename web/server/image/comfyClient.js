/** ComfyUI HTTP 协议：提交、轮询、工作流校验与取图；不访问游戏存档或启动进程。 */
import { setTimeout as sleep } from "node:timers/promises";

export class ComfyUnavailableError extends Error {
  constructor(message) { super(message); this.name = "ComfyUnavailableError"; this.status = 503; }
}
export const PROBE_TIMEOUT_MS = 2000;
export const SUBMIT_TIMEOUT_MS = 15000;
export const VIEW_TIMEOUT_MS = 30000;
export const POLL_INTERVAL_MS = 1500;
export const IMAGE_TIMEOUT_MS = 900000;

export async function isOnline(url, timeoutMs = PROBE_TIMEOUT_MS) {
  try { return (await fetch(`${String(url || "").replace(/\/+$/, "")}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) })).ok; }
  catch { return false; }
}

export async function validateWorkflow(base, workflow, fetcher = (...args) => fetch(...args)) {
  const response = await fetcher(`${base}/object_info`, { signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS) });
  if (!response.ok) throw new ComfyUnavailableError(`读取 ComfyUI 节点信息失败：HTTP ${response.status}`);
  const classes = await response.json();
  for (const node of Object.values(workflow)) {
    const definition = classes[node.class_type];
    if (!definition) throw new ComfyUnavailableError(`ComfyUI 缺少节点：${node.class_type}`);
    for (const [name, value] of Object.entries(node.inputs || {})) {
      const spec = definition.input?.required?.[name] || definition.input?.optional?.[name];
      if (Array.isArray(spec?.[0]) && !spec[0].includes(value)) throw new ComfyUnavailableError(`ComfyUI 不支持 ${node.class_type}.${name}=${value}；请确认模型组件与工作流匹配`);
    }
  }
}

export async function executeWorkflow(base, workflow, { timeoutMs = IMAGE_TIMEOUT_MS, fetcher = (...args) => fetch(...args), wait = sleep, pollMs = POLL_INTERVAL_MS, now = Date.now } = {}) {
  const deadline = now() + timeoutMs;
  let promptId;
  try {
    const response = await fetcher(`${base}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow }), signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS) });
    const data = await response.json();
    if (!response.ok || Object.keys(data.node_errors || {}).length) throw new ComfyUnavailableError(`ComfyUI 拒绝工作流：${JSON.stringify(data).slice(0, 700)}`);
    promptId = data.prompt_id;
    if (!promptId) throw new ComfyUnavailableError("ComfyUI 未返回 prompt_id");
    while (now() < deadline) {
      await wait(pollMs);
      let entry;
      try {
        const response = await fetcher(`${base}/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS) });
        if (!response.ok) continue;
        entry = (await response.json())?.[promptId];
      } catch { continue; }
      if (!entry) continue;
      if (entry.status?.status_str === "error") throw Object.assign(new Error(`ComfyUI 生成失败：${JSON.stringify(entry.status.messages || []).slice(0, 700)}`), { status: 500 });
      if (!entry.status?.completed) continue;
      const image = Object.values(entry.outputs || {}).flatMap((out) => out.images || []).find((img) => img.filename);
      if (!image) throw Object.assign(new Error("ComfyUI 已完成，但没有图片输出"), { status: 500 });
      const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" });
      const response = await fetcher(`${base}/view?${params}`, { signal: AbortSignal.timeout(VIEW_TIMEOUT_MS) });
      if (!response.ok) throw new ComfyUnavailableError(`取图失败：HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 8 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Object.assign(new Error("ComfyUI 返回的内容不是 PNG 图片"), { status: 500 });
      return { buffer, prompt_id: promptId };
    }
    throw new ComfyUnavailableError(`出图等待超时，任务 ${promptId} 可能仍在队列中，请先查看队列再重试`);
  } catch (e) {
    if (e?.status) throw e;
    throw new ComfyUnavailableError(`ComfyUI 通信失败：${e?.message ?? e}`);
  }
}

/**
 * ComfyUI（本机 Z-Image-Turbo）生图客户端。
 *
 * 工作流为实测可用的配方（节点不猜）：
 *   UNETLoader(z_image_turbo_bf16.safetensors) → LoraLoaderModelOnly(NSFW_master_ZIT.safetensors, 0.8)
 *   → ModelSamplingAuraFlow(shift 3.0)；CLIPLoader(qwen_3_4b.safetensors, type "lumina2")
 *   → CLIPTextEncode + ConditioningZeroOut(负向)；EmptySD3LatentImage(1024,1024,1)；
 *   KSampler(8 步, cfg 1.0, res_multistep, simple)；VAELoader(ae.safetensors) → VAEDecode → SaveImage。
 *
 * 流程：POST /prompt 提交 → 轮询 /history/{prompt_id} → GET /view 取 PNG → 存
 * web/assets/<本名>/<kind>-<时间戳>.png，返回 {url, prompt, kind, file, prompt_id}。
 *
 * 可用性策略：ComfyUI 不可达时快速失败（probe 2s）抛 ComfyUnavailableError（HTTP 503），
 * 所有网络异常都在本模块内收敛成异常，绝不崩主服务。
 *
 * assemblePrompt(kind, module, state, extra)：
 *   scene    = 直接用 GM 给出的 image_prompt（补风格前缀；含 anime 时 LoRA 降到 0.5 并前置 anime style 标签）
 *   location = 由地点描述拼模板（英文风格标签 + 本册原文，Qwen 文本编码器可直读中文）
 *   portrait = 由角色卡「外貌 / 概念」拼模板
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { loadConfig, normalizeConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ASSETS_ROOT = path.resolve(__dirname, "..", "assets");

export const MODEL_FILES = {
  unet: "z_image_turbo_bf16.safetensors",
  lora: "NSFW_master_ZIT.safetensors",
  clip: "qwen_3_4b.safetensors",
  vae: "ae.safetensors",
};

export const KINDS = ["scene", "location", "portrait"];

export const PROBE_TIMEOUT_MS = 2000;
export const SUBMIT_TIMEOUT_MS = 15000;
export const VIEW_TIMEOUT_MS = 30000;
export const POLL_INTERVAL_MS = 1500;
export const IMAGE_TIMEOUT_MS = 180000;

const STYLE_REAL = "masterpiece, best quality, photorealistic, cinematic lighting, highly detailed";
const STYLE_ANIME = "anime style, masterpiece, best quality, clean lineart, vibrant colors, detailed";

export class ComfyUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ComfyUnavailableError";
    this.status = 503;
  }
}

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

function normalizeBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function safeDirName(name) {
  const out = String(name || "").replace(/[\\/:*?"<>|]+/g, "").trim();
  return out || "unnamed";
}

function stamp() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

async function safeText(res) {
  try {
    return (await res.text()).replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return "";
  }
}

/** 内置 Z-Image-Turbo 工作流（与 F:/ai/dl/smoke_test.py 实测配方一致）。 */
export function buildWorkflow({
  prompt,
  loraStrength = 0.8,
  seed = null,
  width = 1024,
  height = 1024,
  steps = 8,
  cfg = 1.0,
  filenamePrefix = "rpg",
} = {}) {
  const useSeed = seed === null || seed === undefined ? Math.floor(Math.random() * 0xffffffff) : seed;
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: MODEL_FILES.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: MODEL_FILES.clip, type: "lumina2" } },
    3: { class_type: "VAELoader", inputs: { vae_name: MODEL_FILES.vae } },
    4: {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["1", 0], lora_name: MODEL_FILES.lora, strength_model: loraStrength },
    },
    10: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["4", 0], shift: 3.0 } },
    5: { class_type: "CLIPTextEncode", inputs: { text: String(prompt || ""), clip: ["2", 0] } },
    11: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["5", 0] } },
    6: { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    7: {
      class_type: "KSampler",
      inputs: {
        model: ["10", 0],
        seed: useSeed,
        steps,
        cfg,
        sampler_name: "res_multistep",
        scheduler: "simple",
        positive: ["5", 0],
        negative: ["11", 0],
        latent_image: ["6", 0],
        denoise: 1.0,
      },
    },
    8: { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    9: { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: filenamePrefix } },
  };
}

/** 快速探测 ComfyUI 是否在线（GET /system_stats，超时 2s）。 */
export async function isOnline(comfyUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  const base = normalizeBase(comfyUrl);
  if (!base) return false;
  try {
    const res = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

function findLocation(module, name) {
  const target = String(name || "").trim();
  if (!target) return null;
  const locs = module?.locations || [];
  for (const loc of locs) {
    if (String(loc?.name || "").trim() === target) return loc;
  }
  for (const loc of locs) {
    const n = String(loc?.name || "").trim();
    if (n && (target.includes(n) || n.includes(target))) return loc;
  }
  return null;
}

function pickCard(module, name) {
  const cards = module?.characters || [];
  const target = String(name || "").trim();
  if (!target) return null;
  for (const c of cards) if (c.name === target) return c;
  for (const c of cards) if (c.name && (c.name.includes(target) || target.includes(c.name))) return c;
  return null;
}

/**
 * 拼生图提示词。返回 {prompt, kind, anime, loraStrength}。
 * scene 必须提供 extra.prompt（GM 的 image_prompt）；location / portrait 由存档与模块推导。
 */
export function assemblePrompt(kind, module, state = null, extra = {}) {
  const rawPrompt = String(extra.prompt || "").trim();
  const anime = extra.anime === true || /anime/i.test(rawPrompt);
  const style = anime ? STYLE_ANIME : STYLE_REAL;
  const loraStrength = anime ? 0.5 : 0.8;
  const title = module?.title || module?.name || "RPG";

  if (kind === "scene") {
    if (!rawPrompt) throw badRequest("scene 生图需要 prompt（由 GM 的 image_prompt 提供）");
    return { prompt: `${style}, ${rawPrompt}`, kind, anime, loraStrength };
  }

  if (kind === "location") {
    const loc = findLocation(module, state?.location) || { name: state?.location || "未知地点" };
    const desc = String(loc.desc || loc.raw || "").replace(/\s+/g, " ").slice(0, 320);
    const parts = [style, "environment concept art, wide establishing shot, no people", `《${title}》场景：${loc.name}`];
    if (desc) parts.push(desc);
    if (loc.faction) parts.push(`势力：${loc.faction}`);
    if (loc.danger !== null && loc.danger !== undefined) parts.push(`危险度 ${loc.danger}`);
    return { prompt: parts.join("，"), kind, anime, loraStrength };
  }

  if (kind === "portrait") {
    const name = String(extra.name || state?.character?.name || "").trim();
    const card = pickCard(module, name);
    const parts = [style, "character portrait, upper body, looking at viewer"];
    if (card) {
      parts.push(card.name);
      if (card.concept) parts.push(card.concept);
      const appearance = card.meta?.["外貌"] || card.meta?.["特点"] || "";
      if (appearance) parts.push(appearance);
      if (card.meta?.["年龄"]) parts.push(card.meta["年龄"]);
    } else if (name) {
      parts.push(name);
    }
    if (module?.tone) parts.push(`基调：${module.tone}`);
    return { prompt: parts.join("，"), kind, anime, loraStrength };
  }

  throw badRequest(`未知生图类型：${kind}（可用：${KINDS.join(" / ")}）`);
}

function saveAsset(buffer, module, kind) {
  const dir = path.join(ASSETS_ROOT, safeDirName(module?.name || module?.title || "unnamed"));
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${kind}-${stamp()}.png`;
  const file = path.join(dir, filename);
  fs.writeFileSync(file, buffer);
  return { file, url: `/assets/${encodeURIComponent(path.basename(dir))}/${filename}` };
}

function firstImage(outputs) {
  for (const out of Object.values(outputs || {})) {
    for (const img of out?.images || []) {
      if (img?.filename) return img;
    }
  }
  return null;
}

/**
 * 生成一张图并落盘到 web/assets/。
 * 失败语义：ComfyUI 不可达/超时 → ComfyUnavailableError(503)；参数与工作流错误 → status 400/500 的 Error。
 */
export async function generateImage({
  module,
  state = null,
  kind = "scene",
  prompt = "",
  config = null,
  anime = false,
  timeoutMs = IMAGE_TIMEOUT_MS,
} = {}) {
  const cfg = normalizeConfig(config || loadConfig());
  const base = normalizeBase(cfg.comfy_url);
  const built = assemblePrompt(kind, module, state, { prompt, anime });

  if (!(await isOnline(base))) {
    throw new ComfyUnavailableError(`ComfyUI 未在线或不可达：${base || "（未配置 comfy_url）"}（请先启动 ComfyUI，或在 /api/config 修改 comfy_url）`);
  }

  const workflow = buildWorkflow({ prompt: built.prompt, loraStrength: built.loraStrength, filenamePrefix: `rpg_${kind}` });

  let promptId = null;
  try {
    const res = await fetch(`${base}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
    if (!res.ok) throw new ComfyUnavailableError(`ComfyUI 提交失败：HTTP ${res.status} ${await safeText(res)}`);
    const data = await res.json();
    const nodeErrors = data?.node_errors;
    if (nodeErrors && Object.keys(nodeErrors).length) {
      const e = new Error(`ComfyUI 工作流校验失败：${JSON.stringify(nodeErrors).slice(0, 500)}`);
      e.status = 500;
      throw e;
    }
    promptId = data?.prompt_id || null;
    if (!promptId) {
      const e = new Error("ComfyUI 未返回 prompt_id");
      e.status = 500;
      throw e;
    }
  } catch (e) {
    if (e instanceof ComfyUnavailableError || e?.status) throw e;
    throw new ComfyUnavailableError(`连接 ComfyUI 失败（${base}）：${e?.message ?? e}`);
  }

  const deadline = Date.now() + Math.max(5000, timeoutMs);
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let entry = null;
    try {
      const res = await fetch(`${base}/history/${encodeURIComponent(promptId)}`, {
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const hist = await res.json();
      entry = hist?.[promptId] || null;
    } catch {
      continue; // 单次轮询失败继续等，超时统一处理
    }
    if (!entry) continue;
    const status = entry.status || {};
    if (status.status_str === "error") {
      const detail = JSON.stringify(status.messages || entry).slice(0, 500);
      const e = new Error(`ComfyUI 生成失败：${detail}`);
      e.status = 500;
      throw e;
    }
    if (!status.completed) continue;
    const img = firstImage(entry.outputs);
    if (!img) {
      const e = new Error("ComfyUI 已完成但输出中没有图片");
      e.status = 500;
      throw e;
    }
    const viewUrl = `${base}/view?filename=${encodeURIComponent(img.filename)}`
      + `&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
    let buffer;
    try {
      const res = await fetch(viewUrl, { signal: AbortSignal.timeout(VIEW_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      throw new ComfyUnavailableError(`取图失败（${viewUrl}）：${e?.message ?? e}`);
    }
    const saved = saveAsset(buffer, module, kind);
    return {
      url: saved.url,
      file: saved.file,
      kind,
      prompt: built.prompt,
      prompt_id: promptId,
      anime: built.anime,
      lora_strength: built.loraStrength,
      bytes: buffer.length,
    };
  }

  throw new ComfyUnavailableError(`ComfyUI 生成超时（${timeoutMs}ms，prompt_id=${promptId}）`);
}

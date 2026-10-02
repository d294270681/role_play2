/** 游戏出图服务：公开提示词、模型档案、运行时、HTTP 客户端与图片归档的组合入口。 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig, normalizeConfig } from "../config.js";
import { buildProfileWorkflow, getProfile } from "./profiles.js";
import { imageRuntime } from "./runtime.js";
import { executeWorkflow, validateWorkflow } from "./comfyClient.js";
export { ComfyUnavailableError, isOnline, PROBE_TIMEOUT_MS, SUBMIT_TIMEOUT_MS, VIEW_TIMEOUT_MS, POLL_INTERVAL_MS, IMAGE_TIMEOUT_MS } from "./comfyClient.js";
export { imageRuntime } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS_ROOT = path.resolve(__dirname, "..", "..", "assets");
export const MODEL_FILES = Object.fromEntries(Object.entries(getProfile().models).map(([key, spec]) => [key, spec.file]));
export const KINDS = ["scene", "location", "portrait"];
const STYLE_REAL = "masterpiece, best quality, photorealistic, cinematic lighting, highly detailed";
const STYLE_ANIME = "anime style, masterpiece, best quality, clean lineart, vibrant colors, detailed";
function badRequest(message) { return Object.assign(new Error(message), { status: 400 }); }
function safeDirName(name) { const result = String(name || "").replace(/[\\/:*?"<>|]+/g, "").trim(); return !result || result === "." || result === ".." ? "unnamed" : result; }
function stamp() { return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace("Z", "") + "-" + randomUUID().slice(0, 8); }
export function buildWorkflow(options = {}) { return buildProfileWorkflow(options).workflow; }

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


/** 所有游戏生图入口共用此服务；工作流与模型参数属于独立档案。 */
export async function generateImage({ module, state = null, kind = "scene", prompt = "", name = "", config = null, anime = false, timeoutMs = null, parameters = {} } = {}) {
  const cfg = normalizeConfig(config || loadConfig());
  const built = assemblePrompt(kind, module, state, { prompt, anime, name });
  const base = await imageRuntime.ensureReady(cfg);
  const prepared = buildProfileWorkflow({ profile: cfg.image_generation.profile, prompt: built.prompt, loraStrength: built.loraStrength, filenamePrefix: "rpg_" + kind, ...parameters });
  await validateWorkflow(base, prepared.workflow);
  const result = await executeWorkflow(base, prepared.workflow, { timeoutMs: timeoutMs ?? prepared.profile.timeout_seconds * 1000 });
  const saved = saveAsset(result.buffer, module, kind);
  return {
    ...saved, kind, prompt: built.prompt, prompt_id: result.prompt_id,
    profile: prepared.profile.id, seed: prepared.parameters.seed,
    width: prepared.parameters.width, height: prepared.parameters.height, steps: prepared.parameters.steps,
    anime: built.anime, lora_strength: prepared.profile.models.lora ? prepared.parameters.loraStrength : 0,
    bytes: result.buffer.length,
  };
}

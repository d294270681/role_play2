/** 模型档案与工作流模板；不包含进程、存档或网络逻辑。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ai");
const catalog = JSON.parse(fs.readFileSync(path.join(AI_ROOT, "profiles.json"), "utf8"));
export const DEFAULT_PROFILE = catalog.default;
const profiles = new Map(catalog.profiles.map((profile) => [profile.id, profile]));

export function runtimePaths(root = AI_ROOT) {
  return {
    root, python: path.join(root, "runtime", "python", "python.exe"),
    bootstrap: path.join(root, "bootstrap.py"), comfy: path.join(root, "vendor", "ComfyUI"),
    models: path.join(root, "models"), data: path.join(root, "data"),
    install: path.join(root, "runtime", "install.json"),
    log: path.join(root, "data", "logs", "comfyui.log"),
  };
}

export function getProfile(id = DEFAULT_PROFILE) {
  const profile = profiles.get(id);
  if (!profile) throw Object.assign(new Error(`未知生图模型档案：${id}`), { status: 400 });
  return structuredClone(profile);
}

export function imageSettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
  const integer = (v, fallback, min, max) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    mode: value.mode === "external" ? "external" : "internal",
    auto_start: value.auto_start !== false,
    profile: profiles.has(value.profile) ? value.profile : DEFAULT_PROFILE,
    port: integer(value.port, 8188, 1024, 65535),
    startup_timeout: integer(value.startup_timeout, 120, 10, 600),
  };
}

export function listProfiles(root = AI_ROOT) {
  return [...profiles.values()].map((profile) => {
    const models = Object.values(profile.models).map(({ directory, file }) => {
      const location = path.join(root, "models", directory, file);
      let bytes = 0;
      try { bytes = fs.statSync(location).size; } catch { /* 尚未导入 */ }
      return { directory, file, installed: bytes > 0, bytes };
    });
    return { id: profile.id, title: profile.title, description: profile.description, available: models.every((m) => m.installed), models };
  });
}

export function buildProfileWorkflow({ profile = DEFAULT_PROFILE, prompt = "", negativePrompt = "低画质，模糊，畸形，水印", filenamePrefix = "rpg", ...options } = {}) {
  const definition = getProfile(profile);
  const values = { ...definition.parameters, ...options, prompt: String(prompt), negativePrompt: String(negativePrompt), filenamePrefix: String(filenamePrefix), seed: options.seed ?? Math.floor(Math.random() * 0xffffffff) };
  for (const [key, model] of Object.entries(definition.models)) values[key] = model.file;
  for (const key of ["width", "height"]) {
    if (!Number.isInteger(values[key]) || values[key] < 64 || values[key] > 2048 || values[key] % 8) throw Object.assign(new Error(`${key} 必须是 64–2048 范围内的 8 的倍数`), { status: 400 });
  }
  if (!Number.isInteger(values.steps) || values.steps < 1 || values.steps > 100) throw Object.assign(new Error("采样步数必须是 1–100"), { status: 400 });
  if (!Number.isSafeInteger(values.seed) || values.seed < 0) throw Object.assign(new Error("seed 必须是非负安全整数"), { status: 400 });
  if (!Number.isFinite(values.cfg) || values.cfg < 0 || values.cfg > 20) throw Object.assign(new Error("CFG 必须是 0–20"), { status: 400 });
  const template = JSON.parse(fs.readFileSync(path.join(AI_ROOT, "workflows", definition.workflow), "utf8"));
  const fill = (value) => {
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, fill(v)]));
    const match = typeof value === "string" && /^\{\{(\w+)\}\}$/.exec(value);
    if (!match) return value;
    if (!(match[1] in values)) throw new Error(`工作流缺少参数：${match[1]}`);
    return values[match[1]];
  };
  return { workflow: fill(template), profile: definition, parameters: values };
}

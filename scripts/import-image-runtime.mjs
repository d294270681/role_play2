/** 把用户授权的现有安装复制到项目内；不移动、修改或删除源安装。 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shouldCopyComfy } from "./image-import-plan.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aiRoot = path.join(projectRoot, "ai");
const sourceIndex = process.argv.indexOf("--source");
if (sourceIndex < 0 || !process.argv[sourceIndex + 1]) throw new Error("用法：node scripts/import-image-runtime.mjs --source <现有 AI 安装目录>");
const sourceRoot = fs.realpathSync(path.resolve(process.argv[sourceIndex + 1]));
if (aiRoot.startsWith(`${sourceRoot}${path.sep}`) || sourceRoot.startsWith(`${aiRoot}${path.sep}`)) throw new Error("源目录与目标目录不能嵌套");
const choose = (candidates, label) => {
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`找不到 ${label}：${candidates.join(" / ")}`);
  return found;
};
const comfySource = choose([path.join(sourceRoot, "ComfyUI-src"), path.join(sourceRoot, "ComfyUI_windows_portable", "ComfyUI"), sourceRoot].filter((p) => fs.existsSync(path.join(p, "main.py"))), "ComfyUI 源码");
const sourcePython = choose([path.join(comfySource, "venv", "Scripts", "python.exe"), path.join(sourceRoot, "python_embeded", "python.exe")], "原 Python 环境");
const inspect = spawnSync(sourcePython, ["-c", "import json,sys,site;print(json.dumps({'base':sys.base_prefix,'sites':site.getsitepackages(),'version':sys.version.split()[0]}))"], { encoding: "utf8", windowsHide: true });
if (inspect.status !== 0) throw new Error(`原 Python 环境不能启动：${inspect.stderr}`);
const pythonInfo = JSON.parse(inspect.stdout.trim());
const baseSource = pythonInfo.base;
const venvPackages = path.join(comfySource, "venv", "Lib", "site-packages");
const packageKey = (name) => name.replace(/-(?=\d).*\.(?:dist|egg)-info$/, "").replaceAll("_", "-").toLowerCase();
const overrides = new Set(fs.existsSync(venvPackages) ? fs.readdirSync(venvPackages).map(packageKey) : []);
const skipNames = new Set([".git", "__pycache__", "Doc", "Tools", "include", "libs", "Scripts"]);
const startedAt = new Date().toISOString();
let port = 8188;
try { port = JSON.parse(fs.readFileSync(path.join(projectRoot, "web", "config.json"), "utf8")).image_generation?.port || port; } catch { /* 使用默认内部端口 */ }
let stats;
try { const response = await fetch(`http://127.0.0.1:${port}/system_stats`, { signal: AbortSignal.timeout(1500) }); if (response.ok) stats = await response.json(); } catch { /* 尚未运行 */ }
const args = stats?.system?.argv || [];
const modelsArg = args.indexOf("--models-directory");
if (modelsArg >= 0 && typeof args[modelsArg + 1] === "string" && path.resolve(args[modelsArg + 1]).toLowerCase() === path.join(aiRoot, "models").toLowerCase()) throw new Error("项目内 ComfyUI 正在运行，请先停止出图服务再导入");
await fsp.mkdir(path.join(aiRoot, "runtime"), { recursive: true });
await fsp.writeFile(path.join(aiRoot, "runtime", "install.json"), JSON.stringify({ version: 1, completed: false, started_at: startedAt, source: sourceRoot }));
console.log(`[AI] 复制 Python ${pythonInfo.version} 和标准库…`);
await fsp.cp(baseSource, path.join(aiRoot, "runtime", "python"), { recursive: true, filter: (src) => {
  const rel = path.relative(baseSource, src).split(path.sep);
  if (rel.some((part) => skipNames.has(part))) return false;
  const site = rel.findIndex((part) => part.toLowerCase() === "site-packages");
  return site < 0 || !rel[site + 1] || !overrides.has(packageKey(rel[site + 1]));
} });
if (fs.existsSync(venvPackages)) {
  console.log("[AI] 复制 ComfyUI 的 CUDA 与 Python 依赖…");
  await fsp.cp(venvPackages, path.join(aiRoot, "runtime", "python", "Lib", "site-packages"), { recursive: true, filter: (src) => !path.relative(venvPackages, src).split(path.sep).includes("__pycache__") });
}
console.log("[AI] 复制 ComfyUI 程序与原始许可证…");
await fsp.cp(comfySource, path.join(aiRoot, "vendor", "ComfyUI"), { recursive: true, filter: (src) => shouldCopyComfy(comfySource, src) });
const nodeSource = path.join(sourceRoot, "nodejs");
if (fs.existsSync(path.join(nodeSource, "node.exe"))) {
  console.log("[AI] 复制 Node.js 运行时…");
  const executingTarget = path.resolve(process.execPath).toLowerCase() === path.join(aiRoot, "runtime", "node", "node.exe").toLowerCase();
  await fsp.cp(nodeSource, path.join(aiRoot, "runtime", "node"), { recursive: true, filter: (src) => !(executingTarget && path.resolve(src).toLowerCase() === path.join(nodeSource, "node.exe").toLowerCase()) });
}
for (const dir of ["logs", "user", "input", "output", "temp", "cache"]) await fsp.mkdir(path.join(aiRoot, "data", dir), { recursive: true });
const catalog = JSON.parse(fs.readFileSync(path.join(aiRoot, "profiles.json"), "utf8"));
const modelRoots = [path.join(comfySource, "models"), path.join(sourceRoot, "ComfyUI_windows_portable", "ComfyUI", "models"), path.join(sourceRoot, "models")];
const imported = [], absent = [];
const done = new Set();
async function digest(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
for (const profile of catalog.profiles) for (const model of Object.values(profile.models)) {
  const key = `${model.directory}/${model.file}`;
  if (done.has(key)) continue;
  done.add(key);
  const source = modelRoots.map((root) => path.join(root, model.directory, model.file)).find((p) => fs.existsSync(p));
  if (!source) { absent.push(key); continue; }
  const target = path.join(aiRoot, "models", model.directory, model.file);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const bytes = fs.statSync(source).size;
  console.log(`[AI] 复制模型 ${model.file}（${(bytes / 2 ** 30).toFixed(2)} GiB）…`);
  const tmp = `${target}.importing`;
  await fsp.copyFile(source, tmp);
  if (fs.statSync(tmp).size !== bytes) throw new Error(`模型复制长度错误：${model.file}`);
  await fsp.rename(tmp, target);
  console.log(`[AI] 校验模型 ${model.file}…`);
  imported.push({ path: key, bytes, sha256: await digest(target) });
}
const runtimePython = path.join(aiRoot, "runtime", "python", "python.exe");
console.log("[AI] 检查项目内依赖与 CUDA…");
const check = spawnSync(runtimePython, ["-s", path.join(aiRoot, "bootstrap.py"), "--check"], {
  encoding: "utf8", windowsHide: true,
  env: { ...process.env, PYTHONHOME: path.dirname(runtimePython), PYTHONPATH: "", PYTHONNOUSERSITE: "1", PYTHONIOENCODING: "utf-8" },
});
if (check.status !== 0) throw new Error(`项目内运行时检查失败：${check.stderr}\n${check.stdout}`);
const environment = JSON.parse(check.stdout.trim().split(/\r?\n/).at(-1));
await fsp.writeFile(path.join(aiRoot, "requirements.lock.txt"), `# Windows / Python ${environment.python}; CUDA wheels use https://download.pytorch.org/whl/cu128\n${environment.packages.join("\n")}\n`);
await fsp.writeFile(path.join(aiRoot, "runtime", "install.json"), JSON.stringify({ version: 1, completed: true, started_at: startedAt, completed_at: new Date().toISOString(), source: sourceRoot, python: environment.python, torch: environment.torch, cuda: environment.cuda, device: environment.device, models: imported, absent }, null, 2));
console.log(JSON.stringify({ installed: true, python: environment.python, torch: environment.torch, cuda: environment.cuda, models: imported.map((m) => m.path), missing_optional_models: absent }, null, 2));

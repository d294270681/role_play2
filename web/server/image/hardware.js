/** 只在用户配置时检查硬件；不用 Python/torch，也不加载模型。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getProfile, runtimePaths } from "./profiles.js";

const exec = promisify(execFile);
export const GiB = 1024 ** 3;
export const API_RECOMMENDATION = "当前环境不适合所选本地生图模型，建议使用图片 API，或更换模型/升级硬件。图片 API 暂未接入，可继续游玩文字冒险。";

export function parseNvidiaGpus(csv) {
  return String(csv).trim().split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const fields = line.match(/(?:"[^"]*"|[^,])+/g)?.map((v) => v.trim().replace(/^"|"$/g, "")) || [];
    const [index, name, total, free, driver, capability] = fields;
    if (fields.length !== 6 || !Number.isInteger(Number(index)) || !Number.isFinite(Number(total))) return [];
    return [{ index: Number(index), name, vram_bytes: Number(total) * 1024 ** 2,
      free_bytes: Number.isFinite(Number(free)) ? Number(free) * 1024 ** 2 : null,
      driver, compute_capability: Number(capability) || null }];
  });
}

function versionAtLeast(actual, required) {
  if (!/^\d+(\.\d+)+$/.test(String(actual))) return false;
  const a = String(actual).split(".").map(Number), b = required.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

export function assessHardware(hardware, profile, { missingBytes = 0, runtimeInstalled = false } = {}) {
  const req = profile.requirements;
  const suitable = (g) => g.vram_bytes >= req.vram_gib * GiB && g.compute_capability >= req.compute_capability && versionAtLeast(g.driver, req.driver_windows);
  // 显式保存设备号，避免多卡机器检测 GPU 1、实际却用 GPU 0。
  const gpu = [...(hardware.gpus || [])].sort((a, b) => Number(suitable(b)) - Number(suitable(a)) || b.vram_bytes - a.vram_bytes)[0] || null;
  const diskRequired = missingBytes + (runtimeInstalled ? 4 : 16) * GiB;
  const check = (id, title, passed, actual, required, reason) => ({ id, title, passed: Boolean(passed), actual, required, reason: passed ? "" : reason });
  const checks = [
    check("platform", "系统", hardware.platform === "win32" && hardware.arch === "x64", `${hardware.platform}/${hardware.arch}`, "Windows x64", "当前自动安装支持 Windows x64 + NVIDIA GPU"),
    check("gpu", "GPU 显存", gpu && gpu.vram_bytes >= req.vram_gib * GiB, gpu ? `${gpu.name} · ${(gpu.vram_bytes / GiB).toFixed(1)} GiB` : "未检测到可用 NVIDIA GPU", `≥ ${req.vram_gib} GiB`, `需要 NVIDIA GPU，显存至少 ${req.vram_gib} GiB`),
    check("compute", "GPU 架构", gpu?.compute_capability >= req.compute_capability, gpu?.compute_capability ?? "未知", `CUDA 算力 ≥ ${req.compute_capability}`, "当前配方需要支持 BF16 的 NVIDIA Ampere 或更新架构"),
    check("driver", "GPU 驱动", gpu && versionAtLeast(gpu.driver, req.driver_windows), gpu?.driver || "未知", `≥ ${req.driver_windows}`, `CUDA 12.8 环境需要兼容驱动（本项目门槛 ${req.driver_windows}）`),
    check("ram", "内存", hardware.ram_bytes >= (req.ram_gib - 0.5) * GiB, `${(hardware.ram_bytes / GiB).toFixed(1)} GiB`, `≥ ${req.ram_gib} GiB`, `内存至少 ${req.ram_gib} GiB（预留系统硬件占用容差 0.5 GiB）`),
    check("cpu", "CPU", hardware.cpu.threads >= req.cpu_threads, `${hardware.cpu.name} · ${hardware.cpu.threads} 线程`, `≥ ${req.cpu_threads} 线程`, `CPU 至少 ${req.cpu_threads} 个逻辑线程`),
    check("disk", "工程所在磁盘可用空间", Number.isFinite(hardware.disk_free_bytes) && hardware.disk_free_bytes >= diskRequired, hardware.disk_free_bytes == null ? "未知" : `${(hardware.disk_free_bytes / GiB).toFixed(1)} GiB`, `≥ ${(diskRequired / GiB).toFixed(1)} GiB`, "磁盘空间不足或无法读取可用空间，无法安全完成安装"),
  ];
  const eligible = checks.every((c) => c.passed);
  const warnings = [];
  if (gpu?.free_bytes != null && gpu.free_bytes < 8 * GiB) warnings.push("GPU 当前可用显存较少，出图前请关闭占用显存的应用");
  if (hardware.free_ram_bytes < 8 * GiB) warnings.push("当前空闲内存不足 8 GiB，出图前请关闭占用内存的应用");
  return { profile: profile.id, title: profile.title, eligible, device: gpu?.index ?? null, hardware, checks, warnings,
    requirements: req, download_bytes: missingBytes, disk_required_bytes: diskRequired,
    policy: "这是当前配方的保守安装门槛；内存、CPU 与 Qwen 显存门槛为项目策略，不代表模型理论最低要求。",
    recommendation: eligible ? "" : API_RECOMMENDATION, checked_at: new Date().toISOString() };
}

export async function detectEnvironment(profileId, { paths = runtimePaths(), run = exec, system = os, statfs = fs.promises.statfs, signal } = {}) {
  signal?.throwIfAborted();
  const profile = getProfile(profileId);
  const hardware = { platform: system.platform(), arch: system.arch(), ram_bytes: system.totalmem(), free_ram_bytes: system.freemem(),
    cpu: { name: system.cpus()[0]?.model || "未知 CPU", threads: system.cpus().length }, gpus: [], gpu_error: "", disk_free_bytes: null };
  const results = await Promise.allSettled([
    (async () => {
      const command = "--query-gpu=index,name,memory.total,memory.free,driver_version,compute_cap";
      const options = { windowsHide: true, timeout: 8000, maxBuffer: 128 * 1024, encoding: "utf8", signal };
      try { return await run("nvidia-smi", [command, "--format=csv,noheader,nounits"], options); }
      catch (e) {
        signal?.throwIfAborted();
        // 驱动存在但 nvidia-smi 没在 PATH 时使用系统驱动目录。
        if (hardware.platform !== "win32" || !process.env.SystemRoot) throw e;
        return run(path.join(process.env.SystemRoot, "System32", "nvidia-smi.exe"), [command, "--format=csv,noheader,nounits"], options);
      }
    })(),
    statfs(path.dirname(paths.root)),
  ]);
  signal?.throwIfAborted();
  if (results[0].status === "fulfilled") hardware.gpus = parseNvidiaGpus(results[0].value.stdout);
  else hardware.gpu_error = "未能读取 NVIDIA GPU 信息；请检查显卡与驱动";
  if (results[1].status === "fulfilled") hardware.disk_free_bytes = Number(results[1].value.bavail) * Number(results[1].value.bsize);
  const missingBytes = Object.values(profile.models).filter((m) => !m.optional).reduce((sum, model) => {
    let size = 0, partial = 0;
    const dest = path.join(paths.models, model.directory, model.file);
    try { size = fs.statSync(dest).size; } catch { /* 尚未安装 */ }
    try { partial = Math.min(fs.statSync(`${dest}.part`).size, model.bytes); } catch { /* 无中断下载 */ }
    return sum + (size === model.bytes ? 0 : Math.max(0, model.bytes - partial));
  }, 0);
  let installed = false;
  try { installed = JSON.parse(fs.readFileSync(paths.install, "utf8")).completed === true && fs.existsSync(paths.python) && fs.existsSync(path.join(paths.comfy, "main.py")); } catch { /* 尚未安装 */ }
  return assessHardware(hardware, profile, { missingBytes, runtimeInstalled: installed });
}

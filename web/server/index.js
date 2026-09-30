/**
 * RPG Web 后端入口（Express）。
 *
 * 用法：
 *   node web/server/index.js [端口]      # 默认 http://127.0.0.1:8000（也支持环境变量 PORT）
 * 启动时若 web/config.json 不存在，会自动生成模板（base_url / 空 api_key / model / temperature / comfy_url）。
 *
 * 托管：
 *   /api/**          → routes/index.js（模块白名单 / 存档 / GM 回合 SSE / 移动 / 编辑 / 配置 / 生图）
 *   /assets/**       → web/assets（ComfyUI 生成的 PNG）
 *   /**              → web/client/dist（前端构建产物；未部署时 / 返回占位页）
 *
 * 错误处理：ApiError / 带 status 的异常（含 ComfyUnavailableError 503）映射为 JSON；
 * 其余 500 记录日志，绝不让单个请求打崩进程。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import * as configMod from "./config.js";
import * as comfy from "./comfy.js";
import apiRouter from "./routes/index.js";
import { ApiError } from "./routes/shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..");
const CLIENT_DIST = path.join(WEB_DIR, "client", "dist");
const DEFAULT_PORT = 8000;

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>RPG Web 后端</title>
<style>body{font-family:system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem;color:#222;line-height:1.7}code{background:#f4f4f4;padding:.1em .35em;border-radius:4px}</style>
</head>
<body>
<h1>RPG Web 后端已启动</h1>
<p>前端尚未部署（<code>web/client/dist</code> 不存在），这里是后端占位页。API 已可用：</p>
<ul>
<li><code>GET /api/modules</code> — 列出 RPG 本</li>
<li><code>GET /api/game/slots?module=…</code> / <code>GET /api/game/state?module=…&amp;slot=1</code></li>
<li><code>POST /api/game/new</code> / <code>POST /api/turn</code>（SSE）/ <code>POST /api/move</code> / <code>POST /api/state/edit</code></li>
<li><code>GET|POST /api/config</code> / <code>POST /api/image/generate</code></li>
</ul>
<p>部署前端后刷新本页即可进入游戏。</p>
</body>
</html>
`;

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));

  app.use("/api", apiRouter);
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `未知接口：${req.method} /api${req.path}` });
  });

  app.use("/assets", express.static(comfy.ASSETS_ROOT, { index: false, fallthrough: true }));

  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: "index.html" }));
    const indexFile = path.join(CLIENT_DIST, "index.html");
    if (fs.existsSync(indexFile)) {
      app.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        if (req.path.startsWith("/assets/")) return next();
        res.sendFile(indexFile, { dotfiles: "allow" }, (err) => {
          if (err) next(err);
        });
      });
    }
  }

  app.get("/", (req, res) => {
    res.status(200).type("html").send(PLACEHOLDER_HTML);
  });

  app.use((req, res) => {
    res.status(404).json({ error: `未找到：${req.method} ${req.path}` });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      try {
        res.end();
      } catch {
        // 客户端可能已断开
      }
      return;
    }
    const explicit = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600;
    let status = err instanceof ApiError ? err.status : (explicit ? err.status : 500);
    let message;
    if (err?.type === "entity.parse.failed") {
      status = 400;
      message = `请求体不是合法 JSON：${err.message}`;
    } else if (err?.type === "entity.too.large") {
      status = 413;
      message = "请求体过大";
    } else if (err instanceof ApiError || explicit) {
      message = err?.message || String(err);
    } else {
      message = `服务器内部错误：${err?.name || "Error"}: ${err?.message ?? String(err)}`;
    }
    if (status >= 500) console.error("[rpg] 500:", err);
    res.status(status).json({ error: message });
  });

  return app;
}

function pickPort(argv) {
  for (const a of argv) {
    if (/^\d+$/.test(a)) return Number.parseInt(a, 10);
  }
  const envPort = Number.parseInt(process.env.PORT ?? "", 10);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  return DEFAULT_PORT;
}

export function main(argv = process.argv.slice(2)) {
  const port = pickPort(argv);
  const cfg = configMod.loadConfig();
  const app = createApp();
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`[RPG] 后端已启动：http://127.0.0.1:${port}/`);
    console.log(`[RPG] 配置：${configMod.CONFIG_PATH}（认证模式：${configMod.maskedConfig(cfg).auth_mode}）`);
    console.log(`[RPG] 前端：${fs.existsSync(CLIENT_DIST) ? CLIENT_DIST : "web/client/dist 尚未部署（/ 显示占位页）"}`);
    console.log(`[RPG] 静态资源：${comfy.ASSETS_ROOT} → /assets`);
    comfy.isOnline(cfg.comfy_url).then((ok) => {
      console.log(`[RPG] ComfyUI ${ok ? "在线" : "离线"}：${cfg.comfy_url}`);
    });
  });
  return server;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const self = fs.realpathSync(fileURLToPath(import.meta.url));
    const entry = fs.realpathSync(path.resolve(process.argv[1]));
    return self.toLowerCase() === entry.toLowerCase();
  } catch {
    return false;
  }
}

if (isMainModule()) main();

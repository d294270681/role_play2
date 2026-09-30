import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 开发期 vite dev server（默认 5173）把 /api 与 /assets 代理到 RPG 后端（8000）；
// 生产产物 dist/ 由后端 web/server/index.js 直接托管，同源，无需代理。
const BACKEND = process.env.RPG_BACKEND || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/assets": { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // 后端把 /assets 留给 ComfyUI 生成的 PNG（web/assets），Vite 产物另起目录避免抢路由
    assetsDir: "static",
    chunkSizeWarningLimit: 1200,
  },
});

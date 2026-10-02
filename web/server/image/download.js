/** 流式下载：断点续传、大小/SHA256 校验、完成后原子改名。 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

export async function digestFile(file, { signal, onProgress = () => {} } = {}) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    signal?.throwIfAborted();
    hash.update(chunk); bytes += chunk.length;
    onProgress({ stage: "verifying", received: bytes });
  }
  signal?.throwIfAborted();
  return hash.digest("hex");
}

export async function verifiedDownload(spec, destination, { signal, onProgress = () => {}, fetcher = (...args) => fetch(...args), wait = sleep } = {}) {
  const sources = spec.urls?.length ? spec.urls : [spec.url];
  if (sources.some((url) => new URL(url).protocol !== "https:") || !/^[a-f0-9]{64}$/.test(spec.sha256) || !(spec.bytes > 0)) throw new Error("下载清单无效");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const part = `${destination}.part`;
  const progress = (update) => onProgress({ file: path.basename(destination), total: spec.bytes, ...update });
  const valid = async (file) => fs.existsSync(file) && fs.statSync(file).size === spec.bytes && await digestFile(file, { signal, onProgress: progress }) === spec.sha256;
  if (await valid(destination)) { progress({ stage: "reused", received: spec.bytes }); return destination; }
  signal?.throwIfAborted();
  // 这些是清单指定的工程内缓存文件；不触碰源目录。
  if (fs.existsSync(destination)) fs.unlinkSync(destination);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let offset = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (offset > spec.bytes) { fs.unlinkSync(part); offset = 0; }
    if (offset === spec.bytes) break;
    const idle = new AbortController();
    let timer;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new Error("下载连接长时间没有响应")), 60000); timer.unref?.(); };
    const combined = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
    let handle;
    try {
      reset();
      const source = sources[attempt % sources.length];
      const res = await fetcher(source, { signal: combined, headers: { "Accept-Encoding": "identity", ...(offset ? { Range: `bytes=${offset}-` } : {}) } });
      if (!res.ok || !res.body) throw new Error(`下载失败（HTTP ${res.status}）`);
      if (res.status === 206) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get("content-range") || "");
        if (!match || Number(match[1]) !== offset || Number(match[3]) !== spec.bytes) throw new Error("服务器返回的续传范围不正确");
      } else if (res.status === 200) offset = 0;
      else throw new Error(`不支持的下载响应：${res.status}`);
      handle = await fs.promises.open(part, offset ? "a" : "w");
      progress({ stage: "downloading", received: offset, attempt: attempt + 1, source: new URL(source).hostname });
      for await (const chunk of res.body) {
        signal?.throwIfAborted(); reset();
        if (offset + chunk.length > spec.bytes) throw new Error("下载文件大于清单记录的大小");
        await handle.writeFile(chunk); offset += chunk.length;
        progress({ stage: "downloading", received: offset, attempt: attempt + 1 });
      }
      if (offset !== spec.bytes) throw new Error("下载尚未完成，正在保留断点");
      break;
    } catch (e) {
      signal?.throwIfAborted();
      if (attempt === 2) throw new Error(`无法下载 ${path.basename(destination)}：${e.message}。检查网络是否能访问官方下载站点后重试。`);
      await wait(500 * (attempt + 1), undefined, { signal });
    } finally { clearTimeout(timer); idle.abort(); await handle?.close(); }
  }
  if (!(await valid(part))) {
    if (fs.existsSync(part)) fs.unlinkSync(part);
    throw new Error(`${path.basename(destination)} 大小或 SHA256 校验失败，请重试下载`);
  }
  signal?.throwIfAborted();
  fs.renameSync(part, destination);
  progress({ stage: "completed", received: spec.bytes });
  return destination;
}

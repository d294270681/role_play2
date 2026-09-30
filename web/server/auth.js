/**
 * Kimi OAuth 凭证提供者（web/server/auth.js）。
 *
 * 直接复用本机 Kimi Code CLI 的 OAuth 凭证，让游戏后端不用另配 api_key：
 *   凭证文件  C:/Users/DMH/.kimi-code/credentials/kimi-code.json
 *             {access_token, refresh_token, expires_in(900), expires_at(epoch 秒), scope, token_type}
 *   刷新端点  POST https://auth.kimi.com/api/oauth/token
 *             表单 grant_type=refresh_token & refresh_token & client_id=17e5f671-…
 *   聊天端点  https://api.kimi.com/coding/v1/chat/completions，model = k3
 *
 * 行为约定：
 *   - 内存缓存整份凭证；expires_at 距过期不足 leeway（默认 60s）才刷新；
 *   - 刷新走 single-flight：同一路径的并发请求共用一次网络往返；
 *   - 刷新成功后把新凭证原子写回原文件（先写 .tmp 再 rename），只覆盖响应里出现的字段
 *     + expires_at，其余原字段原样保留；refresh_token 缺失时沿用旧值（服务端可能不轮换）；
 *   - 刷新失败时：旧 token 未过期 → 继续用旧值并告警；已过期 → 抛错。
 *
 * 安全：任何错误信息与日志都不回显 token；即使上游把凭证塞进响应体，也会被 redact 抹掉。
 */

import fs from "node:fs";
import path from "node:path";

/** 本机 Kimi Code 的凭证文件（可在 config.json 的 kimi_oauth.credentials_path 覆盖）。 */
export const DEFAULT_CREDENTIALS_PATH = "C:/Users/DMH/.kimi-code/credentials/kimi-code.json";
export const DEFAULT_TOKEN_URL = "https://auth.kimi.com/api/oauth/token";
export const DEFAULT_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
/** 聊天端点前缀与模型名（写进 web/config.json 用）。 */
export const KIMI_CHAT_BASE_URL = "https://api.kimi.com/coding/v1";
export const KIMI_MODEL = "k3";
/** 提前多久刷新（秒）：access_token 只有 15 分钟有效期。 */
export const REFRESH_LEEWAY_SEC = 60;
const FALLBACK_EXPIRES_IN = 900; // 刷新响应缺 expires_in 时的兜底有效期
const DEFAULT_TIMEOUT_SEC = 20;

function isPlainObject(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function str(v, dflt) {
  const s = typeof v === "string" ? v.trim() : (v === null || v === undefined ? "" : String(v).trim());
  return s || dflt;
}

function positiveInt(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : dflt;
}

/** 把错误/响应文本里的已知凭证抹成 ***（防上游把 token 塞进 body / 错误信息里）。 */
export function redact(text, secrets) {
  let out = String(text ?? "");
  for (const s of [].concat(secrets || [])) {
    const v = typeof s === "string" ? s : "";
    if (v.length >= 8) out = out.split(v).join("***");
  }
  return out;
}

/** kimi_oauth 配置的规范化结果；null 表示「配置里没写这个键」（走自动检测）。 */
export function normalizeOAuthSettings(raw) {
  if (raw === null || raw === undefined) return null;
  let obj = raw;
  let enabled = true;
  if (typeof raw === "boolean") {
    enabled = raw;
    obj = {};
  } else if (!isPlainObject(raw)) {
    return null;
  }
  return {
    enabled: enabled && obj.enabled !== false,
    credentials_path: str(obj.credentials_path ?? obj.credentialsPath, DEFAULT_CREDENTIALS_PATH),
    token_url: str(obj.token_url ?? obj.tokenUrl, DEFAULT_TOKEN_URL),
    client_id: str(obj.client_id ?? obj.clientId, DEFAULT_CLIENT_ID),
  };
}

function settingsOf(options) {
  if (isPlainObject(options) && "kimi_oauth" in options) {
    const fromConfig = normalizeOAuthSettings(options.kimi_oauth);
    if (fromConfig) return fromConfig;
  }
  return normalizeOAuthSettings(options) || normalizeOAuthSettings({});
}

/** 凭证文件是否可读（自动检测用）。 */
export function credentialsExist(options = null) {
  try {
    return fs.existsSync(settingsOf(options).credentials_path);
  } catch {
    return false;
  }
}

export class KimiOAuthProvider {
  constructor(options = null) {
    const s = settingsOf(options);
    this.credentials_path = s.credentials_path;
    this.token_url = s.token_url;
    this.client_id = s.client_id;
    this.leeway = isPlainObject(options) ? positiveInt(options.leeway_sec, REFRESH_LEEWAY_SEC) : REFRESH_LEEWAY_SEC;
    this.timeout_sec = isPlainObject(options) ? positiveInt(options.timeout_sec, DEFAULT_TIMEOUT_SEC) : DEFAULT_TIMEOUT_SEC;
    this.refresh_count = 0;
    this._cached = null;
    this._inflight = null;
  }

  /** 读原始凭证；文件缺失 / 非法 / 无 access_token 时抛错。 */
  readFile() {
    let raw;
    try {
      raw = fs.readFileSync(this.credentials_path, "utf8");
    } catch (e) {
      const why = e?.code === "ENOENT" ? "文件不存在" : (e?.code === "EACCES" ? "无读取权限" : (e?.message ?? e));
      throw new Error(`读取 Kimi 凭证文件失败（${this.credentials_path}）：${why}`);
    }
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error(`Kimi 凭证文件不是合法 JSON：${this.credentials_path}`);
    }
    if (!isPlainObject(obj) || !obj.access_token) {
      throw new Error(`Kimi 凭证文件里没有 access_token：${this.credentials_path}`);
    }
    return obj;
  }

  /** expires_at 缺失时按 expires_in 现算（只在内存里推，不回写文件）。 */
  static expiryOf(creds, nowSec) {
    const at = Number(creds?.expires_at);
    if (Number.isFinite(at) && at > 0) return at;
    const inSec = Number(creds?.expires_in);
    if (Number.isFinite(inSec) && inSec > 0) return nowSec + inSec;
    return 0;
  }

  expiresSoon(creds, nowSec) {
    const at = KimiOAuthProvider.expiryOf(creds, nowSec);
    if (!(at > 0)) return true;
    return at - nowSec < this.leeway;
  }

  expired(creds, nowSec) {
    return KimiOAuthProvider.expiryOf(creds, nowSec) <= nowSec;
  }

  /** 丢弃内存缓存（模型端 401 时调用，强制下次重新读盘 + 刷新）。 */
  invalidate() {
    this._cached = null;
  }

  /**
   * 取可用的 access_token：命中缓存且未临近过期直接返回，否则刷新。
   * 并发调用共用同一次刷新（single-flight）。
   */
  async getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (!this._cached) this._cached = this.readFile();
    if (!this.expiresSoon(this._cached, now)) return String(this._cached.access_token);
    if (!this._inflight) {
      this._inflight = this._refresh().finally(() => {
        this._inflight = null;
      });
    }
    return this._inflight;
  }

  async _refresh() {
    const previous = this._cached || this.readFile();
    let data;
    try {
      data = await this._requestRefresh(previous.refresh_token);
    } catch (e) {
      // 刷新失败：旧 token 还在有效期内就继续用（业务不中断），过期了才抛错。
      if (previous.access_token && !this.expired(previous, Math.floor(Date.now() / 1000))) {
        console.warn(`[rpg] Kimi OAuth 刷新失败，沿用未过期的旧 token：${redact(e?.message ?? e, [previous.access_token])}`);
        this._cached = previous;
        return String(previous.access_token);
      }
      throw new Error(`Kimi OAuth 刷新失败且旧 token 已过期：${redact(e?.message ?? e, [previous.access_token, previous.refresh_token])}`);
    }
    const merged = this._merge(previous, data);
    this._cached = merged;
    this.refresh_count += 1;
    try {
      this._writeFileAtomic(merged);
    } catch (e) {
      // 刷新成功但写回失败：本次请求仍可用新 token，但下次 Kimi Code 自己刷新会失败，
      // 所以必须显眼地喊出来（不含任何 token）。
      console.error(`[rpg] Kimi OAuth 凭证写回失败（${this.credentials_path}）：${e?.message ?? e}（refresh_token 已轮换，请尽快手工修复）`);
    }
    return String(merged.access_token);
  }

  async _requestRefresh(refreshToken) {
    if (!refreshToken) throw new Error("凭证文件里没有 refresh_token，无法刷新");
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(refreshToken),
      client_id: this.client_id,
    }).toString();
    let res;
    try {
      res = await fetch(this.token_url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(this.timeout_sec * 1000),
      });
    } catch (e) {
      throw new Error(`连接 ${this.token_url} 失败：${redact(e?.message ?? e, [refreshToken])}`);
    }
    if (!res.ok) {
      let body = "";
      try {
        body = redact((await res.text()).replace(/\s+/g, " ").trim().slice(0, 200), [refreshToken]);
      } catch {
        body = "";
      }
      throw new Error(`${this.token_url} 返回 ${res.status}：${body || res.statusText}`);
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error(`刷新响应不是合法 JSON：${redact(e?.message ?? e, [refreshToken])}`);
    }
    if (!isPlainObject(data) || !data.access_token) {
      throw new Error("刷新响应里没有 access_token");
    }
    return data;
  }

  /** 只覆盖刷新响应里出现的字段 + expires_at，其余原字段原样保留。 */
  _merge(previous, data) {
    const merged = { ...previous };
    for (const [k, v] of Object.entries(data)) {
      if (v === null || v === undefined) continue;
      merged[k] = v;
    }
    if (!merged.refresh_token) merged.refresh_token = previous.refresh_token;
    const inSec = Number(merged.expires_in);
    const ttl = Number.isFinite(inSec) && inSec > 0 ? inSec : FALLBACK_EXPIRES_IN;
    merged.expires_at = Math.floor(Date.now() / 1000) + ttl;
    return merged;
  }

  /** 先写同目录 .tmp 再 rename，保证读方永远看到完整的一份；保留原文件权限。 */
  _writeFileAtomic(creds) {
    const p = this.credentials_path;
    const dir = path.dirname(p);
    let mode = null;
    try {
      mode = fs.statSync(p).mode;
    } catch {
      mode = null;
    }
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(p)}.${process.pid}.tmp`);
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(creds, null, 2)}\n`, { encoding: "utf8" });
      if (mode !== null) {
        try {
          fs.chmodSync(tmp, mode);
        } catch {
          /* Windows 上 chmod 多为 no-op，失败无所谓 */
        }
      }
      fs.renameSync(tmp, p);
    } catch (e) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* 清理失败不影响主流程 */
      }
      throw e;
    }
  }
}

// 按 (credentials_path, token_url, client_id) 复用同一个 provider：
// 让缓存跨回合生效，也让不同存档的并发回合共用一次刷新。
const PROVIDERS = new Map();

/** 取得（或复用）一个 provider。options 可以是 {kimi_oauth:{…}} 或裸的 kimi_oauth 对象。 */
export function getProvider(options = null) {
  const s = settingsOf(options);
  const key = `${s.credentials_path}\u0000${s.token_url}\u0000${s.client_id}`;
  let p = PROVIDERS.get(key);
  if (!p) {
    const leeway = isPlainObject(options) ? options.leeway_sec : undefined;
    const timeout = isPlainObject(options) ? options.timeout_sec : undefined;
    p = new KimiOAuthProvider({ ...s, leeway_sec: leeway, timeout_sec: timeout });
    PROVIDERS.set(key, p);
  }
  return p;
}

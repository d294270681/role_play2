/**
 * Python 语义小工具，供各移植模块共用：int() / str.splitlines() / str.strip(chars) /
 * isdigit() 取整，以及 Python 异常名（ValueError / FileNotFoundError）的等价物。
 *
 * 这些语义差异是移植 web/engine/*.py 时最容易踩的坑，集中在这里保证两个实现行为一致。
 */

export function isDict(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Python int(v)：bool→0/1，float 截断，数字字符串（含全角数字、数字下划线分组）取整，其余取默认值。 */
export function toInt(v, dflt = 0) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return dflt;
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const s = v.trim();
    const i = parseIntLiteral(s);
    return i === null ? dflt : i;
  }
  return dflt;
}

/** Python s.isdigit() 为真时的 int(s)，否则 null。 */
export function digitInt(s) {
  return parseIntLiteral(String(s).trim());
}

function parseIntLiteral(s) {
  if (/^[+-]?[0-9]+(?:_[0-9]+)*$/.test(s)) return parseInt(s.replace(/_/g, ""), 10);
  const norm = s.replace(/[\uff10-\uff19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  if (/^[+-]?[0-9]+(?:_[0-9]+)*$/.test(norm)) return parseInt(norm.replace(/_/g, ""), 10);
  return null;
}

/** Python str.splitlines()：按 \n、\r\n、\r 及 \v \f \x1c-\x1e \x85 \u2028 \u2029 切分，不留末尾空串。 */
export function pySplitLines(text) {
  const s = String(text);
  if (!s) return [];
  const parts = s.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (parts[parts.length - 1] === "" && /(?:\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])$/.test(s)) parts.pop();
  return parts;
}

/** Python s.strip(chars)：按字符集合剥除首尾字符。 */
export function stripChars(s, chars) {
  const set = new Set(chars);
  let start = 0;
  let end = s.length;
  while (start < end && set.has(s[start])) start += 1;
  while (end > start && set.has(s[end - 1])) end -= 1;
  return s.slice(start, end);
}

/** Python repr(list)：形如 ['a', 'b']（用于逐字复刻带列表的 warning 文案）。 */
export function pyListRepr(items) {
  return `[${items.map((x) => `'${String(x)}'`).join(", ")}]`;
}

/** Python bool()：空 dict / 空 list 为假（JS 里它们为真，这是移植最常踩的坑）。 */
export function pyTruthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
  return true;
}

/** Python 的 `a or b`（按 Python 真值判断）。 */
export function pyOr(a, b) {
  return pyTruthy(a) ? a : b;
}

/** Python 的 str(v or "")：数字/布尔/列表/字典也按 Python 文案输出。 */
export function pyText(v) {
  return pyStr(pyOr(v, ""));
}

/** Python str()：None/True/False/列表/字典的文案与 Python 一致（用于逐字复刻变更说明）。 */
export function pyStr(v) {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (isDict(v)) return `{${Object.entries(v).map(([k, val]) => `${pyRepr(k)}: ${pyRepr(val)}`).join(", ")}}`;
  return String(v);
}

function pyRepr(v) {
  if (typeof v === "string") return `'${v}'`;
  return pyStr(v);
}

export function valueError(msg) {
  const e = new Error(msg);
  e.name = "ValueError";
  return e;
}

export function fileNotFoundError(msg) {
  const e = new Error(msg);
  e.name = "FileNotFoundError";
  return e;
}

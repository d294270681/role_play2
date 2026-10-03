/** Always redact before truncating an upstream error, including short keys. */
export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of [].concat(secrets)) if (typeof secret === "string" && secret) out = out.split(secret).join("***");
  return out;
}

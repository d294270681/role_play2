import path from "node:path";

const rootExclusions = new Set([".git", ".github", ".ci", "venv", "models", "input", "output", "temp", "user", "tests", "tests-unit", "extra_model_paths.yaml"]);

/** 权重目录只在源码顶层排除，comfy/ldm/models 是必须保留的 Python 实现。 */
export function shouldCopyComfy(root, source) {
  const relative = path.relative(root, source);
  if (relative === "") return true;
  const parts = relative.split(path.sep);
  return parts[0] !== ".." && !rootExclusions.has(parts[0]) && !parts.includes("__pycache__");
}

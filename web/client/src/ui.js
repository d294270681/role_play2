/** 视图与可视化数据，只读取游戏快照；不执行游戏裁决或保存。 */
export const VIEWS = [
  {
    key: "adventure",
    label: "冒险",
    icon: "compass",
    caption: "推进故事，决定下一步行动",
  },
  {
    key: "character",
    label: "角色档案",
    icon: "user",
    caption: "属性、技能、资源与角色成长",
  },
  {
    key: "map",
    label: "世界地图",
    icon: "map",
    caption: "探索地点与路线，查看可用行动",
  },
  {
    key: "items",
    label: "装备背包",
    icon: "backpack",
    caption: "随身物品、资金与负重，随行动结算更新",
  },
  {
    key: "clocks",
    label: "进度与威胁",
    icon: "target",
    caption: "追踪进度，以及满格后的后果",
  },
  {
    key: "relations",
    label: "人物关系",
    icon: "users",
    caption: "已认识的人物、关系与公开状态",
  },
  {
    key: "clues",
    label: "线索板",
    icon: "search",
    caption: "发现与调查结果，随冒险自动记录",
  },
  {
    key: "events",
    label: "事件与日志",
    icon: "book",
    caption: "待处理事件与冒险历程",
  },
  {
    key: "combat",
    label: "战斗准备",
    icon: "swords",
    caption: "检查战斗资源与能力，为交锋做好准备",
    upcoming: true,
  },
];

export const GAUGE_META = {
  生命: { icon: "heart", color: "var(--life)", kind: "is-life" },
  精力: { icon: "bolt", color: "var(--energy)", kind: "is-energy" },
  决心: { icon: "shield", color: "var(--resolve)", kind: "is-resolve" },
  压力: { icon: "activity", color: "var(--stress)", kind: "is-stress" },
};
export const viewInfo = (key) =>
  VIEWS.find((view) => view.key === key) || VIEWS[0];
export const clamp = (value, lo, hi) =>
  Math.max(lo, Math.min(hi, Number(value) || 0));
export const gaugeMeta = (name) =>
  GAUGE_META[name] || { icon: "sparkles", color: "var(--brass)", kind: "" };

export function resourceRows(state) {
  return Object.entries(state?.character?.gauges || {})
    .sort(
      ([a], [b]) =>
        (["生命", "精力", "决心", "压力"].indexOf(a) + 1 || 99) -
        (["生命", "精力", "决心", "压力"].indexOf(b) + 1 || 99),
    )
    .map(([name, gauge]) => ({ name, ...gauge, ...gaugeMeta(name) }));
}

export function inventoryLoad(inventory = []) {
  return inventory.reduce(
    (sum, item) =>
      sum +
      Math.max(0, Number(item.slots) || 0) *
        Math.max(0, Number(item.qty ?? 1) || 0),
    0,
  );
}

export function resourceAlerts(state) {
  const gauges = state?.character?.gauges || {},
    alerts = [];
  if (gauges.生命?.max > 0 && gauges.生命.value / gauges.生命.max <= 0.25)
    alerts.push("生命偏低，留意受伤与倒地风险");
  if (gauges.精力?.max > 0 && gauges.精力.value <= 0)
    alerts.push("精力耗尽，考虑寻找休整机会");
  if (gauges.压力?.max > 0 && gauges.压力.value / gauges.压力.max >= 0.6)
    alerts.push("压力较高，留意判定与状态影响");
  if (
    state?.character?.capacity > 0 &&
    inventoryLoad(state.inventory) > state.character.capacity
  )
    alerts.push("背包超出负重，整理随身物品");
  return alerts;
}

export function clockArc(index, count) {
  const at = (r, degrees) => {
    const a = (degrees * Math.PI) / 180;
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  };
  const span = 360 / count,
    gap = Math.min(5, span / 4);
  const start = -90 + index * span + gap / 2,
    end = start + span - gap;
  const [a, b, c, d] = [at(43, start), at(43, end), at(33, end), at(33, start)];
  return [
    "M",
    ...a,
    "A 43 43 0",
    end - start > 180 ? 1 : 0,
    "1",
    ...b,
    "L",
    ...c,
    "A 33 33 0",
    end - start > 180 ? 1 : 0,
    "0",
    ...d,
    "Z",
  ].join(" ");
}

/** 同一关系图同时包含地点连接与声明路线；未解析的路线端点保持外部节点。 */
export function mapGraph(locations = [], routes = [], current = "") {
  const nodes = locations.map((loc) => ({ ...loc, external: false }));
  const edges = [],
    seen = new Set();
  const match = (name) => nodes.find((node) => node.name === name);
  const ensure = (name) => {
    if (!name) return null;
    let node = match(name);
    if (!node) {
      const candidates = nodes.filter(
        (other) =>
          !other.external &&
          (String(name).includes(other.name) ||
            other.name.includes(String(name))),
      );
      if (candidates.length === 1) node = candidates[0];
    }
    if (!node) {
      node = {
        name,
        external: true,
        desc: "路线端点，当前冒险本未提供此地点的详细资料。",
      };
      nodes.push(node);
    }
    return node;
  };
  const edge = (from, to, route = null) => {
    if (!from || !to || from === to) return;
    const key = [from, to].sort().join("\0");
    const old = seen.has(key) && edges.find((e) => e.key === key);
    if (old) {
      if (route) Object.assign(old, { route });
      else if (
        !old.connections.some(
          (direction) => direction.from === from && direction.to === to,
        )
      )
        old.connections.push({ from, to });
      return;
    }
    seen.add(key);
    edges.push({
      key,
      from,
      to,
      route,
      connections: route ? [] : [{ from, to }],
    });
  };
  for (const loc of locations)
    for (const connection of loc.connections || []) {
      const exact = locations.find((other) => other.name === connection);
      const candidates = locations.filter(
        (other) =>
          String(connection).includes(other.name) ||
          other.name.includes(String(connection)),
      );
      const target = exact || (candidates.length === 1 ? candidates[0] : null);
      if (target) edge(loc.name, target.name);
    }
  for (const route of routes) {
    const from = ensure(route.from),
      to = ensure(route.to);
    if (from && to) edge(from.name, to.name, route);
  }
  const visited = new Set(),
    positions = new Map();
  let yOffset = 92,
    maxLayer = 0;
  const starts = [...nodes].sort(
    (a, b) => Number(b.name === current) - Number(a.name === current),
  );
  for (const start of starts) {
    if (visited.has(start.name)) continue;
    const queue = [{ name: start.name, depth: 0 }],
      levels = new Map();
    visited.add(start.name);
    while (queue.length) {
      const { name, depth } = queue.shift();
      if (!levels.has(depth)) levels.set(depth, []);
      levels.get(depth).push(name);
      for (const link of edges) {
        const next =
          link.from === name ? link.to : link.to === name ? link.from : null;
        if (next && !visited.has(next)) {
          visited.add(next);
          queue.push({ name: next, depth: depth + 1 });
        }
      }
    }
    const rows = Math.max(
      1,
      ...[...levels.values()].map((level) => level.length),
    );
    for (const [depth, names] of levels) {
      maxLayer = Math.max(maxLayer, depth);
      names.forEach((name, index) =>
        positions.set(name, {
          x: 96 + depth * 194,
          y: yOffset + index * 104 + (rows - names.length) * 52,
        }),
      );
    }
    yOffset += rows * 104 + 48;
  }
  const placed = nodes.map((node) => ({
    ...node,
    ...positions.get(node.name),
  }));
  return {
    nodes: placed,
    edges: edges.map((link) => ({
      ...link,
      a: positions.get(link.from),
      b: positions.get(link.to),
    })),
    width: Math.max(740, 194 * maxLayer + 196),
    height: Math.max(350, yOffset - 24),
  };
}

export function relationLabel(value) {
  const n = clamp(value, -5, 5);
  if (n <= -5) return "死敌";
  if (n <= -3) return "敌视";
  if (n < 0) return "冷淡";
  if (n === 0) return "中立";
  if (n <= 2) return "友善";
  if (n < 5) return "信任";
  return "生死之交";
}

/** 开场保留故事与时间，角色文件路径等创作元信息由角色档案替代。 */
export function openingText(opening = {}) {
  return String(opening.raw || opening.premise || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:-\s*)?玩家角色\s*[：:]/.test(line))
    .map((line) => line.replace(/^\s*-\s*/, "").replace(/^开场\s*[：:]\s*/, ""))
    .join("\n")
    .trim();
}

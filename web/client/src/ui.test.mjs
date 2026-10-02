import test from "node:test";
import assert from "node:assert/strict";
import {
  inventoryLoad,
  mapGraph,
  resourceAlerts,
  resourceRows,
  relationLabel,
  openingText,
} from "./ui.js";

test("地图保留地点连接与路线信息，重复边合并，外部端点不会伪装成可进入地点", () => {
  const locations = [
    { name: "租屋", connections: ["老街"], danger: 0 },
    { name: "老街", connections: ["租屋", "旧码头"] },
    { name: "旧码头", connections: ["老街"] },
  ];
  const routes = [
    { from: "老街", to: "旧码头", code: "R1", time_slots: 2 },
    { from: "旧码头", to: "离岛", code: "R2", time_slots: 1 },
  ];
  const before = JSON.stringify({ locations, routes });
  const graph = mapGraph(locations, routes, "租屋");
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 3);
  assert.equal(graph.nodes.find((node) => node.name === "离岛").external, true);
  assert.equal(
    graph.nodes.find((node) => node.name === "旧码头").external,
    false,
  );
  assert.equal(
    graph.edges.find((edge) => edge.from === "老街" && edge.to === "旧码头")
      .route.time_slots,
    2,
  );
  for (const node of graph.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.x >= 70 && node.x <= graph.width - 70);
    assert.ok(node.y >= 32 && node.y <= graph.height - 32);
  }
  assert.equal(JSON.stringify({ locations, routes }), before);
});

test("地图规范化唯一的地点全称，不猜测含糊的区域名，并展示不相连的路线", () => {
  const locations = [
    { name: "港城·老街" },
    { name: "港城·租屋" },
    { name: "旧码头" },
  ];
  const graph = mapGraph(
    locations,
    [
      { from: "老街", to: "旧码头", code: "R1" },
      { from: "港城", to: "山间驿站", code: "R2" },
    ],
    "旧码头",
  );
  assert.equal(
    graph.nodes.some((node) => node.name === "老街"),
    false,
  );
  assert.equal(graph.nodes.find((node) => node.name === "港城").external, true);
  assert.equal(
    graph.nodes.find((node) => node.name === "山间驿站").external,
    true,
  );
  assert.ok(
    graph.edges.some(
      (edge) => edge.from === "港城·老街" && edge.to === "旧码头",
    ),
  );
  assert.ok(
    graph.edges.some((edge) => edge.from === "港城" && edge.to === "山间驿站"),
  );
  assert.equal(mapGraph().nodes.length, 0);
});

test("负重使用实际数量，零数量不占格；警告遵循资源方向，不把压力低当作危险", () => {
  assert.equal(
    inventoryLoad([{ qty: 0, slots: 4 }, { qty: 2, slots: 3 }, { slots: 1 }]),
    7,
  );
  assert.deepEqual(
    resourceAlerts({
      character: {
        gauges: { 生命: { value: 8, max: 8 }, 压力: { value: 0, max: 10 } },
      },
    }),
    [],
  );
  const alerts = resourceAlerts({
    character: {
      capacity: 2,
      gauges: {
        生命: { value: 1, max: 8 },
        精力: { value: 0, max: 6 },
        压力: { value: 7, max: 10 },
      },
    },
    inventory: [{ qty: 3, slots: 1 }],
  });
  assert.equal(alerts.length, 4);
  assert.match(alerts.join("，"), /生命.*精力.*压力.*背包/);
});

test("资源摘要保留自定义仪表，核心四资源顺序与人物关系边界正确", () => {
  const rows = resourceRows({
    character: {
      gauges: {
        自定义: { value: 1, max: 3 },
        压力: { value: 0, max: 10 },
        决心: { value: 8, max: 8 },
        精力: { value: 6, max: 6 },
        生命: { value: 8, max: 8 },
      },
    },
  });
  assert.deepEqual(
    rows.map((row) => row.name),
    ["生命", "精力", "决心", "压力", "自定义"],
  );
  assert.equal(relationLabel(-5), "死敌");
  assert.equal(relationLabel(-4), "敌视");
  assert.equal(relationLabel(-3), "敌视");
  assert.equal(relationLabel(-2), "冷淡");
  assert.equal(relationLabel(-1), "冷淡");
  assert.equal(relationLabel(0), "中立");
  assert.equal(relationLabel(1), "友善");
  assert.equal(relationLabel(2), "友善");
  assert.equal(relationLabel(3), "信任");
  assert.equal(relationLabel(4), "信任");
  assert.equal(relationLabel(5), "生死之交");
});

test("单向地点连接保持方向信息，路线仍可双向查看", () => {
  const graph = mapGraph(
    [
      { name: "甲", connections: ["乙"] },
      { name: "乙", connections: [] },
    ],
    [{ from: "乙", to: "丙", time_slots: 1 }],
    "乙",
  );
  const connection = graph.edges.find((edge) => edge.from === "甲");
  assert.deepEqual(connection.connections, [{ from: "甲", to: "乙" }]);
  assert.equal(connection.route, null);
  assert.ok(graph.edges.find((edge) => edge.from === "乙").route);
});

test("开场展示保留故事和日期，不把角色文件路径或默认角色名当成当前角色", () => {
  const text = openingText({
    raw: "- 第 1 天 · 晨，租屋。\n- 玩家角色：阿澄（characters/a-cheng.md），也可以自建。\n- 开场：门口响起敲门声。",
  });
  assert.equal(text, "第 1 天 · 晨，租屋。\n门口响起敲门声。");
  assert.equal(
    openingText({ premise: "一段完整的开场。" }),
    "一段完整的开场。",
  );
});

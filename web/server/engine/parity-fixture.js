/** 独立的扩展规则夹具，仅写入 verifier 创建的临时项目，不作为可玩的本发布。 */
import fs from "node:fs";
import path from "node:path";

export function createParityModule(root) {
  const dir = path.join(root, "modules", "parity-rules");
  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${text.trim()}\n`, "utf8");
  };
  write("module.md", `---
name: parity-rules
title: 扩展规则校验夹具
engine: core
tone: 调查测试
rating: 全年龄
---
## 简介
供 JS/Python 一致性验证使用的固定数据。
## 文件
- map: world-map.md
- events: event-deck.md
- characters: characters/
- save: saves/save-state.md
## 规则覆盖
- 清晨(6-8) → 上午(8-12) → 中午(12-14) → 下午(14-18) → 傍晚(18-22) → 深夜(22-次日6)
- **信任度**：0-100
- **警觉度**：0-100
- 权限等级 1-5
- 声望值（各 0-10 级）
- 调查度：0-8
## 开局
- 第 1 天 · 清晨，租屋。
- 玩家角色：沈亦舟（characters/main-npcs.md）。
- 开场：检查档案室的账本。
`);

  const places = ["租屋", "旧码头", "城档案室", "老街", "车站", "河岸", "市场", "邮局", "码头仓库", "山间驿站"];
  const locations = places.map((name, i) => i % 2 === 0 ? `
### ${name}（危险度 ${i % 4}，夜间 ${Math.min(5, i % 4 + 1)}）
- 势力：商会
- 描述：用于验证括号格式地点。
- 可用行动：察觉、交涉
- 常驻 NPC：温稚宁、陆渊
- 连接：${places[(i + 1) % places.length]}
` : `
## ${name}
- 危险度：${i % 4}
- 描述：用于验证字段格式地点。
- 可用行动：
  - 调查
  - 休息
- 可来访：江蘅
- 连接：${places[(i + 1) % places.length]}
`);
  const routes = places.slice(1).map((name, i) => `| R${i + 1} | ${places[i]} | ${name} | ${i % 3} 时段 | ${i % 4} | 校验路线 |`);
  write("world-map.md", `# 校验地图\n${locations.join("\n")}
## 路线表
| 编号 | 起点 | 终点 | 耗时 | 路线危险度 | 备注 |
|---|---|---|---|---|---|
${routes.join("\n")}

## 不同列顺序路线表
| 备注 | 终点 | 路线危险度 | 起点 | 耗时 | 编号 |
|---|---|---|---|---|---|
| 返回 | 租屋 | 1 | 山间驿站 | 2 | R10 |
`);

  const names = ["沈亦舟", "温稚宁", "江蘅", "陆渊", "王主任", "魏岚", "苏策", "柯澜", "白棠", "程砚"];
  const cards = names.map((name, i) => `
## ${name}
- 概念：档案调查员
- 背景：参与调查的测试角色。
- 目标：核验账本。
- 外貌：灰色外套。
- 秘密：持有未公开的档案。
- 对主角的态度：关系沈亦舟 ${i % 3 - 1}
### 属性
体魄 2、敏捷 3、智识 3、感知 2、魅力 2、意志 2
### 技能
运动 1、潜行 2、学识 1、交涉 1、察觉 2
### 资源
生命 8/8、精力 6/6、压力 0/10、决心 4/4
信任度 ${i + 1}/100、警觉度 0/100、权限等级 1/5、声望值 0/10、调查度 0/8
防御值 11、携带格 8、护甲 1、攻击 +2
### 特质
- 冷静
### 状态
- 无
### 关系
- 陆渊：+1（同事）
### 装备
- 随身：摄像设备、手稿
- 资金：18
经验：当前 2（累计 4）
`);
  write("characters/main-npcs.md", `# 测试角色卡\n${cards.join("\n")}`);

  const events = [];
  for (let a = 1; a <= 6; a += 1) for (let b = 1; b <= 6; b += 1) {
    events.push(`### ${a}${b} 调查记录 ${a}${b}\n- 类型：线索\n- 后果：记录一条线索。`);
  }
  for (let i = 1; i <= 12; i += 1) events.push(`## S-${String(i).padStart(2, "0")} 特殊校验 ${i}\n- 条件：调查度至少 1。`);
  events.push("## M-E1 抉择校验一\n- 后果：推进调查。", "## M-E2 抉择校验二\n- 后果：保留档案。");
  write("event-deck.md", `# 校验事件牌\n${events.join("\n\n")}`);
  write("setting.md", "# 校验设定\n一座用于测试解析器的调查城市。");
  write("item-dex.md", "# 校验道具\n## 摄像设备\n- 占用：1 格\n- 用途：记录档案。");
  write("saves/save-state.md", "# 初始模板\n测试数据，不关联玩家槽位。");
}

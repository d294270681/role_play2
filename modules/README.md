# RPG 本（模块）目录

> 引擎在 `core/`，每个 RPG 本放在 `modules/<本名>/`，两者互不引用对方的具体内容。
> 用 `/skill:rpg-load <本名>` 加载；不带参数则列出所有可用的本。
> 用 `/skill:rpg-create <本名或构想>` 按本格式新建一个本。

## 目录结构

```
modules/<本名>/
├── module.md          # 必需：清单文件（见下）
├── setting.md         # 世界观、基调、题材专属规则
├── world-map.md       # 地点与路线（格式同 core/world-map.md 模板）
├── event-deck.md      # 事件牌（格式同 core/event-deck.md 模板）
├── item-dex.md        # 道具（格式同 core/item-dex.md 模板）
├── characters/        # 玩家角色卡与 NPC 卡
└── saves/
    └── save-state.md  # 当前存档（格式同 core/save-state.md 模板）
```

除 `module.md` 外都是约定，缺哪个文件就用 `core/` 里的通用内容顶上。

## module.md 格式

```markdown
---
name: 本名（与目录名一致）
title: 显示标题
engine: core            # 使用 core/ 规则；写 none 表示本自带全部规则
tone: 一句话基调
rating: 全年龄 / 青少年 / 成人
---

## 简介
两三句话。

## 文件
- setting: setting.md
- map: world-map.md
- events: event-deck.md
- items: item-dex.md
- characters: characters/
- save: saves/save-state.md

## 规则覆盖
- 对 core 规则的替换或追加，写明覆盖的是哪一节（如「替换 core §5 压力 → 理智」）。

## 开局
- 起始地点、起始时间、玩家角色、开场一段情境。
```

## 解耦纪律

1. `core/` 不出现任何具体本的名字、地点或 NPC；示例内容只作格式演示。
2. 本只能通过「规则覆盖」改 core 的机制，不直接改 `core/` 文件。
3. 存档只写在本自己的 `saves/` 下。

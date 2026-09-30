# 项目进度文档

> 最后更新：2026-10-01（冻结点交接版）
> 恢复方式：对塔台说「继续」，舰队从冻结点原地复活。

---

## 一、两条产品线现状

### 1. RPG 跑团游戏网站 —— 已可玩 ✅

- **运行方式**：`F:/role_play2/启动游戏.bat`（游戏 http://127.0.0.1:8000）+ `F:/ai/启动ComfyUI.bat`（出图 http://127.0.0.1:8188）
- **玩法闭环**：选本建档 → K3（Kimi）演绎剧情 → 真骰子判定（2d6 体系）→ 右侧七面板管理（角色/地图/物品/进度钟/关系/线索/事件）→ 自动或手动生成剧情插图（Z-Image-Turbo + NSFW LoRA）
- **当前可用本**：港城疑案（gangcheng，青少年）、绿帽淫妻地狱（lvmao-yinqi-diyu，成人）

### 2. Z-Image NSFW 出图环境 —— 已验收 ✅

- ComfyUI v0.37.0 源码版：`F:/ai/ComfyUI-src/`（venv，torch 2.9.1+cu128，RTX 3090 24GB）
- 模型组（`F:/ai/ComfyUI_windows_portable/ComfyUI/models/`）：z_image_turbo_bf16（12.3GB）+ qwen_3_4b 编码器（8GB）+ ae VAE（335MB）+ NSFW-MASTER LoRA（1.24GB）
- 配方（`F:/ai/dl/smoke_test.py`）：CLIPLoader type=lumina2 + ModelSamplingAuraFlow shift=3 + KSampler 8步 cfg1.0 res_multistep/simple；写实 LoRA 0.8 / 二次元 0.4–0.5（前置 anime style 标签）
- 网络约束：huggingface/civitai 被墙 → 走 hf-mirror.com；GitHub 大文件 50KB/s → 用源码安装路线；本机无代理

---

## 二、仓库状态（F:/role_play2，git master）

最新提交：`8416dea`（含全部已合并任务 + 整合修正）。

### 已合并任务

| 任务 | 内容 | 验证 |
|---|---|---|
| M1 | Python 引擎（dice/state/module_loader） | 96+30 断言，两轮评审 |
| M4 | JS 引擎移植（web/server/engine/） | parity 26/26，30,996 组合穷举，变异测试 |
| M5 | Express 后端（GM 协议/SSE/ComfyUI 生图/per-slot 锁） | 全端点实测、真出图、竞态修复 |
| M6 | Vue 前端（暗色黄铜风/判定卡/七面板/插图灯箱） | 三轮评审（主题死配置、判定卡顺序、高度链） |
| M7 | Kimi OAuth 令牌自动刷新（auth.js） | 47 断言 + 真模型回合 + 强制过期轮换 |

### 作废但保留

- M2/M3：Python 后端 / 裸 JS 前端（技术栈切 Node 时作废）。M2 成品在分支 `feat/rpg-backend-gm-protocol-and-http-api-w2` 作备胎。
- 审计记录全部在 `.tower/comms/`（评审、finding、活动日志）。

---

## 三、塔台任务冻结点 ⏸️（2026-10-01 人类指令停工）

| 任务 | 状态 | 分支 / 提交 | 下一步 |
|---|---|---|---|
| M8 规则包后端 | 🟢 完工待审 | `feat/rules-pack-backend-exert-assist-editops` @ `1cb14dc` | 评审（agent-26 冻结，可 resume 或重派）→ 合并 |
| M9 战斗后端 | 🟢 完工待审 | `feat/combat-state-machine-backend-core-sectio` @ `5ca4ae3` | 评审（agent-27 冻结）→ 合并 |
| M10 前端补全 | 🟡 未开工 | — | M8+M9 合并后 TowerSpawn |

### M8 内容（规则包后端，6 项全完工）

- 精力：POST /api/turn 带 `exert:true`（本回合首个判定 +2、精力-1 合并结算）；新增 POST /api/turn/reroll（咬牙重来：2 精力重掷一颗、reroll_count 守卫、不调 LLM）
- §2.7 协助：dice_request 支持 assist[{name,attr,skill}]，最多 2 人，每人 2d6 对同难度，成功各 +1（rollCheck 新增第 8 参 extra，不占 ±3 钳制）
- remove_relation / remove_gauge（核心四仪表禁删），patch 支持 remove:true（JS+Python 双侧）
- lvmao 地点 d20 事件表结构化（events_d20），移动途中事件按目的地表抽（修掉取错地点的 bug）
- parity 30/30 全绿
- 评审注意点见 inbox `20261001-agent-rulespack-tower-review-request.md`（协助公式、单侧扩展、last_check 等 6 条）

### M9 内容（§3 战斗状态机，3 项全完工）

- combat.js 1105 行：先手 2d6+敏捷+察觉、偷袭免费行动+优势、攻击/次要/逃跑/等待/医疗、超出档加伤、代价成功反噬、护甲相减 min1、NPC 简单 AI、倒地 3 轮医疗窗、非致命昏迷、结束结算写回 gauges/状态
- 端点：POST /api/combat/start、GET /api/combat/state、POST /api/combat/action（白名单+slot锁+锁内重读）
- 143 断言连跑 5 次全绿（脚本在 worktree `.verify-tmp/m9-combat-verify.mjs`，未进 commit——后续 mission 应把测试纳入仓库）
- 两处规则歧义的实现选择（评审重点）：超出 5 取 +2；代价成功算命中。见 inbox `20261001-agent-combat-tower-review-request.md`

### M10 待办（前端补全）

输入区「全力以赴」开关、判定卡「咬牙重来」按钮、assist 展示、关系/仪表删除按钮、战斗视图（先手条/参与者卡/行动表单/日志流）、地图「开始战斗」入口。注意 jsdom 盲区：布局用 headless Edge 实测。

---

## 四、关键配置与凭证

| 项 | 位置 | 说明 |
|---|---|---|
| 游戏 LLM 配置 | `F:/role_play2/web/config.json`（gitignored） | kimi-oauth，model `k3`，**temperature 必须 1**（k3 只接受 1） |
| Kimi 令牌 | `C:/Users/DMH/.kimi-code/credentials/kimi-code.json` | 15 分钟有效期；游戏经 `https://auth.kimi.com/api/oauth/token` 刷新并原子写回，与 Kimi Code 共享互不干扰 |
| 聊天端点 | `https://api.kimi.com/coding/v1/chat/completions` | OpenAI 兼容，model 填 `k3` |
| 存档 | `web/saves/<本名>/slot<N>.json` | 原子写；槽 3 曾被测试乱码污染，已重置 |
| 生成图片 | `web/assets/<本名>/` | gitignored，经 `/assets/` 访问 |

---

## 五、已知坑（维护必读）

1. **双实现纪律**：引擎逻辑必须 `web/engine/*.py` 与 `web/server/engine/*.js` 两侧同步改，`verify-parity.mjs` 全绿才算完；新行为加 parity 断言。
2. **Windows 控制台 curl 发中文 = GBK 乱码**：测试写 UTF-8 文件后 `--data-binary @file`，别内联中文。
3. **jsdom 盲区**：无布局引擎。布局/主题改动必须 headless Edge + CDP 量 `offsetHeight/clientHeight`（M6 两个 P1 的教训）。
4. **worktree 无 node_modules**：worktree 里起服务先 `mklink /J` 到主检出或 `npm i`；测完摘链接用 `cmd rmdir`。
5. **验证后收进程**：Windows 允许同端口后绑接管，残留进程会让「冷启动」验证失真（M7/M9 都踩过）。
6. **LLM 软约束项**（设计如此，非缺陷）：压力档位惩罚、状态效果判定影响、经验发放——规则全文在 GM 提示词里由 K3 执行，代码不强制。

## 六、规则覆盖清单（M8/M9/M10 合并后达成的终态）

- ✅ 代码强制：判定公式/四档/优劣/对抗/被动、±3 钳制、精力（全力以赴/咬牙重来）、§2.7 协助、§3 战斗状态机、成长花费、进度钟、关系、仪表、时间/移动/事件（d66+d20）、删关系/删仪表
- 🟡 LLM 驱动：压力档位惩罚与崩溃表、状态效果影响、倒地叙述、经验发放
- 交付后以本节为「规则齐全」验收基准。

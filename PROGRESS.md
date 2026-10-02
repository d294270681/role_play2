# 项目进度文档

> 最后更新：2026-10-03（项目内 ComfyUI、运行时与模型集成）
> 恢复方式：对塔台说「继续」，舰队从冻结点原地复活。

---

## 本次开发：项目内生图架构

代码基线提交为 `7d8cfe9`。现有 `F:\ai` 生图资源已复制到工程 `ai/`，原安装保留。项目内副本约 26.1 GiB，其中四个模型约 20.43 GiB、Python/CUDA/Node.js 运行时约 5.64 GiB、ComfyUI 代码约 0.05 GiB；没有通过目录链接依赖原安装。

- **目录分层**：`ai/profiles.json` 维护模型组件与参数，`ai/workflows/` 维护工作流；第三方程序位于 `ai/vendor/ComfyUI`，依赖位于 `ai/runtime`，权重位于 `ai/models`，日志/输入/输出/缓存位于 `ai/data`。程序、依赖和模型物理文件已复制，模型 SHA-256 记录在本机导入清单中。
- **应用分层**：`web/server/image/profiles.js` 读取档案并填充模板；`runtime.js` 管理进程与归属；`comfyClient.js` 负责工作流校验、提交、队列轮询与取图；`service.js` 负责游戏提示词与图片归档。原 `comfy.js` 作为兼容入口，GM、头像、地点统一使用同一服务。
- **启动与设置**：`启动游戏.bat` 优先使用项目内 Node.js，后端默认自动带起项目内 ComfyUI。新设置支持模型档案、内部/外部连接、自动启动、独立检测与启停。冷启动完成后会更新出图按钮，状态检测不依赖存档，也不会被迟到的存档快照覆盖。
- **生命周期**：并发请求共用一次启动任务；关闭也共用一次停止任务。服务只监听本机，模型和应用缓存使用工程目录，第三方联网 API/自定义节点默认禁用。关闭游戏时只释放自己创建的出图进程；另一套 ComfyUI 占用内部端口时明确报错，外部连接模式不负责关闭外部服务。
- **模型身份**：本机现有配方是 Z-Image-Turbo + Qwen3 文本编码器 + AE VAE + 原 LoRA，已完整导入并可用。完整 Qwen-Image 2512 是另一套主模型/编码器/VAE，源目录没有对应三个权重；已提供独立档案和标准模板，组件未齐全时保持不可选，尚未实机验证该档案。
- **安装与维护**：`scripts/import-image-runtime.mjs` 复制既有安装、合并 Python 依赖、检查项目内依赖来源及 CUDA、记录模型校验值与依赖锁。导入开始先标记未完成，成功后再记录完成状态；当前项目服务运行时拒绝覆盖。`scripts/verify-image-runtime.mjs` 提供无玩家档案写入的真实出图验证。

验证：44 项离线 Node 回归（31 项原有、11 项生图配置/生命周期/HTTP/复制规则、2 项前端出图状态隔离）通过；JS/Python parity 29/29；前端生产构建通过。项目内 Python 3.10.11、PyTorch 2.9.1+cu128、ComfyUI 0.37.0 在 RTX 3090 上通过实机验证：512×512 和默认 1024×1024 均成功生成 PNG，1024 测试启动到归档约 32 秒；真实游戏后端自动启动、状态接口和退出释放进程也通过。图片位于 `web/assets/integration-smoke`，测试进程已关闭，玩家槽位未修改。

架构与操作说明见 `ai/README.md`。源码、工作流、档案、脚本和锁文件参与 Git；机器运行时、权重、缓存及输出保持忽略，离线打包时须携带本地安装目录。

---

## 本次开发：Web 存档可靠性

- **完整开档与会话隔离**：首次新建存档后回读完整模块快照，地图、NPC、事件、开场同时就绪。换本/换槽清空旧剧情、建议、面板及图片；异步响应校验模块、槽位和会话版本。回读还校验状态修订序号，避免同槽位的旧响应覆盖刚完成的回合。生图迟到也不会写进新档的图片记忆。
- **公开资料与 GM 私有资料**：读取、新建、编辑、移动及 SSE 状态统一经过公开字段筛选。NPC 原始卡片、秘密、动机和旧档混合 `party.notes` 留在服务端；玩家备注取明确的 `public_notes` 或角色公开描述。GM 提示词继续读取完整卡片，并加入存档中的私有备注。存档格式兼容旧档，无需修改已有槽位。
- **提交与断流恢复**：回合先成功落盘，再广播 `state`；写入失败发送 `error`/`done` 并保留旧档。状态回读使用同一槽位锁，等待回合完成；不同槽位独立运行。按钮改为「停止显示」，收到服务端回合确认后才可停止；停止/断流/错误时回读最终存档，同步完成前禁止下一次行动和切换。回读失败时保持不可行动，可重新载入该槽位。当前行动不再重复塞进对话历史。
- **编辑原子性**：服务端在草稿副本上编辑，只在成功时提交；JS/Python 的时间编辑均先验证时段再修改日期。拒绝编辑时返回原状态，前端也不采用拒绝响应中的状态。
- **独立校验环境**：parity 使用当前港城模块与固定的扩展规则夹具，完整运行在自建临时项目中；不依赖已删除的剧情模块，也不读写 `web/saves` 中的玩家存档。夹具覆盖 10 个角色、10 个地点、两种路线列序、50 张含特殊编码的事件、5 个自定义仪表与 6 个时段。完成或失败后清理自建临时目录。

验证：31 项 Node 回归通过（15 项既有规则、10 项前端会话与 SSE、6 项公开视图/真实 HTTP/SSE 路由）；JS/Python parity 29/29 通过；Vite 生产构建通过并更新 `web/client/dist`。测试使用内存存档和模型/ComfyUI 替身，不调用线上模型、不修改玩家存档。

**下一阶段**：模块初始进度钟/线索读取、事件条件的结构化筛选、运行时地图与 NPC 世界状态、完整回合历史和长期摘要，以及 M8/M9/M10 的规则接入。当前断流恢复使用已保存日志；旧的叙述日志长度上限仍保留，不能视为完整剧情历史已经持久化。

---

## 本次开发：核心规则 1.1

保留 2d6、属性与技能范围、难度表、既有角色和本专属覆盖，修改集中在裁决公平性与实际结算。

- **规则文档**：先说明难度/风险/耗时；失败仍给主线必需的基础线索；禁止同一局势反复掷骰；代价成功只收一项相关代价；明确协助、偷袭、攻击超出 5 的大成功伤害、社交底线、威胁钟与奖励去重。同步修正示范回合及通用示例存档。
- **成长（双引擎）**：跳级逐级累计经验；提升或编辑体魄/意志/敏捷/运动会按差量同步生命、精力、决心、防御、负重，保留现有修正且不免费补满资源。前端展示相同费用并禁用无效或经验不足的升级。
- **状态（双引擎 + GM 接入）**：压力取最高档；冷静延迟两点；生命不超过一半时自动受伤；束缚仅影响身体行动；恐惧仅影响明确面对恐惧源的行动。状态数值独立于情境 ±3，判定卡与模型反馈都列出来源。`engine: none` 不自动套 core 状态。
- **时间与事件**：协议 `action_cost` 表示总耗时 0–12；0 耗时不抽事件，长行动逐时段抽取；兼容旧 `time_advance` 的额外耗时语义，正常回合忽略直接 day/period 跳转；续写漏填耗时时沿用首次宣告。移动风险按实际消耗的时段判定，多事件按 `pending_event` + `pending_events` FIFO 队列保留。
- **本地演示**：移除每回合压力 +15 和无条件发钱；失败/代价成功只加 1 压力，完整成功无状态惩罚。

验证：15 项 Node 回归测试（含真实回合生成器的模拟协议、移动、事件队列和费用不变量）；JS/Python parity 29/29，新增 265 种状态边界与 72 种费用组合；前端 Vite 生产构建通过。测试不调用线上模型/ComfyUI，不修改玩家槽位。

**仍由 GM 裁决**：耗时的语义选择、恐惧源识别、休息/疲惫/中毒/流血/崩溃、经验奖励上限和去重、威胁钟推进幅度、协助及冲突后果。文档约定不等于这些规则已有独立状态机。M8/M9/M10 仍处于下方记录的待审/待开发状态；后续合并须对齐 1.1 的费用、状态修正与时间协议，不能直接覆盖此次修复。

本机验证环境：原 Python 3.10 安装已缺失，旧 ComfyUI venv 无法启动；使用系统临时目录中的 Python 3.10.11 嵌入运行时执行 parity，没有更改系统 Python。PowerShell 下使用 `npm.cmd`；本机 PATH 有多余引号导致 npm 子进程找不到 node，验证时只在当前进程补齐 Node 路径。可指定 `PYTHON` 或 `verify-parity.mjs --python <解释器路径>`。

---

## 一、两条产品线现状

### 1. RPG 跑团游戏网站 —— 已可玩 ✅

- **运行方式**：`F:/role_play2/启动游戏.bat`（游戏 http://127.0.0.1:8000；项目内 ComfyUI 自动启动于 http://127.0.0.1:8188）
- **玩法闭环**：选本建档 → K3（Kimi）演绎剧情 → 真骰子判定（2d6 体系）→ 右侧七面板管理（角色/地图/物品/进度钟/关系/线索/事件）→ 自动或手动生成剧情插图（Z-Image-Turbo + NSFW LoRA）
- **当前工作区可用本**：港城疑案（gangcheng，青少年）

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
6. **LLM 软约束项**：经验奖励、休息与持续伤害、崩溃等由 GM 执行；压力/受伤的数值惩罚、束缚/恐惧的判定劣势已由 1.1 引擎执行，GM 不得重复添加这些惩罚。

## 六、规则覆盖清单（M8/M9/M10 合并后达成的终态）

- ✅ 代码强制：判定公式/四档/优劣/对抗/被动、±3 钳制、精力（全力以赴/咬牙重来）、§2.7 协助、§3 战斗状态机、成长花费、进度钟、关系、仪表、时间/移动/事件（d66+d20）、删关系/删仪表
- 🟡 LLM 驱动：崩溃表、休息与持续伤害、倒地叙述、经验发放；压力/受伤/束缚/恐惧的判定效果已代码化
- 交付后以本节为「规则齐全」验收基准。

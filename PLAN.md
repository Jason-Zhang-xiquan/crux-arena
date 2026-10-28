# Crux Arena 项目计划（暂名）

> 难题先交给一群 AI 在像素格斗场里打一架，最后把"打不倒的答案"交给用户。
> 准则：**Visually appealing + Useful**；token 用量可控、可见；**每一次胜负都可追溯**。

- 调研日期：2026-10-27
- 视觉原型：[design/arena-mockup.html](design/arena-mockup.html)（浏览器直接打开，脚本回放一场演示比赛）
- 在线演示：https://jason-zhang-xiquan.github.io/crux-arena/

---

## 0. 产品形态（2026-10-28 定稿）

**主形态：桌面常驻小程序。** 用户不用打开网页、不用记命令：

1. **快捷键唤出**（默认 `Ctrl+Alt+Space`，被占用时自动换备选，托盘里可看当前快捷键）。屏幕中央弹出像素风输入框。
2. **写问题**，可选：
   - 一个**文件夹**（只读，只输出结论，见 §3.2）；
   - **模式**（混战 / 红蓝组队）；
   - **上场选手**（2–6 名，记住上次的选择）。
3. `Ctrl+Enter` 开打。输入框收起，**小 AI 们直接站在桌面底部、任务栏上方打架**：透明置顶窗口，空白处鼠标可以穿透，不挡你干活。
4. 打完弹出**冠军答案卡片**：复制答案 / 查看战报 / 打开存档文件夹。`Esc` 随时收起。
5. 每场比赛存成 `events.jsonl` + `battle-log.md`，可回放。

其他形态降为次要：网页演示站（已上线，用于传播）、CLI（开发与自动化）、Claude Code / MCP 插件（Phase 3）。

**开发顺序：先把所有非模型部分做完，最后再接真实模型。** 桌面壳、事件驱动的画面、演示大脑、文件夹侦察、存档与回放都先用演示大脑跑通；接模型时只替换"大脑"这一层。

**技术选型：Electron。** 引擎和只读文件夹工具本来就跑在 Node 上，Electron 主进程可以直接调用同一套代码；Tauri 体积小，但要另起一个 Node 子进程，接口多一层。以后如果在意体积，再评估把引擎打包成 sidecar 换 Tauri。

```
快捷键 ─▶ 输入框窗口 ──开打──▶ 主进程：引擎 + 只读文件夹工具 + 存档
                                   │ 事件流（IPC，逐条推送）
                                   ▼
                          桌面竞技场窗口（透明、置顶、可穿透）
                                   │ final
                                   ▼
                              冠军答案卡片
```

---

## 1. 现有项目调研（摘要）

| 项目 | ★ | 强项 | 短板 |
|---|---|---|---|
| [karpathy/llm-council](https://github.com/karpathy/llm-council) | ~26k | 盲答 → 匿名互评 → 主席综合；OpenRouter 一个 key 接多家 | 没有交锋，UI 平淡 |
| [dyubero/conclave](https://github.com/dyubero/conclave) | 0 | 先 steelman 再反驳；论点标注 事实/推断/猜测；防假共识；审计；HTML 回放 | 单一模型，无观赏性 |
| [Detrol/quorum-cli](https://github.com/Detrol/quorum-cli) | ~124 | 多种讨论"模式"，支持 Ollama | 终端 UI |
| [blueman82/ai-counsel](https://github.com/blueman82/ai-counsel) | 1 | 投票 + 观点收敛提前停止 | 无可视化 |
| [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) | ~9.9k | 像素小人实时反映 agent 状态（打字=生成、翻书=搜索、气泡=等待） | 不产出决策 |
| [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) | ~10.7k | 像素世界 + AI 角色，MIT | 不产出决策 |
| [neutree-ai/llm-fighter](https://github.com/neutree-ai/llm-fighter) / [llm-colosseum](https://github.com/OpenGenerativeAI/llm-colosseum) | — / ~1.5k | HP/MP 格斗机制做 LLM 对战 | 是评测，不是辩论 |
| [Agent Arena](https://agentarena.party/) | 闭源? | 3D 辩论场、回放、天梯 | 无评判标准、不产出结论 |

研究依据：

- [Debate or Vote（NeurIPS 2025）](https://arxiv.org/abs/2508.17536)：辩论收益大多来自**投票**；纯辩论期望上不提升正确率，只有**偏向纠错**的更新才有用。
- [S²-MAD（NAACL 2025）](https://arxiv.org/abs/2502.04790v2)、[稀疏拓扑（arXiv 2406.11776）](https://export.arxiv.org/pdf/2406.11776)：观点重复的 agent 轮空、稀疏通信，省 token 且效果持平或更好。
- [Du et al. ICML 2024](https://github.com/composable-models/llm_multiagent_debate)、[MAD](https://github.com/Skytliang/Multi-Agents-Debate)：多轮辩论可提升事实性。

**空白点**：没有项目同时做到 *异构多模型真实交锋* + *游戏级可视化* + *有研究依据的更好答案* + *可见可控的 token* + *可追溯的胜负记录*。

---

## 2. 融合方案：每个成功项目借什么

| 借鉴元素 | 来源 | 在 Crux Arena 里的位置 |
|---|---|---|
| 盲答 + 匿名 + 主席综合 | llm-council | Round 0 盲答；选手之间匿名；Final 由主席模型写冠军答案 |
| 匿名互评 | llm-council | 裁判看不到论点出自哪家模型，防偏袒 |
| 先 steelman 再反驳 | Conclave | 攻击动作的 schema 里必填 `steelman` 字段（一句话） |
| 事实 / 推断 / 猜测 标签 | Conclave | 每张论点卡带标签；只有"事实"能被证据暴击、也只有带证据的攻击能打暴击 |
| 防假共识 + 审计 | Conclave | 认输必须引用导致认输的动作（见 §4）；Final 前审计"无因认输" |
| 多种讨论模式 | Quorum | Quick Match / Ranked / Tournament / Red Team |
| 投票 + 收敛提前停止 | ai-counsel | 每回合末统计立场，收敛即进 Final |
| 观点重复者轮空 | S²-MAD | 与他人立场重合的选手本回合轮空，日志里写明"省了多少 tok" |
| 偏向纠错 | Debate or Vote | 证据（搜索/代码执行）= 暴击；没证据的反驳伤害上限低 |
| 像素小人反映 agent 真实状态 | Pixel Agents | 生成中=蓄力，调工具=举放大镜，等待=待机，认输=举白旗 |
| HP / MP 格斗机制 | llm-fighter | 论点卡 HP；选手信誉条；**Mana = token 预算** |
| 回放 / 天梯 | Agent Arena | 事件日志回放；跨比赛统计"说服力 / 被说服率"排行 |

---

## 3. 一场比赛的流程

```
THE QUESTION      用户提问，可选择模式、选手、预算
     │
ROUND 0 盲答      每名选手独立作答 → {answer, claims[], label, confidence}
     │            选手互相不可见、匿名
CRUX 分歧提取     便宜模型聚类论点 → 共识区（金框）/ 争议区
     │            争议区为空 → FLAWLESS VICTORY，直接 Final
ROUND 1..N 交锋   N ≤ 3。每人每回合最多 1 次攻击 + 1 次防守；让 / 改不限
     │            只传"论点板"压缩状态；立场重复者轮空
     │            裁判（不参赛的模型，匿名）结算伤害并给一句话裁决
     │            立场收敛 → 提前结束
FINAL             主席模型基于存活论点写冠军答案 + 少数派意见 + 待你判断的 crux
     │
RESULT            冠军答案、论点存亡溯源、说服链、成本对比；可导出
```

### 动作类型

| 动作 | 标签 | 含义 | 必填字段 |
|---|---|---|---|
| 立 | `claim` | Round 0 提出论点 | `text`, `label` |
| 攻 | `attack` | 质疑某张论点卡 | `target`, `why`, `steelman`, 可选 `evidence` |
| 守 | `defend` | 为某张论点卡辩护 | `target`, `why` |
| 让 | `concede` | 放弃自己的论点 | `target`, `why`, **`caused_by`** |
| 改 | `shift` | 转投 / 有条件支持另一论点 | `target`, `why`, **`caused_by`** |
| 裁 | `ruling` | 裁判结算 | `damage`, `crit`, `ruling` |
| 略 | `skip` | 选手轮空（S²-MAD） | `reason`, `saved_tokens` |

### 3.1 对战模式

| 模式 | 结构 | 适合的问题 | 结束条件 | 成本 |
|---|---|---|---|---|
| **混战 FFA**（默认） | 每人独立立论，自由攻守；立场重复者轮空 | 开放问题、没有现成选项 | 立场收敛或满 3 回合 | 中 |
| **组队 TEAM**（红 vs 蓝） | 选手分两队，各持一方立场；队内先合议成一份立论，只打对方 | 二选一：A 还是 B、做还是不做 | 裁判团判胜负，或一方队长认输 | 中低 |
| **攻擂 KING** | 擂主守一个答案（可以是你自己的方案），其他人轮流攻；擂主论点被 KO，攻擂者上台并修订答案 | 评审方案、PR、文档："帮我挑刺" | 连续一轮无人破防 | 中 |
| **淘汰赛 BRACKET** | 每个候选项由一名选手代言，两两对决，胜者晋级 | 多选一：起名、技术选型、供应商 | 决出冠军，附完整排名和理由 | 中高（同轮可并行） |
| **速决 QUICK** | 只做盲答 + 投票 + 主席综合（≈ llm-council） | 简单问题、快速第二意见 | 一轮结束 | 低 |
| **讨伐 BOSS**（文件夹专用） | 所有选手一起"打"同一个仓库：各自找问题，每条发现必须由另一名选手复核才算命中 | 找 bug、安全隐患、架构风险 | 预算用完或一轮无新发现 | 中 |

- **组队规则**：选人顺序单号进红队、双号进蓝队，也可以手动拖拽；建议每队混搭国内外模型（异构更有用）。队内合议由队长汇总队友要点，只算 1 次调用，比每人各写一份省 token。
- 原型已实现 **混战** 和 **组队**；其余模式先在选人界面占位。

### 3.2 文件夹模式（只读，只输出结论）

让选手围绕一个本地文件夹（代码仓库、文档目录）打架，例如"这个仓库该不该拆微服务""找出最严重的 3 个问题"。

**入口**

- CLI：`crux fight --dir ./my-repo --mode ffa "问题"`
- 选人界面填写文件夹路径
- Claude Code 插件：`/arena 问题`，默认使用当前目录

**只读保证（在工具层强制，不靠提示词）**

1. 选手只拿到 `list_dir` / `read_file`（按行范围）/ `grep` / `git_log` / `git_diff` 这些只读工具，没有写文件和执行命令的工具。
2. 所有路径限定在根目录内，先解析符号链接再检查，越界直接拒绝。
3. 默认跳过 `.env`、密钥、证书、`node_modules`、构建产物（读 `.gitignore` + 敏感文件规则），可配置。
4. 如果接入本地 CLI agent，也用只读方式启动，例如 Codex 用 `--sandbox read-only`，Claude Code 只放行 Read / Grep / Glob。
5. 每次文件读取都记进事件日志，结果页显示"读取 N 个文件，写入 0 次"。

**证据与 token**

- 证据统一写成 `file:line`。带 `file:line` 的攻击才能打出暴击，裁判只读被引用的那几行来核实，成本很低。
- 侦察阶段：便宜模型先生成一份仓库地图（目录树 + 关键文件摘要 + 符号索引），所有选手共享，并走 prompt 缓存。
- 共享证据柜：同一个文件片段只读一次，所有选手复用。
- 每名选手有读取预算，例如最多 30 次读取 / 40k tokens。

**输出只要结论**

冠军答案 + 关键发现（每条附 `file:line`）+ 置信度 + 少数派意见 + 需要你判断的点。不产出补丁，不改任何文件；战斗日志照常可追溯。

---

## 4. 可追溯战斗日志（核心需求）

目标：随时能回答"**谁、在哪一步、因为什么，说服 / 击败了谁**"，而且日志要短。

### 4.1 两层日志

| 层 | 文件 | 给谁看 | 内容 |
|---|---|---|---|
| 事件流 | `matches/<id>/events.jsonl` | 机器、回放、eval | 每个动作的完整文本、证据、token、耗时 |
| 战斗日志 | `matches/<id>/battle-log.md` | 人 | 一个动作一行；末尾附说服链和结论溯源 |

**战斗日志由事件流确定性生成，不额外调用 LLM，零 token。**

### 4.2 让日志变短的规则

1. 选手的结构化输出里自带 `why` 字段：**≤ 20 个汉字 / 12 个英文词**，在同一次调用里产出，不另花调用。
2. 裁判的 `ruling` **≤ 15 个汉字**。
3. 一个动作一行，格式固定：`#编号 回合 标签 选手 ▸ 目标  理由  → 结果`。
4. 完整论证、证据链接、token 只在展开（UI 点击行）或 `events.jsonl` 里出现。
5. 被同一证据连续击中等重复事件合并为一行（`×2`）。

### 4.3 因果链：谁说服了谁

- `concede` / `shift` **必须**填写 `caused_by`（引起这次转变的动作编号，如 `#A1`）。缺失时引擎让该选手补填一次；仍缺失则标记为 **"无因认输"**（从众 / 谄媚信号），在结果页和审计里高亮。
- 说服边 = `caused_by` 指向的动作的发起者 → 认输者。由此自动生成**说服链**。
- 每张论点卡的存亡都能回溯到具体动作：`C2 ✗ ⇐ #A8 CODEX 认输 ⇐ #A1 DEEPSEEK 证据暴击`。
- 跨比赛累计：每个模型的 **说服力**（说服他人次数）、**被说服率**、**无因认输率** → 排行榜。这本身就是有用的模型对比数据，也是视频素材。

### 4.4 battle-log.md 示例

```
# Battle Log · 5 人团队做 B2B SaaS：微服务还是单体？
选手 CLAUDE · CODEX · GEMINI · DEEPSEEK | 裁判 KIMI | 31.4k tok · $0.12

R0  立  CLAUDE   C1 先做模块化单体，按需再拆            [推断]
R0  立  CODEX    C2 一开始就上微服务                    [推断]
R0  立  GEMINI   C3 全部 Serverless，免运维              [推断]
R0  立  DEEPSEEK C4 自建 K8s 运维≈1 名专职人力           [事实]
R0  裁  分歧：C1/C2/C3 互斥 · 共识：先建 CI/CD 与监控
#A1 R1 攻 DEEPSEEK ▸ C2  抽 1 人运维=砍 20% 研发 [web]  → -40 暴击｜证据成立
#A2 R1 守 CODEX    ▸ C2  托管 K8s 可降到 0.3 人          → +10｜部分成立
#A3 R1 攻 CLAUDE   ▸ C3  冷启动会击穿 p99 延迟           → -30｜成立
#A4 R1 守 GEMINI   ▸ C3  预留并发可消除冷启动            → +5 ｜抵消了省钱优势
#A5 R1 攻 CODEX    ▸ C1  单体后期拆分代价高              → -15｜模块边界可缓解
    R2 略 DEEPSEEK 立场与 CLAUDE 重合，轮空              省 2.1k tok
#A6 R2 攻 CLAUDE   ▸ C3  预留并发低流量下比 VM 贵 [web]  → -45 暴击｜证据成立
#A7 R2 让 GEMINI   ▸ C3  成本优势不成立  ⇐#A3 #A6         → C3 KO
#A8 R2 让 CODEX    ▸ C2  运维人力确实不够  ⇐#A1           → C2 KO，改投 C1
    R2 裁  立场收敛，提前结束                             省 ~9k tok

## 说服链
DEEPSEEK ⟹ CODEX   C2  运维成本超出团队容量        #A1 → #A8
CLAUDE   ⟹ GEMINI  C3  冷启动 + 低流量成本高        #A3 #A6 → #A7

## 结论溯源
C1 ✓ 85HP  扛住 #A5；CODEX、GEMINI 转投
C4 ✓ 100HP 事实，已验证
C2 ✗ ⇐ #A8 CODEX 认输 ⇐ #A1
C3 ✗ ⇐ #A7 GEMINI 认输 ⇐ #A3 #A6
```

### 4.5 事件 schema（events.jsonl 每行）

```json
{"id":"A1","round":1,"type":"attack","actor":"deepseek","target":"C2",
 "why":"抽 1 人运维=砍 20% 研发","steelman":"微服务确实便于独立扩容",
 "detail":"……完整论证……","evidence":[{"tool":"web_search","url":"…","quote":"…"}],
 "ruling":{"by":"judge","damage":40,"crit":true,"text":"证据成立"},
 "caused_by":["C4"],"tokens":{"in":1820,"out":142},"cost_usd":0.0041,"ms":3200}
```

---

## 5. 视觉方案：像素格斗风

原型见 [design/arena-mockup.html](design/arena-mockup.html)，角色设定页见 [design/mascots.html](design/mascots.html)。16:9（1280×720 基准，自动缩放），方便直接录屏做视频。

### 5.1 画面布局

```
┌────────────────────────────── HUD ───────────────────────────────┬────────────┐
│ [头像]CLAUDE ████████░  [头像]GEMINI ██████░░   ROUND 2   CODEX │            │
│                       MANA ▓▓▓▓▓▓░░░░ 18.2k/60k tok · $0.07        │  BATTLE    │
├───────────────────────────────────────────────────────────────────┤  LOG       │
│                                                                   │  (可筛选、  │
│   GEMINI                 ┌─C1─┐ ┌─C2─┐                  DEEPSEEK   │  可展开、   │
│          CLAUDE          └────┘ └────┘          CODEX              │  点 ⇐#A1   │
│                          ┌─C3─┐ ┌─C4─┐                             │  跳转原因)  │
│                          └────┘ └────┘                             │            │
│  ════════════════════ 像素擂台地面 ═══════════════════════════      │ ── 说服链 ─ │
├───────────────────────────────────────────────────────────────────┤            │
│ [头像] DEEPSEEK  攻 ▸ C2                                           │            │
│ 「5 人团队里抽 1 人专职运维，等于砍掉 20% 研发产能……」 ▌            │            │
└───────────────────────────────────────────────────────────────────┴────────────┘
```

### 5.2 视觉语言

| 元素 | 表现 |
|---|---|
| 选手 | 每个 AI 一个吉祥物（24×20 精灵，5 倍放大），共 13 名，见 §5.4；赛前在选人界面选 2–6 名 |
| 选手状态 | 生成中：蓄力光环；调工具：头顶放大镜；认输：白旗；轮空：Zzz（借 Pixel Agents） |
| 论点卡 | 像素边框卡片：编号、出处颜色条、短文本、标签（事实/推断/猜测）、10 格 HP |
| 攻击 | 像素弹道从选手飞向卡片；伤害数字弹出；暴击：屏幕震动 + "CRITICAL!" |
| 格挡 | 卡片蓝色护盾闪光 + 回血数字 |
| KO | 卡片碎裂成像素粒子 + "K.O." 印章；卡片变灰留在原位作为"墓碑"，点击仍能看溯源 |
| 共识 | 金色边框卡片，不参与战斗 |
| Mana 条 | HUD 中间，token 预算实时消耗；轮空和提前结束时显示"+SAVED" |
| 字体 | 英文 HUD：Press Start 2P；中文正文：[Fusion Pixel 12px](https://github.com/TakWolf/fusion-pixel-font)（OFL） |
| 节奏 | 开场 "ROUND 1 · FIGHT!" 横幅；回合之间 0.6s 停顿；空格暂停；1×/2×/4× 倍速 |
| 结果页 | "CHAMPION ANSWER" 卡 + 存活/淘汰论点溯源 + 说服链 + 成本对比 + MVP 小统计 |

### 5.3 战斗日志面板交互

- 每行即 §4.4 的格式，颜色区分选手，标签用彩色小方块（攻/守/让/改/裁/略）。
- 点击一行展开：完整论证、steelman、证据、裁判理由、token。
- 点击 `⇐#A1` 跳转并闪烁被引用的那一行。
- 悬停论点卡 → 日志里所有针对该卡的行高亮。
- 按选手筛选；"导出"按钮直接生成 `battle-log.md` 文本。

### 5.4 吉祥物与美术来源

**角色表**：共 13 名。代码在 [packages/sprites/mascots.js](packages/sprites/mascots.js)，选人界面在 [design/mascots.html](design/mascots.html)。每个角色 4 个姿势：待机 A / 待机 B / 攻击 / 受击。

| 选手 | 厂商 | 形象 | 设计要点 |
|---|---|---|---|
| CLAUDE | Anthropic | 小螃蟹 | 橙色方块身体、竖条眼、大钳子；攻击时钳子夹紧 |
| CODEX | OpenAI | 终端机器人 | CRT 脑袋，屏幕 `>_` 就是脸；攻击 `>>!`，受击 `x x` |
| GEMINI | Google | 双子星 | 渐变四角星 + 绕转的小星星 |
| GROK | xAI | 黑洞小怪 | 黑洞 + 吸积盘，一脸坏笑；攻击时眼睛变红 |
| MUSE | Meta | 眼镜精灵 | ∞ 变成一副眼镜（致敬 Meta 眼镜），头顶 spark |
| MISTRAL | Mistral AI | 橘猫 | Le Chat = 猫，黄到红渐变条纹 |
| DEEPSEEK | 深度求索 | 小鲸鱼 | 头顶喷水，攻击时水花炸开 |
| DOUBAO | 字节跳动 · 豆包 | 豆沙包 | 顶上一点红豆沙，会呼吸；生气冒热气 |
| QWEN | 阿里 · 千问 | 问号精灵 | 紫色六边形宝石 + 问号天线 |
| KIMI | 月之暗面 | 登月小月亮 | 月亮 + 绕飞小火箭（Moonshot） |
| YUANBAO | 腾讯 · 元宝 | 金元宝 | 两头翘起，旁边闪光 |
| GLM | 智谱 | 光谱棱镜 | 智谱 ≈ 光谱：白光进、彩虹出 |
| MINIMAX | MiniMax · 海螺 | 小海螺 | 粉色螺旋海螺，花纹会转 |

后续可加：文心（百度）、讯飞星火、阶跃星辰、Llama（开源本地模型，Ollama）。每次比赛选 2–6 名上场；论文结论是异构模型更有用，所以默认推荐跨厂商组合。

**现有开源素材调研**

| 仓库 | ★ | 许可 | 能不能用 |
|---|---|---|---|
| [rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) | ~6.5k | 代码 AGPL-3.0；**美术 All Rights Reserved** | 不能拿素材，只能参考思路（它给 Codex 设计的是云朵形象 Cloudling） |
| [JohnHeibel/ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase) | ~2.1k | MIT | 手绘风 Clawd + 31 种表情，适合参考"情绪 → 动作"的设计 |
| [xixicc186/clawd-emotes-skill](https://github.com/xixicc186/clawd-emotes-skill) | ~79 | MIT | 纯 SVG + CSS 的 Clawd 表情动画，可参考做法 |
| [CodeChrisB/MyClawd](https://github.com/CodeChrisB/MyClawd) | 3 | 无许可证 | 不能直接用 |
| [YANZHANLIN/clawd-avatar-skill](https://github.com/YANZHANLIN/clawd-avatar-skill) | 7 | 无许可证 | 不能直接用（帽子 / 道具换装思路可参考） |

**美术原则**

1. 所有像素图自己画，不复制别人的素材，也不直接用厂商 logo。
2. 形象只"致敬"各家的标志性元素（Clawd 螃蟹、DeepSeek 鲸鱼、Gemini 星芒），README 和画面里注明"非官方同人，与各厂商无关联"。
3. 皮肤可替换：角色 = `{ kind, palette, poses }`，社区可以提交皮肤包；如果哪家厂商提出异议，换一套皮肤即可。
4. 正式版用 Aseprite / [LibreSprite](https://github.com/LibreSprite/LibreSprite)（开源）精修，导出 sprite sheet（PNG + JSON）给 PixiJS `AnimatedSprite`；姿势扩充到 思考 / 搜索 / 攻击 / 受击 / 认输 / 胜利，每个 2–4 帧。

---

## 6. 模型、推理强度、预算与额度

### 6.1 Token 控制原则

原则：**只在分歧上交锋，只传状态不传全文，贵模型只用一次，日志和解说零成本。**

| 手段 | 说明 |
|---|---|
| 硬预算 + 开赛前估价 | Mana 用完自动进入 Final |
| Flawless Victory | 无分歧直接出答案 |
| 只打争议论点 | 共识区不进交锋 |
| 压缩状态 | 每轮只传论点板（编号 + 短文本 + HP）+ 上轮各动作的 `why`，上下文不随回合膨胀 |
| 短动作 | 结构化输出，`why` ≤ 20 字，`detail` ≤ 120 词 |
| 稀疏参与 | 立场重复者轮空（S²-MAD） |
| 收敛即停 | 回合上限 3 |
| 模型分级 | 分歧提取、裁判用便宜模型；冠军答案用最强模型 |
| Prompt caching | 系统提示 + 题目做缓存前缀 |
| 零成本表现层 | 解说台词、战斗日志、说服链全部由事件确定性生成 |

目标：总成本 ≤ 单模型的 4–8 倍（对比全量记录式辩论的 15–30 倍），Phase 0 实测后写进 README。

### 6.2 每个 agent 都能调模型

**吉祥物是身份，模型是装备。** CLAUDE 小螃蟹默认用 Anthropic 的模型，但具体用哪个型号、走哪条通道，都可以按选手单独配置；以后也支持完全自定义的选手。

| 可调项 | 说明 |
|---|---|
| 通道 | 任何接入方式（见 §6.7）：会员命令行（Claude Code、Cursor Agent、Codex CLI…）、兼容 API（OpenRouter、各家平台、Ollama…），或用户自己写的脚本 |
| 模型 | 同一个选手可选同家不同档位，例如 CLAUDE 选 `claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5` |
| 推理强度 | 统一五档：`off` / `low` / `medium` / `high` / `max`（见 §6.3） |
| 单次输出上限 | 每次调用的最大输出 token，防止某个选手写长篇碾压别人 |
| 个人预算 | 这名选手整场最多能花多少 token（见 §6.4） |
| 降级链 | 额度用尽或出错时依次换用的模型（见 §6.5） |

**按角色给默认值**：分歧提取和裁判用便宜、快的模型 + `low`；选手用中档 + `medium`；冠军答案只调用一次，用最强模型 + `high`。

**按阶段给默认值**：盲答决定起点质量，推理强度高一档；交锋阶段的动作很短（结构化、`why` ≤ 20 字），推理强度低一档；主席综合用最高档。

### 6.3 推理强度怎么落到各家

引擎只认统一的五档，由各家适配层翻译成自己的参数（具体参数名和取值以各家当前文档为准）：

| 统一档位 | 含义 | 典型映射 |
|---|---|---|
| `off` | 不开思考 | 关闭思考模式，或换用非推理模型 |
| `low` | 少量思考 | 档位类参数取最低档；按 token 计的思考预算给小额度 |
| `medium` | 默认 | 中档，或中等思考预算 |
| `high` | 深想 | 高档，或较大思考预算 |
| `max` | 不计成本 | 最高档，只建议给主席或单场关键调用 |

- 有的模型按"档位"控制（如 effort / reasoning effort），有的按"思考 token 预算"控制，有的只有"开 / 关"或"换推理版型号"。适配层负责就近映射，**映射结果写进事件**，方便回看"这一步用了多大推理"。
- 不支持思考的模型：`low` 及以上一律按 `off` 处理，并在战报里注明。
- **思考产生的 token 照样计费、照样计入预算**（通常按输出 token 计价），这是推理强度最容易让成本失控的地方。

### 6.4 Token 预算：四层

| 层级 | 默认 | 用完怎么办 |
|---|---|---|
| 单次调用 | 输出上限 + 思考预算 | 截断；动作 `why` 本来就有字数上限 |
| 单个选手 | 整场预算 ÷ 人数（可单独调） | 该选手本场后续回合"观望"，日志写明"预算用完" |
| 单场比赛 | 60k tokens（MANA 条） | 直接进入冠军答案 |
| 每日 / 每月花费 | 用户自设美元上限（默认关闭） | 开赛前拦截，提示还剩多少 |

几条硬规则：

1. **给冠军答案预留**：整场预算的 15% 固定留给主席综合，交锋阶段不能动，保证任何情况下都能出答案。
2. **开赛前估价**：按 人数 × 回合 × 平均调用量 × 推理档位系数 估算 token 和美元。超预算时给出降级建议：降推理档位、减选手、改用 QUICK 速决。
3. **按真实用量记账**：以各家返回的 usage 为准，分开记输入、输出、思考、缓存命中四项；价格表可配置，也可从 OpenRouter 的模型列表拉取。
4. **公平**：默认每名选手的 token 上限相同（也可以改成"美元上限相同"）。否则贵模型靠长篇和深想碾压，比的就不是论证质量了。评测时推理档位也要对齐。
5. **看得见**：HUD 的 MANA 条显示整场余量，每个选手名牌下加一条迷你能量条；结果卡显示每人消耗和推理档位。

### 6.5 没额度了怎么办

先分清是哪种问题，再决定重试、降级还是退场：

| 情况 | 识别 | 处理 |
|---|---|---|
| 短时限流 | 429、Retry-After | 按提示等待，指数退避 + 抖动；同一通道限制并发，排队调用 |
| 额度 / 余额用尽 | 402、余额不足、订阅 CLI 提示"用量已达上限" | **不重试**；该通道今天标记为不可用，立刻走降级链 |
| 服务故障 | 5xx、超时、断网 | 重试 2 次，仍失败就降级 |
| 上下文超长 | 超出窗口 | 压缩论点板（只保留争议卡和最近动作）后重试一次 |
| 模型拒答 | 安全过滤、空回复 | 不重试同样的提示；该选手本回合观望，记标记 |

**降级链**（每名选手可配，默认如下）：同家更便宜的型号 → OpenRouter 上的同款模型 → 本地 Ollama 模型 → **退场**。

- 每次降级都记一条事件，战报写明"CLAUDE 因额度用尽，从 opus 降为 haiku"。
- **退场**：选手头上出现"没电了"图标并变灰。战报写明"因额度用尽退场（不是被说服）"；不计入说服链，也不计入"被说服率"。
- **比赛层面**：
  - 场上可用选手少于 2 名，直接进入冠军答案；
  - 裁判或主席不可用，从仍可用的模型里自动选一个顶上（优先不参赛的）；
  - 全部不可用，就暂停比赛，用已有事件生成"未完成"战报。
- **断点续打**：比赛是事件溯源的，暂停时状态全在 `events.jsonl` 里。额度恢复后 `crux resume <比赛>` 或在回放列表里点"继续"，从断点接着打，已经完成的调用不会重复付费。
- **开赛前预检**：检查每条通道（key 是否配置、能否查询余额、本地 Ollama 是否在运行），输入框里把没额度的选手标红，并建议替换。
- **API key 安全**：key 存在系统钥匙串（桌面版用操作系统提供的加密存储），只在主进程使用；绝不写进事件、战报或日志。

### 6.6 配置与事件

**配置**（设置页"模型与额度"标签页，也可以写成 `crux.config.json`；模型名为示意）：

```json
{
  "budget": { "perMatchTokens": 60000, "perFighter": "equal", "reserveForFinal": 0.15, "dailyUsd": 2 },
  "roles": {
    "judge": { "model": "openrouter/<便宜快速的模型>", "effort": "low" },
    "chair": { "model": "anthropic/claude-opus-5-5", "effort": "high" }
  },
  "fighters": {
    "claude": {
      "model": "anthropic/claude-sonnet-5-5", "effort": "medium", "maxOutput": 600,
      "fallback": ["anthropic/claude-haiku-5-5", "openrouter/anthropic/claude-sonnet-5-5", "ollama/<本地模型>"]
    }
  }
}
```

**新增事件**（都进 `events.jsonl`，战报和画面据此显示）：

| 事件 | 内容 |
|---|---|
| `model_call` | 谁、哪条通道、哪个模型、推理档位（统一档位 + 实际映射）、输入 / 输出 / 思考 / 缓存 token、耗时、花费 |
| `fallback` | 谁、从哪个模型降到哪个、原因 |
| `fighter_out` | 谁退场、原因（额度 / 限流 / 故障 / 拒答 / 个人预算用完） |
| `paused` | 比赛暂停的原因、恢复提示（如额度重置时间） |

**界面**：输入框里每张选手卡可以右键选模型和推理档位，顶部显示开赛预估（如"≈ 38k tok · $0.15"）；竞技场里额度告急的选手显示"LOW BATTERY"，退场时变灰。

### 6.7 通道：任何接入方式都能插上（可扩展）

模型和接入方式变得太快，我们不追着适配每一家。引擎只认一个统一的**通道**接口；通道背后是会员命令行、API 还是本地模型，引擎不关心。开源后，每个人接自己手上有的东西，**也可以让自己的 AI 助手替自己写接入**。

**统一接口**（一次调用 = 一个请求 JSON → 一个结果 JSON）：

```json
// 请求
{ "v": 1, "task": "draft | act | crux | rule | final",
  "model": "grok-4.7", "effort": "medium",
  "system": "……", "messages": [{ "role": "user", "content": "……" }],
  "schema": { "…": "要求输出的 JSON Schema" }, "maxOutputTokens": 600, "timeoutMs": 120000 }

// 成功
{ "ok": true, "json": { "…": "按 schema 的结构化结果" }, "text": "原始文本（可选）",
  "usage": { "in": 1820, "out": 142, "reasoning": 300, "cached": 1200, "estimated": false },
  "model": "实际使用的模型", "effortApplied": "实际映射，如 grok-4.7-medium" }

// 失败：只有这几种类型，正好对应 §6.5 的处理规则
{ "ok": false, "error": { "kind": "rate_limit | quota | unavailable | context_length | refusal | auth | bad_output",
  "message": "……", "retryAfterMs": 30000, "resetAt": "额度恢复时间（知道的话）" } }
```

**三种接入方式**，从不写代码到写代码：

| 方式 | 适合 | 用户要做什么 |
|---|---|---|
| **命令行模板**（零代码） | Claude Code、Cursor Agent、Codex CLI、Ollama，以及任何命令行工具 | 一段配置：怎么调用、提示词从哪进、结果和用量从输出哪里取、出现哪些字样算"额度用尽 / 限流 / 未登录" |
| **兼容 API**（零代码） | OpenRouter，以及提供 OpenAI / Anthropic 兼容接口的平台（多数国内平台都有），本地 Ollama、LM Studio | 地址、模型名、key 的引用（key 本身在系统钥匙串里） |
| **脚本协议**（任何语言） | 前两种覆盖不了的情况 | 一个小程序：从标准输入读请求 JSON，往标准输出写结果 JSON。Python、Node、Go 都行 |

配置示例（命令行模板；参数以各工具当前版本的 `--help` 为准）：

```json
{
  "channels": {
    "cursor": {
      "type": "command",
      "cmd": ["cursor-agent", "-p", "--output-format", "json", "--model", "{model}"],
      "prompt": "stdin",
      "result": "json:result", "usage": "json:usage",
      "errors": { "quota": ["usage limit", "upgrade your plan"], "auth": ["not logged in"], "rate_limit": ["rate limit", "429"] },
      "effort": { "mode": "model-suffix", "map": { "low": "-low", "medium": "-medium", "high": "-high", "max": "-xhigh" } }
    }
  },
  "fighters": {
    "grok": { "channel": "cursor", "model": "grok-4.7", "effort": "medium" },
    "kimi": { "channel": "cursor", "model": "kimi-k3", "effort": "high" }
  }
}
```

**推理档位映射**：每个通道声明自己怎么表达档位：参数（如 `--effort high`）、模型名后缀（如 `grok-4.7-high`）、思考 token 预算，或不支持。引擎把统一的五档交给通道翻译，实际映射写进 `model_call` 事件。

**内置预设 + 自动探测**：

- 预设：Claude Code、Cursor Agent、Codex CLI、OpenRouter、Ollama。
- `crux channel probe`：扫描本机装了哪些命令行工具、是否已登录、能用哪些模型（只读模型列表，不发起对话、不耗额度），自动生成通道配置，并把能上场的选手标出来。

**让用户的 AI 助手写接入**：

1. 仓库里放一份**写给 AI 看的接入说明**（`docs/channels.md`）：协议、错误类型、档位映射规则，加上三种方式各一个可运行的模板。
2. 用户对自己的 Claude Code / Cursor / Codex 说"帮我给 Crux Arena 接入 XXX，按 docs/channels.md 来"，它生成配置或脚本。
3. **验收测试 `crux channel test <通道>`**，通过了才能上场：
   - 结构化输出：按给定 schema 回答，格式不对能被识别为 `bad_output`；
   - 推理档位：五档都能映射，或明确声明不支持；
   - 用量：会上报 token，或标明是估算；
   - 错误分类：用模拟场景检查限流、额度用尽、超时、未登录能否被正确归类；
   - 超时与输出大小上限生效。
   `--mock` 先只验证格式和流程，不耗额度；最后再做一次真实调用验收。
4. 桌面版设置页加"添加通道"：给出一段可以直接复制给自己 agent 的话；接好后点"验收"，结果显示在通道列表里。

**会员通道的特点**（Claude 会员、ChatGPT 会员、Cursor 会员等）：

- 不按 token 扣钱，而是有使用窗口或月度用量。引擎照样记 token（命令行不报就按字数估算，标为估算），用于公平和预算。
- 命令行一旦提示用量到上限，就按 `quota` 处理：降级、退场、暂停、断点续打全部照 §6.5 走。
- 每次调用要启动一次命令行，比 API 慢。用盲答并行、保持会话、按通道限制并发来缓解。
- 用官方命令行、在自己电脑上、给自己用，是这些工具的正常用法；不要把自己的会员当后端给别人用。具体以各家条款为准。

**作者当前环境（2026-10-28 实测）**：

| 通道 | 状态 | 能上场的选手 |
|---|---|---|
| Claude Code（Claude 会员） | 已安装、可用；支持 `--model`、`--effort`、JSON 输出、限制工具 | CLAUDE |
| Cursor Agent（Cursor 会员） | 已安装、已登录；账号下 270 个模型，档位写在模型名后缀里 | CODEX（GPT）、GROK、GEMINI（Gemini 4 Argon 等）、KIMI（K3）、GLM（5.2）、DEEPSEEK（V4.1）；CLAUDE 的备用 |
| Codex CLI（ChatGPT 会员） | 未安装 | 装好后接 CODEX |
| 无通道 | 需要 API / OpenRouter / Ollama | MUSE、MISTRAL、DOUBAO、QWEN、YUANBAO、MINIMAX |

没有通道的选手在输入框里显示为灰色"无通道"，**不会偷偷换成别的模型冒充**。

**安全边界**：

- 命令行和脚本通道会在本机执行命令，只能由用户自己在配置里定义；比赛内容（问题、模型输出）不会改变要执行的命令，提示词只走标准输入或临时文件，不拼进命令行参数。
- 每次调用都有超时和输出大小上限；通道进程不需要、也拿不到文件夹访问权：文件由我们的只读工具读取，再把片段放进提示词，审计和敏感文件屏蔽仍在引擎手里。
- 会员命令行一律以只读 / 问答模式启动，并关闭它自带的写文件、执行命令能力。
- API key 只以引用的形式出现在配置里，绝不写进事件、战报和日志。

---

## 7. 技术架构

```
Engine (TS)  ──events (SSE)──▶  Arena UI (PixiJS v8 + React 叠加层)
  状态机 / Provider 适配 / 预算 / 工具 / 日志生成器
      │
      ▼
 matches/<id>/events.jsonl  ──确定性生成──▶  battle-log.md / 结果报告
 （唯一事实来源：回放、分享、录视频、eval 全靠它）
```

| 层 | 选择 |
|---|---|
| 语言 | TypeScript，pnpm monorepo：`packages/engine`、`packages/arena-ui`、`packages/cli` |
| 模型 | OpenRouter + Anthropic / OpenAI / Google SDK 直连 + Ollama |
| 渲染 | PixiJS v8（精灵、粒子、震屏）+ React（日志面板、结果页）+ GSAP |
| 音效 | Howler.js + 8-bit SFX（命中、格挡、暴击、KO、回合铃） |
| 后端 | Node + Hono，SSE 推事件 |
| 分发 | `npx crux-arena` 本地运行；静态 demo 站只放回放（免 key） |
| 集成 | MCP server / Claude Code 插件：`/arena <问题>` |
| 录视频 | Playwright 固定帧率回放录屏 |

---

## 8. 开发路线

### Phase 0 — 引擎 + 日志 + 评测（约 1 周）
- [x] npm workspaces monorepo：`packages/engine`、`packages/workspace`、`packages/cli`（Node ≥ 23.6 直接跑 TypeScript，无构建步骤）
- [x] 事件 schema（zod 校验，`packages/engine/src/schema.ts`）+ 由事件推导状态的 reducer（`state.ts`）
- [x] 引擎状态机（`engine.ts`）：盲答 → 分歧提取 → 交锋 → 收敛 → 冠军答案；稀疏轮空、提前收敛、预算上限、组队模式不能打队友
- [x] 规则：伤害由引擎按裁决类别计算（成立 30 / 部分 15 / 驳回 0，带证据且核实 ×1.5 暴击）；`why` ≤ 20 字自动截断
- [x] 动作校验 + 重试一次：认输 / 改投必须写 `causedBy`，否则记"无因认输"；不合规动作丢弃并记标记
- [x] 匿名论点板（`view.ts`）：大脑只看到 P1/P2… 代号和压缩状态
- [x] `battle-log.md` 生成器（`battlelog.ts`）：确定性、零 token；含说服链、结论溯源、标记、只读审计
- [x] 只读文件夹工具（`packages/workspace`）：list_dir / read_file / grep / 仓库地图；路径沙箱、符号链接与目录联接越界拒绝、敏感文件屏蔽、`.gitignore`、按选手读取预算、共享证据柜、审计进事件流
- [x] CLI：`crux demo` / `crux log <events.jsonl>` / `crux ws <文件夹> map|ls|read|grep`
- [x] 测试：`npm test`（23 个，1 个文件符号链接用例在 Windows 普通权限下跳过）；`npm run typecheck`
- [ ] Provider 适配与 LLM 大脑：移到 Phase 4（最后做）
- [ ] `git_log` / `git_diff` 只读工具：需先关掉仓库自带配置可能触发的外部命令（diff 驱动、textconv、fsmonitor），再开放
- [ ] 子目录里的 `.gitignore`（目前只读根目录的）
- [ ] Eval：单模型 vs 多数投票 vs Arena，准确率 + 成本（GPQA 子集 + 30 道真实难题）
- 门槛：Arena 不比投票强就先调机制，不做画面

### Phase 1 — 桌面版（先不接模型）
- [x] 通用演示大脑：任意 2–6 名选手、混战 / 组队都能跑完整场（规则驱动，不是写死的剧本）
- [x] 吉祥物精灵抽成共享包，网页原型和桌面版共用一份
- [x] Electron 桌面壳：全局快捷键、托盘、像素风输入框（问题 / 文件夹 / 模式 / 选手）、记住上次设置
- [x] 桌面竞技场：事件驱动（不再是剧本），选手站在任务栏上方，透明置顶、空白处鼠标穿透
- [x] 冠军答案卡片：复制答案、查看战报、打开存档
- [x] 文件夹模式真实侦察：仓库地图 + 只读读取，审计进事件流
- [x] 存档：每场写 events.jsonl + battle-log.md；自测模式自动截图
- [x] 回放：输入框里的最近比赛列表、托盘"回放最近一场 / 打开存档回放"、结果卡"再看一遍"
- [x] 设置页：录制自定义快捷键（被占用时自动退到备选）、默认倍速、战报面板、存档位置、开机自启
- [x] Windows 安装包：esbuild 把主进程打成单文件，electron-builder 生成 NSIS 安装程序（`npm run desktop:dist`）
- [ ] 安装包代码签名（未签名时 Windows SmartScreen 会提示）、自动更新、macOS 版
- 实测：`Ctrl+Alt+Space` 在作者机器上已被占用，自动退到 `Ctrl+Shift+Space`

### Phase 2 — 噱头打磨（约 1–2 周）
- [ ] 精修原创精灵（多帧动画）、音效、镜头特效
- [ ] 组队 / 攻擂 / 淘汰赛 / 速决模式；证据工具（搜索、代码执行）
- [ ] 文件夹模式（只读工具白名单、路径沙箱、仓库地图、共享证据柜）与讨伐 BOSS 模式
- [ ] 跨比赛排行榜（说服力 / 被说服率 / 无因认输率）
- [ ] 回放分享链接、视频导出

### Phase 3 — 开源发布（约 1 周）
- [ ] README：首屏 GIF、一行命令、成本表、eval 结果、日志示例
- [ ] demo 站 10+ 场精选回放
- [ ] MCP / Claude Code 插件
- [ ] GitHub、Show HN、r/LocalLLaMA、X、B站 / YouTube

### Phase 4 — 接入真实模型（最后做，见 §6）
- [x] 通道接口 + 模拟通道测试（格式错误重试、限流重试、额度用尽不重试、并发闸门）；`packages/channels`
- [ ] 模拟通道补齐超时、拒答，并用它测通降级、退场、暂停、续打
- [ ] 通道三种方式：命令行模板、兼容 API、脚本协议（§6.7）；统一返回 usage（输入 / 输出 / 思考 / 缓存，或标为估算）
- [ ] 内置预设（Claude Code、Cursor Agent、Codex CLI、OpenRouter、Ollama）+ `crux channel probe` 自动探测
- [ ] 写给 AI 的接入说明 `docs/channels.md` + 三种模板 + `crux channel test` 验收（含 `--mock`）；设置页"添加通道"
- [x] 第一批真实通道：Cursor Agent（ask 只读模式，8 名选手：CLAUDE / CODEX / GROK / GEMINI / MUSE / DEEPSEEK / KIMI / GLM）；Claude Code（已接，登录后自动优先给 CLAUDE 用）。不经过 shell、提示词只走标准输入、空沙箱目录启动
- [x] 首场真实 8 人混战（2026-10-28）：`crux fight --real`，存档含 events.jsonl / battle-log.md / calls.jsonl（每次调用的提示词、原始输出、模型、用量、耗时）
- [x] 录屏：`node packages/desktop/scripts/record.ts <存档>`，桌面版 `--replay --backdrop --exit-after-replay` + ffmpeg 只录竞技场区域
- [x] 省 token：裁判每回合合并成一次裁决（原来每个动作一次）
- [x] 有分歧：盲答时按出场顺序分配立场视角（代码审查 / 决策两套，按问题自动选）
- [x] 选手盲答前可以请求读文件（每人一次、最多 3 段、每段 ≤120 行），走只读工具和审计；交锋时继续给他看
- [x] **从任何 agent 拉起对局**（docs/agents.md）：`crux fight --detach` 后台开打、`crux result --wait` 取回冠军答案；Claude Code skill（`crux setup` 安装）；Cursor / Codex 用 AGENTS.md 说明
- [x] 自审修复（来自一场 4 人代码审查对局，逐条核实后修）：交出盲答不到 2 人判"对局无效"而不是完美收敛；每次调用新建空沙箱目录、环境变量白名单（不再把宿主会话凭据传给命令行）；超时杀整棵进程树并兜底返回；事件写入失败不再静默丢事件；JSON 解析容忍尾随文字
- [ ] 只读工具的符号链接 TOCTOU（需要有人在比赛进行中改仓库，风险低）
- [x] 自定义通道（§6.7 三种方式落地）：`channels.json` 里的 openai / command / script 通道；自定义选手、改自带选手的通道、指定裁判 / 主席；`crux channel list|test`；模拟选手脚本（零成本试跑）；docs/channels.md + crux-channel skill
- [x] 自定义形象：24×20 四姿势像素表（docs/mascots.md），同编号覆盖自带形象；`crux mascot export|new|check|preview|reset`；新选手没画形象时用同色史莱姆；桌面版托盘"重新加载"；crux-mascot skill
- [x] 桌面版接管 agent 拉起的对局：完整竞技场 / 角落小窗 / 纯后台；没开时自动在后台拉起；设置页"模型与额度""agent 对局"，与 CLI 共用默认值
- [x] 基于提示词的 LLM 大脑：盲答、分歧提取、动作（结构化输出 + 校验重试）、裁判、主席；文件证据由引擎读原文核对，不信模型自报
- [x] 推理强度五档映射（Cursor：按模型名后缀取最接近的一档；Claude Code：`--effort`）
- [ ] 按角色、按阶段的推理档位默认值
- [x] 单场预算：剩余预算不够打完整一回合就不开新回合，冠军答案预留 15%
- [ ] 其余预算层：单次、单选手、每日 / 每月；开赛前估价与降级建议
- [ ] 错误分类、重试与降级链；选手退场；裁判 / 主席自动顶替
- [ ] 暂停与断点续打（`crux resume`）；开赛前通道预检
- [ ] 设置页"模型与额度"：API key（系统钥匙串）、默认模型、推理档位、降级链、花费上限
- [ ] 新事件 `model_call` / `fallback` / `fighter_out` / `paused` 进战报和画面
- [ ] Eval：单模型 vs 多数投票 vs 竞技场，准确率 + 成本，推理档位对齐

---

## 9. 视频方案

1. **钩子（0–15s）**：一个模型自信地错，另一个带着搜索证据暴击，论点卡碎裂 K.O.。字幕："一个 AI 会犯错，让它们打一架呢？"
2. **问题（15–45s）**：幻觉、自信地错；llm-council 等方案看不见过程。
3. **演示（45s–3min）**：有标准答案的难题（纠错）、真实决策题（crux + 少数派）、一场 Flawless Victory（省钱）。
4. **可追溯（20s）**：打开战斗日志，点 `⇐#A1` 一路追到"谁因为什么说服了谁"。
5. **数据（30s）**：准确率 vs 单模型 vs 投票 + 成本，诚实展示；附"哪个模型最容易被说服"排行。
6. **结尾**：开源地址 + 一行命令。

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 辩论本身不提升正确率 | 异构模型 + 投票打底 + 证据纠错；Phase 0 先验证 |
| 从众 / 谄媚 | 盲答、匿名、steelman；认输必须有 `caused_by`，否则标记"无因认输" |
| 裁判偏袒 | 裁判用不参赛的模型或多裁判投票，匿名 |
| 日志太长 | `why` / `ruling` 字数上限；一行一动作；细节折叠 |
| 好看但看不懂 | 随时暂停、点卡看溯源、结果页是严肃报告 |
| 成本失控 | 硬预算 + 预估 + Mana 条 |
| 推理 token 失控 | 思考 token 计入预算；按角色 / 阶段给推理档位；单次思考预算上限 |
| 额度中途用尽 | 错误分类 + 降级链 + 选手退场；冠军答案预留预算；暂停与断点续打 |
| 模型之间不公平 | 默认每人等额 token 上限；输出上限；评测时推理档位对齐 |
| API key 泄露 | 存系统钥匙串，只在主进程使用，绝不写进事件和日志 |
| AI 写的通道不可靠 / 不安全 | `crux channel test` 验收通过才能上场；超时与输出上限；命令只能由用户在配置里定义，比赛内容不进命令行参数 |
| 用会员冒充其他模型 | 没有通道的选手显示"无通道"，不自动替换；每次调用的实际模型写进事件 |
| 美术工作量 | 先用原型里的程序化精灵，Phase 2 再精修 |
| 名称与商标 | 发布前检查 GitHub / npm / 商标冲突 |

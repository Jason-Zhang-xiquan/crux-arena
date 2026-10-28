---
name: crux-arena
description: Start a Crux Arena match so other AI models (Codex/GPT, Gemini, Grok, DeepSeek, Kimi, GLM, Muse, Claude) debate a question or review code, then return the champion answer with a traceable log of who convinced whom. Use when the user asks to discuss, debate, argue, review or "fight" something together with other AIs or models, e.g. "跟 codex、gemini 和 deepseek 讨论一下这套代码的 bugs 和可行性", "让几个 AI 打一架看看", "ask gemini and grok to argue about this design".
---

# Crux Arena：拉其他 AI 来一场对局

Crux Arena 让多个模型匿名辩论同一个问题：盲答 → 裁判提取分歧 → 交锋（攻 / 守 / 改投，必须写明被谁说服）→ 主席综合出冠军答案。文件夹严格只读。对局在后台跑，画面由用户的桌面版显示（完整竞技场 / 角落小窗 / 不显示，看用户设置）。

## 步骤

1. **组队**：用户点名的模型 + 你自己（你是 Claude Code，就加上 `claude`）。编号：`claude`、`codex`（GPT / OpenAI）、`gemini`、`grok`、`deepseek`、`kimi`、`glm`、`muse`（Meta）。2–8 人。用户没点名就不传 `--team`，用默认阵容。
2. **问题**：把用户的话改写成一个独立、清楚的问题（用用户的语言），写明要关注什么。例如"这套代码有哪些 bug？整体设计是否可行？按严重程度排序"。
3. **文件夹**：问题和当前项目 / 代码有关时传 `--dir`（仓库根目录）；纯观点问题不传。
4. **开打**（后台，立刻返回比赛编号）：
   ```bash
   crux fight "问题" --team claude,codex,gemini,deepseek --dir . --detach
   ```
   只有用户明确要求时才加：`--display full|mini|none`（画面）、`--rounds N`、`--budget N`、`--effort low|medium|high`。其余用用户在桌面版设置里的默认值。
5. **告诉用户**已经开打（编号、选手、画面在哪），然后等结果，通常 3–8 分钟：
   ```bash
   crux result <比赛编号> --wait --timeout 900
   ```
   你的工具支持后台运行就放后台，等的时候可以继续做别的。
6. **汇报**：冠军答案、少数派意见、谁因为什么说服了谁（挑关键的一两条）、需要用户判断的问题，以及战报路径。要据此改代码时，先自己读代码核实结论，再动手。

## 出错时

- `这些选手在本机没有通道`：照输出告诉用户哪些能上场（`crux channels`），问要不要换人。
- 找不到 `crux` 命令：让用户在 Crux Arena 仓库的 `packages/cli` 里运行一次 `npm link`。
- `crux result` 显示"中断"：把 `runner.log` 的最后几行告诉用户。

## 注意

- 会消耗用户的 Cursor / Claude 会员额度。默认预算约 25 万 token（4 人约打 1–2 回合）；不要未经同意连开多场或调高预算。
- 用户说"别显示""后台跑就行"时传 `--display none`；说"我想看"时传 `--display full`。

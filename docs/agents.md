# 从任何 agent 拉起对局

在 Claude Code、Cursor、Codex 或其他能跑命令行的 agent 里说一句"跟 codex、gemini 和 deepseek 讨论一下这套代码的 bugs 和可行性"，agent 就会用 `crux fight` 在后台开一场 Crux Arena 对局，打完把冠军答案带回来。

所有 agent 用的都是同一个命令行，区别只在于怎么把用法告诉 agent。

## 1. 安装命令行（一次）

```bash
cd packages/cli
npm link
crux channels        # 看本机能上场哪些选手（只读探测，不耗额度）
```

需要 Node ≥ 23.6，以及至少一个已登录的通道：Cursor Agent（`cursor-agent login`）或 Claude Code（`claude auth login`）。

## 2. 告诉你的 agent

| Agent | 做法 |
|---|---|
| Claude Code | `crux setup`：装三个 skill 到 `~/.claude/skills/`（crux-arena 拉起对局、crux-mascot 画形象、crux-channel 接自己的 AI），所有项目都能用 |
| Codex CLI | 把下面的说明加进 `~/.codex/AGENTS.md`（全局）或项目里的 `AGENTS.md` |
| Cursor | 加进项目的 `AGENTS.md`，或 Cursor 设置里的 User Rules |
| 其他 | 加进它读取的规则 / 系统提示文件 |

给非 Claude Code agent 的说明（复制即可）：

```markdown
## Crux Arena
当用户要你和其他 AI 一起讨论、辩论、审查某件事（如"跟 gemini 和 deepseek 讨论一下这段代码"）时：
1. 组队：用户点名的模型 + 你自己。编号 claude / codex（GPT）/ gemini / grok / deepseek / kimi / glm / muse，2–8 人。
2. 把用户的话改写成一个清楚的问题；和当前代码有关就加 `--dir <仓库根目录>`。
3. 运行 `crux fight "问题" --team a,b,c --dir . --detach`，告诉用户已开打。
4. 运行 `crux result <比赛编号> --wait --timeout 900` 等结果（3–8 分钟）。
5. 汇报冠军答案、少数派、谁说服了谁、需要用户判断的问题；改代码前先自己核实。
会消耗用户的会员额度，不要未经同意连开多场。
```

## 3. 常用参数

| 参数 | 说明 | 默认（桌面版设置里可改） |
|---|---|---|
| `--team` | 选手编号，逗号分隔；认识 gpt / openai / google 等别名 | claude,codex,gemini,deepseek |
| `--dir` | 只读文件夹；选手可以请求读具体文件，引擎核对引用的原文 | 不读文件 |
| `--display` | `full` 完整竞技场 / `mini` 角落小窗 / `none` 纯后台 | mini |
| `--rounds` / `--budget` / `--effort` | 回合上限 / 单场 token 预算 / 推理档位 | 2 / 250000 / low |
| `--lens` | 立场视角：`code`（代码审查）/ `decision`（决策）/ `none`；`auto` 按问题判断 | auto |
| `--detach` | 后台开打，立刻返回比赛编号 | 前台跑完再返回 |

`crux result latest`、`crux list` 查看最近的对局；每场存档里有 `events.jsonl`、`battle-log.md`、`calls.jsonl`（每次模型调用的提示词、原始输出、用量）和 `runner.log`。

## 接自己的 AI、画自己的形象

- 接入新模型（OpenRouter、Ollama、各家平台、任何命令行或脚本）：[channels.md](channels.md)。其他 agent 直接读这份说明照做即可。
- 改自带形象、给新 AI 画形象：[mascots.md](mascots.md)。

## 画面

桌面版在运行时会自动接管 agent 拉起的对局；没在运行时 `crux fight` 会在后台把它拉起来（只开托盘，不弹输入框）。角落小窗点一下展开完整竞技场；关掉小窗比赛照样在后台跑完。

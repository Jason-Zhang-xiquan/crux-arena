---
name: crux-channel
description: Connect a new AI model to Crux Arena as a fighter, judge or chair by writing a custom channel — an OpenAI-compatible API (OpenRouter, Ollama, LM Studio, vendor platforms), a command-line template, or a stdin/stdout script. Use when the user wants to add their own AI or model to the arena, route a built-in fighter through a different provider, or says things like "把我的 ollama 接进竞技场", "用 OpenRouter 的 qwen 上场", "add my local model as a fighter".
---

# Crux Arena：接入自己的 AI

配置文件是数据目录下的 `channels.json`（Windows：`%APPDATA%\Crux Arena\channels.json`；`crux channel list` 会打印路径）。完整说明在仓库的 `docs/channels.md`，动手前先读一遍。

## 步骤

1. **弄清用户有什么**：哪个模型、怎么访问（API 地址 + key、本地 Ollama、某个命令行工具，还是只能写代码调用）、想让它当选手还是裁判 / 主席、编号和显示名叫什么。
2. **选接入方式**，能零代码就零代码：
   - 有 OpenAI 兼容接口 → `"type": "openai"`（`baseUrl` 到 `/v1`，key 放环境变量，用 `apiKeyEnv` 写变量名）。
   - 有命令行能从标准输入读提示词 → `"type": "command"`。
   - 都不行 → `"type": "script"`，照 `integrations/channels/mock-fighter.mjs` 的协议写一个小脚本（Python / Node 都行）。
3. **写配置**：先读现有的 `channels.json`（可能不存在），**合并**进去，不要覆盖用户已有的通道和选手。
   - `fighters.<编号>`：`channel`、`model`，可选 `name`、`color`、`effort`。编号用小写字母、数字、短横线。写自带编号（如 `codex`）就是改它的通道。
   - 没有 Cursor 的用户必须在 `roles` 里给裁判和主席指定通道。
   - **绝不把 API key 写进文件**，让用户自己在环境变量里设置。
4. **验收**：
   ```bash
   crux channel list
   crux channel test <通道名> --model <模型>
   ```
   `test` 会真实调用一次（消耗少量额度），要看到"调用成功"和"JSON 可解析"。失败就按报错改：auth 多半是环境变量没设；bad_output 说明输出格式要调整。
5. **形象**：新编号还没有形象时，竞技场会用同色小史莱姆顶上；问用户要不要画一个（crux-mascot skill）。
6. **告诉用户**：桌面版托盘菜单点"重新加载自定义形象与通道"后，就能在输入框里选到它；命令行和 agent 里直接用 `--team 编号`。

## 注意

- 命令行和脚本通道会在用户电脑上执行命令，只能执行用户认可的程序；写 `cmd` 前把要执行什么告诉用户。
- 不要用别的模型冒充用户要接的模型；接不通就如实说明。

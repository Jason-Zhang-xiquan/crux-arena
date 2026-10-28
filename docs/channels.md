# 自定义通道：把你自己的 AI 接进竞技场

这份说明写给人，也写给你的 AI 助手。对它说"按 docs/channels.md 帮我把 XXX 接进 Crux Arena"，它就能照着配好。

配置文件：`数据目录/channels.json`。数据目录在 Windows 上是 `%APPDATA%\Crux Arena`，macOS 上是 `~/Library/Application Support/Crux Arena`，也可以用环境变量 `CRUX_HOME` 指定。文件结构：

```json
{
  "channels": { "通道名": { "type": "openai | command | script", "…": "…" } },
  "fighters": { "选手编号": { "name": "显示名", "channel": "通道名", "model": "模型名", "effort": "low", "color": "#f2a65a" } },
  "roles": { "judge": { "channel": "…", "model": "…" }, "chair": { "channel": "…", "model": "…" } }
}
```

- **`fighters`**：写新编号就是加一个新 AI；写自带编号（如 `codex`）就是改它走哪条通道。没写的自带选手照旧走 Claude Code / Cursor。
- **通道名**：除了自己定义的，也可以直接用内置的 `cursor`、`claude-code`。比如 `{ "channel": "cursor", "model": "composer-2.5" }` 就能让 Cursor 里的任何模型上场。
- **`roles`**：裁判和主席用什么。不写就用 Cursor 的 `composer-2.5`；没有 Cursor 的用户必须写。
- **形象**：新选手要有样子，见 [mascots.md](mascots.md)。没画的话会用同色小史莱姆顶上。

改完运行 `crux channel list` 检查，再用 `crux channel test <通道> --model <模型>` 真实调用一次做验收。桌面版在托盘菜单点"重新加载自定义形象与通道"。

## 方式一：兼容 OpenAI 的 API（零代码）

适用于 OpenRouter、Ollama、LM Studio、vLLM，以及提供 OpenAI 兼容接口的平台（DeepSeek、通义千问、豆包、Kimi、智谱等大多都有）。

```json
{
  "channels": {
    "openrouter": { "type": "openai", "baseUrl": "https://openrouter.ai/api/v1", "apiKeyEnv": "OPENROUTER_API_KEY", "reasoningEffort": true },
    "ollama": { "type": "openai", "baseUrl": "http://localhost:11434/v1", "concurrency": 1 }
  },
  "fighters": {
    "qwen": { "channel": "openrouter", "model": "qwen/qwen3-max" },
    "llama": { "name": "LLAMA", "channel": "ollama", "model": "llama3.3", "color": "#f2a65a" }
  }
}
```

| 字段 | 说明 |
|---|---|
| `baseUrl` | 到 `/v1` 为止，引擎自己拼 `/chat/completions` |
| `apiKeyEnv` | **key 所在的环境变量名**。配置文件里不写 key |
| `reasoningEffort` | 是否传 `reasoning_effort`（low / medium / high）。模型不支持就别开 |
| `jsonMode` | 是否传 `response_format: json_object` |
| `maxTokens`、`headers`、`concurrency`、`timeoutMs` | 可选 |

## 方式二：命令行模板（零代码）

适用于任何能"从标准输入读提示词、往标准输出写回答"的命令行工具。

```json
{
  "channels": {
    "my-cli": {
      "type": "command",
      "cmd": ["my-ai", "--model", "{model}", "--reasoning", "{effort}", "--json"],
      "output": "json:result",
      "usage": "json:usage",
      "errors": { "quota": ["usage limit", "upgrade your plan"], "auth": ["not logged in"], "rate_limit": ["429"] },
      "effort": { "off": "none", "low": "low", "medium": "medium", "high": "high", "max": "high" },
      "passEnv": ["MY_AI_TOKEN"]
    }
  }
}
```

- `cmd`：不经过 shell，直接执行。只有 `{model}`、`{effort}` 两个占位符；比赛内容从不进命令行参数。
- 标准输入：`系统提示 + "---" + 提示词`。
- `output`：`text` 表示整个标准输出就是回答；`json:路径` 表示从输出 JSON 里取回答，路径用点分隔，如 `json:choices.0.message.content`。
- `usage`：`json:路径`，指向一个含 `input_tokens/prompt_tokens/in` 和 `output_tokens/completion_tokens/out` 的对象。没有就按字数估算，并标为"估算"。
- `errors`：出现这些字样时归为对应错误。错误类型见下面"错误类型"一节。
- `passEnv`：默认只传系统必需的环境变量，命令需要的 token 要在这里点名。

## 方式三：脚本协议（任何语言）

前两种都不合适时，写一个小程序：从标准输入读一个请求 JSON，往标准输出的**最后一行**写一个结果 JSON。

```json
{ "channels": { "mine": { "type": "script", "cmd": ["python", "C:/path/my_channel.py"], "passEnv": ["MY_KEY"] } } }
```

请求：

```json
{ "v": 1, "task": "draft | act | crux | rule | final", "model": "…", "effort": "off | low | medium | high | max",
  "system": "系统提示", "prompt": "提示词（要求的 JSON 格式写在里面）", "messages": [{ "role": "user", "content": "…" }], "timeoutMs": 180000 }
```

成功：

```json
{ "ok": true, "text": "模型的原始回答", "usage": { "in": 1820, "out": 142 }, "model": "实际模型", "effortApplied": "实际档位" }
```

`text` 也可以换成 `"json": { … }`，直接给结构化结果。

失败：

```json
{ "ok": false, "error": { "kind": "rate_limit", "message": "…", "retryAfterMs": 30000 } }
```

模板：[integrations/channels/mock-fighter.mjs](../integrations/channels/mock-fighter.mjs) 是一个不调用模型的"模拟选手"，可以零成本试跑整场比赛；把其中的 `answer()` 换成真正的模型调用，就是你自己的通道。

## 错误类型

引擎按类型决定重试、降级还是退场（PLAN §6.5）：

| kind | 什么时候用 | 引擎怎么处理 |
|---|---|---|
| `rate_limit` | 短时限流（429） | 等待后重试 |
| `quota` | 额度 / 余额用尽 | 不重试 |
| `unavailable` | 服务故障、超时、断网 | 重试 |
| `context_length` | 提示词超出上下文窗口 | 不重试 |
| `refusal` | 模型拒答 | 不重试 |
| `auth` | 没登录、key 无效 | 不重试 |
| `bad_output` | 输出不是要求的格式 | 带着错误提示重试一次 |

## 安全边界

- **命令由你定义**：命令只能写在你自己的配置文件里；比赛内容（问题、模型输出）不会改变要执行的命令，只走标准输入或请求体。
- **每次调用都隔离**：
  - 在一个新建的空目录里启动，调完就删；
  - 环境变量只传白名单里的系统变量，加上 `passEnv` 点名的；
  - 有超时和输出大小上限。
- **通道碰不到你的文件夹**：文件由引擎的只读工具读取，再把片段放进提示词。
- **不写 key**：API key 放在环境变量里，配置文件里只写变量名。

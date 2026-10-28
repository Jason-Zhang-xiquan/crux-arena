// 自定义通道（PLAN §6.7）：用户在 channels.json 里接自己的 AI，三种方式——
//   command  命令行模板（零代码）：怎么调用、结果和用量从输出哪里取、哪些字样算什么错误
//   openai   兼容 OpenAI 的 API（OpenRouter、Ollama、LM Studio、各家平台）：地址、模型、key 所在的环境变量
//   script   脚本协议（任何语言）：标准输入读请求 JSON，标准输出写结果 JSON
// 安全边界和内置通道一样：命令只能由用户写在配置里；比赛内容只走标准输入 / 请求体；新的空目录启动；环境变量白名单。
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Channel, ChannelRequest, ChannelResult, Effort, ErrorKind } from './channel.ts';
import { classify, estimateTokens } from './channel.ts';
import { minimalEnv, runProcess, withSandbox } from './command.ts';

const KINDS = ['rate_limit', 'quota', 'unavailable', 'context_length', 'refusal', 'auth', 'bad_output'] as const;
const EFFORTS = ['off', 'low', 'medium', 'high', 'max'] as const;
const Common = { concurrency: z.number().int().min(1).max(16).default(2), timeoutMs: z.number().int().min(5_000).max(900_000).default(180_000) };

const CommandCfg = z.object({
  type: z.literal('command'),
  cmd: z.array(z.string()).min(1),                         // 可用占位符 {model}、{effort}
  output: z.string().default('text'),                      // text = 整个标准输出；json:路径 = 从输出 JSON 里取，如 json:result
  usage: z.string().optional(),                            // json:路径，指向 { input_tokens/prompt_tokens/in, output_tokens/completion_tokens/out }
  errors: z.partialRecord(z.enum(KINDS), z.array(z.string())).default({}),   // 出现这些字样就归为对应错误
  effort: z.partialRecord(z.enum(EFFORTS), z.string()).optional(),          // 统一档位 → 填进 {effort} 的值
  passEnv: z.array(z.string()).default([]),                // 额外传给命令的环境变量名（如 OPENAI_API_KEY）
  ...Common,
});
const OpenAICfg = z.object({
  type: z.literal('openai'),
  baseUrl: z.string().url(),                               // 如 https://openrouter.ai/api/v1、http://localhost:11434/v1
  apiKeyEnv: z.string().optional(),                        // key 放在这个环境变量里，配置文件里不写 key
  reasoningEffort: z.boolean().default(false),             // 是否传 reasoning_effort（low / medium / high）
  maxTokens: z.number().int().positive().optional(),
  jsonMode: z.boolean().default(false),                    // 是否传 response_format: json_object
  headers: z.record(z.string(), z.string()).default({}),
  ...Common,
});
const ScriptCfg = z.object({
  type: z.literal('script'),
  cmd: z.array(z.string()).min(1),
  passEnv: z.array(z.string()).default([]),
  ...Common,
});
export const ChannelCfg = z.discriminatedUnion('type', [CommandCfg, OpenAICfg, ScriptCfg]);
export type ChannelCfg = z.infer<typeof ChannelCfg>;

const SeatCfg = z.object({ channel: z.string(), model: z.string(), effort: z.enum(EFFORTS).optional() });
export const CustomConfig = z.object({
  channels: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/), ChannelCfg).default({}),
  // 选手：新 AI，或者改自带选手走哪条通道。id 规则和选手编号一致
  fighters: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/), SeatCfg.extend({
    name: z.string().max(16).optional(), color: z.string().optional(), maker: z.string().optional(),
  })).default({}),
  roles: z.object({ judge: SeatCfg.optional(), chair: SeatCfg.optional() }).default({}),
});
export type CustomConfig = z.infer<typeof CustomConfig>;

/** 读 channels.json；文件不存在就是空配置，格式错了直接报出哪一项 */
export async function loadCustomConfig(file: string): Promise<CustomConfig> {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { return CustomConfig.parse({}); }
  const r = CustomConfig.safeParse(JSON.parse(text));
  if (!r.success) throw new Error(`${file} 格式不对：${r.error.issues.slice(0, 3).map(i => `${i.path.join('.')}：${i.message}`).join('；')}`);
  return r.data;
}

/** 按 "a.b.0.c" 取值 */
const pick = (obj: unknown, p: string) => p.split('.').filter(Boolean).reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
const usageFrom = (u: unknown, req: ChannelRequest, text: string) => {
  const o = (u ?? {}) as Record<string, number | undefined>;
  const inT = o.input_tokens ?? o.prompt_tokens ?? o.in ?? o.inputTokens, outT = o.output_tokens ?? o.completion_tokens ?? o.out ?? o.outputTokens;
  if (typeof inT === 'number' && typeof outT === 'number') return { in: inT, out: outT, cached: o.cached ?? 0, estimated: false };
  return { in: estimateTokens(req.system + req.prompt), out: estimateTokens(text), cached: 0, estimated: true };
};
const fail = (model: string, ms: number, kind: ErrorKind, message: string, retryAfterMs?: number): ChannelResult =>
  ({ ok: false, error: { kind, message: message.slice(0, 300), ...(retryAfterMs ? { retryAfterMs } : {}) }, model, ms });
const customRules = (errors: Partial<Record<ErrorKind, string[]>>) =>
  Object.fromEntries(Object.entries(errors).filter(([, v]) => v?.length).map(([k, v]) => [k, new RegExp(v!.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')]));
const extraEnv = (names: string[]) => Object.fromEntries(names.filter(n => process.env[n] !== undefined).map(n => [n, process.env[n]!]));

export function createChannel(id: string, cfg: ChannelCfg): Channel {
  if (cfg.type === 'openai') return openaiChannel(id, cfg);
  if (cfg.type === 'script') return scriptChannel(id, cfg);
  return commandChannel(id, cfg);
}

function commandChannel(id: string, cfg: z.infer<typeof CommandCfg>): Channel {
  const rules = customRules(cfg.errors);
  return {
    id, concurrency: cfg.concurrency,
    async call(req) {
      const effort = cfg.effort?.[req.effort] ?? req.effort;
      const args = cfg.cmd.map(a => a.replaceAll('{model}', req.model).replaceAll('{effort}', effort));
      const r = await withSandbox(dir => runProcess(args[0], args.slice(1), { env: minimalEnv(extraEnv(cfg.passEnv)), cwd: dir, stdin: `${req.system}\n\n---\n\n${req.prompt}`, timeoutMs: req.timeoutMs ?? cfg.timeoutMs }));
      if (r.timedOut) return fail(req.model, r.ms, 'unavailable', '调用超时');
      if (r.tooLarge) return fail(req.model, r.ms, 'bad_output', '输出超过大小上限');
      const all = r.stdout + '\n' + r.stderr;
      if (r.code !== 0) return fail(req.model, r.ms, classify(all, rules), (r.stderr || r.stdout).trim() || `退出码 ${r.code}`);
      let text = r.stdout.trim(), parsed: unknown;
      if (cfg.output.startsWith('json:') || cfg.usage) { try { parsed = JSON.parse(text); } catch { if (cfg.output !== 'text') return fail(req.model, r.ms, 'bad_output', '输出不是 JSON'); } }
      if (cfg.output.startsWith('json:')) {
        const v = pick(parsed, cfg.output.slice(5));
        if (v == null) return fail(req.model, r.ms, classify(all, rules), `输出 JSON 里没有 ${cfg.output.slice(5)}`);
        text = typeof v === 'string' ? v : JSON.stringify(v);
      }
      // 正常退出但输出里带着错误字样（有的命令行把"额度用尽"当普通输出）
      for (const [kind, re] of Object.entries(rules)) if (re.test(text) && kind !== 'bad_output') return fail(req.model, r.ms, kind as ErrorKind, text);
      return { ok: true, text, model: req.model, effortApplied: effort, ms: r.ms, usage: usageFrom(cfg.usage ? pick(parsed, cfg.usage.slice(5)) : undefined, req, text) };
    },
  };
}

const OPENAI_EFFORT: Record<Effort, string | undefined> = { off: undefined, low: 'low', medium: 'medium', high: 'high', max: 'high' };

function openaiChannel(id: string, cfg: z.infer<typeof OpenAICfg>): Channel {
  return {
    id, concurrency: cfg.concurrency,
    async call(req) {
      const t0 = Date.now();
      const key = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
      if (cfg.apiKeyEnv && !key) return fail(req.model, 0, 'auth', `环境变量 ${cfg.apiKeyEnv} 没有设置（key 不写进配置文件）`);
      const effort = cfg.reasoningEffort ? OPENAI_EFFORT[req.effort] : undefined;
      const body = {
        model: req.model,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.prompt }],
        ...(effort ? { reasoning_effort: effort } : {}),
        ...(cfg.maxTokens ? { max_tokens: cfg.maxTokens } : {}),
        ...(cfg.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      };
      let res: Response;
      try {
        res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(req.timeoutMs ?? cfg.timeoutMs),
          headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...cfg.headers },
        });
      } catch (err) {
        return fail(req.model, Date.now() - t0, 'unavailable', (err as Error).name === 'TimeoutError' ? '调用超时' : (err as Error).message);
      }
      const ms = Date.now() - t0;
      const raw = await res.text();
      if (!res.ok) {
        const retry = Number(res.headers.get('retry-after')) * 1000 || undefined;
        const kind: ErrorKind = res.status === 429 ? (/quota|insufficient|balance|billing/i.test(raw) ? 'quota' : 'rate_limit')
          : res.status === 401 || res.status === 403 ? 'auth' : res.status === 402 ? 'quota'
          : res.status >= 500 ? 'unavailable' : classify(raw);
        return fail(req.model, ms, kind, `HTTP ${res.status}：${raw}`, retry);
      }
      let j: { choices?: Array<{ message?: { content?: string; refusal?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }; model?: string };
      try { j = JSON.parse(raw); } catch { return fail(req.model, ms, 'bad_output', '响应不是 JSON'); }
      const msg = j.choices?.[0]?.message;
      if (msg?.refusal) return fail(req.model, ms, 'refusal', msg.refusal);
      const text = msg?.content ?? '';
      if (!text) return fail(req.model, ms, j.choices?.[0]?.finish_reason === 'content_filter' ? 'refusal' : 'bad_output', '空回复');
      const u = j.usage;
      return {
        ok: true, text, model: j.model ?? req.model, effortApplied: effort ? `reasoning_effort=${effort}` : '不支持 / 未开启', ms,
        usage: u?.prompt_tokens !== undefined ? { in: u.prompt_tokens, out: u.completion_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens ?? 0, estimated: false } : usageFrom(undefined, req, text),
      };
    },
  };
}

/** 脚本协议 v1：标准输入一个请求 JSON，标准输出最后一行是结果 JSON（docs/channels.md） */
function scriptChannel(id: string, cfg: z.infer<typeof ScriptCfg>): Channel {
  return {
    id, concurrency: cfg.concurrency,
    async call(req) {
      const input = JSON.stringify({ v: 1, task: req.task, model: req.model, effort: req.effort, system: req.system, prompt: req.prompt, messages: [{ role: 'user', content: req.prompt }], timeoutMs: req.timeoutMs ?? cfg.timeoutMs });
      const r = await withSandbox(dir => runProcess(cfg.cmd[0], cfg.cmd.slice(1), { env: minimalEnv(extraEnv(cfg.passEnv)), cwd: dir, stdin: input, timeoutMs: req.timeoutMs ?? cfg.timeoutMs }));
      if (r.timedOut) return fail(req.model, r.ms, 'unavailable', '调用超时');
      if (r.tooLarge) return fail(req.model, r.ms, 'bad_output', '输出超过大小上限');
      const last = r.stdout.trim().split(/\r?\n/).pop() ?? '';
      let o: { ok?: boolean; text?: string; json?: unknown; usage?: unknown; model?: string; effortApplied?: string; error?: { kind?: string; message?: string; retryAfterMs?: number } };
      try { o = JSON.parse(last); } catch { return fail(req.model, r.ms, r.code ? classify(r.stdout + r.stderr) : 'bad_output', (r.stderr || last).trim() || `退出码 ${r.code}`); }
      if (!o.ok) {
        const kind = (KINDS as readonly string[]).includes(o.error?.kind ?? '') ? o.error!.kind as ErrorKind : 'unavailable';
        return fail(req.model, r.ms, kind, o.error?.message ?? '脚本报告失败', o.error?.retryAfterMs);
      }
      const text = o.text ?? (o.json !== undefined ? JSON.stringify(o.json) : '');
      if (!text) return fail(req.model, r.ms, 'bad_output', '结果里没有 text 或 json');
      return { ok: true, text, model: o.model ?? req.model, effortApplied: o.effortApplied ?? req.effort, ms: r.ms, usage: usageFrom(o.usage, req, text) };
    },
  };
}

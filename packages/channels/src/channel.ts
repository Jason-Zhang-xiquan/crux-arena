// 通道：一次调用 = 一个请求 → 一个结果（PLAN §6.7）。
// 引擎和大脑不关心背后是会员命令行、API 还是用户自己写的脚本；错误只有固定几类，对应 §6.5 的处理规则。

export type Effort = 'off' | 'low' | 'medium' | 'high' | 'max';
export type Task = 'draft' | 'act' | 'crux' | 'rule' | 'final';
export type ErrorKind = 'rate_limit' | 'quota' | 'unavailable' | 'context_length' | 'refusal' | 'auth' | 'bad_output';

export interface ChannelRequest {
  task: Task;
  model: string;                     // 不带档位后缀的模型名，如 kimi-k3；档位由通道翻译
  effort: Effort;
  system: string;                    // 固定模板，不含比赛内容
  prompt: string;                    // 比赛内容只走这里（标准输入），不拼进命令行参数
  timeoutMs?: number;
}

export interface Usage { in: number; out: number; cached: number; estimated: boolean }

export type ChannelResult =
  | { ok: true; text: string; usage: Usage; model: string; effortApplied: string; ms: number }
  | { ok: false; error: { kind: ErrorKind; message: string; retryAfterMs?: number }; model: string; ms: number };

export interface Channel {
  id: string;
  /** 并发上限：同一通道同时最多几个调用 */
  concurrency: number;
  call(req: ChannelRequest): Promise<ChannelResult>;
}

/** 按输出里的字样归类错误；没认出来的一律算 unavailable（可重试、可降级） */
export function classify(text: string, extra: Partial<Record<ErrorKind, RegExp>> = {}): ErrorKind {
  const rules: Array<[ErrorKind, RegExp]> = [
    ...Object.entries(extra) as Array<[ErrorKind, RegExp]>,
    ['auth', /not logged in|log ?in required|failed to authenticate|unauthori[sz]ed|\b401\b|oauth/i],
    ['quota', /usage limit|quota|upgrade your plan|out of (credits|usage)|spending limit|insufficient (balance|credit)|\b402\b/i],
    ['rate_limit', /rate.?limit|too many requests|\b429\b/i],
    ['context_length', /context (length|window)|too many tokens|prompt is too long/i],
  ];
  for (const [kind, re] of rules) if (re.test(text)) return kind;
  return 'unavailable';
}

/** 给通道加并发闸门：超过上限的调用排队 */
export function limit(ch: Channel): Channel {
  let running = 0;
  const waiting: Array<() => void> = [];
  return {
    ...ch,
    async call(req) {
      if (running >= ch.concurrency) await new Promise<void>(r => waiting.push(r));
      running++;
      try { return await ch.call(req); } finally { running--; waiting.shift()?.(); }
    },
  };
}

/** 估算 token：一个汉字约 1 token，英文约 4 字符 1 token（只在通道不报用量时用，并标为估算） */
export function estimateTokens(text: string): number {
  const cjk = text.match(/[　-〿㐀-鿿豈-﫿＀-￯]/gu)?.length ?? 0;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

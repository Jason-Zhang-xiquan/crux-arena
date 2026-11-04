export const config = {
  port: Number(process.env.PORT ?? 8080),
  secret: process.env.TOKEN_SECRET ?? '',
  tokenTtlSeconds: 3600,
  rateLimit: { windowMs: 60_000, max: 30 },
  pageSize: 20,
  codeLength: 6,
};

# shortlink

一个很小的短链服务：登录用户可以创建短链（随机短码或自定义短码）、分页查看自己的短链、删除短链；任何人访问 `/<短码>` 会被 302 跳转到目标网址。

只用 Node 内置模块，数据存在内存里。可以直接部署在公网，也可以放在 nginx 等反向代理后面。

## 运行

```bash
TOKEN_SECRET=换成随机字符串 node src/main.js
node scripts/issue-token.js alice          # 给用户 alice 签发一个令牌，有效期 1 小时
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/links` | 创建短链，body：`{"target":"https://…","code":"可选的自定义短码"}`；每个客户端每分钟最多 30 次 |
| GET | `/api/links?page=N` | 分页列出自己的短链，每页 20 条，新的在前 |
| DELETE | `/api/links/<短码>` | 删除自己的短链 |
| GET | `/<短码>` | 跳转到目标网址，并记一次点击 |

需要登录的接口带 `Authorization: Bearer <令牌>`。

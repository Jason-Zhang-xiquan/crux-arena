# signup

一个活动报名服务：创建活动、打标签、报名（满员自动进候补，候补保留 10 分钟）、签到积分和排行榜、把报名名单导出成 CSV。

只用 Node 内置模块。存储层模拟远程数据库，所有读写都是异步的。内部工具，部署在内网，鉴权由前面的网关负责。

## 运行

```bash
EXPORT_DIR=/var/signup/exports node src/main.js
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/events` | 创建活动，body：`{"title":"…","capacity":50,"tags":["可选"]}`；容量默认 50 |
| POST | `/events/<编号>/tags` | 给活动加一个标签，body：`{"tag":"vip"}` |
| POST | `/events/<编号>/signup` | 报名，body：`{"user":"alice"}`；满员时进候补名单 |
| POST | `/checkin` | 签到加 10 分，body：`{"user":"alice"}` |
| GET | `/points?users=alice,bob` | 一组用户的总积分 |
| GET | `/leaderboard` | 最高的 3 个积分（并列只算一次），从高到低 |
| POST | `/events/<编号>/export` | 把报名名单导出到 `EXPORT_DIR` 下的 CSV，body：`{"name":"可选的文件名"}` |
| GET | `/events/<编号>/export` | 读取默认文件名的导出结果 |

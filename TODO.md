# 待办

## 1. 虚拟礼物补录（用户提，暂不实现）

需求：有些礼物**没录到**（当时没启动 / 漏收），需要一个入口**手动补一条礼物记录**。

要点：
- 补录的记录要能区分来源（`source = manual` 或 `is_virtual = 1`），不能和真实抓取的混在一起分不清
- 写进 `gifts` 表时要带齐：`session_id` / `user_sec_uid` / `nickname` / `gift_name` / `repeat_count` /
  `diamond_count`(单价) / `total_diamonds`(金额=单价×次数) / `create_time`
- 补录后必须**触发该场次聚合与汇总重算**（`agg_*`、`session_*_totals`），否则数字不同步
- 前端入口：场次详情页 → 礼物明细附近，一个「补录礼物」按钮 + 表单
- 注意：**单价与金额是两个字段**，补录表单要分开填或只填单价+次数自动算金额（见 lib/user-display.js 旁边那段说明）

## 2. 本地开发只跑面板（已支持，无需开发）

`DASHBOARD_EMBED_WORKER=0 node web-dashboard.js` —— 不起监控 worker，只跑前端 + 数据库接口。
（同一份 cookie 已经在别的机器录制时，本地调试必须用这个模式，否则会抢直播间连接）

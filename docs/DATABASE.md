# 数据库表结构与口径

> 由 `PRAGMA table_info` **从真实库生成**（`db/douyin.db`），字段与类型以本文件为准。
> 生成时间：2026-10-19 05:16 ｜ 共 **16** 张表。
>
> ⚠️ 口径说明只写"能从代码/README 确认"的部分；不确定处不写，避免把猜测写进文档。

## 表索引

| 表 | 类别 | 行数（当前库） | 说明 |
| --- | --- | --- | --- |
| [`danmaku`](#danmaku) | 基础明细 | 468,607 | 弹幕明细（每行一条）。 |
| [`dashboard_users`](#dashboard_users) | 账号 | 2 | 看板账号（scrypt + 随机盐；兼容旧无盐 sha256 并在登录时自动升级 |
| [`gift_icons`](#gift_icons) | 图标库 | 1,679 | 礼物图标库：运行时积累 + `sync-gift-icons.js` 同步。 |
| [`gifts`](#gifts) | 基础明细 | 425,021 | 礼物明细。连击去重按 `(用户, 礼物名, 收礼人, **场次**)` 分组 — |
| [`members`](#members) | 基础明细 | 1,051,194 | 进场（观众进入直播间）明细。 |
| [`online_records`](#online_records) | 基础明细 | 291,232 | 在线人数采样（按时间点）。 |
| [`session_anchor_ranking`](#session_anchor_ranking) | 场次预聚合 | 1,262 | 场次预聚合：单场团播主播排名（收礼人维度）。`anchor_avatar` 是* |
| [`session_danmaku_ranking`](#session_danmaku_ranking) | 场次预聚合 | 5,889 | 场次预聚合：单场弹幕排行。 |
| [`session_gift_details`](#session_gift_details) | 场次预聚合 | 125,987 | 场次预聚合：单场礼物**明细**（连击去重后，含 `to_nickname`）。 |
| [`session_gift_ranking`](#session_gift_ranking) | 场次预聚合 | 3,931 | 场次预聚合：单场礼物排行（送礼人维度），结束时写入。 |
| [`session_gift_type_totals`](#session_gift_type_totals) | 总览汇总 | 11,027 | 全量汇总（不截断）：按礼物类型 × 场次的统计。 |
| [`session_timeline`](#session_timeline) | 场次预聚合 | 31,785 | 场次预聚合：逐分钟时间线（gifts/diamonds/danmaku），供详情 |
| [`session_user_danmaku_totals`](#session_user_danmaku_totals) | 总览汇总 | 53,173 | 全量汇总（不截断）：按用户 × 场次的弹幕数。 |
| [`session_user_gift_totals`](#session_user_gift_totals) | 总览汇总 | 64,845 | 全量汇总（不截断）：按用户 × 场次的钻石/礼物数，总览与合并页读它，而不是扫明 |
| [`sessions`](#sessions) | 基础明细 | 216 | 一场直播一行。`start_time/end_time` 决定场次边界；已结束场 |
| [`streamers`](#streamers) | 基础明细 | 8 | 主播（房间）主表；`sec_uid` 是抖音真实 ID，**不是**主键。 |

## danmaku

> 弹幕明细（每行一条）。

行数：**468,607** ｜ 字段 9 个 ｜ 索引 4 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER |  | 是 |  |
| `session_id` | INTEGER | 是 |  |  |
| `msg_id` | TEXT |  |  | `NULL` |
| `nickname` | TEXT |  |  | `NULL` |
| `avatar` | TEXT |  |  | `NULL` |
| `content` | TEXT |  |  | `NULL` |
| `user_display_id` | TEXT |  |  | `NULL` |
| `user_sec_uid` | TEXT |  |  | `NULL` |
| `create_time` | INTEGER |  |  | `NULL` |

索引：`idx_danmaku_user_sec_uid`(user_sec_uid) · `idx_danmaku_session_time`(session_id, create_time) · `idx_danmaku_user`(nickname) · `idx_danmaku_session`(session_id)

## dashboard_users

> 看板账号（scrypt + 随机盐；兼容旧无盐 sha256 并在登录时自动升级）。

行数：**2** ｜ 字段 8 个 ｜ 索引 1 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER |  | 是 |  |
| `username` | TEXT | 是 |  |  |
| `password` | TEXT | 是 |  |  |
| `role` | TEXT | 是 |  | `'R_GUEST'` |
| `enabled` | INTEGER | 是 |  | `1` |
| `create_time` | TEXT |  |  | `datetime('now','localtime')` |
| `last_login_time` | TEXT |  |  | `NULL` |
| `avatar` | TEXT |  |  | `NULL` |

索引：`sqlite_autoindex_dashboard_users_1`(username) UNIQUE

## gift_icons

> 礼物图标库：运行时积累 + `sync-gift-icons.js` 同步。

行数：**1,679** ｜ 字段 4 个 ｜ 索引 0 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `gift_id` | INTEGER |  | 是 |  |
| `name` | TEXT | 是 |  |  |
| `icon_url` | TEXT |  |  |  |
| `diamond_count` | INTEGER |  |  | `0` |

## gifts

> 礼物明细。连击去重按 `(用户, 礼物名, 收礼人, **场次**)` 分组 —— 跨场次查询时 SELECT 必须带 `session_id`，否则分组会退化成跨场次合并（实测差 0.057%）。`to_avatar` 是收礼人（主播）头像，采集端可能为空。

行数：**425,021** ｜ 字段 22 个 ｜ 索引 8 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER |  | 是 |  |
| `session_id` | INTEGER | 是 |  |  |
| `msg_id` | TEXT |  |  | `NULL` |
| `nickname` | TEXT |  |  | `NULL` |
| `avatar` | TEXT |  |  | `NULL` |
| `to_nickname` | TEXT |  |  | `NULL` |
| `to_avatar` | TEXT |  |  | `NULL` |
| `to_user_display_id` | TEXT |  |  | `NULL` |
| `to_user_sec_uid` | TEXT |  |  | `NULL` |
| `gift_name` | TEXT |  |  | `NULL` |
| `diamond_count` | INTEGER |  |  | `0` |
| `repeat_count` | INTEGER |  |  | `1` |
| `total_diamonds` | INTEGER |  |  | `0` |
| `create_time` | INTEGER |  |  | `NULL` |
| `user_display_id` | TEXT |  |  | `NULL` |
| `user_sec_uid` | TEXT |  |  | `NULL` |
| `trace_id` | TEXT |  |  | `NULL` |
| `combo_count` | INTEGER |  |  | `0` |
| `repeat_end` | INTEGER |  |  | `NULL` |
| `group_count` | INTEGER |  |  | `1` |
| `send_type` | INTEGER |  |  | `NULL` |
| `icon` | TEXT |  |  |  |

索引：`idx_gifts_create_time`(create_time) · `idx_gifts_user_sec_uid`(user_sec_uid) · `idx_gifts_to_nickname`(session_id, to_nickname) · `idx_gifts_session_nickname`(session_id, nickname) · `idx_gifts_session_time`(session_id, create_time) · `idx_gifts_session_trace`(session_id, trace_id) · `idx_gifts_user`(nickname) · `idx_gifts_session`(session_id)

## members

> 进场（观众进入直播间）明细。

行数：**1,051,194** ｜ 字段 8 个 ｜ 索引 2 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER |  | 是 |  |
| `session_id` | INTEGER | 是 |  |  |
| `msg_id` | TEXT |  |  | `NULL` |
| `nickname` | TEXT |  |  | `NULL` |
| `avatar` | TEXT |  |  | `NULL` |
| `user_display_id` | TEXT |  |  | `NULL` |
| `user_sec_uid` | TEXT |  |  | `NULL` |
| `create_time` | INTEGER |  |  | `NULL` |

索引：`idx_members_user_sec_uid`(user_sec_uid) · `idx_members_session`(session_id)

## online_records

> 在线人数采样（按时间点）。

行数：**291,232** ｜ 字段 4 个 ｜ 索引 1 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER |  | 是 |  |
| `session_id` | INTEGER | 是 |  |  |
| `count` | INTEGER | 是 |  | `0` |
| `recorded_at` | INTEGER |  |  | `NULL` |

索引：`idx_online_session_time`(session_id, recorded_at)

## session_anchor_ranking

> 场次预聚合：单场团播主播排名（收礼人维度）。`anchor_avatar` 是**懒回填**的 —— 只有打开过该场次详情页才会补上并写回。

行数：**1,262** ｜ 字段 7 个 ｜ 索引 1 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `session_id` | INTEGER | 是 | 是 |  |
| `anchor_sec_uid` | TEXT | 是 | 是 |  |
| `anchor_name` | TEXT |  |  |  |
| `anchor_avatar` | TEXT |  |  |  |
| `total_diamonds` | INTEGER |  |  | `0` |
| `gift_count` | INTEGER |  |  | `0` |
| `user_count` | INTEGER |  |  | `0` |

索引：`sqlite_autoindex_session_anchor_ranking_1`(session_id, anchor_sec_uid) UNIQUE

## session_danmaku_ranking

> 场次预聚合：单场弹幕排行。

行数：**5,889** ｜ 字段 6 个 ｜ 索引 1 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `session_id` | INTEGER | 是 | 是 |  |
| `rank` | INTEGER | 是 | 是 |  |
| `nickname` | TEXT |  |  |  |
| `avatar` | TEXT |  |  |  |
| `user_sec_uid` | TEXT |  |  |  |
| `msg_count` | INTEGER |  |  | `0` |

索引：`sqlite_autoindex_session_danmaku_ranking_1`(session_id, rank) UNIQUE

## session_gift_details

> 场次预聚合：单场礼物**明细**（连击去重后，含 `to_nickname`）。合并页的"某主播收到了谁的礼"就按它算，与 thanks-rank.js 榜单口径一致。实测 7000+ 条 / 3MB+，所以走独立接口 `/api/sessions/:id/gift-details`，只在打开明细弹窗时拉取。

行数：**125,987** ｜ 字段 11 个 ｜ 索引 1 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `session_id` | INTEGER | 是 |  |  |
| `id` | INTEGER |  | 是 |  |
| `nickname` | TEXT |  |  |  |
| `user_sec_uid` | TEXT |  |  |  |
| `gift_name` | TEXT |  |  |  |
| `to_nickname` | TEXT |  |  |  |
| `total_diamonds` | INTEGER |  |  | `0` |
| `count` | INTEGER |  |  | `0` |
| `avatar_url` | TEXT |  |  |  |
| `gift_icon` | TEXT |  |  |  |
| `create_time` | INTEGER |  |  | `0` |

索引：`idx_session_gift_details_sid`(session_id)

## session_gift_ranking

> 场次预聚合：单场礼物排行（送礼人维度），结束时写入。

行数：**3,931** ｜ 字段 7 个 ｜ 索引 1 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `session_id` | INTEGER | 是 | 是 |  |
| `rank` | INTEGER | 是 | 是 |  |
| `nickname` | TEXT |  |  |  |
| `avatar_url` | TEXT |  |  |  |
| `user_sec_uid` | TEXT |  |  |  |
| `total_diamonds` | INTEGER |  |  | `0` |
| `gift_count` | INTEGER |  |  | `0` |

索引：`sqlite_autoindex_session_gift_ranking_1`(session_id, rank) UNIQUE

## session_gift_type_totals

> 全量汇总（不截断）：按礼物类型 × 场次的统计。

行数：**11,027** ｜ 字段 4 个 ｜ 索引 2 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `session_id` | INTEGER | 是 | 是 |  |
| `gift_name` | TEXT | 是 | 是 |  |
| `gift_count` | INTEGER |  |  | `0` |
| `diamonds` | INTEGER |  |  | `0` |

索引：`idx_sgtt_name`(gift_name) · `sqlite_autoindex_session_gift_type_totals_1`(session_id, gift_name) UNIQUE

## session_timeline

> 场次预聚合：逐分钟时间线（gifts/diamonds/danmaku），供详情页 "最新动态" 与按时段分析。

行数：**31,785** ｜ 字段 5 个 ｜ 索引 1 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `session_id` | INTEGER | 是 | 是 |  |
| `time` | TEXT | 是 | 是 |  |
| `gifts` | INTEGER |  |  | `0` |
| `diamonds` | INTEGER |  |  | `0` |
| `danmaku` | INTEGER |  |  | `0` |

索引：`sqlite_autoindex_session_timeline_1`(session_id, time) UNIQUE

## session_user_danmaku_totals

> 全量汇总（不截断）：按用户 × 场次的弹幕数。

行数：**53,173** ｜ 字段 5 个 ｜ 索引 2 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `session_id` | INTEGER | 是 | 是 |  |
| `user_sec_uid` | TEXT |  | 是 |  |
| `nickname` | TEXT |  | 是 |  |
| `avatar` | TEXT |  |  |  |
| `msg_count` | INTEGER |  |  | `0` |

索引：`idx_sudt_user`(user_sec_uid) · `sqlite_autoindex_session_user_danmaku_totals_1`(session_id, user_sec_uid, nickname) UNIQUE

## session_user_gift_totals

> 全量汇总（不截断）：按用户 × 场次的钻石/礼物数，总览与合并页读它，而不是扫明细。

行数：**64,845** ｜ 字段 6 个 ｜ 索引 2 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `session_id` | INTEGER | 是 | 是 |  |
| `user_sec_uid` | TEXT |  | 是 |  |
| `nickname` | TEXT |  | 是 |  |
| `avatar_url` | TEXT |  |  |  |
| `total_diamonds` | INTEGER |  |  | `0` |
| `gift_count` | INTEGER |  |  | `0` |

索引：`idx_sugt_user`(user_sec_uid) · `sqlite_autoindex_session_user_gift_totals_1`(session_id, user_sec_uid, nickname) UNIQUE

## sessions

> 一场直播一行。`start_time/end_time` 决定场次边界；已结束场次的聚合（agg_*）在结束时写入。

行数：**216** ｜ 字段 22 个 ｜ 索引 1 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER |  | 是 |  |
| `streamer_id` | INTEGER | 是 |  |  |
| `room_title` | TEXT |  |  | `NULL` |
| `room_id` | TEXT |  |  | `NULL` |
| `start_time` | TEXT |  |  | `NULL` |
| `end_time` | TEXT |  |  | `NULL` |
| `duration_seconds` | INTEGER |  |  | `0` |
| `stats_danmaku` | INTEGER |  |  | `0` |
| `stats_gift` | INTEGER |  |  | `0` |
| `stats_like` | INTEGER |  |  | `0` |
| `stats_member` | INTEGER |  |  | `0` |
| `stats_follow` | INTEGER |  |  | `0` |
| `stats_social` | INTEGER |  |  | `0` |
| `raw_messages_count` | INTEGER |  |  | `0` |
| `archived` | INTEGER |  |  | `0` |
| `file_path` | TEXT |  |  | `NULL` |
| `updated_at` | TEXT |  |  | `datetime('now','localtime')` |
| `online_peak` | INTEGER |  |  | `0` |
| `agg_gifts` | INTEGER |  |  | `0` |
| `agg_diamonds` | INTEGER |  |  | `0` |
| `agg_danmaku` | INTEGER |  |  | `0` |
| `agg_users` | INTEGER |  |  | `0` |

索引：`idx_sessions_streamer`(streamer_id)

## streamers

> 主播（房间）主表；`sec_uid` 是抖音真实 ID，**不是**主键。

行数：**8** ｜ 字段 6 个 ｜ 索引 1 个

| 字段 | 类型 | 非空 | 主键 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER |  | 是 |  |
| `name` | TEXT | 是 |  |  |
| `room_id` | TEXT |  |  | `NULL` |
| `avatar` | TEXT |  |  | `NULL` |
| `created_at` | TEXT |  |  | `datetime('now','localtime')` |
| `sec_uid` | TEXT |  |  | `""` |

索引：`sqlite_autoindex_streamers_1`(name) UNIQUE

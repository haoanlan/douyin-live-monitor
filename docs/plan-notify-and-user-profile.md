# 新功能规划：通知管理 + 观众等级体系

> 状态：草案（等你补「通知事件清单」文档后细化）
> 目标版本：v1.2

---

## 一、通知管理（独立页面）

### 1.1 为什么单独做一页

现在系统里的"通知"只有两处零散能力：

- `POST /api/report/generate` 生成战报图（但**不会**自己发出去）
- 前端 `art-notification` 只是顶栏的站内消息组件（模板自带，业务没接）

开播通知 / 下播战报 / 主播上场通知这类需求，本质是**规则 + 渠道 + 记录**三件事，
散落在设置里会很难维护，所以单独一页。

### 1.2 页面结构（初版）

```
通知管理
├─ 事件规则   事件类型 × 作用范围 × 触发条件 × 推送渠道 × 免打扰时段
├─ 推送渠道   企业微信 / 飞书 / 钉钉 / 自定义 Webhook / 邮件，支持"测试发送"
├─ 消息模板   开播话术、战报caption（支持变量 {{room}} {{diamonds}} …）
└─ 发送记录   成功/失败、重试、失败原因（排查"为什么没收到"）
```

### 1.3 事件类型（待你文档补充，先按这些占位）

| 事件 | 触发时机 | 数据来源 | 备注 |
| --- | --- | --- | --- |
| 开播通知 | 房间从离线→直播中 | worker `room-state` | 复用现有实时状态 |
| 下播战报 | 场次结束 | `sessions` + 报告图 | 生成图 + 文本摘要 |
| 主播上场 | 团播中检测到某主播开始说话/上榜 | 消息流 | 需要"上场"判定规则 |
| 连麦 / PK | 连麦开始、PK 结束 | 消息流 | 待确认是否要 |
| 断播 | 直播中断超过 N 分钟 | worker | |
| 在线骤降 | 相对峰值下降 X% | `online_records` | |
| 钻石爆发 | 单场钻石超阈值 | `sessions` | |
| 关键词命中 | 弹幕命中监控词 | `danmaku` | 与关键词监控共用 |

### 1.4 数据模型

```sql
-- 渠道
CREATE TABLE notify_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,              -- wecom | feishu | dingtalk | webhook | email
  name TEXT NOT NULL,
  config TEXT NOT NULL,            -- JSON：url / token / 收件人
  enabled INTEGER DEFAULT 1,
  created_at INTEGER
);

-- 规则
CREATE TABLE notify_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,             -- live_start | live_end_report | anchor_on_stage | ...
  room_id TEXT,                    -- 空 = 全部房间
  channel_ids TEXT NOT NULL,       -- JSON 数组
  conditions TEXT,                 -- JSON：阈值、关键词、最小时长等
  template_id INTEGER,
  quiet_hours TEXT,                -- JSON：{start:"23:00", end:"08:00"}
  enabled INTEGER DEFAULT 1,
  created_at INTEGER, updated_at INTEGER
);

-- 模板
CREATE TABLE notify_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  title TEXT, body TEXT            -- 支持 {{变量}}
);

-- 发送记录
CREATE TABLE notify_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER, event TEXT, channel_id INTEGER,
  payload TEXT, status TEXT,       -- sent | failed
  error TEXT, created_at INTEGER
);
```

### 1.5 接口草案

```
GET    /api/notify/channels          渠道列表
POST   /api/notify/channels          新增/修改渠道
POST   /api/notify/channels/test     测试发送（填 URL 即可试）
GET    /api/notify/rules             规则列表
POST   /api/notify/rules             保存规则
DELETE /api/notify/rules/:id         删除
GET    /api/notify/logs              发送记录（分页 + 状态筛选）
POST   /api/notify/resend/:id        重发
```

权限动作新增：`notify.manage`（通知管理页）、`notify.test`（测试发送）。

### 1.6 实现顺序（建议）

1. **渠道 + 测试发送**（能手动发出一条消息，先验证 webhook 通）
2. **开播 / 下播战报两条规则**（复用车床报告图 + 状态数据）
3. **发送记录 + 失败重试**
4. 其余事件（主播上场、网络异常等）按你的文档补

---

## 二、观众等级体系：等级 / 粉丝团 / 阶段性等级

### 2.1 数据从哪来

直播消息里能拿到（待确认字段名）：

- 用户等级（消费等级 / payGrade）
- 粉丝团（粉丝团名称 + 粉丝团等级）
- 阶段性等级（活动/阶段等级，如 PK 阶段、榜单阶段）

这些是**用户维度**的属性，且会随时间变化，所以存两层：

```sql
-- 用户档案（跨场次，最新一次为准）
CREATE TABLE user_profiles (
  user_sec_uid TEXT PRIMARY KEY,
  nickname TEXT, avatar_url TEXT,
  level INTEGER,                  -- 用户等级
  fans_club_name TEXT,            -- 粉丝团名称
  fans_club_level INTEGER,        -- 粉丝团等级
  stage_level TEXT,               -- 阶段性等级（先存字符串，字段确定再改）
  first_seen INTEGER, last_seen INTEGER, updated_at INTEGER
);

-- 每场快照（看"这场他是什么等级"）
CREATE TABLE session_user_profiles (
  session_id INTEGER NOT NULL,
  user_sec_uid TEXT NOT NULL,
  level INTEGER, fans_club_name TEXT, fans_club_level INTEGER, stage_level TEXT,
  captured_at INTEGER,
  PRIMARY KEY (session_id, user_sec_uid)
);
```

写入时机：worker 收到消息时顺手 upsert（按秒合并，避免高频写）。

### 2.2 放在哪里展示（重点讨论项）

| 方案 | 形态 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A. 行内徽章** | 榜单/明细每行加 `Lv.32` `粉丝团 7` 徽章，悬浮显示全部 | 就近、零点击 | 信息密度高，窄屏挤 |
| **B. 观众档案抽屉** | 点任意用户 → 侧滑抽屉：等级/粉丝团/阶段 + 跨场次累计钻石、最近出现、等级变化 | 信息完整、可追溯 | 多一次点击 |
| **C. 独立「观众」页** | 搜索 + 列表 + 排序（按累计钻石/最近出现/等级），识别核心粉丝与流失 | 能做运营分析 | 新页面，工作量大 |

**我的建议**：A + B 一起做（行内只放 1 个主徽章 + 抽屉里放全部），
C 作为第二步，等核心粉丝榜做出来再合并成一页。

### 2.3 待你确认

1. 这三个字段在消息协议里的**具体名字**（我按实际字段解析，避免猜错）
2. 阶段性等级是"每场算"还是"平台给的"，决定存快照还是只存最新
3. 徽章放行内是否合适，还是只放在抽屉里

---

## 三、与现有功能的衔接

- 下播战报 = 现有 `reportImg` 生成图 + `notify_rules` 推送（不重写报告）
- 主播上场通知需要"上场判定"，和团播主播排名用的是同一份 `anchorRanking` 数据
- 观众档案 = `session_user_gift_totals` / `session_user_danmaku_totals` 已有的跨场次基础 + 新 `user_profiles`
- CSV 导出、榜单图片下载保持不变

---

## 四、主播上场提醒：已实现部分（2026-11-08）

按《主播上场提醒-完整文档》落地，代码在 `lib/upstage/`：

| 文件 | 作用 |
| --- | --- |
| `store.js` | 关注名单 / 状态机 / 事件日志三张表 |
| `rank-list.js` | 团员榜 uid→昵称（零 cookie），60s 缓存 + room_id 失效重解析 |
| `engine.js` | 上升沿状态机：CONF_MIN 0.30 / NEED_HITS 2 / GONE 180s / 冷却 600s / 断流保护 60s |
| `ingest.js` | worker 的进度条通道（ContainerChange → challenge_user_infos）喂帧 |
| `token.js` | 外部采集进程的 X-Upstage-Token |
| `lib/routes/upstage.js` | 名单 / 状态 / 事件 / 帧入口 |

**通道现状**

- 进度条通道（`WebcastGroupLiveContainerChangeMessage` 的 `challenge_user_infos`）：**已接**，公会赛房间靠它。
- 人脸识别通道（`WebcastGroupLiveOnCamRecognitionMessage`）：**代理二进制里没有这个 proto**（已验证 `douyinLive-linux-amd64` 中不含该字符串），
  所以留了 `POST /api/upstage/frames` 给外部采集进程（Python 旁路 dump 解码后提交），令牌在页面「通知管理 → 主播上场」里。

**已实现的行为**

- 只推上场，离场只记 `off_stage` 事件（文档 4.4）
- 名字拿不到 → 挂起 `pending`，心跳每 10 秒重试，拿到后补发（文档 4.5 / 坑 2）
- 一帧多人、名单外忽略（文档坑 1 / 坑 6）
- 清空状态会把冷却一起清掉（否则"清空了还是不推"）

**待补**

- 脸部帧采集脚本（外部进程）—— 需要你确认用现有的 `watch_oncam.py` 还是我写一个 Node 版
- 开播/下播时自动 `resetRoom`（现在靠页面按钮或手动 API）
- 推送卡片用飞书 `lark_md` + @人（文档坑 14）
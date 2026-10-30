# 两个功能的方案（先看方案，不写代码）

> 目的：先把要改什么、怎么验、风险在哪写清楚。你确认后我再按阶段做。

---

# A. 虚拟礼物补录

## 要解决的问题

采集没启动 / 漏收的时候，某个礼物**确实发生但库里没有**。需要一个入口手动补一条，
并且补完之后**该场次的统计要跟着变**（否则榜单、总览、画像全是旧的）。

## 数据模型

复用现有 `gifts` 表，只加 3 列（迁移放在 `db-sqlite.js` 的 `init()` 里，用 `ALTER TABLE`）：

| 列 | 类型 | 说明 |
|---|---|---|
| `source` | TEXT DEFAULT `'live'` | `live` = 抓到的，`manual` = 手动补录 |
| `created_by` | TEXT | 补录人（`dashboard_users.username`） |
| `note` | TEXT | 备注，可空 |

**关键约束**（写库时由代码保证，不是靠人记）：

```
total_diamonds = diamond_count(单价) × repeat_count(次数)
```

单价和金额是**两个字段**，补录表单只让填「单价 + 次数」，金额由服务端算 —— 避免手填导致两者对不上。

## 接口

```
POST   /api/sessions/:id/gifts/manual     新增补录
DELETE /api/gifts/manual/:id              撤销补录
```

**POST body**

```json
{
  "nickname": "某观众",
  "user_sec_uid": "MS4w...",        // 可空；空则按昵称聚合
  "gift_name": "小心心",
  "unit_price": 1,                   // 单价
  "count": 10,                       // 次数
  "create_time": 1793179647069,      // 可空，默认现在
  "to_nickname": "主播名"            // 团播时才填
}
```

**校验**

- `gift_name` 非空、`unit_price > 0`、`count >= 1`
- 场次必须存在
- 只有超级管理员能调（复用 `auth-guard.requireSuper`）

**写完必须触发重算**（这是最容易漏的一步）

- `sessions.agg_gifts / agg_diamonds`
- `session_gift_details`（明细聚合表）
- `session_user_gift_totals`（用户维度）
- `session_gift_type_totals`（礼物维度）
- 顺带清掉 `/api/overview` 的缓存（否则总览 5 分钟内还是旧的）

> 实现前先查一下有没有现成的「重算单个场次」函数可复用；没有的话就写一个
> `recomputeSessionAggregates(sessionId)`，供补录/撤销/修复共用。

## 前端

入口：**场次详情 → 礼物明细卡片标题栏 → 「补录礼物」按钮**（只有超管可见）。

弹窗表单：昵称（必填）、抖音号（选填）、礼物名（带历史礼物名补全，给单价默认值）、
单价、次数、收礼人（团播时选）、时间（默认现在）。

列表里补录行加一个「手动」小标记，**和抓到的区分开**。

## 验证（必须过这一关）

```
1. 补录前：SELECT SUM(total_diamonds) FROM gifts WHERE session_id = X   → A
2. 补录 unit_price=99, count=3 → 应为 297
3. 补录后：SUM(total_diamonds) 必须等于 A + 297（一分不差）
4. 该场次 agg_diamonds 也必须等于 A + 297
5. 撤销后再查：必须回到 A
```

任何一个不成立 → 回退，不接受。

## 风险与防护

- **会写库** → 操作前先 `fs.copyFileSync('db/douyin.db', 'db/douyin.db.bak-<时间>')`
- 只允许超管
- 撤销功能必须有（补错了能撤）

**预计**：1~2 轮（后端 + 前端 + 验证）

---

# B. 菜单管理 + 账号权限可视化

## 现状

- 菜单是**前端硬编码**：`frontend/src/router/modules/douyin.ts`
- 角色是**后端硬编码**：`dashboard_users.role`，`lib/auth-guard.js` 里按 `R_SUPER` 判
- 没有“这个角色能看哪些菜单 / 能做哪些操作”的概念

## 数据模型（4 张表）

```sql
menu_items(id, key, title, parent_key, path, icon, sort, visible)
  -- key = 路由 name（如 DouyinGiftPrices）；parent_key 支持二级菜单

roles(id, key, name, note)
  -- key 如 R_SUPER / R_OPERATOR / R_VIEWER

role_menus(role_key, menu_key, can_view)
  -- 一个角色能看到哪些菜单

role_actions(role_key, action_key)
  -- 细粒度操作，如：gift_price.write / qrlogin / service.restart / manual_gift.add
```

## 接口

```
GET    /api/admin/menus                 菜单树（含 visible / sort）
POST   /api/admin/menus                 新增
PUT    /api/admin/menus/:id             改名/排序/显隐
DELETE /api/admin/menus/:id

GET    /api/admin/roles                 角色列表（含菜单数/人数）
POST   /api/admin/roles
PUT    /api/admin/roles/:key/menus      一次性提交该角色的菜单勾选
PUT    /api/admin/roles/:key/actions    一次性提交该角色的操作勾选

GET    /api/me/permissions              当前登录者的 { menus: [...], actions: [...] }
```

## 前端

1. **菜单管理页**：树形列表（拖拽排序、显隐开关、增删改）
2. **角色管理页**：左边角色列表，右边「菜单勾选矩阵」+「操作勾选列表」
3. **登录后**：拿 `/api/me/permissions` → 侧边栏只渲染有权限的菜单；按钮用 `v-auth="'gift_price.write'"` 控制

## 改造顺序（绝对不能一次做完）

| 阶段 | 做什么 | 是否动鉴权 |
|---|---|---|
| **1** ✓ | 建 4 张表 + 把现有菜单/角色**灌进去**（只读同步） | ❌ 不动 |
| **2** ✓ | 只读的菜单管理页 + 角色页（能看，不能改） | ❌ 不动 |
| **3** ✓ | 打开编辑，但**鉴权仍走老逻辑**（新表只是展示） | ❌ 不动 |
| **4** ✗ | 鉴权切到 `role_actions` + 前端按 `menus` 动态渲染 | ✅ **动** |

**为什么分 4 步**：第 4 步一旦出错就是“所有人看不到菜单”或“越权”，必须单独一轮 + 回滚方案。

## 风险

- 高（动鉴权核心）
- 必须保证：**超管永远有全部权限**（不能被自己锁死）
- 回滚：保留旧的 `role === 'R_SUPER'` 判断作为**兜底**，新逻辑失败时回落

**预计**：4~6 轮（每阶段一轮，每轮都要你在真机上点一遍）

# 抖音团播「团员榜」接口文档

> 实测环境：2026-11-12，项目 `new_douyinlive`，房间「林语巷」。
> 结论先说：**这个接口不需要 cookie、不需要登录、不需要 Referer**；但它的参数是**内部 room_id（19 位数字）**，不是页面上那个房间号。

---

## 1. 接口

```
GET https://live.douyin.com/webcast/anchor/group_live/get_group_rank_list/
```

### 最小可用请求（实测通过）

```bash
curl "https://live.douyin.com/webcast/anchor/group_live/get_group_rank_list/?aid=6383&room_id=7707179014414158619"
```

只要 `aid=6383` + `room_id=<内部room_id>` 就能拿到数据，其余参数全部可选（下面这份完整参数是我们 App 里在用的，加上也不会错）：

```
aid=6383
app_name=douyin_web
live_id=1
device_platform=web
language=zh-CN
enter_from=web_live
cookie_enabled=true
screen_width=1536
screen_height=864
browser_language=zh-CN
browser_platform=Win32
browser_name=Edge
browser_version=156.0.0.0
room_id=<内部 room_id>
```

### 实测：哪些东西是必需的

| 场景 | 结果 |
| --- | --- |
| 不带任何 header（无 cookie / 无 UA / 无 Referer） | ✅ `status_code=0`，正常返回 7 条 |
| 只带 UA | ✅ 正常 |
| UA + Referer | ✅ 正常 |
| 只带 `aid` + `room_id`（省掉其它参数） | ✅ 正常 |
| `room_id` 传页面房间号 `65209552987` | ❌ `status_code=10011` `Request params error` |

---

## 2. room_id 从哪来

`room_id` 是**内部房间 ID**（19 位，如 `7707179014414158619`），与页面上显示的 web 房间号（如 `65209552987`）不是一回事，且不能互相替代。

三种获取方式：

1. **从直播 WebSocket 消息里抓**（推荐，不依赖 cookie）：
   WS 的推流/房间消息里带 `room_id`，本项目由 worker 抓取后落库，`lib/upstage/rank-list.js` 的 `resolveRoomId()` 就优先读这份缓存。
2. **带有效 cookie 请求 web/enter 解析**：
   `https://live.douyin.com/webcast/room/web/enter/?aid=6383&app_name=douyin_web&device_platform=web&web_rid=<页面房间号>`
   —— 需要 cookie 里的 `s_v_web_id`，失效时会返回 **200 + 空 body**（本项目踩过这个坑）。
3. **浏览器打开直播间**，开发者工具 Network 里任意 `webcast` 请求的 `room_id` 参数。

> 补充实测：不带 cookie 直接 GET `https://live.douyin.com/<页面房间号>`，返回的 HTML 只有 6KB（反爬空页），**解析不出 room_id**。

---

## 3. 响应结构（只列有用的）

```jsonc
{
  "status_code": 0,
  "data": {
    "rank_list_users": [
      {
        "user_info": {
          "id": 67232674905,
          "id_str": "67232674905",       // 优先用这个（见 §5）
          "nickname": "西柠",             // ← 短名
          "avatar_thumb": { "url_list": ["https://..."] },
          "sec_uid": "MS4wLjABAAAA...",
          "mystery_man": 1
        },
        "score": 1059493,                // ← 本场贡献分（榜单排序依据，整数）
        "tier_rank_info": {
          "user_info": {
            "id": 67232674905,
            "id_str": "67232674905",
            "nickname": "🧊西柠🦋¹²²⁰林语巷"   // ← 全名（带后缀/emoji）
          },
          "score": 27434.2,              // ← 段位积分（浮点，与 score 不是一个量纲）
          "score_str": "234",            // 段位积分的展示缩写
          "tier_str": "黄金",             // 段位名
          "tier_node": 2,                // 段位小级
          "group_live_tier": 3,
          "medal_url": "https://...webp",
          "next_tier_node_diff": 3865.8, // 距下一级还差多少
          "season": { "year": "2026", "month": "11" }
        }
      }
    ],
    "rank_list_is_open": true,
    "tier_rank_activity_status": 0
  }
}
```

### 字段对照（本项目实测 7 条数据）

| 外层 `user_info.nickname` | `tier_rank_info.user_info.nickname` |
| --- | --- |
| 西柠 | 🧊西柠🦋¹²²⁰林语巷 |
| 假头 | 一颗假头👽林语巷 |
| 萱萱 | 萱萱🍋🍋‍🟩🍒🧸🛌林语巷 |
| 小爻 | 刀门太上老祖·爻🐸✖️✖️Ⱄⱄᐝ |
| 孔雀晓晓 | 晓晓🎀林语巷 |
| 沐洛 | ʚ沐洛洛ɞ 🍊🐟 |
| Vv | 陈Vv💎 |

- 要**短名**用 `user_info.nickname`；
- 要**完整昵称（带后缀/emoji）**用 `tier_rank_info.user_info.nickname`；
- 某些用户可能没有 `tier_rank_info`，需要回退到外层。

---

## 4. 两种「分数」不是一回事

| 字段 | 含义 | 量纲 | 用途 |
| --- | --- | --- | --- |
| `score` | **本场团播贡献分** | 整数，1 ~ 百万级 | **榜单排序依据**（谁第一看这个） |
| `tier_rank_info.score` | **段位积分**（黄金/白银累计分） | 浮点，1 万 ~ 4 万级 | 段位/勋章相关 |
| `tier_rank_info.score_str` | 段位积分展示串 | 如 `234` 表示 2.34 万 | UI 显示 |

实测样例（林语巷，按 `score` 排序）：

| 排名 | 昵称 | `score` | 段位 | `tier.score` |
| --- | --- | ---: | --- | ---: |
| 1 | 🧊西柠🦋¹²²⁰林语巷 | 1,059,493 | 黄金2 | 27,434.2 |
| 2 | 一颗假头👽林语巷 | 185,132 | 黄金1 | 23,402.2 |
| 3 | 萱萱🍋🍋‍🟩🍒🧸🛌林语巷 | 2,946 | 黄金5 | 42,108 |
| 4 | 刀门太上老祖·爻🐸✖️✖️Ⱄⱄᐝ | 2,398 | 白银4 | 17,879.9 |
| 5 | 晓晓🎀林语巷 | 150 | 白银5 | 22,206.6 |
| 6 | ʚ沐洛洛ɞ 🍊🐟 | 56 | 黄金1 | 26,316.1 |
| 7 | 陈Vv💎 | 14 | 白银3 | 14,593.3 |

> 注意：段位积分最高的不是第 1 名（萱萱 42,108 排第 3），两者别混用。

---

## 5. 坑

1. **19 位 id 精度**：`user_info.id` 是 JSON number，超过 2^53 会被舍入。
   实测 `陈Vv💎`：`id = 7450866781424895000`，而 `id_str = 7450866781424895034`。
   **任何地方取 uid 都用 `id_str`**（没有再用 `id`），别用 number 解析。
2. **`room_id` 必须是内部 ID**，传页面房间号返回 `status_code=10011`。
3. **不带 cookie 也能调**，但 room_id 的获取可能需要 cookie（见 §2）。
4. **每个用户可能有多条 tier 信息**，只有 `tier_rank_info` 才是"当前段位/全名/分数"的来源。
5. **频控**：本项目对同一房间做 60 秒缓存，不要高频轮询（尤其多房间时）。
6. **房间未开播时也可能返回数据**（服务端保留榜单），不代表"正在直播"。

---

## 6. 代码示例

### Node.js（无依赖）

```js
async function fetchGroupRank(roomId) {
  const url =
    'https://live.douyin.com/webcast/anchor/group_live/get_group_rank_list/' +
    `?aid=6383&room_id=${encodeURIComponent(roomId)}`;
  const json = await fetch(url).then((r) => r.json());
  if (json?.status_code !== 0) throw new Error(`status_code=${json?.status_code}`);
  return (json.data?.rank_list_users || []).map((it) => {
    const outer = it.user_info || {};
    const tier = it.tier_rank_info || {};
    const inner = tier.user_info || {};
    return {
      uid: String(inner.id_str || outer.id_str || outer.id || ''),
      shortName: outer.nickname || '',
      fullName: inner.nickname || outer.nickname || '',
      score: it.score ?? 0,                       // 本场贡献分
      tierScore: tier.score ?? 0,                 // 段位积分
      tier: tier.tier_str ? `${tier.tier_str}${tier.tier_node || ''}` : '',
      avatar: outer.avatar_thumb?.url_list?.[0] || '',
      secUid: outer.sec_uid || ''
    };
  });
}

const list = await fetchGroupRank('7707179014414158619');
console.log(list);
```

### Python

```python
import requests

def fetch_group_rank(room_id: str):
    url = "https://live.douyin.com/webcast/anchor/group_live/get_group_rank_list/"
    j = requests.get(url, params={"aid": 6383, "room_id": room_id}, timeout=10).json()
    if j.get("status_code") != 0:
        raise RuntimeError(f"status_code={j.get('status_code')}")
    out = []
    for it in j.get("data", {}).get("rank_list_users", []):
        outer = it.get("user_info") or {}
        tier = it.get("tier_rank_info") or {}
        inner = tier.get("user_info") or {}
        out.append({
            "uid": str(inner.get("id_str") or outer.get("id_str") or outer.get("id") or ""),
            "short_name": outer.get("nickname", ""),
            "full_name": inner.get("nickname") or outer.get("nickname", ""),
            "score": it.get("score", 0),
            "tier_score": tier.get("score", 0),
            "tier": f"{tier.get('tier_str','')}{tier.get('tier_node','')}",
        })
    return out

print(fetch_group_rank("7707179014414158619"))
```

---

## 7. 本项目里的对应实现

| 文件 | 作用 |
| --- | --- |
| `lib/upstage/rank-list.js` | `fetchRankList(roomId)` 拉榜、`resolveRoomId(webRid)` 解析 room_id、60s 缓存、`getUidNameMap()` 只保留 uid→短名 |
| `lib/upstage/uid.js` | `asUid()`，统一走 `id_str` 防精度丢失 |
| `lib/routes/upstage.js` | `GET /api/upstage/members?webRid=...`，给前端下拉用（**目前只返回 uid + 短名，没带分数**） |

如果要在本项目里显示分数/全名，需要改 `rank-list.js` 的 `normalize()`（取 `tier_rank_info.user_info.nickname` + `score`），并把字段透传到 `/api/upstage/members`。

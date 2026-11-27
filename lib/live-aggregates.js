/**
 * 直播中场次的**实时聚合** —— 全项目唯一实现。
 *
 * 背景（三个地方曾经各算各的，数字对不上）：
 *   · 场次列表（sessions.js）  用 comboDedupGifts 去重 ✓ 但用户数没算 ✗
 *   · 场次详情（detail.js:181）直接 SUM 原始礼物 ✗ **没去重** → 比列表大 ✗
 *   · 合并页（sessions.js）    读预聚合表 ✗ → 直播中这些表是空的 ✗
 *
 * 口径（与"连击去重按场次分组"的既有约定一致）：
 *   连击去重键 = (用户, 礼物名, 收礼人, 场次) → comboDedupGifts 统一处理 ✓
 *   钻石 = 去重后 SUM(total_diamonds) ✓
 *   礼物数 = 去重后 SUM(repeat_count) ✓
 *   用户数 = 送过礼 **或** 发过言的去重人数 ✓
 *
 * 只在"场次还没结束"时使用：已结束的场次读预聚合表（快、且与历史一致）。
 */

const { isAnonymousName, isPlaceholderAvatar, pickDisplayUser } = require('./user-display');

function liveAggregates(dbInstance, comboDedupGifts, sessionId) {
  const sid = Number(sessionId);

  // 原始礼物（SELECT * 与列表接口保持一致，字段集随表演进）
  let rawGifts = [];
  try {
    rawGifts = dbInstance.prepare('SELECT * FROM gifts WHERE session_id = ? ORDER BY id').all(sid);
  } catch {
    rawGifts = [];
  }
  const deduped = comboDedupGifts(rawGifts);

  const diamonds = deduped.reduce((s, g) => s + (g.total_diamonds || 0), 0);
  const gifts = deduped.reduce((s, g) => s + (g.repeat_count || 1), 0);

  let danmaku = 0;
  try {
    danmaku = dbInstance.prepare('SELECT COUNT(*) AS c FROM danmaku WHERE session_id = ?').get(sid).c || 0;
  } catch {
    danmaku = 0;
  }

  // 用户数：送过礼 ∪ 发过言（sec_uid 去重；空 uid 不计）
  let users = 0;
  try {
    users =
      dbInstance
        .prepare(
          `SELECT COUNT(DISTINCT user_sec_uid) AS c FROM gifts
            WHERE session_id = ? AND user_sec_uid IS NOT NULL AND user_sec_uid <> ''`
        )
        .get(sid).c || 0;
  } catch {
    users = 0;
  }

  // 礼物榜：按用户聚合（连击去重后）
  const giftUserMap = {};
  for (const g of deduped) {
    const uid = g.user_sec_uid || g.nickname || '';
    if (!uid) continue;
    if (!giftUserMap[uid]) {
      giftUserMap[uid] = {
        nickname: g.nickname,
        /*
         * gifts 表的列名是 avatar，不是 avatar_url ——
         * 旧代码在 SQL 里 `SELECT avatar as avatar_url` 别名过，所以能拿到；
         * 这里用的是 SELECT *，必须显式兼容两种写法，否则礼物榜头像全是空的。
         */
        avatar_url: g.avatar_url || g.avatar || null,
        user_sec_uid: g.user_sec_uid,
        total_diamonds: 0,
        gift_count: 0,
        _rows: []
      };
    }
    /*
     * 匿名占位：抖音对"未登录/被隐藏"的用户给「神秘人NNN」+ webcast/m... 的占位头像。
     * 同一个人可能先以神秘人身份送礼、后来又用真名送 —— 这时昵称能汇总对，
     * 但头像若按"贡献最大的那条"挑，会挑到神秘人那张占位图（用户反馈：
     * "汇总了但是头像是神秘人的头像"）。
     * 所以这里单独记住"真名那条"的昵称与头像，最后再覆盖。
     */
    /*
     * 名字和头像是一对，来自同一条记录（用户 2026-11-16 确认的唯一规则）：
     * 记住"第一条真名记录"的昵称+头像，最后整对使用；没有真名记录就用第一条匿名记录。
     * 匿名判定（神秘人 / dou123 / user123 / 用户123）只用来决定选哪一条。
     */
    // 收集这个人所有记录（名字+头像成对），最后按"同类兜底"统一挑一对
    giftUserMap[uid]._rows.push({ nickname: g.nickname, avatar: g.avatar_url || g.avatar || null });
    giftUserMap[uid].total_diamonds += g.total_diamonds || 0;
    giftUserMap[uid].gift_count += g.repeat_count || 1;
  }
  /*
   * 真名/真头像优先；**昵称和头像必须来自同一类记录**：
   * 出现过真名的人，头像只认真名记录那张 —— 真名记录没头像就留空，
   * 绝不拿"神秘人"那张头像去配真名（用户反复强调的错配）。
   */
  for (const u of Object.values(giftUserMap)) {
    // 名字/头像同源：真名组内挑（组内可兜底），没有真名记录才用匿名组
    const picked = pickDisplayUser(u._rows || []);
    if (picked.nickname) u.nickname = picked.nickname;
    u.avatar_url = picked.avatar_url || null;
    delete u._rows;
    delete u._realName;
    delete u._realAvatar;
  }
  const giftUsers = Object.values(giftUserMap)
    .sort((a, b) => b.total_diamonds - a.total_diamonds)
    .slice(0, 20);

  // 主播榜：按收礼人聚合（团播场景一个场次有多个主播）
  /*
   * 先建"昵称 → 真实主播身份"的索引：补录礼物可能只写了 to_nickname、没有 to_user_sec_uid，
   * 直接用昵称当键会让「神秘人 / 匿名」变成独立主播（用户反馈：榜单里冒出神秘人、没头像）。
   */
  const nickToAnchor = new Map();
  for (const g of deduped) {
    const name = (g.to_nickname || '').trim();
    if (!name || !g.to_user_sec_uid) continue;
    if (!nickToAnchor.has(name) || (!nickToAnchor.get(name).avatar && g.to_avatar)) {
      nickToAnchor.set(name, { sec: g.to_user_sec_uid, avatar: g.to_avatar || '' });
    }
  }
  /*
   * 原来这里又用 const 声明了一次 isAnonymousName，和文件顶部的 require 同名，
   * 而上面 giftUsers 聚合（第 82 行附近）已经用过它 —— 同函数作用域内 const 会提升到
   * 作用域顶部但未初始化，于是报 `Cannot access 'isAnonymousName' before initialization`。
   * 只在"直播中场次"走到这段聚合时触发，所以生产上表现为直播中报错。
   * 现在直接复用顶部 require 的那一份实现（`^(神秘人|匿名|游客)` / `dou123` / `user123` 规则一致）。
   */

  const anchorMap = {};
  for (const g of deduped) {
    const nick = (g.to_nickname || '').trim();
    const mapped = nick ? nickToAnchor.get(nick) : null;
    /*
     * 主播榜单**只认真实 secUid**（或昵称映射回的真实主播）。
     * 团播里"没有 to_user_sec_uid"的礼物就是送给主账号/主直播间的 ——
     * 这类行不该出现在主播榜里（用户 2026-11-27 明确：榜单上不出现主直播间的名字）。
     * 与 anchor-gifters.js 的 computeAnchorGifters 保持同一口径。
     */
    const sec = g.to_user_sec_uid || (mapped && mapped.sec) || '';
    if (!sec) continue;
    const key = sec;
    if (!anchorMap[key]) {
      anchorMap[key] = {
        anchor_sec_uid: sec || '',
        anchor_name: nick || '',
        anchor_avatar: g.to_avatar || (mapped && mapped.avatar) || null,
        total_diamonds: 0,
        gift_count: 0,
        users: new Set()
      };
    } else if (!anchorMap[key].anchor_avatar) {
      anchorMap[key].anchor_avatar = g.to_avatar || (mapped && mapped.avatar) || null;
    }
    anchorMap[key].total_diamonds += g.total_diamonds || 0;
    anchorMap[key].gift_count += g.repeat_count || 1;
    if (g.user_sec_uid) anchorMap[key].users.add(g.user_sec_uid);
  }
  const anchors = Object.values(anchorMap)
    .map((a) => ({ ...a, user_count: a.users.size, users: undefined }))
    .sort((a, b) => b.total_diamonds - a.total_diamonds);

  // 弹幕榜：按人聚合条数
  let danmakuRanking = [];
  try {
    danmakuRanking = dbInstance
      .prepare(
        `SELECT user_sec_uid AS user_sec_uid, nickname AS nickname, COUNT(*) AS danmaku
           FROM danmaku
          WHERE session_id = ? AND user_sec_uid IS NOT NULL AND user_sec_uid <> ''
          GROUP BY user_sec_uid
          ORDER BY danmaku DESC
          LIMIT 100`
      )
      .all(sid);
  } catch {
    danmakuRanking = [];
  }

  return { diamonds, gifts, danmaku, users, giftUsers, anchors, danmakuRanking, deduped, rawGifts };
}

module.exports = { liveAggregates };

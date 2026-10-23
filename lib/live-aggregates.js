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
        gift_count: 0
      };
    }
    // 神秘人/空头像不要覆盖已有的正常昵称与头像（同一用户不同消息里字段质量不一样）
    if (g.nickname && !String(g.nickname).startsWith('神秘人')) {
      giftUserMap[uid].nickname = g.nickname;
    }
    const av = g.avatar_url || g.avatar;
    if (av && !giftUserMap[uid].avatar_url) giftUserMap[uid].avatar_url = av;
    giftUserMap[uid].total_diamonds += g.total_diamonds || 0;
    giftUserMap[uid].gift_count += g.repeat_count || 1;
  }
  const giftUsers = Object.values(giftUserMap)
    .sort((a, b) => b.total_diamonds - a.total_diamonds)
    .slice(0, 20);

  // 主播榜：按收礼人聚合（团播场景一个场次有多个主播）
  const anchorMap = {};
  for (const g of deduped) {
    const key = g.to_user_sec_uid || g.to_nickname || '';
    if (!key) continue;
    if (!anchorMap[key]) {
      anchorMap[key] = {
        anchor_sec_uid: key,
        anchor_name: g.to_nickname || '',
        anchor_avatar: g.to_avatar || null,
        total_diamonds: 0,
        gift_count: 0,
        users: new Set()
      };
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

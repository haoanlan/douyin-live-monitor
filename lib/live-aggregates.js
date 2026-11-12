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

const { isAnonymousName, isPlaceholderAvatar } = require('./user-display');

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
    /*
     * 匿名占位：抖音对"未登录/被隐藏"的用户给「神秘人NNN」+ webcast/m... 的占位头像。
     * 同一个人可能先以神秘人身份送礼、后来又用真名送 —— 这时昵称能汇总对，
     * 但头像若按"贡献最大的那条"挑，会挑到神秘人那张占位图（用户反馈：
     * "汇总了但是头像是神秘人的头像"）。
     * 所以这里单独记住"真名那条"的昵称与头像，最后再覆盖。
     */
    const anonName = isAnonymousName(g.nickname);
    if (!anonName) {
      if (!giftUserMap[uid]._realName) giftUserMap[uid]._realName = g.nickname;
      const realAv = g.avatar_url || g.avatar;
      if (realAv && !giftUserMap[uid]._realAvatar) giftUserMap[uid]._realAvatar = realAv;
    }
    if (!anonName) {
      giftUserMap[uid].nickname = g.nickname;
    }
    const av = g.avatar_url || g.avatar;
    if (av && !giftUserMap[uid].avatar_url) giftUserMap[uid].avatar_url = av;
    giftUserMap[uid].total_diamonds += g.total_diamonds || 0;
    giftUserMap[uid].gift_count += g.repeat_count || 1;
  }
  // 真名/真头像优先（神秘人的名字与 webcast 占位头像只在没有真名时才用）
  for (const u of Object.values(giftUserMap)) {
    if (u._realName) u.nickname = u._realName;
    if (u._realAvatar) u.avatar_url = u._realAvatar;
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
    // 优先真实 sec_uid；补录只有昵称时按昵称映射回真实主播；再不行就跳过匿名占位
    const sec = g.to_user_sec_uid || (mapped && mapped.sec) || '';
    const key = sec || nick;
    if (!key) continue;
    if (!sec && isAnonymousName(nick)) continue;
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

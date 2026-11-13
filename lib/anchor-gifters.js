/**
 * 「主播 → 送礼人」的唯一聚合实现。
 *
 * 数据源必须和「礼物排行 / 礼物明细」一致：`session_gift_details`
 * （已按连击去重、昵称规整过的明细）。用原始 gifts 行自己再算一遍，
 * 连击开始/结束两条会各算一次，金额会被放大（实测 367 场：初心不變 算出 117,192，
 * 而礼物排行/明细里是 81,229）。
 * 表为空（新场次还没落快照）时，用 aggregateGiftDetails + comboDedupGifts 现场算一份。
 *
 * 归属规则（按顺序）：
 *   1. to_user_sec_uid 有值 → 归它
 *   2. 没有 → to_nickname（含归一化核心名）映射到本场已知主播
 *      （"清子" 和 "清子🍟" 是同一个主播的两种写法）
 *   3. 都没有 → **跳过**（不归属任何主播）
 * 人数口径：按送礼人 user_sec_uid 去重（改昵称不会算成两个人）
 */

const normName = (s) =>
  String(s || '')
    .replace(/[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .trim();

function loadDetailRows(dbInstance, sessionId) {
  let rows = [];
  try {
    rows = dbInstance
      .prepare(
        `SELECT nickname, user_sec_uid, to_nickname, to_user_sec_uid, avatar_url, gift_name,
                total_diamonds, count, create_time
           FROM session_gift_details WHERE session_id = ?`
      )
      .all(sessionId);
  } catch (e) {
    rows = [];
  }
  /*
   * 快照可能比礼物表旧（场次结束后又补录/继续进礼物），表现为金额和人数都少一截
   * （实测 358 场：快照 1044 行，礼物表 2929 行）。
   * 用「最新 create_time」判断：礼物表更新就改用实时聚合。
   */
  try {
    const snapMax = rows.reduce((m, r) => Math.max(m, Number(r.create_time) || 0), 0);
    const liveMax = dbInstance
      .prepare('SELECT MAX(create_time) m FROM gifts WHERE session_id = ?')
      .get(sessionId).m;
    if (rows.length && liveMax && liveMax > snapMax) rows = [];
  } catch (e) {
    /* 判断失败就按快照走 */
  }
  if (!rows.length) {
    // 还没落快照：用和 /gift-details 完全相同的聚合现场算
    const { aggregateGiftDetails } = require('./session-gift-details.js');
    const { comboDedupGifts } = require('./gift-utils.js');
    const raw = dbInstance
      .prepare(
        `SELECT id, nickname, avatar as avatar_url, user_sec_uid, user_display_id, gift_name,
                to_nickname, to_user_sec_uid, to_user_display_id, diamond_count, repeat_count,
                total_diamonds, combo_count, repeat_end, create_time
           FROM gifts WHERE session_id = ? ORDER BY id`
      )
      .all(sessionId);
    rows = aggregateGiftDetails(comboDedupGifts(raw));
  }
  return rows;
}

function computeAnchorGifters(dbInstance, sessionId) {
  const session = dbInstance
    .prepare('SELECT id, room_id, streamer_id FROM sessions WHERE id = ?')
    .get(sessionId);
  const mainStreamer =
    session && session.streamer_id
      ? dbInstance.prepare('SELECT id, name, sec_uid, room_id FROM streamers WHERE id = ?').get(session.streamer_id)
      : null;
  const mainKey = mainStreamer
    ? String(mainStreamer.sec_uid || '').trim() || `room:${mainStreamer.room_id || (session && session.room_id)}`
    : '';

  const rows = loadDetailRows(dbInstance, sessionId);

  /*
   * 昵称 → 主播 secUid（精确 + 归一化核心名）。
   * 映射从 **gifts 原始行** 建，而不是从快照明细建：
   * 老库的 session_gift_details 没有 to_user_sec_uid（列是后加的，值为 NULL），
   * 只有 gifts 里才有真实的收礼人 secUid。
   */
  const nickToSec = new Map();
  const coreToSec = new Map();
  for (const g of rows) {
    const n = (g.to_nickname || '').trim();
    if (!n || !g.to_user_sec_uid) continue;
    if (!nickToSec.has(n)) nickToSec.set(n, g.to_user_sec_uid);
    const core = normName(n);
    if (core && !coreToSec.has(core)) coreToSec.set(core, g.to_user_sec_uid);
  }
  const rawPairs = dbInstance
    .prepare(
      `SELECT DISTINCT to_nickname, to_user_sec_uid FROM gifts
        WHERE session_id = ? AND IFNULL(to_user_sec_uid,'') <> '' AND IFNULL(to_nickname,'') <> ''`
    )
    .all(sessionId);
  for (const p of rawPairs) {
    const n = (p.to_nickname || '').trim();
    if (!n || !p.to_user_sec_uid) continue;
    if (!nickToSec.has(n)) nickToSec.set(n, p.to_user_sec_uid);
    const core = normName(n);
    if (core && !coreToSec.has(core)) coreToSec.set(core, p.to_user_sec_uid);
  }

  const anchors = new Map();
  for (const g of rows) {
    const nick = (g.to_nickname || '').trim();
    /*
     * 主播归属**只认 to_user_sec_uid**（或其昵称映射到的真实 secUid）。
     *
     * 团播里"没有 to_user_sec_uid"的礼物就是送给**主账号/主直播间**的 ——
     * 这类行不该出现在主播榜里（原来主播榜只统计有 to 字段的行，所以从来没有"林语巷"这一行）。
     * 我上一版把它们兜底归给 sessions.streamer_id，才凭空多出一行主直播间、弹窗混人。
     * 现在恢复原语义：没有 to 字段（也映射不到）就跳过，昵称单独不成主播。
     */
    const sec = g.to_user_sec_uid || nickToSec.get(nick) || coreToSec.get(normName(nick)) || '';
    if (!sec) continue;
    const key = sec;

    if (!anchors.has(key)) {
      anchors.set(key, {
        anchor_sec_uid: sec,
        anchor_name: nick || '',
        anchor_avatar: null,
        total_diamonds: 0,
        gift_count: 0,
        gifters: new Map()
      });
    }
    const a = anchors.get(key);
    a.total_diamonds += g.total_diamonds || 0;
    a.gift_count += g.count || 1;

    const senderKey = g.user_sec_uid || `n:${g.nickname || ''}`;
    if (!senderKey || senderKey === 'n:') continue;
    if (!a.grifters) a.grifters = new Map();
    if (!a.grifters.has(senderKey)) {
      a.grifters.set(senderKey, {
        nickname: g.nickname || '',
        user_sec_uid: g.user_sec_uid || '',
        avatar_url: g.avatar_url || null,
        total_diamonds: 0,
        gift_count: 0
      });
    }
    const u = a.grifters.get(senderKey);
    u.total_diamonds += g.total_diamonds || 0;
    u.gift_count += g.count || 1;
  }

  const out = [];
  for (const a of anchors.values()) {
    const gifters = [...a.grifters.values()].sort((x, y) => y.total_diamonds - x.total_diamonds);
    out.push({
      anchor_sec_uid: a.anchor_sec_uid,
      anchor_name: a.anchor_name,
      anchor_avatar: a.anchor_avatar,
      total_diamonds: a.total_diamonds,
      gift_count: a.gift_count,
      user_count: gifters.length,
      gifters
    });
  }
  out.sort((x, y) => y.total_diamonds - x.total_diamonds);

  return out;
}

module.exports = { computeAnchorGifters, normName };

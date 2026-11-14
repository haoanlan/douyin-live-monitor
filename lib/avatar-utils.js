/**
 * 头像查询工具 — 从 gifts/danmaku/members 表 fallback 查找用户头像
 * 消除 web-dashboard.js 中重复的头像查询逻辑
 */

const { isAnonymousName } = require('./user-display.js');

// 头像只需"有就用"，不再按 URL 识别占位

/** 从多行候选里挑第一张非空头像（默认头像/神秘人头像同样有效） */
function pickBestAvatar(rows) {
  // 每条消息都自带头像，这里只需要挑一张非空的（默认头像 / 神秘人头像都照原样用）
  const list = (rows || []).map((r) => r && r.avatar).filter(Boolean);
  return list[0] || null;
}

/**
 * 按 sec_uid 查找头像，依次从 gifts → danmaku → members 表 fallback。
 *
 * 注意：同一个人可能同时存在「马赛克/匿名占位图」和「正常头像」两类记录
 * （抖音对隐私用户先下发 mosaic-legacy，之后才出现真头像）。
 * 原来只取第一条，命中打码图就会显示成"神秘人头像 + 正常昵称"
 * （用户实测场次 358 的「嘆𩆩」）。现在优先返回非占位那张。
 *
 * @param {object} dbInstance - better-sqlite3 Database 实例
 * @param {number|null} sessionId - 场次 ID（members 表查询不需要）
 * @param {string} secUid - 用户 sec_uid
 * @returns {string|null} 头像 URL 或 null
 */
function getAvatarBySecUid(dbInstance, sessionId, secUid, opts = {}) {
  if (!secUid) return null;
  /*
   * 关键：同一个人（sec_uid）可能既有真名记录、又有"神秘人"记录。
   * 按 sec_uid 查头像时**必须优先真名记录的头像**，
   * 否则会把匿名头像贴到真名上（用户反复强调的错配）。
   * 只有这个人从来没出现过真名时，才允许用匿名记录的头像。
   */
  const wantName = String(opts.nickname || '').trim();
  const pick = (rows) => {
    // 1) 有指定昵称：只认这个昵称的记录
    if (wantName) {
      const same = rows.filter((r) => String(r.nickname || '').trim() === wantName && r.avatar);
      if (same.length) return same[0].avatar;
    }
    // 2) 真名记录的头像
    const real = rows.find((r) => r.avatar && !isAnonymousName(r.nickname));
    if (real) return real.avatar;
    // 3) 完全没真名：才用匿名记录的头像
    const anon = rows.find((r) => r.avatar);
    return anon ? anon.avatar : null;
  };

  if (sessionId != null) {
    const g = pick(
      dbInstance
        .prepare('SELECT nickname, avatar FROM gifts WHERE session_id = ? AND user_sec_uid = ? AND avatar IS NOT NULL LIMIT 20')
        .all(sessionId, secUid)
    );
    if (g) return g;

    const d = pick(
      dbInstance
        .prepare('SELECT nickname, avatar FROM danmaku WHERE session_id = ? AND user_sec_uid = ? AND avatar IS NOT NULL LIMIT 20')
        .all(sessionId, secUid)
    );
    if (d) return d;
  }
  return pick(
    dbInstance
      .prepare('SELECT nickname, avatar FROM members WHERE user_sec_uid = ? AND avatar IS NOT NULL LIMIT 20')
      .all(secUid)
  );
}

/**
 * 按 nickname + sessionId 从 gifts 表查找头像
 * @param {object} dbInstance - better-sqlite3 Database 实例
 * @param {number} sessionId - 场次 ID
 * @param {string} nickname - 用户昵称
 * @returns {string|null} 头像 URL 或 null
 */
function getAvatarByNickname(dbInstance, sessionId, nickname) {
  if (!nickname) return null;
  const r = pickBestAvatar(
    dbInstance
      .prepare('SELECT avatar FROM gifts WHERE session_id = ? AND nickname = ? AND avatar IS NOT NULL LIMIT 8')
      .all(sessionId, nickname)
  );
  return r;
}

module.exports = { getAvatarBySecUid, getAvatarByNickname };

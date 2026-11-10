/**
 * 观众档案：用户等级 / 消费等级 / 粉丝团（等级体系，见 docs/plan-notify-and-user-profile.md §2）
 *
 * 字段来源（proto 里确认过的，不是猜的）：
 *   User.level                 → user_level      用户等级
 *   User.pay_grade.level / name → pay_level/pay_name 消费等级
 *   User.fans_club.data.club_name / .level → club_name / club_level 粉丝团
 *
 * 存两层（方案文档 §2.1）：
 *   user_profiles          跨场次最新值（一人一行）
 *   session_user_profiles  每场快照（看"这场他是什么等级"）
 *
 * 写入是 worker 里顺手的 upsert，带节流：同一个 uid 5 秒内只写一次，
 * 否则弹幕/进房高峰会把 SQLite 写满（实测单场 358 条弹幕 × 每场多房间）。
 */
const WRITE_TTL_MS = 5000;

let ensured = false;
const lastWrite = new Map();

function ensure(db) {
  if (ensured || !db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_sec_uid TEXT PRIMARY KEY,
      nickname TEXT,
      avatar_url TEXT,
      user_level INTEGER,
      pay_level INTEGER,
      pay_name TEXT,
      club_name TEXT,
      club_level INTEGER,
      first_seen INTEGER,
      last_seen INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS session_user_profiles (
      session_id INTEGER NOT NULL,
      user_sec_uid TEXT NOT NULL,
      user_level INTEGER,
      pay_level INTEGER,
      pay_name TEXT,
      club_name TEXT,
      club_level INTEGER,
      captured_at INTEGER,
      PRIMARY KEY (session_id, user_sec_uid)
    );
    CREATE INDEX IF NOT EXISTS idx_sup_uid ON session_user_profiles(user_sec_uid);
    /*
     * 主播身份映射：anchorId（数字 user id）→ sec_uid / 昵称 / 头像。
     * 团播一场里会有多个主播，每人的粉丝团各归各的；只靠 club_name 认不出是谁
     * （实测 398 个有粉丝团的人里只有 11 个带名字），所以必须靠 anchorId，
     * 而 anchorId 是数字 id，需要在礼物消息的 toUser 里建立映射。
     */
    CREATE TABLE IF NOT EXISTS anchor_ids (
      anchor_id INTEGER PRIMARY KEY,
      sec_uid TEXT,
      nickname TEXT,
      avatar TEXT,
      updated_at INTEGER
    );
  `);
  // 老库补列（新加的粉丝团归属/状态）
  const addCol = (table, col, type) => {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch (e) {
      /* ignore */
    }
  };
  for (const t of ['user_profiles', 'session_user_profiles']) {
    addCol(t, 'club_anchor_id', 'INTEGER');
    addCol(t, 'club_status', 'INTEGER');
    // 图标（2026-11-10）：消费等级图标 + 粉丝团两级徽章 + 星守护状态
    addCol(t, 'pay_icon_url', 'TEXT');
    addCol(t, 'club_badge_uri', 'TEXT');
    addCol(t, 'club_guard_uri', 'TEXT');
    addCol(t, 'guard_status', 'INTEGER');
    addCol(t, 'guard_expired_at', 'INTEGER');
  }
  ensured = true;
}

/** 从 protojson 的 user 对象里抽等级信息；一个都没有就返回 null */
function extractProfile(user) {
  if (!user || typeof user !== 'object') return null;
  const num = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const pay = user.payGrade || user.pay_grade || {};
  const club = (user.fansClub || user.fans_club || {}).data
    || user.fansClub?.preferData?.[0]
    || {};
  const p = {
    userLevel: num(user.level),
    payLevel: num(pay.level),
    payName: pay.name || null,
    clubName: club.clubName || club.club_name || null,
    clubLevel: num(club.level),
    /*
     * 粉丝团归属：anchorId 是"这个团属于哪个主播"的数字 user id。
     * 团播里一场有多个主播，观众可能挂着任意一家的团 —— 光有 club_name 认不出来
     * （实测只有 11/398 带名字），必须靠它。userFansClubStatus：1=在团、2=退团/未点亮。
     */
    clubAnchorId: num(club.anchorId),
    clubStatus: num(club.userFansClubStatus),
    // 图标：消费等级用 pay_grade 自带的 URL（只跟 level 有关）；
    // 粉丝团必须存 badge.icons 里的 URI（带版本/状态，拼不出来）。
    payIconUrl:
      pay.newImIconWithLevel?.urlList?.[0] ||
      pay.imIconWithLevel?.urlList?.[0] ||
      pay.icon?.urlList?.[0] ||
      null,
    clubBadgeUri: club.badge?.icons?.['2']?.uri || null,
    clubGuardUri: club.badge?.icons?.['4']?.uri || null,
    // 星守护：userGuardStatus（1=开通）或 guardExpiredTime（秒级）任一即可判
    guardStatus: num(club.userGuardStatus),
    guardExpiredAt: num(club.guardExpiredTime)
  };
  if (p.userLevel == null && p.payLevel == null && p.clubLevel == null && !p.clubName) return null;
  return p;
}

/**
 * 写入/更新档案（latest + 本场快照）。
 * @param {object} db better-sqlite3 实例
 * @param {string} secUid
 * @param {ReturnType<typeof extractProfile>} profile
 * @param {{sessionId?:number, nickname?:string, avatar?:string, now?:number}} [opts]
 */
function recordProfile(db, secUid, profile, opts = {}) {
  if (!db || !secUid || !profile) return;
  const now = opts.now || Date.now();
  const prev = lastWrite.get(secUid) || 0;
  // force=true 跳过节流（回填历史数据时用：同一秒内要写几百个人）
  if (!opts.force && now - prev < WRITE_TTL_MS) return;
  lastWrite.set(secUid, now);
  // 节流表本身别无限涨：超过 2 万条就清掉旧记录
  if (lastWrite.size > 20000) lastWrite.clear();

  try {
    ensure(db);
    db.prepare(
      `INSERT INTO user_profiles
         (user_sec_uid, nickname, avatar_url, user_level, pay_level, pay_name, club_name, club_level,
          club_anchor_id, club_status, pay_icon_url, club_badge_uri, club_guard_uri, guard_status, guard_expired_at,
          first_seen, last_seen, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_sec_uid) DO UPDATE SET
         nickname   = COALESCE(NULLIF(excluded.nickname,''), nickname),
         avatar_url = COALESCE(NULLIF(excluded.avatar_url,''), avatar_url),
         user_level = COALESCE(excluded.user_level, user_level),
         pay_level  = COALESCE(excluded.pay_level, pay_level),
         pay_name   = COALESCE(NULLIF(excluded.pay_name,''), pay_name),
         club_name  = COALESCE(NULLIF(excluded.club_name,''), club_name),
         club_level = COALESCE(excluded.club_level, club_level),
         club_anchor_id = COALESCE(excluded.club_anchor_id, club_anchor_id),
         club_status    = COALESCE(excluded.club_status, club_status),
         pay_icon_url   = COALESCE(NULLIF(excluded.pay_icon_url,''), pay_icon_url),
         club_badge_uri = COALESCE(NULLIF(excluded.club_badge_uri,''), club_badge_uri),
         club_guard_uri = COALESCE(NULLIF(excluded.club_guard_uri,''), club_guard_uri),
         guard_status   = COALESCE(excluded.guard_status, guard_status),
         guard_expired_at = COALESCE(excluded.guard_expired_at, guard_expired_at),
         last_seen  = excluded.last_seen,
         updated_at = excluded.updated_at`
    ).run(
      secUid, opts.nickname || '', opts.avatar || '',
      profile.userLevel, profile.payLevel, profile.payName,
      profile.clubName, profile.clubLevel,
      profile.clubAnchorId, profile.clubStatus,
      profile.payIconUrl, profile.clubBadgeUri, profile.clubGuardUri,
      profile.guardStatus, profile.guardExpiredAt,
      now, now, now
    );

    if (opts.sessionId) {
      db.prepare(
        `INSERT INTO session_user_profiles
           (session_id, user_sec_uid, user_level, pay_level, pay_name, club_name, club_level,
            club_anchor_id, club_status, pay_icon_url, club_badge_uri, club_guard_uri, guard_status, guard_expired_at,
            captured_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(session_id, user_sec_uid) DO UPDATE SET
           user_level = COALESCE(excluded.user_level, user_level),
           pay_level  = COALESCE(excluded.pay_level, pay_level),
           pay_name   = COALESCE(NULLIF(excluded.pay_name,''), pay_name),
           club_name  = COALESCE(NULLIF(excluded.club_name,''), club_name),
           club_level = COALESCE(excluded.club_level, club_level),
           club_anchor_id = COALESCE(excluded.club_anchor_id, club_anchor_id),
           club_status    = COALESCE(excluded.club_status, club_status),
           pay_icon_url   = COALESCE(NULLIF(excluded.pay_icon_url,''), pay_icon_url),
           club_badge_uri = COALESCE(NULLIF(excluded.club_badge_uri,''), club_badge_uri),
           club_guard_uri = COALESCE(NULLIF(excluded.club_guard_uri,''), club_guard_uri),
           guard_status   = COALESCE(excluded.guard_status, guard_status),
           guard_expired_at = COALESCE(excluded.guard_expired_at, guard_expired_at),
           captured_at = excluded.captured_at`
      ).run(
        Number(opts.sessionId), secUid,
        profile.userLevel, profile.payLevel, profile.payName,
        profile.clubName, profile.clubLevel,
        profile.clubAnchorId, profile.clubStatus,
        profile.payIconUrl, profile.clubBadgeUri, profile.clubGuardUri,
        profile.guardStatus, profile.guardExpiredAt,
        now
      );
    }
  } catch (e) {
    // 档案写失败不能影响采集
    console.warn('[profile] 写入失败:', e.message);
  }
}

/** 批量取档案（信息查询卡片用）：返回 sec_uid → profile */
function getProfiles(db, secUids) {
  const out = new Map();
  if (!db || !Array.isArray(secUids) || !secUids.length) return out;
  try {
    ensure(db);
    const uniq = [...new Set(secUids.filter(Boolean))];
    const CHUNK = 400;
    for (let i = 0; i < uniq.length; i += CHUNK) {
      const chunk = uniq.slice(i, i + CHUNK);
      const rows = db
        .prepare(
          `SELECT p.user_sec_uid, p.user_level, p.pay_level, p.pay_name, p.club_name, p.club_level,
                  p.club_anchor_id, p.club_status, p.pay_icon_url, p.club_badge_uri, p.club_guard_uri,
                  p.guard_status, p.guard_expired_at,
                  a.nickname AS club_anchor_name, a.avatar AS club_anchor_avatar
             FROM user_profiles p
             LEFT JOIN anchor_ids a ON a.anchor_id = p.club_anchor_id
            WHERE p.user_sec_uid IN (${chunk.map(() => '?').join(',')})`
        )
        .all(...chunk);
      for (const r of rows) {
        const nowSec = Math.floor(Date.now() / 1000);
        const urlOf = (uri) => (uri ? `https://p11-webcast.douyinpic.com/img/${uri}~tplv-obj.image` : null);
        const guardUri = String(r.club_guard_uri || '');
        let starGuard;
        if (r.guard_status != null) starGuard = r.guard_status > 0;
        else if (r.guard_expired_at) starGuard = Number(r.guard_expired_at) > nowSec;
        else if (guardUri) starGuard = /star_guard/i.test(guardUri) && !/gray/i.test(guardUri);
        else starGuard = false;
        out.set(r.user_sec_uid, {
          userLevel: r.user_level,
          payLevel: r.pay_level,
          payName: r.pay_name,
          payIconUrl: r.pay_icon_url || null,
          clubName: r.club_name,
          clubLevel: r.club_level,
          clubStatus: r.club_status,
          clubAnchorId: r.club_anchor_id,
          clubAnchorName: r.club_anchor_name || null,
          clubAnchorAvatar: r.club_anchor_avatar || null,
          clubBadgeUri: r.club_badge_uri || null,
          clubGuardUri: r.club_guard_uri || null,
          clubBadgeUrl: urlOf(r.club_badge_uri),
          clubGuardUrl: urlOf(r.club_guard_uri),
          starGuard
        });
      }
    }
  } catch (e) {
    console.warn('[profile] 查询失败:', e.message);
  }
  return out;
}

/**
 * 记录用户身份映射：数字 user id → sec_uid / 昵称 / 头像。
 *
 * 数据来源：礼物消息的 toUser（收礼主播）+ 任意消息的作者 user。
 * 前者覆盖"收过礼的主播"，后者覆盖"自己发过言/送过礼的主播"——
 * 团播里人最多的那个团不一定收到过礼物，但主播本人几乎一定会发弹幕，所以两条路都要走。
 * 带 10 分钟节流：弹幕量大，不能每条都写库。
 */
const identityWrite = new Map();
const IDENTITY_TTL_MS = 10 * 60 * 1000;

function recordIdentity(db, userId, info = {}) {
  const id = Number(userId);
  if (!db || !Number.isFinite(id) || id <= 0) return;
  const now = Date.now();
  const prev = identityWrite.get(id) || 0;
  if (now - prev < IDENTITY_TTL_MS) return;
  identityWrite.set(id, now);
  if (identityWrite.size > 50000) identityWrite.clear();
  try {
    ensure(db);
    db.prepare(
      `INSERT INTO anchor_ids (anchor_id, sec_uid, nickname, avatar, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(anchor_id) DO UPDATE SET
         sec_uid    = COALESCE(NULLIF(excluded.sec_uid,''), sec_uid),
         nickname   = COALESCE(NULLIF(excluded.nickname,''), nickname),
         avatar     = COALESCE(NULLIF(excluded.avatar,''), avatar),
         updated_at = excluded.updated_at`
    ).run(id, info.secUid || '', info.nickname || '', info.avatar || '', now);
  } catch (e) {
    console.warn('[profile] 主播映射写入失败:', e.message);
  }
}

// 旧名字兼容（礼物消息那条路径之前调 recordAnchor）
const recordAnchor = recordIdentity;

module.exports = { ensure, extractProfile, recordProfile, recordIdentity, recordAnchor, getProfiles };

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
  `);
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
    clubLevel: num(club.level)
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
  if (now - prev < WRITE_TTL_MS) return;
  lastWrite.set(secUid, now);
  // 节流表本身别无限涨：超过 2 万条就清掉旧记录
  if (lastWrite.size > 20000) lastWrite.clear();

  try {
    ensure(db);
    db.prepare(
      `INSERT INTO user_profiles
         (user_sec_uid, nickname, avatar_url, user_level, pay_level, pay_name, club_name, club_level, first_seen, last_seen, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_sec_uid) DO UPDATE SET
         nickname   = COALESCE(NULLIF(excluded.nickname,''), nickname),
         avatar_url = COALESCE(NULLIF(excluded.avatar_url,''), avatar_url),
         user_level = COALESCE(excluded.user_level, user_level),
         pay_level  = COALESCE(excluded.pay_level, pay_level),
         pay_name   = COALESCE(NULLIF(excluded.pay_name,''), pay_name),
         club_name  = COALESCE(NULLIF(excluded.club_name,''), club_name),
         club_level = COALESCE(excluded.club_level, club_level),
         last_seen  = excluded.last_seen,
         updated_at = excluded.updated_at`
    ).run(
      secUid, opts.nickname || '', opts.avatar || '',
      profile.userLevel, profile.payLevel, profile.payName,
      profile.clubName, profile.clubLevel, now, now, now
    );

    if (opts.sessionId) {
      db.prepare(
        `INSERT INTO session_user_profiles
           (session_id, user_sec_uid, user_level, pay_level, pay_name, club_name, club_level, captured_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(session_id, user_sec_uid) DO UPDATE SET
           user_level = COALESCE(excluded.user_level, user_level),
           pay_level  = COALESCE(excluded.pay_level, pay_level),
           pay_name   = COALESCE(NULLIF(excluded.pay_name,''), pay_name),
           club_name  = COALESCE(NULLIF(excluded.club_name,''), club_name),
           club_level = COALESCE(excluded.club_level, club_level),
           captured_at = excluded.captured_at`
      ).run(
        Number(opts.sessionId), secUid,
        profile.userLevel, profile.payLevel, profile.payName,
        profile.clubName, profile.clubLevel, now
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
          `SELECT user_sec_uid, user_level, pay_level, pay_name, club_name, club_level
             FROM user_profiles WHERE user_sec_uid IN (${chunk.map(() => '?').join(',')})`
        )
        .all(...chunk);
      for (const r of rows) {
        out.set(r.user_sec_uid, {
          userLevel: r.user_level,
          payLevel: r.pay_level,
          payName: r.pay_name,
          clubName: r.club_name,
          clubLevel: r.club_level
        });
      }
    }
  } catch (e) {
    console.warn('[profile] 查询失败:', e.message);
  }
  return out;
}

module.exports = { ensure, extractProfile, recordProfile, getProfiles };

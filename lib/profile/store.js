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

  /*
   * 团名的第二来源（比 fansClub.data.clubName 更全）：
   * user.badgeImageList / badgeImageListV2 里，imageType=7 是粉丝团徽章，
   * 它的 content.name 就是团名、content.level 是等级；imageType=51 是星守护徽章。
   * 实测有些消息 fansClub.data 里没有 clubName，但徽章列表里有名字。
   */
  let badgeClubName = null;
  let badgeClubLevel = null;
  let badgeGuard = false;
  for (const list of [user.badgeImageList, user.badgeImageListV2]) {
    if (!Array.isArray(list)) continue;
    for (const b of list) {
      const t = Number(b?.imageType);
      const nm = b?.content?.name;
      const lv = num(b?.content?.level);
      if (t === 7 && nm) {
        badgeClubName = badgeClubName || nm;
        if (lv != null) badgeClubLevel = lv;
      } else if (t === 51) {
        if (nm) badgeClubName = badgeClubName || nm;
        if (lv != null) badgeClubLevel = badgeClubLevel ?? lv;
        badgeGuard = true;
      }
    }
  }

  const p = {
    userLevel: num(user.level),
    payLevel: num(pay.level),
    payName: pay.name || null,
    clubName: club.clubName || club.club_name || badgeClubName || null,
    clubLevel: num(club.level) ?? badgeClubLevel,
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

function recordIdentity(db, userId, info = {}, source = 'user') {
  const id = Number(userId);
  if (!db || !Number.isFinite(id) || id <= 0) return;
  const now = Date.now();
  const prev = identityWrite.get(id) || 0;
  if (now - prev < IDENTITY_TTL_MS) return;
  identityWrite.set(id, now);
  if (identityWrite.size > 50000) identityWrite.clear();
  try {
    ensure(db);
    /*
     * 来源优先级（踩过的坑）：
     *   · user = 消息里的 user 对象，是**完整昵称**（沐洛洛、一颗假头）；
     *   · rank = 团员榜的昵称，**可能是简称**（沐洛、侠客假头），只用于补空缺。
     * 之前两者都走 upsert，结果团员榜的简称把全名覆盖了，徽章上就显示成短名。
     * 现在 rank 走 DO NOTHING：没有才写入，已有全名就不动。
     */
    if (source === 'rank') {
      db.prepare(
        `INSERT INTO anchor_ids (anchor_id, sec_uid, nickname, avatar, updated_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(anchor_id) DO NOTHING`
      ).run(id, info.secUid || '', info.nickname || '', info.avatar || '', now);
      return;
    }
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

/**
 * 给消息行补上"粉丝团展示信息"（场次详情用）。
 *
 * 两种情况：
 *   1. 有 club_json（新数据，按消息快照）→ 解析它，并把 ca（归属主播 id）换成主播名 an；
 *   2. 没有 club_json（历史数据）→ 退回该用户的最新档案（user_profiles），
 *      至少能显示等级和归属，而不是空着。
 *
 * 只读不写，失败静默（详情页不能因为补标签而挂掉）。
 */
function decorateMessageClubs(db, rows, opts = {}) {
  if (!db || !Array.isArray(rows) || !rows.length) return rows;
  const sessionId = opts.sessionId ? Number(opts.sessionId) : null;
  try {
    ensure(db);
    const secSet = new Set();
    const parsed = new Map();

    for (const r of rows) {
      let c = null;
      const raw = r.club_json || r.club;
      if (raw) {
        try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { c = null; }
      }
      parsed.set(r, c);
      const sec = r.user_sec_uid;
      if (!c && sec) secSet.add(sec);
    }

    /*
     * 历史数据回退：**只用本场快照**（session_user_profiles）。
     * 之前用 user_profiles（跨房间的最新档案）→ 把别的直播间的灯牌串到这一场里，
     * 用户实测到"在这个直播间显示了另一个直播间人的灯牌"，就是这个原因。
     */
    const fallback = new Map();
    if (sessionId && secSet.size) {
      const uids = [...secSet];
      for (let i = 0; i < uids.length; i += 300) {
        const chunk = uids.slice(i, i + 300);
        const rowsFb = db
          .prepare(
            `SELECT user_sec_uid, user_level, pay_level, pay_icon_url, club_level, club_name,
                    club_anchor_id, club_status, club_guard_uri
               FROM session_user_profiles
              WHERE session_id = ? AND user_sec_uid IN (${chunk.map(() => '?').join(',')})`
          )
          .all(sessionId, ...chunk);
        for (const p of rowsFb) {
          fallback.set(p.user_sec_uid, {
            payLevel: p.pay_level,
            payIconUrl: p.pay_icon_url,
            clubLevel: p.club_level,
            clubName: p.club_name,
            clubAnchorId: p.club_anchor_id,
            clubStatus: p.club_status,
            clubGuardUri: p.club_guard_uri
          });
        }
      }
    }

    for (const r of rows) {
      const c = parsed.get(r);
      if (c) {
        // 归属名（an）在写入时已解析并存在快照里，这里不再二次解析，保证显示永不改变
        c.cbu = c.cb ? `https://p11-webcast.douyinpic.com/img/${c.cb}~tplv-obj.image` : null;
        r.club = c;
      } else {
        const p = fallback.get(r.user_sec_uid);
        if (p && (p.payLevel != null || p.clubLevel != null)) {
          const ca = p.clubAnchorId != null ? Number(p.clubAnchorId) : null;
          r.club = {
            pl: p.payLevel,
            pi: p.payIconUrl,
            cl: p.clubLevel,
            cn: p.clubName || '',
            ca,
            cs: p.clubStatus,
            gu: p.clubGuardUri,
            an: ca ? lookupAnchorName(db, ca) : '',
            cbu: p.clubBadgeUri ? `https://p11-webcast.douyinpic.com/img/${p.clubBadgeUri}~tplv-obj.image` : null,
            fallback: true
          };
        }
      }
    }
  } catch (e) {
    /* ignore */
  }
  return rows;
}

/**
 * 数字 id → 主播名（写入时用，带 60 秒缓存）。
 * 为什么在写入时解析：用户要求"一条消息显示出来是什么就永远是什么"，
 * 读取时再解析会导致同一条历史消息的归属名后来变掉（映射表补人后）。
 */
const anchorNameCache = new Map();
let anchorCacheAt = 0;

function lookupAnchorName(db, anchorId) {
  const id = Number(anchorId);
  if (!db || !Number.isFinite(id) || id <= 0) return '';
  const now = Date.now();
  if (now - anchorCacheAt > 60000) {
    anchorNameCache.clear();
    anchorCacheAt = now;
  }
  if (anchorNameCache.has(id)) return anchorNameCache.get(id);
  try {
    const row = db.prepare('SELECT nickname FROM anchor_ids WHERE anchor_id = ?').get(id);
    const name = (row && row.nickname) || '';
    anchorNameCache.set(id, name);
    return name;
  } catch (e) {
    return '';
  }
}

module.exports = { ensure, extractProfile, recordProfile, recordIdentity, recordAnchor, getProfiles, decorateMessageClubs, lookupAnchorName };

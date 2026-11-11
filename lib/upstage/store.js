/**
 * 主播上场提醒 —— 存储层
 *
 * 三张表：
 *   upstage_watch   关注名单（按 room 的 uid，uid 是稳定标识；昵称只做显示）
 *   upstage_state   状态机（每人一行：命中次数 / 是否在场 / 最近一次出现）
 *   upstage_events  事件日志（上场 / 离场 / 挂起补发），排查"为什么没提醒"全靠它
 *
 * 为什么 uid 作为主键的一部分：昵称会改、带 emoji，只有 uid 稳定（见方法文档坑 1）。
 */

function ensure(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS upstage_watch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      web_rid TEXT NOT NULL,
      uid TEXT NOT NULL,
      nickname TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER,
      UNIQUE(web_rid, uid)
    );

    CREATE TABLE IF NOT EXISTS upstage_state (
      web_rid TEXT NOT NULL,
      uid TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0,
      present INTEGER NOT NULL DEFAULT 0,
      last_seen_at INTEGER,
      last_notified_at INTEGER,
      notified_in_session INTEGER NOT NULL DEFAULT 0,
      pending INTEGER NOT NULL DEFAULT 0,
      pending_since INTEGER,
      updated_at INTEGER,
      PRIMARY KEY (web_rid, uid)
    );

    CREATE TABLE IF NOT EXISTS upstage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      web_rid TEXT NOT NULL,
      uid TEXT,
      nickname TEXT,
      event TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_upstage_events_time ON upstage_events(created_at);

    /*
     * 现场识别到的人：公会赛房间没有团员榜（文档坑 17），
     * 只能靠进度条/人脸通道里出现的 uid 来"发现"候选主播。
     * 这里记 uid + 出现的昵称（有就记），页面上让用户点一下加入关注。
     */
    CREATE TABLE IF NOT EXISTS upstage_seen (
      web_rid TEXT NOT NULL,
      uid TEXT NOT NULL,
      nickname TEXT,
      source TEXT,
      -- 人脸通道会给出置信度和人脸框，一起存下来，页面上可以看到"识别得多确定"
      conf REAL,
      box TEXT,
      last_seen_at INTEGER,
      PRIMARY KEY (web_rid, uid)
    );
  `);
}

// 老库补列（在 ensure 之后、首次使用之前）
function ensureAll(db) {
  ensure(db);
  migrate(db);
}

const now = () => Math.floor(Date.now() / 1000);

/* ---------------- 关注名单 ---------------- */

function listWatch(db, webRid) {
  const sql = webRid
    ? 'SELECT * FROM upstage_watch WHERE web_rid=? ORDER BY id'
    : 'SELECT * FROM upstage_watch ORDER BY web_rid, id';
  return (webRid ? db.prepare(sql).all(webRid) : db.prepare(sql).all()).map((r) => ({
    ...r,
    enabled: !!r.enabled
  }));
}

function upsertWatch(db, { web_rid, uid, nickname, enabled = 1 }) {
  const ts = now();
  db.prepare(
    `INSERT INTO upstage_watch (web_rid, uid, nickname, enabled, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(web_rid, uid) DO UPDATE SET nickname=excluded.nickname, enabled=excluded.enabled`
  ).run(String(web_rid), String(uid), nickname || '', enabled ? 1 : 0, ts);
}

function removeWatch(db, id) {
  db.prepare('DELETE FROM upstage_watch WHERE id=?').run(id);
}

/* ---------------- 状态 ---------------- */

function getState(db, webRid, uid) {
  return db.prepare('SELECT * FROM upstage_state WHERE web_rid=? AND uid=?').get(webRid, uid) || null;
}

function saveState(db, webRid, uid, patch) {
  const ts = now();
  const cur = getState(db, webRid, uid) || {
    hits: 0,
    present: 0,
    last_seen_at: null,
    last_notified_at: null,
    notified_in_session: 0,
    pending: 0,
    pending_since: null
  };
  const next = { ...cur, ...patch };
  db.prepare(
    `INSERT INTO upstage_state
       (web_rid, uid, hits, present, last_seen_at, last_notified_at, notified_in_session, pending, pending_since, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(web_rid, uid) DO UPDATE SET
       hits=excluded.hits, present=excluded.present, last_seen_at=excluded.last_seen_at,
       last_notified_at=excluded.last_notified_at, notified_in_session=excluded.notified_in_session,
       pending=excluded.pending, pending_since=excluded.pending_since, updated_at=excluded.updated_at`
  ).run(
    webRid,
    uid,
    next.hits | 0,
    next.present ? 1 : 0,
    next.last_seen_at || null,
    next.last_notified_at || null,
    next.notified_in_session ? 1 : 0,
    next.pending ? 1 : 0,
    next.pending_since || null,
    ts
  );
  return next;
}

/** 一场结束/开播时清空该房间所有状态（不跨场记忆） */
function resetRoom(db, webRid) {
  /*
   * last_notified_at 也要清：否则"清空状态后重新上场"会被 10 分钟冷却挡住，
   * 表现就是「点了清空，还是不推」。
   */
  db.prepare(
    `UPDATE upstage_state
        SET hits=0, present=0, notified_in_session=0, pending=0, pending_since=NULL,
            last_notified_at=NULL, updated_at=?
      WHERE web_rid=?`
  ).run(now(), webRid);
}

/** 记一个"现场见过"的 uid（有昵称就更新，没有就保留旧值） */
/** 老库补列（CREATE TABLE IF NOT EXISTS 不会给已存在的表加列） */
function migrate(db) {
  // 人脸通道新增：置信度 / 人脸框
  for (const [table, col, type] of [
    ['upstage_seen', 'conf', 'REAL'],
    ['upstage_seen', 'box', 'TEXT']
  ]) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  try {
    const cols = db.prepare('PRAGMA table_info(upstage_events)').all().map((c) => c.name);
    if (!cols.includes('source')) {
      db.exec("ALTER TABLE upstage_events ADD COLUMN source TEXT DEFAULT ''");
    }
  } catch (e) {
    console.warn('[upstage] 事件表补列失败（不影响使用）:', e.message);
  }
}

function upsertSeen(db, { web_rid, uid, nickname, source, conf, box }) {
  const ts = now();
  db.prepare(
    `INSERT INTO upstage_seen (web_rid, uid, nickname, source, conf, box, last_seen_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(web_rid, uid) DO UPDATE SET
       nickname = COALESCE(NULLIF(excluded.nickname,''), upstage_seen.nickname),
       source = excluded.source,
       conf = COALESCE(excluded.conf, upstage_seen.conf),
       box = COALESCE(excluded.box, upstage_seen.box),
       last_seen_at = excluded.last_seen_at`
  ).run(
    String(web_rid),
    String(uid),
    nickname || '',
    source || '',
    typeof conf === 'number' ? conf : null,
    box ? JSON.stringify(box) : null,
    ts
  );
}

function listSeen(db, webRid, limit = 40) {
  return db
    .prepare('SELECT * FROM upstage_seen WHERE web_rid=? ORDER BY last_seen_at DESC LIMIT ?')
    .all(String(webRid), limit);
}

function listStates(db, webRid) {
  return db.prepare('SELECT * FROM upstage_state WHERE web_rid=? ORDER BY present DESC, last_seen_at DESC').all(webRid);
}

/* ---------------- 事件 ---------------- */

function addEvent(db, { web_rid, uid, nickname, event, detail, source }) {
  db.prepare(
    'INSERT INTO upstage_events (web_rid, uid, nickname, event, detail, source, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(String(web_rid), String(uid || ''), nickname || '', event, detail || '', source || '', now());
}

function listEvents(db, { webRid = '', page = 1, size = 20 } = {}) {
  const where = webRid ? 'WHERE web_rid=?' : '';
  const args = webRid ? [webRid] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM upstage_events ${where}`).get(...args).n;
  const items = db
    .prepare(`SELECT * FROM upstage_events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (page - 1) * size);
  return { total, items };
}

module.exports = {
  ensure,
  ensureAll,
  listWatch,
  upsertWatch,
  removeWatch,
  getState,
  saveState,
  resetRoom,
  listStates,
  upsertSeen,
  listSeen,
  addEvent,
  listEvents
};

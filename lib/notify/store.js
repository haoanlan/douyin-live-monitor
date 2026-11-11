/**
 * 通知管理的存储层（表结构 + CRUD）。
 *
 * 为什么放在 lib 而不是路由里：
 *   · 「开播通知」「下播战报」由 worker / 定时器触发，路由只是 HTTP 外壳；
 *   · 建表放在 ensure()，服务启动时调一次，路由里就不用每次判表是否存在。
 *
 * 账号隔离（2026-11-11）：
 *   通知配置**按登录账号隔离** —— 渠道、规则、发送记录都带 owner。
 *   每个账号只看得到、只能改自己的；
 *   但通知本身是全局事件（开播/下播），所以 dispatch 用 listAllRules() 跑所有账号的规则，
 *   每条规则只发它自己主人的渠道。
 */

function ensure(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notify_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS notify_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT,
      event TEXT NOT NULL,
      room_id TEXT,
      channel_ids TEXT NOT NULL DEFAULT '[]',
      conditions TEXT NOT NULL DEFAULT '{}',
      template_id INTEGER,
      quiet_hours TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS notify_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT,
      title TEXT,
      body TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS notify_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT,
      rule_id INTEGER,
      event TEXT,
      channel_id INTEGER,
      channel_name TEXT,
      payload TEXT,
      status TEXT,
      error TEXT,
      created_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_notify_logs_created ON notify_logs(created_at);
  `);

  // 老库补 owner 列（CREATE TABLE IF NOT EXISTS 不会给已存在的表加列）
  const columnNames = (table) =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);
  for (const table of ['notify_channels', 'notify_rules', 'notify_logs']) {
    if (!columnNames(table).includes('owner')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN owner TEXT`);
    }
  }

  /*
   * 历史数据归属：以前通知配置只有一套（没有 owner 概念）。
   * 回填给最早的超管，避免升级后界面上"配置全没了"。
   */
  let legacyOwner = null;
  try {
    const first = db
      .prepare("SELECT username FROM dashboard_users WHERE role = 'R_SUPER' ORDER BY id LIMIT 1")
      .get();
    legacyOwner = first?.username || null;
  } catch {
    /* dashboard_users 还不存在就算了 */
  }
  if (legacyOwner) {
    for (const table of ['notify_channels', 'notify_rules', 'notify_logs']) {
      db.prepare(`UPDATE ${table} SET owner = ? WHERE owner IS NULL OR owner = ''`).run(legacyOwner);
    }
  }
}

const now = () => Math.floor(Date.now() / 1000);

function parseJSON(text, fallback) {
  if (!text) return fallback;
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/* ---------------- 渠道 ---------------- */

function listChannels(db, owner) {
  return db
    .prepare('SELECT * FROM notify_channels WHERE owner = ? ORDER BY id DESC')
    .all(owner)
    .map((r) => ({ ...r, config: parseJSON(r.config, {}), enabled: !!r.enabled }));
}

function saveChannel(db, input, owner) {
  const config = typeof input.config === 'string' ? input.config : JSON.stringify(input.config || {});
  const ts = now();
  if (input.id) {
    // WHERE 带 owner：改别人的 id 等于没改
    db.prepare(
      'UPDATE notify_channels SET type=?, name=?, config=?, enabled=?, updated_at=? WHERE id=? AND owner=?'
    ).run(input.type, input.name, config, input.enabled ? 1 : 0, ts, input.id, owner);
    return input.id;
  }
  const info = db
    .prepare(
      'INSERT INTO notify_channels (owner, type, name, config, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run(owner, input.type, input.name, config, input.enabled ? 1 : 0, ts, ts);
  return Number(info.lastInsertRowid);
}

function deleteChannel(db, id, owner) {
  db.prepare('DELETE FROM notify_channels WHERE id=? AND owner=?').run(id, owner);
}

/** 按 id 取渠道（dispatch 用；规则里的 channel_ids 已经保证是同账号的） */
function getChannel(db, id) {
  const row = db.prepare('SELECT * FROM notify_channels WHERE id=?').get(id);
  if (!row) return null;
  return { ...row, config: parseJSON(row.config, {}), enabled: !!row.enabled };
}

/* ---------------- 规则 ---------------- */

function mapRule(r) {
  return {
    ...r,
    channel_ids: parseJSON(r.channel_ids, []),
    conditions: parseJSON(r.conditions, {}),
    quiet_hours: parseJSON(r.quiet_hours, null),
    enabled: !!r.enabled
  };
}

/** 某个账号自己的规则（页面用） */
function listRules(db, owner) {
  return db
    .prepare('SELECT * FROM notify_rules WHERE owner = ? ORDER BY id DESC')
    .all(owner)
    .map(mapRule);
}

/**
 * 所有账号的规则（**只有 worker/dispatch 用**）。
 * 通知是全局事件：开播了要把每个账号自己配的规则都跑一遍，各发各的渠道。
 */
function listAllRules(db) {
  return db.prepare('SELECT * FROM notify_rules ORDER BY id DESC').all().map(mapRule);
}

function saveRule(db, input, owner) {
  const channelIds = JSON.stringify(input.channel_ids || []);
  const conditions = JSON.stringify(input.conditions || {});
  const quiet = input.quiet_hours ? JSON.stringify(input.quiet_hours) : null;
  const ts = now();
  if (input.id) {
    db.prepare(
      `UPDATE notify_rules
          SET event=?, room_id=?, channel_ids=?, conditions=?, template_id=?, quiet_hours=?, enabled=?, updated_at=?
        WHERE id=? AND owner=?`
    ).run(
      input.event,
      input.room_id || null,
      channelIds,
      conditions,
      input.template_id || null,
      quiet,
      input.enabled ? 1 : 0,
      ts,
      input.id,
      owner
    );
    return input.id;
  }
  const info = db
    .prepare(
      `INSERT INTO notify_rules (owner, event, room_id, channel_ids, conditions, template_id, quiet_hours, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      owner,
      input.event,
      input.room_id || null,
      channelIds,
      conditions,
      input.template_id || null,
      quiet,
      input.enabled ? 1 : 0,
      ts,
      ts
    );
  return Number(info.lastInsertRowid);
}

function deleteRule(db, id, owner) {
  db.prepare('DELETE FROM notify_rules WHERE id=? AND owner=?').run(id, owner);
}

/* ---------------- 模板 ---------------- */

function listTemplates(db) {
  return db.prepare('SELECT * FROM notify_templates ORDER BY id DESC').all();
}

function saveTemplate(db, input) {
  const ts = now();
  if (input.id) {
    db.prepare('UPDATE notify_templates SET event=?, title=?, body=?, updated_at=? WHERE id=?').run(
      input.event || null,
      input.title || '',
      input.body || '',
      ts,
      input.id
    );
    return input.id;
  }
  const info = db
    .prepare('INSERT INTO notify_templates (event, title, body, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(input.event || null, input.title || '', input.body || '', ts, ts);
  return Number(info.lastInsertRowid);
}

/** 按事件取模板（没有就返回 null，调用方用默认文案） */
function getTemplateByEvent(db, event) {
  return db.prepare('SELECT * FROM notify_templates WHERE event=? ORDER BY id DESC LIMIT 1').get(event) || null;
}

/* ---------------- 记录 ---------------- */

function addLog(db, entry) {
  db.prepare(
    `INSERT INTO notify_logs (owner, rule_id, event, channel_id, channel_name, payload, status, error, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    entry.owner || '',
    entry.rule_id || null,
    entry.event || '',
    entry.channel_id || null,
    entry.channel_name || '',
    entry.payload || '',
    entry.status || 'sent',
    entry.error || '',
    now()
  );
}

function listLogs(db, owner, { page = 1, size = 20, status = '' } = {}) {
  const where = status ? 'WHERE owner = ? AND status = ?' : 'WHERE owner = ?';
  const args = status ? [owner, status] : [owner];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM notify_logs ${where}`).get(...args).n;
  const rows = db
    .prepare(`SELECT * FROM notify_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (page - 1) * size);
  return { total, items: rows };
}

module.exports = {
  ensure,
  listChannels,
  saveChannel,
  deleteChannel,
  getChannel,
  listRules,
  listAllRules,
  saveRule,
  deleteRule,
  listTemplates,
  saveTemplate,
  getTemplateByEvent,
  addLog,
  listLogs
};

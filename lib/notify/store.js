/**
 * 通知管理的存储层（表结构 + CRUD）。
 *
 * 为什么放在 lib 而不是路由里：
 *   · 后面「开播通知」「下播战报」要由 worker / 定时器触发，路由只是 HTTP 外壳；
 *   · 建表放在 ensure()，服务启动时调一次，路由里就不用每次判表是否存在。
 */

function ensure(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notify_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS notify_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

function listChannels(db) {
  return db
    .prepare('SELECT * FROM notify_channels ORDER BY id DESC')
    .all()
    .map((r) => ({ ...r, config: parseJSON(r.config, {}), enabled: !!r.enabled }));
}

function saveChannel(db, input) {
  const config = typeof input.config === 'string' ? input.config : JSON.stringify(input.config || {});
  const ts = now();
  if (input.id) {
    db.prepare(
      'UPDATE notify_channels SET type=?, name=?, config=?, enabled=?, updated_at=? WHERE id=?'
    ).run(input.type, input.name, config, input.enabled ? 1 : 0, ts, input.id);
    return input.id;
  }
  const info = db
    .prepare(
      'INSERT INTO notify_channels (type, name, config, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    )
    .run(input.type, input.name, config, input.enabled ? 1 : 0, ts, ts);
  return Number(info.lastInsertRowid);
}

function deleteChannel(db, id) {
  db.prepare('DELETE FROM notify_channels WHERE id=?').run(id);
}

function getChannel(db, id) {
  const row = db.prepare('SELECT * FROM notify_channels WHERE id=?').get(id);
  if (!row) return null;
  return { ...row, config: parseJSON(row.config, {}), enabled: !!row.enabled };
}

/* ---------------- 规则 ---------------- */

function listRules(db) {
  return db
    .prepare('SELECT * FROM notify_rules ORDER BY id DESC')
    .all()
    .map((r) => ({
      ...r,
      channel_ids: parseJSON(r.channel_ids, []),
      conditions: parseJSON(r.conditions, {}),
      quiet_hours: parseJSON(r.quiet_hours, null),
      enabled: !!r.enabled
    }));
}

function saveRule(db, input) {
  const channelIds = JSON.stringify(input.channel_ids || []);
  const conditions = JSON.stringify(input.conditions || {});
  const quiet = input.quiet_hours ? JSON.stringify(input.quiet_hours) : null;
  const ts = now();
  if (input.id) {
    db.prepare(
      `UPDATE notify_rules
          SET event=?, room_id=?, channel_ids=?, conditions=?, template_id=?, quiet_hours=?, enabled=?, updated_at=?
        WHERE id=?`
    ).run(
      input.event,
      input.room_id || null,
      channelIds,
      conditions,
      input.template_id || null,
      quiet,
      input.enabled ? 1 : 0,
      ts,
      input.id
    );
    return input.id;
  }
  const info = db
    .prepare(
      `INSERT INTO notify_rules (event, room_id, channel_ids, conditions, template_id, quiet_hours, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
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

function deleteRule(db, id) {
  db.prepare('DELETE FROM notify_rules WHERE id=?').run(id);
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
    `INSERT INTO notify_logs (rule_id, event, channel_id, channel_name, payload, status, error, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
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

function listLogs(db, { page = 1, size = 20, status = '' } = {}) {
  const where = status ? 'WHERE status=?' : '';
  const args = status ? [status] : [];
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
  saveRule,
  deleteRule,
  listTemplates,
  saveTemplate,
  getTemplateByEvent,
  addLog,
  listLogs
};

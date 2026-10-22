/**
 * 礼物单价覆盖表（gift_price_overrides）—— 页面可改，不用改代码、不用重启。
 *
 * 为什么需要：原始消息里的 diamondCount 有时不准（例如「抖音飞艇」23333 也见过别的值），
 * 而内置表 lib/gift-price-builtin.js 是代码，改一次要发版。这个模块把覆盖价放数据库。
 *
 * 采集时的优先级（message-handler 调用）：
 *   消息 diamondCount  <  工坊宝箱融合计价  <  内置表  <  本表（最高）
 *
 * ⚠ 改这里只影响**之后**采集到的礼物：历史行已经把 diamond_count / total_diamonds 写死了。
 *   要让历史数据也用新价，走 /api/gift-prices/repair（见 lib/routes/gift-prices.js）。
 *
 * 缓存：采集是热路径（每条礼物消息都查），所以整表缓存在内存里。
 *   · 同进程内写入会立刻刷新缓存（页面保存后马上生效）
 *   · 跨进程（monitor.js 与 web-dashboard.js 是不同进程）靠 TTL 最多 10 秒后生效
 */

const TABLE = 'gift_price_overrides';
const TTL_MS = 10_000;

let cache = null; // Map<gift_name, diamond_per_unit>
let cacheAt = 0;

function ensureSchema(db) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
      gift_name TEXT PRIMARY KEY,
      diamond_per_unit INTEGER NOT NULL,
      note TEXT,
      updated_at TEXT
    )`
  ).run();
}

/** 重新读库（写操作后调用，保证同进程立刻生效） */
function reload(db) {
  ensureSchema(db);
  const map = new Map();
  for (const r of db.prepare(`SELECT gift_name, diamond_per_unit FROM ${TABLE}`).all()) {
    map.set(r.gift_name, r.diamond_per_unit);
  }
  cache = map;
  cacheAt = Date.now();
  return map;
}

function getMap(db) {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  return reload(db);
}

/**
 * 取覆盖价。
 * @returns {number|undefined} undefined 表示"没配置"（注意 0 是合法价格）
 */
function getPrice(db, giftName) {
  if (!giftName) return undefined;
  const m = getMap(db);
  return m.has(giftName) ? m.get(giftName) : undefined;
}

/** 全部覆盖项（页面列表用，不走缓存，直接读库） */
function list(db) {
  ensureSchema(db);
  return db
    .prepare(
      `SELECT gift_name, diamond_per_unit, note, updated_at
       FROM ${TABLE} ORDER BY updated_at DESC, gift_name`
    )
    .all();
}

/** 新增/更新一条覆盖价 */
function set(db, giftName, diamondPerUnit, note) {
  ensureSchema(db);
  const name = String(giftName || '').trim();
  const price = Math.round(Number(diamondPerUnit));
  if (!name) throw new Error('礼物名不能为空');
  if (!Number.isFinite(price) || price < 0) throw new Error('单价必须是不小于 0 的数字');
  db.prepare(
    `INSERT INTO ${TABLE} (gift_name, diamond_per_unit, note, updated_at)
     VALUES (?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(gift_name) DO UPDATE SET
       diamond_per_unit = excluded.diamond_per_unit,
       note = excluded.note,
       updated_at = excluded.updated_at`
  ).run(name, price, note || null);
  reload(db); // 同进程立刻生效
  return { gift_name: name, diamond_per_unit: price };
}

/** 删除一条覆盖价（删掉后回退到内置表/消息价） */
function remove(db, giftName) {
  ensureSchema(db);
  const name = String(giftName || '').trim();
  if (!name) throw new Error('礼物名不能为空');
  const r = db.prepare(`DELETE FROM ${TABLE} WHERE gift_name = ?`).run(name);
  reload(db);
  return r.changes;
}

module.exports = { getPrice, getMap, list, set, remove, reload };

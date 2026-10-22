/**
 * 礼物价格管理（页面 /douyin/gift-prices 的后端）。
 *
 * 解决两个问题：
 *   ① 原始数据里 diamondCount 不准 —— 在页面上改单价，之后采集立刻按新价计算；
 *   ② 历史数据已经被写死在 gifts 表里 —— 提供"重算历史"，把指定礼物名的
 *      diamond_count / total_diamonds 改成新价，并重建该场次的全部预聚合。
 *
 * 重算会动到的表（都通过 recomputeSessionAggregates 重建，避免这里再抄一遍逻辑）：
 *   gifts（单价/总额）、sessions.agg_*、session_gift_ranking、session_anchor_ranking、
 *   session_gift_details、session_timeline、session_user_gift_totals、
 *   session_gift_type_totals、session_user_danmaku_totals
 */

const { getBuiltinPrice } = require('../gift-price-builtin');
const overrides = require('../gift-price-overrides');

module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse } = ctx;
  if (!pathname.startsWith('/api/gift-prices')) return false;

  const sqlite = require('../../db-sqlite.js');

  // ---- 列表：礼物名 + 实际数据统计 + 内置价 + 覆盖价 ----
  if (pathname === '/api/gift-prices' && req.method === 'GET') {
    const q = String(query.q || '').trim();
    const only = String(query.only || ''); // '' | 'override' | 'anomaly' | 'zero'

    /*
     * 一次扫描算出每个礼物名的：出现行数、礼物个数、钻石总额、单价的最小/最大值。
     * min != max 说明同一礼物在历史数据里出现过不同单价 —— 页面标红提示。
     */
    const args = [];
    let where = "WHERE gift_name IS NOT NULL AND gift_name <> ''";
    if (q) {
      where += ' AND gift_name LIKE ?';
      args.push('%' + q + '%');
    }
    const stats = dbInstance
      .prepare(
        `SELECT gift_name,
                COUNT(*) AS rows,
                SUM(COALESCE(repeat_count, 1)) AS gift_count,
                SUM(COALESCE(total_diamonds, 0)) AS diamonds,
                MIN(diamond_count) AS min_unit,
                MAX(diamond_count) AS max_unit,
                COUNT(DISTINCT session_id) AS sessions,
                MAX(create_time) AS last_time
         FROM gifts
         ${where}
         GROUP BY gift_name
         ORDER BY diamonds DESC`
      )
      .all(...args);

    const ovMap = new Map(overrides.list(dbInstance).map((o) => [o.gift_name, o]));

    /*
     * gift_icons 里记的是"从礼物消息里学到的价格"，作为第三种参考值。
     * 有些礼物在 gifts 里没有（只在图标同步时见过），也一并展示出来。
     */
    const iconMap = new Map();
    for (const r of dbInstance.prepare('SELECT name, diamond_count FROM gift_icons').all()) {
      if (r.name) iconMap.set(r.name, r.diamond_count);
    }

    let list = stats.map((s) => {
      const ov = ovMap.get(s.gift_name);
      const builtin = getBuiltinPrice(s.gift_name);
      return {
        gift_name: s.gift_name,
        rows: s.rows,
        gift_count: s.gift_count || 0,
        diamonds: s.diamonds || 0,
        min_unit: s.min_unit,
        max_unit: s.max_unit,
        sessions: s.sessions || 0,
        last_time: s.last_time,
        builtin_price: builtin === undefined ? null : builtin,
        icon_price: iconMap.has(s.gift_name) ? iconMap.get(s.gift_name) : null,
        override_price: ov ? ov.diamond_per_unit : null,
        note: ov ? ov.note : null,
        updated_at: ov ? ov.updated_at : null
      };
    });

    // 覆盖表里有、但礼物明细里没有的名字（还没采到，或名字写错）也要能删掉
    const seen = new Set(list.map((x) => x.gift_name));
    for (const [name, ov] of ovMap) {
      if (seen.has(name)) continue;
      list.push({
        gift_name: name,
        rows: 0,
        gift_count: 0,
        diamonds: 0,
        min_unit: null,
        max_unit: null,
        sessions: 0,
        last_time: null,
        builtin_price: getBuiltinPrice(name) ?? null,
        icon_price: iconMap.has(name) ? iconMap.get(name) : null,
        override_price: ov.diamond_per_unit,
        note: ov.note,
        updated_at: ov.updated_at
      });
    }

    if (only === 'override') list = list.filter((x) => x.override_price !== null);
    else if (only === 'zero') list = list.filter((x) => x.diamonds === 0 && x.rows > 0);
    else if (only === 'anomaly') {
      list = list.filter(
        (x) => (x.min_unit !== null && x.max_unit !== null && x.min_unit !== x.max_unit) || x.override_price !== null
      );
    }

    return sendJSON(res, { total: list.length, items: list });
  }

  // ---- 预览：把某礼物改成新单价，会影响多少数据 ----
  if (pathname === '/api/gift-prices/preview' && req.method === 'GET') {
    const giftName = String(query.gift || '').trim();
    const price = Math.round(Number(query.price));
    if (!giftName) return sendError(res, '缺少 gift 参数', 400);
    if (!Number.isFinite(price) || price < 0) return sendError(res, 'price 必须是不小于 0 的数字', 400);

    const agg = dbInstance
      .prepare(
        `SELECT COUNT(*) AS rows,
                SUM(COALESCE(repeat_count, 1)) AS gift_count,
                SUM(COALESCE(total_diamonds, 0)) AS old_diamonds,
                COUNT(DISTINCT session_id) AS sessions
         FROM gifts WHERE gift_name = ?`
      )
      .get(giftName);
    const newDiamonds = (agg.gift_count || 0) * price;
    const affected = dbInstance
      .prepare(
        `SELECT session_id, COUNT(*) AS rows, SUM(COALESCE(total_diamonds,0)) AS old_diamonds
         FROM gifts WHERE gift_name = ? GROUP BY session_id ORDER BY session_id DESC`
      )
      .all(giftName);

    return sendJSON(res, {
      gift_name: giftName,
      price,
      rows: agg.rows || 0,
      gift_count: agg.gift_count || 0,
      old_diamonds: agg.old_diamonds || 0,
      new_diamonds: newDiamonds,
      diff: newDiamonds - (agg.old_diamonds || 0),
      sessions: agg.sessions || 0,
      affected
    });
  }

  // ---- 保存覆盖价（不影响历史） ----
  if (pathname === '/api/gift-prices' && req.method === 'POST') {
    const body = await bodyParse(req);
    try {
      const saved = overrides.set(dbInstance, body.giftName, body.diamondPerUnit, body.note);
      return sendJSON(res, { ok: true, ...saved, message: '已保存，之后采集到的该礼物按新价计算' });
    } catch (e) {
      return sendError(res, e.message, 400);
    }
  }

  // ---- 删除覆盖价 ----
  if (pathname === '/api/gift-prices' && req.method === 'DELETE') {
    try {
      const n = overrides.remove(dbInstance, query.name);
      return sendJSON(res, { ok: true, removed: n });
    } catch (e) {
      return sendError(res, e.message, 400);
    }
  }

  // ---- 重算历史：把该礼物的历史行改成新价，并重建受影响场次 ----
  if (pathname === '/api/gift-prices/repair' && req.method === 'POST') {
    const body = await bodyParse(req);
    const giftName = String(body.giftName || '').trim();
    const price = Math.round(Number(body.diamondPerUnit));
    if (!giftName) return sendError(res, '缺少 giftName', 400);
    if (!Number.isFinite(price) || price < 0) return sendError(res, 'diamondPerUnit 必须是不小于 0 的数字', 400);
    if (body.saveOverride !== false) {
      try {
        overrides.set(dbInstance, giftName, price, body.note);
      } catch (e) {
        return sendError(res, e.message, 400);
      }
    }

    // 先记下受影响的场次（更新后就查不出原来的分布了）
    const sessionIds = dbInstance
      .prepare('SELECT DISTINCT session_id FROM gifts WHERE gift_name = ? ORDER BY session_id')
      .all(giftName)
      .map((r) => r.session_id);

    const t0 = Date.now();
    const upd = dbInstance
      .prepare(
        `UPDATE gifts
            SET diamond_count = ?,
                total_diamonds = ? * COALESCE(repeat_count, 1)
          WHERE gift_name = ?`
      )
      .run(price, price, giftName);

    // 逐场重建预聚合。失败要显式报出来，不能静默跳过
    const failed = [];
    for (const sid of sessionIds) {
      try {
        const r = await sqlite.recomputeSessionAggregates(sid);
        if (!r || r.ok === false) failed.push({ sessionId: sid, error: (r && r.error) || 'unknown' });
      } catch (e) {
        failed.push({ sessionId: sid, error: e.message });
      }
    }

    return sendJSON(res, {
      ok: true,
      gift_name: giftName,
      price,
      updated_rows: upd.changes,
      rebuilt_sessions: sessionIds.length - failed.length,
      failed,
      elapsed_ms: Date.now() - t0
    });
  }

  return false;
};

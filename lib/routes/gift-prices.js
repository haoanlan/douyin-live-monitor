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
const { getGiftIconLookup } = require('../gift-utils.js');

module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse } = ctx;
  if (!pathname.startsWith('/api/gift-prices')) return false;

  const sqlite = require('../../db-sqlite.js');

  // ---- 列表：礼物名 + 图标 + 实际数据统计 + 内置价 + 覆盖价 ----
  if (pathname === '/api/gift-prices' && req.method === 'GET') {
    const q = String(query.q || '').trim();
    const only = String(query.only || ''); // '' | 'mapped' | 'unmapped' | 'anomaly' | 'zero'

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
                /*
                 * 实际单价 = total_diamonds / repeat_count。
                 * 为什么不直接用 diamond_count 判断"价格是否不一致"：
                 * 老数据里有 diamond_count=1200 但 total_diamonds=36000 的行（金额按 36000 记的），
                 * 用 diamond_count 会把它误报成"历史价不一致"，而实际金额口径是一致的。
                 */
                MIN(CASE WHEN COALESCE(repeat_count,0) > 0
                         THEN CAST(ROUND(1.0 * COALESCE(total_diamonds,0) / repeat_count) AS INTEGER) END) AS eff_min,
                MAX(CASE WHEN COALESCE(repeat_count,0) > 0
                         THEN CAST(ROUND(1.0 * COALESCE(total_diamonds,0) / repeat_count) AS INTEGER) END) AS eff_max,
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
     * 「建议单价」= 数据里**最近一次**采集到的单价（按 gifts.id 最大那条）。
     *
     * 为什么用最近一次而不是"最常见"：抖音调价后，旧价可能数量更多，
     * 用众数会把新价当成错的。最近一次才最接近"现在官方是多少"。
     *
     * 用 GROUP BY MAX(id) 再 JOIN 回主键，避免对每个礼物名做相关子查询（710 个名字 × 全表扫 = 灾难）。
     */
    const latestPriceMap = new Map();
    for (const r of dbInstance
      .prepare(
        `SELECT g.gift_name,
                /*
                 * 单价就是**存下来的单价**（最近一条礼物的 diamond_count），不是折算出来的。
                 * 有映射（覆盖价）时页面优先显示映射价；没有映射时显示这个"消息价"。
                 */
                g.diamond_count AS latest_price
         FROM gifts g
         JOIN (
           SELECT gift_name, MAX(id) AS mid
           FROM gifts
           WHERE gift_name IS NOT NULL AND gift_name <> ''
           GROUP BY gift_name
         ) t ON g.id = t.mid`
      )
      .all()) {
      if (Number.isFinite(r.latest_price)) latestPriceMap.set(r.gift_name, r.latest_price);
    }

    /*
     * gift_icons 里记的是"从礼物消息里学到的价格"，作为第三种参考值。
     * 有些礼物在 gifts 里没有（只在图标同步时见过），也一并展示出来。
     */
    const iconMap = new Map();
    const iconUrlByName = new Map();
    for (const r of dbInstance.prepare('SELECT name, diamond_count, icon_url FROM gift_icons').all()) {
      if (!r.name) continue;
      iconMap.set(r.name, r.diamond_count);
      if (r.icon_url) iconUrlByName.set(r.name, r.icon_url);
    }
    /*
     * 图标：gifts.icon（按礼物名取最新一条）优先，gift_icons.icon_url 兜底。
     * 两者互补 —— gift_icons 精确名只覆盖 448/696 个礼物名，反过来有些只在 gift_icons 里有图。
     */
    const giftsIconOf = getGiftIconLookup(dbInstance);
    const iconUrlOf = (name) => giftsIconOf(name) || iconUrlByName.get(name) || null;

    let list = stats.map((s) => {
      const ov = ovMap.get(s.gift_name);
      const builtin = getBuiltinPrice(s.gift_name);
      return {
        gift_name: s.gift_name,
        /* 礼物图标（列表里显示在名字前面），没有就是 null —— 前端用通用礼物图标兜底 */
        icon_url: iconUrlOf(s.gift_name),
        rows: s.rows,
        gift_count: s.gift_count || 0,
        diamonds: s.diamonds || 0,
        min_unit: s.min_unit,
        max_unit: s.max_unit,
        /* 实际单价（金额口径）的最小/最大；null 表示没有可比的行 */
        eff_min_unit: s.eff_min === null || s.eff_min === undefined ? null : s.eff_min,
        eff_max_unit: s.eff_max === null || s.eff_max === undefined ? null : s.eff_max,
        /* 真正的不一致：按"金额算出来的单价"出现过多种值 */
        price_kinds: s.eff_min !== null && s.eff_max !== null && s.eff_min !== s.eff_max ? 2 : 1,
        /*
         * 历史里出现过的单价，最多两个（页面「单价」列只展示这两种）。
         * 用户口径："估计最多出来两种单价" —— 更多种也没意义，min/max 已经能说明问题。
         */
        unit_variants:
          s.eff_min === null || s.eff_min === undefined
            ? []
            : s.eff_max === null || s.eff_max === undefined || s.eff_max === s.eff_min
              ? [s.eff_min]
              : [s.eff_min, s.eff_max],
        /* 建议单价（页面那一列的初始值）：覆盖价 > 最近一次采集价 > 内置价 */
        latest_price: latestPriceMap.has(s.gift_name) ? latestPriceMap.get(s.gift_name) : null,
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
        icon_url: iconUrlOf(name),
        rows: 0,
        gift_count: 0,
        diamonds: 0,
        min_unit: null,
        max_unit: null,
        eff_min_unit: null,
        eff_max_unit: null,
        price_kinds: 0,
        unit_variants: [],
        sessions: 0,
        last_time: null,
        builtin_price: getBuiltinPrice(name) ?? null,
        icon_price: iconMap.has(name) ? iconMap.get(name) : null,
        override_price: ov.diamond_per_unit,
        note: ov.note,
        updated_at: ov.updated_at
      });
    }

    /*
     * 两个总数必须在过滤**之前**算好：否则「未映射 / 已映射」标签会显示筛选后的条数。
     */
    const allTotal = list.length;
    /*
     * 「已映射」= **数据库覆盖价 或 代码内置价** 都算。
     * 内置表（lib/gift-price-builtin.js 里的 GIFT_PRICE_MAP，采集端 message-handler 在用）
     * 本来就是"人工定过价"的；只统计覆盖表会把 无界超跑 这类只剩内置价的礼物算成"未映射"。
     * 「未映射」= 两样都没有 —— 采集时只能信消息里的 diamondCount，最可能出现价格不准。
     */
    const isMapped = (x) => x.override_price !== null || x.builtin_price !== null;
    const mappedTotal = list.filter(isMapped).length;
    const unmappedTotal = allTotal - mappedTotal;

    if (only === 'override' || only === 'mapped') list = list.filter(isMapped);
    else if (only === 'unmapped') list = list.filter((x) => !isMapped(x));
    else if (only === 'zero') list = list.filter((x) => x.diamonds === 0 && x.rows > 0);
    else if (only === 'anomaly') {
      list = list.filter(
        (x) => (x.min_unit !== null && x.max_unit !== null && x.min_unit !== x.max_unit) || x.override_price !== null
      );
    }

    // price_source：给页面显示"这个价从哪来"
    for (const x of list) {
      x.price_source =
        x.override_price !== null ? 'override' : x.builtin_price !== null ? 'builtin' : 'message';
    }
    return sendJSON(res, {
      total: list.length,
      all_total: allTotal,
      mapped_total: mappedTotal,
      unmapped_total: unmappedTotal,
      items: list
    });
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

  /*
   * ---- 同步单价字段（只改 diamond_count，不动任何金额）----
   *
   * 背景：历史上有人发现"价格错了"就手动 UPDATE total_diamonds，但没同步 diamond_count，
   * 于是同一行出现 diamond_count=1200 / total_diamonds=36000。
   * 金额口径（total_diamonds）是所有统计的唯一来源，所以这里**以 total_diamonds 为准**
   * 把 diamond_count 回填成 total_diamonds / repeat_count。
   *
   * 风险：不改变任何金额、不触发任何重算 —— 只让报告图片 / CSV 里显示的单价不再自相矛盾。
   */
  if (pathname === '/api/gift-prices/unit-sync/preview' && req.method === 'GET') {
    const rows = dbInstance
      .prepare(
        `SELECT gift_name,
                COUNT(*) AS rows,
                MIN(diamond_count) AS from_min,
                MAX(diamond_count) AS from_max,
                CAST(ROUND(1.0 * SUM(COALESCE(total_diamonds,0)) / SUM(COALESCE(repeat_count,1))) AS INTEGER) AS to_unit
         FROM gifts
         WHERE COALESCE(repeat_count, 0) > 0
           AND diamond_count <> CAST(ROUND(1.0 * COALESCE(total_diamonds,0) / repeat_count) AS INTEGER)
         GROUP BY gift_name
         ORDER BY rows DESC`
      )
      .all();
    const total = rows.reduce((s, r) => s + r.rows, 0);
    return sendJSON(res, { total_rows: total, gifts: rows.length, items: rows.slice(0, 50) });
  }

  if (pathname === '/api/gift-prices/unit-sync' && req.method === 'POST') {
    const t0 = Date.now();
    const upd = dbInstance
      .prepare(
        `UPDATE gifts
            SET diamond_count = CAST(ROUND(1.0 * COALESCE(total_diamonds,0) / repeat_count) AS INTEGER)
          WHERE COALESCE(repeat_count, 0) > 0
            AND diamond_count <> CAST(ROUND(1.0 * COALESCE(total_diamonds,0) / repeat_count) AS INTEGER)`
      )
      .run();
    return sendJSON(res, { ok: true, updated_rows: upd.changes, elapsed_ms: Date.now() - t0 });
  }

  return false;
};

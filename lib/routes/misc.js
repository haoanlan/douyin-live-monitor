/**
 * 本地日期戳 YYYY-MM-DD。
 * 原来用 new Date().toISOString().slice(0,10) —— 那是 **UTC 日期**：
 * 北京时间 08:00 之前导出，文件名会写成"昨天"。
 */
function localDateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
const path = require('path');
const fs = require('fs');
const workerControl = require('../worker-control.js');
const { intParam } = require('../http-params');

module.exports = async function(pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse, comboDedupGifts, DATA_DIR } = ctx;

  // --- 趋势数据 ---
  if (pathname === '/api/trends') {
    const range = query.range || '7d'; // 7d, 30d, 90d, all
    const groupBy = query.group || 'day'; // day, week, month

    // 白名单校验，防止 SQL 注入
    const validRanges = ['7d', '30d', '90d', 'all'];
    const validGroups = ['day', 'week', 'month'];
    if (!validRanges.includes(range)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid range' })); return; }
    if (!validGroups.includes(groupBy)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid group' })); return; }

    let dateExpr, groupExpr;
    if (groupBy === 'day') {
      dateExpr = "date(create_time/1000, 'unixepoch', 'localtime')";
      groupExpr = dateExpr;
    } else if (groupBy === 'week') {
      dateExpr = "date(create_time/1000, 'unixepoch', 'localtime', 'weekday 0', '-6 days')";
      groupExpr = dateExpr;
    } else {
      dateExpr = "strftime('%Y-%m', create_time/1000, 'unixepoch', 'localtime')";
      groupExpr = dateExpr;
    }

    let where = '';
    if (range === '7d') where = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-7 days') AS INTEGER)";
    else if (range === '30d') where = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-30 days') AS INTEGER)";
    else if (range === '90d') where = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-90 days') AS INTEGER)";

    // 礼物趋势（需要去重）
    let whereSql = '';
    if (range === '7d') whereSql = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-7 days') AS INTEGER)";
    else if (range === '30d') whereSql = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-30 days') AS INTEGER)";
    else if (range === '90d') whereSql = "WHERE CAST(create_time/1000 AS INTEGER) >= CAST(strftime('%s', 'now', '-90 days') AS INTEGER)";

    // ⚠ 必须带 session_id：这里是按时间范围跨场次的扫描，comboDedupGifts 的分组键含场次，
    //   漏了这一列分组就退化成"跨场次合并"，和总览/场次页的口径不一致（详见 lib/gift-utils.js）
    const rawGifts = dbInstance.prepare(
      `SELECT id, session_id, nickname, user_display_id, gift_name, user_sec_uid, to_user_sec_uid, to_user_display_id, to_nickname, repeat_count, total_diamonds, combo_count, repeat_end, create_time FROM gifts ${whereSql} ORDER BY id`
    ).all();
    const dedupedGifts = comboDedupGifts(rawGifts);
    // 按日期分组
    const trendMap = {};
    for (const g of dedupedGifts) {
      let dateStr;
      const ts = g.create_time;
      if (typeof ts === 'number') {
        const d = new Date(ts > 1e12 ? ts : ts * 1000);
        if (groupBy === 'day') dateStr = d.toLocaleDateString('zh-CN');
        else if (groupBy === 'week') { const wd = d.getDay(); const diff = wd === 0 ? 6 : wd - 1; d.setDate(d.getDate() - diff); dateStr = d.toLocaleDateString('zh-CN'); }
        else dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      } else {
        dateStr = String(ts).slice(0, 10);
      }
      if (!trendMap[dateStr]) trendMap[dateStr] = { date: dateStr, total_diamonds: 0, gift_count: 0, senders: new Set() };
      trendMap[dateStr].total_diamonds += g.total_diamonds || 0;
      trendMap[dateStr].gift_count += g.repeat_count || 1;
      if (g.nickname) trendMap[dateStr].senders.add(g.nickname);
    }
    const giftTrend = Object.values(trendMap).map(t => ({
      date: t.date, total_diamonds: t.total_diamonds, gift_count: t.gift_count, sender_count: t.senders.size
    })).sort((a, b) => a.date.localeCompare(b.date));

    // 弹幕趋势
    const danmakuTrend = dbInstance.prepare(`
      SELECT ${groupExpr} as date,
        COUNT(*) as danmaku_count,
        COUNT(DISTINCT nickname) as sender_count
      FROM danmaku ${where} GROUP BY ${groupExpr} ORDER BY date
    `).all();

    // 在线人数趋势（sessions 表用 start_time，是 TEXT 类型）
    let sessionDateExpr;
    if (groupBy === 'day') {
      sessionDateExpr = "date(start_time)";
    } else if (groupBy === 'week') {
      sessionDateExpr = "date(start_time, 'weekday 0', '-6 days')";
    } else {
      sessionDateExpr = "strftime('%Y-%m', start_time)";
    }

    const onlineTrend = dbInstance.prepare(`
      SELECT s2.date, MAX(or2.count) as peak_online
      FROM (
        SELECT ${sessionDateExpr} as date, id as session_id
        FROM sessions WHERE start_time IS NOT NULL
      ) s2
      LEFT JOIN online_records or2 ON s2.session_id = or2.session_id
      GROUP BY s2.date ORDER BY s2.date
    `).all();

    return sendJSON(res, { giftTrend, danmakuTrend, onlineTrend });
  }

  // --- 弹幕搜索 ---
  if (pathname === '/api/danmaku/search') {
    const keyword = query.q;
    if (!keyword) return sendError(res, '缺少搜索关键词', 400);
    // 这里原来完全没有上限（`parseInt(limit) || 50`）→ ?limit=100000 会拉全表；
    // 且 ?limit=abc → NaN 绑进 SQL 抛错变 500。统一走 intParam 夹紧 + 非法值回 400。
    const pg = intParam(query.page, { def: 1, min: 1, max: 100000 });
    const lim = intParam(query.limit, { def: 50, min: 1, max: 500 });
    if (pg.invalid || lim.invalid) return sendError(res, 'page / limit 必须是正整数', 400);
    const page = pg.value;
    const limit = lim.value;
    const offset = (page - 1) * limit;

    const rows = dbInstance.prepare(`
      SELECT d.*, s.start_time as session_time, st.name as streamer_name
      FROM danmaku d
      LEFT JOIN sessions s ON d.session_id = s.id
      LEFT JOIN streamers st ON s.streamer_id = st.id
      WHERE d.content LIKE ? ORDER BY d.create_time DESC LIMIT ? OFFSET ?
    `).all(`%${keyword}%`, limit, offset);

    const total = dbInstance.prepare(`
      SELECT COUNT(*) as c FROM danmaku WHERE content LIKE ?
    `).get(`%${keyword}%`).c;

    return sendJSON(res, { data: rows, total, page, limit });
  }

  // --- 实时监控状态 ---
  if (pathname === '/api/status') {
    // 同进程直接调用 worker（原来是走 monitor.sock）；
    // worker 没在跑时返回 503 并说明原因，而不是含糊的"解析失败"
    const result = await workerControl.sendControlCommand('status');
    /*
     * 顺带做一次**轻量**代理探活。
     * 总览页原来只有守护进程这一份数据，于是「Go 代理」那格只能拿
     * daemonRunning 顶替 —— 代理挂了它照样显示绿色「正常」（用户反馈）。
     * 这里只做 TCP + /health，不读日志/配置，开销可以接受。
     */
    let proxy = null;
    try {
      proxy = await require('../proxy-probe.js').probeProxyLight();
    } catch (e) {
      proxy = { port: 1088, reachable: false, healthy: false, tag: null, error: String(e.message || e) };
    }
    return sendJSON(res, { ...result, proxy }, workerControl.controlStatus(result));
  }

  /*
   * 导出 CSV 的三个接口（/api/export/gifts、/export/danmaku、/export/sessions）已删除
   * （2026-11-11）：
   *   · 前端从来没有入口，仓库里也没有任何调用方
   *   · 不带 session_id 时是 SELECT * 全表，实测 415k 行要 15 秒，
   *     而 worker 与 HTTP 同进程 —— 这段时间会直接丢弹幕/礼物
   *   · 按场次导出的需求，等真正要的时候再做（带权限、带分页/流式）
   */
  /*
   * 旧的「生成图片报告 / 取报告图片」两个接口已删除（2026-11-11 自检）：
   *   · 前端从来没有调用过（全仓库搜 report/generate、report/image 均无引用）
   *   · 功能已被 /api/sessions/:id/report 取代（按场次生成 + 返回图片）
   *   · 其中 POST /api/report/generate 还没有任何权限校验，任何登录用户都能触发
   *     一次无头浏览器渲染 —— 既费资源又没有意义
   */

  // --- 总览统计 ---
  if (pathname === '/api/summary') {
    // 已结束场次：直接用预聚合数据（<1ms）
    const completed = dbInstance.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(agg_gifts), 0) as total_gifts,
        COALESCE(SUM(agg_diamonds), 0) as total_diamonds,
        COALESCE(SUM(agg_danmaku), 0) as total_danmaku,
        COALESCE(SUM(stats_like), 0) as total_likes
      FROM sessions WHERE (agg_gifts > 0 OR agg_danmaku > 0) AND end_time IS NOT NULL
    `).get();
    // unique_users 跨场次去重，不能 SUM，用 SQL COUNT DISTINCT（有索引，快）
    const usersRow = dbInstance.prepare('SELECT COUNT(DISTINCT user_sec_uid) as cnt FROM gifts').get();
    const danmakuUsersRow = dbInstance.prepare('SELECT COUNT(DISTINCT user_sec_uid) as cnt FROM danmaku WHERE user_sec_uid IS NOT NULL').get();
    // 合并礼物+弹幕的独立用户
    const allUsers = dbInstance.prepare(`
      SELECT COUNT(DISTINCT user_sec_uid) as cnt FROM (
        SELECT user_sec_uid FROM gifts WHERE user_sec_uid IS NOT NULL
        UNION
        SELECT user_sec_uid FROM danmaku WHERE user_sec_uid IS NOT NULL
      )
    `).get();
    // 直播中场次：实时计算（只查单场，几千条）
    const liveSessions = dbInstance.prepare('SELECT id FROM sessions WHERE end_time IS NULL AND archived = 0').all();
    let liveGifts = 0, liveDiamonds = 0, liveDanmaku = 0;
    for (const ls of liveSessions) {
      const rawGifts = dbInstance.prepare('SELECT * FROM gifts WHERE session_id = ? ORDER BY id').all(ls.id);
      const deduped = comboDedupGifts(rawGifts);
      liveGifts += deduped.reduce((s, g) => s + (g.repeat_count || 1), 0);
      liveDiamonds += deduped.reduce((s, g) => s + (g.total_diamonds || 0), 0);
      const dm = dbInstance.prepare('SELECT COUNT(*) as cnt FROM danmaku WHERE session_id = ?').get(ls.id);
      liveDanmaku += dm.cnt;
    }
    const liveCount = liveSessions.length;
    const offlineCount = dbInstance.prepare("SELECT COUNT(*) as cnt FROM sessions WHERE end_time IS NOT NULL AND archived = 1").get().cnt;
    return sendJSON(res, {
      total_sessions: completed.total_sessions + liveCount,
      total_gifts: completed.total_gifts + liveGifts,
      total_diamonds: completed.total_diamonds + liveDiamonds,
      total_danmaku: completed.total_danmaku + liveDanmaku,
      unique_users: allUsers.cnt,
      live_count: liveCount,
      offline_count: offlineCount,
      total_likes: completed.total_likes
    });
  }

  return false;
};

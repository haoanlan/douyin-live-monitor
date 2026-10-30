const fs = require('fs');
const path = require('path');

/**
 * 虚拟礼物补录（手动补一条礼物记录）+ 虚拟用户合并。
 *
 * ## 为什么需要
 *
 * 采集没启动 / 漏收的时候，某个礼物确实发生了但库里没有。补一条之后，
 * 该场次的聚合（agg_* / 明细 / 用户 / 礼物四张表）必须跟着变，否则
 * 榜单和总览还是旧数字。
 *
 * ## 身份怎么定（按用户确认的规则）
 *
 *   · 库里已有的人 → 前端选中他 → 用**真实秒 uid**
 *   · 新观众       → 用虚拟 uid `manual:<标识>`（前缀就是标记，一眼看得出是补的）
 *   · 以后确认了   → `POST /api/manual/merge` 把 `manual:x` 合并到真实 uid
 *
 * ## 金额怎么算
 *
 *   total_diamonds = diamond_count(单价) × repeat_count(次数)
 *   **单价和金额是两个字段**，表单只让填单价和次数，金额由这里算 ——
 *   避免手填导致两者对不上（gift-prices 的改价逻辑强依赖这个等式）。
 */

const MANUAL_PREFIX = 'manual:';

/** 清掉总览的模块缓存（否则补录后 5 分钟内总览还是旧数字） */
function clearOverviewCache() {
  try {
    const ov = require('./overview');
    if (typeof ov.clearCache === 'function') ov.clearCache();
  } catch (e) {
    console.warn('[manual-gifts] 清总览缓存失败（不影响本次写入）:', e.message);
  }
}

/**
 * 重算一个场次的所有聚合。
 * 复用 db-sqlite 里已有的 recomputeSessionAggregates —— 它同时更新
 * sessions.agg_*、buildPrecomputed（三张预聚合表）、buildOverviewTotals。
 */
async function recompute(dbInstance, sessionId) {
  try {
    const dbModule = require('../../db-sqlite');
    if (typeof dbModule.recomputeSessionAggregates === 'function') {
      const r = await dbModule.recomputeSessionAggregates(sessionId);
      if (!r || r.ok === false) {
        console.warn('[manual-gifts] 聚合重算失败:', r && r.error);
      }
    } else {
      console.warn('[manual-gifts] db-sqlite 没导出 recomputeSessionAggregates，聚合未重算');
    }
  } catch (e) {
    console.warn('[manual-gifts] 聚合重算异常:', e.message);
  }
  clearOverviewCache();
}

/** 手工加一条礼物记录（POST /api/sessions/:id/gifts/manual） */
module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse } = ctx;

  /*
   * 新增补录：POST /api/sessions/<id>/gifts/manual
   */
  const mAdd = pathname.match(/^\/api\/sessions\/(\d+)\/gifts\/manual$/);
  if (mAdd && req.method === 'POST') {
    const sid = Number(mAdd[1]);
    const body = (await bodyParse(req)) || {};

    const nickname = String(body.nickname || '').trim();
    const giftName = String(body.gift_name || '').trim();
    const unitPrice = Math.floor(Number(body.unit_price));
    const count = Math.floor(Number(body.count));
    let toNickname = String(body.to_nickname || '').trim();
    if (!toNickname) {
      /*
       * 没传收礼人时，**不能**留空 —— 留空会让这条记录在"团播主播排名"里
       * 变成一个独立的、没有头像的主播（用户反馈"主播多出一个来"）。
       * 用该场次收礼最多的主播兜底。
       */
      const top = dbInstance
        .prepare(
          `SELECT to_nickname, COUNT(*) c FROM gifts
            WHERE session_id = ? AND IFNULL(to_nickname,'') <> ''
            GROUP BY to_nickname ORDER BY c DESC LIMIT 1`
        )
        .get(Number(mAdd[1]));
      if (top && top.to_nickname) toNickname = top.to_nickname;
    }
    let secUid = String(body.user_sec_uid || '').trim();
    const displayId = String(body.user_display_id || '').trim();

    if (!nickname) return sendError(res, '缺少昵称', 400);
    if (!giftName) return sendError(res, '缺少礼物名', 400);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return sendError(res, '单价必须是正整数', 400);
    if (!Number.isFinite(count) || count < 1) return sendError(res, '条数必须 ≥ 1', 400);

    const session = dbInstance.prepare('SELECT id FROM sessions WHERE id = ?').get(sid);
    if (!session) return sendError(res, '场次不存在', 404);

    // 没给 sec_uid 就用虚拟 uid（前缀标记，方便以后合并）
    if (!secUid) {
      secUid = MANUAL_PREFIX + (displayId || nickname);
    }

    const total = unitPrice * count;
    const createTime = Number(body.create_time) || Date.now();
    /*
     * 头像：补录时前端通常拿不到（这个人在库里可能只有名字）。
     * 不填就会在榜单上显示成空头像（用户反馈"补录后没有头像"）。
     * 所以这里按 sec_uid 优先、昵称兜底，从库里已有的记录里找一张。
     */
    let avatar = String(body.avatar || '').trim();
    if (!avatar) {
      try {
        const av = ctx.getAvatarBySecUid && ctx.getAvatarBySecUid(secUid);
        if (av) avatar = av;
      } catch { /* ignore */ }
    }
    if (!avatar && ctx.getAvatarByNickname) {
      try {
        const av2 = ctx.getAvatarByNickname(nickname);
        if (av2) avatar = av2;
      } catch { /* ignore */ }
    }
    if (!avatar) {
      const row = dbInstance
        .prepare(
          `SELECT avatar FROM gifts
            WHERE IFNULL(avatar,'') <> '' AND (user_sec_uid = ? OR nickname = ?)
            ORDER BY id DESC LIMIT 1`
        )
        .get(secUid, nickname);
      if (row && row.avatar) avatar = row.avatar;
    }

    let info;
    try {
      info = dbInstance
        .prepare(
          `INSERT INTO gifts
             (session_id, nickname, avatar, user_sec_uid, user_display_id, gift_name, to_nickname,
              repeat_count, diamond_count, total_diamonds, create_time, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`
        )
        .run(sid, nickname, avatar || null, secUid, displayId || null, giftName, toNickname || null,
             count, unitPrice, total, createTime);
    } catch (e) {
      return sendError(res, `写入失败：${e.message}`, 500);
    }

    await recompute(dbInstance, sid);
    return sendJSON(res, {
      ok: true,
      id: info.lastInsertRowid,
      session_id: sid,
      user_sec_uid: secUid,
      virtual: secUid.startsWith(MANUAL_PREFIX),
      unit_price: unitPrice,
      count,
      total_diamonds: total
    });
  }

  /*
   * 某场次的补录记录：GET /api/sessions/<id>/gifts/manual
   * 前端"补录面板"下方列表用，撤销按钮调 DELETE。
   */
  const mList = pathname.match(/^\/api\/sessions\/(\d+)\/gifts\/manual$/);
  if (mList && req.method === 'GET') {
    const sid = Number(mList[1]);
    const rows = dbInstance
      .prepare(
        `SELECT id, nickname, user_sec_uid, user_display_id, gift_name, to_nickname,
                repeat_count, diamond_count, total_diamonds, create_time
           FROM gifts
          WHERE session_id = ? AND source = 'manual'
          ORDER BY id DESC`
      )
      .all(sid);
    return sendJSON(res, {
      session_id: sid,
      count: rows.length,
      total_diamonds: rows.reduce((s, r) => s + (r.total_diamonds || 0), 0),
      items: rows
    });
  }

  /*
   * 撤销补录：DELETE /api/gifts/manual/<id>
   * 只允许删 source='manual' 的行（防止手滑把真实礼物删掉）
   */
  const mDel = pathname.match(/^\/api\/gifts\/manual\/(\d+)$/);
  if (mDel && req.method === 'DELETE') {
    const id = Number(mDel[1]);
    const row = dbInstance.prepare('SELECT id, session_id, source FROM gifts WHERE id = ?').get(id);
    if (!row) return sendError(res, '记录不存在', 404);
    if (row.source !== 'manual') {
      return sendError(res, '这条不是补录记录（source≠manual），拒绝删除', 400);
    }
    dbInstance.prepare('DELETE FROM gifts WHERE id = ?').run(id);
    await recompute(dbInstance, row.session_id);
    return sendJSON(res, { ok: true, id, session_id: row.session_id });
  }

  /*
   * 虚拟用户列表：GET /api/manual/users
   * 列出所有 manual:* 的虚拟身份 + 条数 + 总额 + 涉及场次，供"确认后合并"用
   */
  if (pathname === '/api/manual/users' && req.method === 'GET') {
    const rows = dbInstance
      .prepare(
        `SELECT user_sec_uid, MAX(nickname) nickname, COUNT(*) rows_n,
                SUM(total_diamonds) diamonds, COUNT(DISTINCT session_id) sessions
           FROM gifts
          WHERE source = 'manual' AND user_sec_uid LIKE 'manual:%'
          GROUP BY user_sec_uid
          ORDER BY diamonds DESC`
      )
      .all();
    return sendJSON(res, { users: rows });
  }

  /*
   * 合并：POST /api/manual/merge  { from: 'manual:小明', to: '<真实 sec_uid>' }
   *
   * 只改 user_sec_uid（搬记录），**不动金额** —— 所以合并前后
   * SUM(total_diamonds) 必须完全一致。幂等：from 已无记录时直接返回 ok。
   */
  if (pathname === '/api/manual/merge' && req.method === 'POST') {
    const body = (await bodyParse(req)) || {};
    const from = String(body.from || '').trim();
    const to = String(body.to || '').trim();
    if (!from || !to) return sendError(res, '缺少 from / to', 400);
    if (!from.startsWith(MANUAL_PREFIX)) return sendError(res, `from 必须是 ${MANUAL_PREFIX} 开头的虚拟 uid`, 400);
    if (to.startsWith(MANUAL_PREFIX)) return sendError(res, 'to 必须是真实用户 sec_uid', 400);

    // 哪些场次受影响（合并后要重算这几个场次）
    const sessions = dbInstance
      .prepare(
        `SELECT DISTINCT session_id FROM gifts
          WHERE user_sec_uid = ? AND source = 'manual'`
      )
      .all(from)
      .map((r) => r.session_id);

    if (!sessions.length) {
      return sendJSON(res, { ok: true, merged: 0, sessions: [], note: '没有需要合并的记录（可能已经合并过）' });
    }

    // 真实用户的昵称/头像，用来覆盖虚拟记录上的（可选，让画像页长得对）
    const target = dbInstance
      .prepare(
        `SELECT nickname, avatar, user_display_id FROM gifts
          WHERE user_sec_uid = ? AND IFNULL(nickname,'') <> ''
          ORDER BY LENGTH(nickname) DESC LIMIT 1`
      )
      .get(to);

    const tx = dbInstance.transaction(() => {
      const upd = dbInstance
        .prepare(
          `UPDATE gifts SET user_sec_uid = ?
            WHERE user_sec_uid = ? AND source = 'manual'`
        )
        .run(to, from);
      if (target && target.nickname) {
        dbInstance
          .prepare(
            `UPDATE gifts SET nickname = ?, avatar = COALESCE(?, avatar), user_display_id = COALESCE(?, user_display_id)
              WHERE user_sec_uid = ? AND source = 'manual'`
          )
          .run(target.nickname, target.avatar || null, target.user_display_id || null, to);
      }
      return upd.changes;
    });
    const merged = tx();

    for (const sid of sessions) await recompute(dbInstance, sid);
    return sendJSON(res, { ok: true, merged, sessions });
  }

  return false;
};

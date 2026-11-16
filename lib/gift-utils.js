/**
 * 礼物连击去重工具函数
 * 按 (uid, gift_name, 收礼人, **场次**) 四分组，识别连续连击序列，取每序列最高 combo_count 的帧
 */

/**
 * 连击去重：同一用户对同一收礼人送同一礼物的连续连击帧只保留最高 count 的一条
 *
 * 分组键里**必须带 session_id**（实测修正）：
 *   原来只用 (uid, gift_name, 收礼人) 三分组，跨场次合并同一粉丝给同一主播送同一礼物的记录。
 *   而序列切分规则里有一条 `cc < pc && cc > 1`（本意是处理"combo 4 比 3 先到"的帧序错乱），
 *   于是新场次从 1 重新计数时，只要首帧 combo_count > 1，就会被判成"同一段连击"而合并掉，
 *   整条礼物少算一帧。实测：全表去重比逐场次去重少 1,630 件礼物 / 106,701 钻石（约 0.057%），
 *   且 12,892 / 70,066 组（18%）是跨场次出现的 —— 影响面并不罕见。
 *   加上 session_id 后两种口径完全一致（实测 2,942,202 vs 2,942,190，差 12 条即期间新写入的行），
 *   总览页从此与场次列表/画像/详情（都按场次口径）自洽。
 *
 * 切段判据（相邻两帧，判是不是同一笔）：
 *   ⓪ 上一帧 repeat_end=1            → 切（上一笔已收尾；新的一笔起点件数不一定比上一笔小）
 *   ① combo_count 递增               → 同一笔
 *   ② combo_count 没变 + 当前帧终结  → 同一笔
 *   ③ combo_count 回落但没回到 1     → 同一笔（帧序错乱，如 3→2）
 *   ④ combo_count 没变 + 累计件数在涨 → 同一笔（一次发多件时序号停住不动，如 2→4）
 *   其余                             → 切
 * 每笔取 repeat_count 最大的帧（金额 = 单价 × 累计件数），同件数优先终结帧。
 *
 * 为什么要有 ⓪ 和 ④（实测）：
 *   ④ 修的是「一次发多件，combo_count 不涨」——场次387 微微/为你闪耀 原来 23 件，
 *     真实 20 件（9 + 11），多出来的 2 就是 2→2 那处被切出来的。
 *   ⓪ 修的是「新的一笔起点件数更大」——只把 combo 换成 repeat 不行：
 *     上一笔连到 9，下一笔一次发 11，件数 9→11 是涨，会被并成一笔，
 *     微微那笔就变成 12 件。唯一的信号是上一帧 repeat_end=1。
 *
 * ⚠ 调用方注意：**跨场次**查询必须在 SELECT 里带上 `session_id`，
 *   否则这里拿到的全是 undefined、分组退化成旧的跨场次合并（踩过一次：
 *   overview.js 的 SELECT 漏了这列，改完分组键数字却纹丝不动）。
 *   按单场次查询（WHERE session_id = ?）带不带都不影响结果。
 *
 * @param {Array} gifts 礼物列表
 * @returns {Array} 去重后的礼物列表
 */
function comboDedupGifts(gifts) {
  const rawGroups = {};
  for (const g of gifts) {
    const uid = g.user_display_id || g.nickname;
    const toKey = g.to_user_sec_uid || g.to_user_display_id || g.to_nickname || '';
    const key = (g.session_id ?? '') + '\x00' + uid + '\x00' + (g.gift_name || '') + '\x00' + toKey;
    if (!rawGroups[key]) rawGroups[key] = [];
    rawGroups[key].push(g);
  }
  const deduped = [];
  for (const [, items] of Object.entries(rawGroups)) {
    if (items.length === 1) { deduped.push(items[0]); continue; }
    items.sort((a, b) => (a.id || 0) - (b.id || 0));

    let seq = [items[0]];
    const sequences = [];
    for (let i = 1; i < items.length; i++) {
      const prev = seq[seq.length - 1];
      const curr = items[i];
      const pc = parseInt(String(prev.combo_count || 1), 10);
      const cc = parseInt(String(curr.combo_count || 1), 10);
      const pr = parseInt(String(prev.repeat_count || 1), 10);
      const cr = parseInt(String(curr.repeat_count || 1), 10);
      // ⓪ 上一帧是终结帧 → 上一笔收尾了，这一帧一定新起一笔
      // ① 连击递增 / ② 同值+终结帧 / ③ 回落但没回到 1（帧序错乱）/ ④ 同值但件数在涨（一次发多件）
      if (prev.repeat_end === 1) {
        sequences.push(seq);
        seq = [curr];
      } else if (cc > pc || (cc === pc && curr.repeat_end === 1) || (cc < pc && cc > 1)
        || (cc === pc && cr > pr)) {
        seq.push(curr);
      } else {
        sequences.push(seq);
        seq = [curr];
      }
    }
    sequences.push(seq);

    for (const s of sequences) {
      if (s.length === 1) {
        deduped.push(s[0]);
      } else {
        // 取累计件数最大的一帧：成组帧序号低但件数高，按序号取会拿到中间那个件数
        s.sort((a, b) => {
          const ac = parseInt(String(a.repeat_count || 1), 10);
          const bc = parseInt(String(b.repeat_count || 1), 10);
          if (bc !== ac) return bc - ac;
          return (b.repeat_end === 1 ? 1 : 0) - (a.repeat_end === 1 ? 1 : 0);
        });
        deduped.push(s[0]);
      }
    }
  }
  return deduped;
}

/**
 * 礼物名 → 图标 URL 的查表函数（带缓存，10 分钟过期）。
 *
 * 为什么要全表扫而不是从"当前用户那几条礼物"里取：
 * 图标写在每条礼物行自带的 icon 字段里，**同一个礼物名有一部分行的 icon 是空的**
 * （实测「钻石跑车」206/288 行有值、「玫瑰星瀚」443/552、「定制跑车」54/154）。
 * 只看当前用户去重后的那几条，恰好挑中空行就永远显示不出图标 ——
 * 用户反馈的「钻石跑车在馈赠明细里没有图标」就是这么来的
 * （而且 gift_icons 名称表里根本没有「钻石跑车」这个名字，兜底也兜不住）。
 *
 * 全表 GROUP BY 实测约 1s、675 个名字，所以缓存住；期间新礼物类型出现时
 * 最多 10 分钟内显示占位图标，过期后自动重建。
 *
 * @param {object} db better-sqlite3 实例
 * @param {number} ttlMs 缓存有效期
 * @returns {(name: string) => (string|null)} 传礼物名，返回图标 URL 或 null
 */
function getGiftIconLookup(db, ttlMs = 10 * 60 * 1000) {
  let map = null;
  let builtAt = 0;
  return function lookupIcon(name) {
    if (!name) return null;
    const now = Date.now();
    if (!map || now - builtAt > ttlMs) {
      const next = new Map();
      try {
        const rows = db
          .prepare(
            "SELECT gift_name, MAX(icon) AS icon FROM gifts WHERE icon IS NOT NULL AND icon != '' GROUP BY gift_name"
          )
          .all();
        for (const r of rows) if (r.gift_name && r.icon) next.set(r.gift_name, r.icon);
      } catch (e) {
        // 表结构异常时不让接口挂掉，退化成"没有图标"（前端会显示通用礼物图标）
      }
      map = next;
      builtAt = now;
    }
    return map.get(name) || null;
  };
}

module.exports = { comboDedupGifts, getGiftIconLookup };

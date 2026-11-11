/**
 * 主播 uid 规范化（2026-11-11 实地排查得出）
 *
 * 抖音的 user id 是 64 位整数，很多是 19 位（如 7450866781424895034）。
 * JS 的 number 只能精确到 2^53，**用 number 解析会丢末位**：
 *   团员榜实测：id = 7450866781424895000（数字，已被舍入）
 *              id_str = 7450866781424895034（字符串，真实值）
 * 同一个人的 id 在不同请求/不同进程（Go 代理 int64、JS、前端）里，
 * 只要中间用过 number，末几位就可能不一样 —— 表现出来就是"uid 会变化"。
 *
 * 所以：**任何地方取 uid 都必须优先用字符串字段（id_str / user_id_str）**，
 * number 只作为最后兜底，并且超过安全整数时给出告警。
 */

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function warnUnsafe(value) {
  console.warn(
    '[upstage] uid 以 number 形式出现且超过 2^53，末位可能已被舍入：' +
      value +
      '（请让上游改传 id_str / 字符串）'
  );
}

/**
 * 从一个"用户对象"里取 uid：优先 id_str / user_id_str / uid_str，最后才用数字。
 * @param {object} o
 * @returns {string}
 */
function asUid(o) {
  if (o === null || o === undefined) return '';
  if (typeof o === 'string') return o.trim();
  if (typeof o === 'number') {
    if (!Number.isSafeInteger(o)) warnUnsafe(o);
    return String(o);
  }
  const candidates = [
    o.id_str,
    o.user_id_str,
    o.uid_str,
    o.webcast_uid,
    o.user_id,
    o.uid,
    o.id,
    o.user_open_id
  ];
  for (const v of candidates) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'number') {
      if (!Number.isSafeInteger(v)) warnUnsafe(v);
      return String(v);
    }
    return String(v).trim();
  }
  return '';
}

/** 直接的 uid 值（外部 POST /api/upstage/frames 可能给数字或字符串） */
function normalizeUid(u) {
  return asUid(u);
}

module.exports = { asUid, normalizeUid, MAX_SAFE };

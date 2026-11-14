/**
 * 「这个人该怎么显示」的唯一判定处。
 *
 * ## 为什么需要这个文件
 *
 * 抖音对"未登录 / 被隐藏"的用户给两样东西：
 *   1. 昵称 → `神秘人123456`，或者打码成 `神***`
 *   2. 头像 → `.../img/webcast/m...` 这种**匿名占位图**
 *
 * 同一个人可能**先匿名送过礼、后来用真名送礼**。汇总时如果按"贡献最大的那条"挑，
 * 就会挑到匿名那条 —— 于是出现「真名 + 神秘人头像」这种错配。
 *
 * 这套判定原来在 5 个文件里各写一遍（overview / live-aggregates / users /
 * session-gift-details / sessions），改了 2 处、漏了 3 处，同一个 bug 又冒出来。
 * 所以收口到这里：**判定只写一次，别处只调用**。
 */

/** 昵称是否是匿名/打码名（神秘人123456、神***、空） */
function isAnonymousName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return true;
  return /^(神秘人|神\*+)/.test(n);
}

/**
 * 头像分三档（2026-11-14 修正：mosaic 不是"坏头像"，是**抖音默认头像**）
 *
 *   0 真头像        —— 用户自己设的
 *   1 默认头像      —— `mosaic-legacy_*`：用户没设头像时抖音下发的默认图，**应该正常显示**
 *   2 匿名占位图    —— `/img/webcast/…`、`mystery_man`：被隐藏身份的人，显示它等于泄露/错配
 *   9 没有头像
 *
 * 上一版把 mosaic 也当占位图，结果"没设头像的正常用户"头像位置被换成了昵称首字
 * （用户截图：60705261974 用的是抖音默认头像，却显示成 "6"）。
 */
function avatarRank(url) {
  if (!url) return 9;
  const s = String(url);
  if (s.includes('/img/webcast/') || s.includes('mystery_man')) return 2;
  if (s.includes('mosaic-legacy')) return 1;
  return 0;
}

/** 旧的语义保留：只有"匿名占位图"才算不可展示 */
function isPlaceholderAvatar(url) {
  return avatarRank(url) === 2;
}

/** 抖音默认头像（没设头像的人） */
function isDefaultAvatar(url) {
  return avatarRank(url) === 1;
}

/** a 是否比 b 更适合展示 */
function isBetterAvatar(a, b) {
  return avatarRank(a) < avatarRank(b);
}

/**
 * 从"同一个人的多条记录"里挑出要显示的昵称与头像。
 *
 * @param {{nickname?: string, avatar_url?: string, avatar?: string}[]} rows
 * @returns {{nickname: string, avatar_url: string|null}}
 */
function pickDisplayUser(rows) {
  let anonName = '';
  let anonAvatar = '';
  let realName = '';
  let realAvatar = '';
  /** 只接受 rank<2 的头像，并取最优的那张 */
  const takeAvatar = (cur, next) => {
    if (!next || avatarRank(next) >= 2) return cur;
    return !cur || isBetterAvatar(next, cur) ? next : cur;
  };
  for (const r of rows || []) {
    if (!r) continue;
    const name = String(r.nickname || '');
    const avatar = r.avatar_url || r.avatar || '';
    if (isAnonymousName(name)) {
      if (!anonName && name) anonName = name;
      anonAvatar = takeAvatar(anonAvatar, avatar);
    } else {
      if (!realName) realName = name;
      // 真名那条的头像才可信（默认头像也接受，匿名占位图丢弃）
      realAvatar = takeAvatar(realAvatar, avatar);
    }
  }
  return {
    nickname: realName || anonName,
    avatar_url: realAvatar || anonAvatar || null
  };
}

module.exports = { isAnonymousName, isPlaceholderAvatar, isDefaultAvatar, isBetterAvatar, avatarRank, pickDisplayUser };

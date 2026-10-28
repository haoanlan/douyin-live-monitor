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

/** 头像是否是抖音的匿名占位图 */
function isPlaceholderAvatar(url) {
  if (!url) return false;
  return String(url).includes('/img/webcast/m');
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
  for (const r of rows || []) {
    if (!r) continue;
    const name = String(r.nickname || '');
    const avatar = r.avatar_url || r.avatar || '';
    if (isAnonymousName(name)) {
      if (!anonName && name) anonName = name;
      if (!anonAvatar && avatar) anonAvatar = avatar;
    } else {
      if (!realName) realName = name;
      // 真名那条的头像才可信；占位图直接忽略
      if (avatar && !isPlaceholderAvatar(avatar) && !realAvatar) realAvatar = avatar;
    }
  }
  return {
    nickname: realName || anonName,
    avatar_url: realAvatar || (isPlaceholderAvatar(anonAvatar) ? anonAvatar : anonAvatar) || null
  };
}

module.exports = { isAnonymousName, isPlaceholderAvatar, pickDisplayUser };

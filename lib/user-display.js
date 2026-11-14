/**
 * 「这个人该怎么显示」的唯一判定处。
 *
 * ## 2026-11-14 重要修正（用户多次强调）
 *
 * **头像不需要按 URL 去"识别占位图"、也不需要隐藏任何一种。**
 * 抖音的每条消息（弹幕/礼物/进场）本来就带着该用户的昵称和头像，
 * 我们该做的是**照原样显示**这条记录带的头像：
 *
 *   · mosaic-legacy_*        —— 用户没设头像时抖音给的默认头像 → 正常显示
 *   · /img/webcast/…         —— 神秘人（隐身份）的默认头像 → 也是它真实下发的图，正常显示
 *
 * 之前的版本按 URL 把这些图判成"占位图"并替换成昵称首字，属于我们自己造的规则，
 * 结果正常用户（没设头像）显示成首字 —— 那是错的。
 *
 * 唯一要处理的是**聚合时的配对问题**：同一个人可能既有匿名记录又有真名记录，
 * 汇总时昵称取了真名那条、头像却取了匿名那条，就会出现"真名 + 神秘人头像"的错配。
 * 正确做法是：**昵称和头像来自同一条记录**；该条没有头像时才用同一个人的其它记录补。
 */

/** 昵称是否是匿名/打码名（神秘人123456、神***）。仅用于文案展示与配对，不再用来决定头像去留 */
function isAnonymousName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return true;
  return /^(神秘人|神\*+)/.test(n);
}

/**
 * 保留函数名（多处 import），但语义已改：**任何 URL 都不再视为"不可展示"**。
 * 只有"没有头像"才返回 false（即：有 URL 就返回 false）。
 */
function isPlaceholderAvatar() {
  return false;
}

/** 抖音默认头像（没设头像时下发）—— 只用来做聚合时的优先级，不再用于隐藏 */
function isDefaultAvatar(url) {
  return String(url || '').includes('mosaic-legacy');
}

/** 有头像就一样好；没有才差。返回 true 表示 a 更适合展示（仅"有 > 无"） */
function isBetterAvatar(a, b) {
  return Boolean(a) && !b;
}

/** 0 = 有头像，9 = 没有（保留三档 API 的形状，避免调用方大改） */
function avatarRank(url) {
  return url ? 0 : 9;
}

/**
 * 从"同一个人的多条记录"里挑出要显示的昵称与头像。
 *
 * 规则：昵称优先真名那条；**头像跟着昵称走**（同一条记录），
 * 只有那条没有头像时才用同一个人的其它记录补一张。
 *
 * @param {{nickname?: string, avatar_url?: string, avatar?: string}[]} rows
 * @returns {{nickname: string, avatar_url: string|null}}
 */
function pickDisplayUser(rows) {
  /*
   * 铁律（用户明确要求）：**每个人一定有头像**，永远给一张，绝不置空。
   *
   * 配对规则：
   *   · 显示真名时，优先用"真名那条记录"的头像（S + S 的头像）；
   *   · 真名那条没带头像、或者这人只出现过神秘人 → 就用它名下的任意一张头像
   *     （神秘人头像也是抖音真实下发的图，可以显示）；
   *   · 完全不按 URL 判断"该不该显示"。
   */
  let anonName = '';
  let anonAvatar = '';
  let realName = '';
  let realAvatar = '';
  let anyAvatar = '';
  for (const r of rows || []) {
    if (!r) continue;
    const name = String(r.nickname || '');
    const avatar = String(r.avatar_url || r.avatar || '');
    if (avatar && !anyAvatar) anyAvatar = avatar;
    if (isAnonymousName(name)) {
      if (!anonName && name) anonName = name;
      if (!anonAvatar && avatar) anonAvatar = avatar;
    } else {
      if (!realName) realName = name;
      if (!realAvatar && avatar) realAvatar = avatar;
    }
  }
  return {
    nickname: realName || anonName,
    // 真名头像 > 匿名头像 > 任何一张 > null
    avatar_url: realAvatar || anonAvatar || anyAvatar || null
  };
}

module.exports = {
  isAnonymousName,
  isPlaceholderAvatar,
  isDefaultAvatar,
  isBetterAvatar,
  avatarRank,
  pickDisplayUser
};

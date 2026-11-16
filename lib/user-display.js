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

/**
 * 昵称是不是匿名/占位名。
 *
 * 这是**后端唯一的判定**，用来决定"该显示哪一条记录"：
 *   · 神秘人123456 / 神***   —— 隐藏身份的默认名
 *   · dou1234567             —— 未登录/数字号
 *   · user1234 / 用户123456   —— 同上
 * 判出来的结果只决定"选哪条记录"，不决定头像显不显示。
 */
function isAnonymousName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return true;
  if (/^(神秘人|神\*+)/.test(n)) return true;
  if (/^(dou|user)\d{3,}$/i.test(n)) return true;
  if (/^用户\d{3,}$/.test(n)) return true;
  return false;
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
 * 唯一规则（用户 2026-11-16 确认）：
 *   **名字和头像是一对，来自同一条记录 —— 显示谁的名字，就用那条记录自己的头像。**
 *   · 有真名记录 → 用那条记录的「真名 + 它的头像」；
 *   · 只有匿名记录（比如他自己改名成神秘人）→ 用那条的「匿名名 + 它的头像」；
 *   · 被选中的那条没带头像 → 头像留空，**绝不拿别的记录的图来配**。
 *
 * 匿名判定用 isAnonymousName（后端逻辑保留），只用来决定"选哪一条"，不用来隐藏头像。
 *
 * @param {{nickname?: string, avatar_url?: string, avatar?: string}[]} rows
 * @returns {{nickname: string, avatar_url: string|null}}
 */
function pickDisplayUser(rows) {
  const list = (rows || []).filter((r) => r && String(r.nickname || '').trim());
  const avatarOf = (r) => String(r.avatar_url || r.avatar || '') || null;

  /*
   * 从"同一类记录"里取一对：名字用这一组的第一条，
   * 头像优先用这一条自己的；这一条没头像时，在本组内兜一张。
   * 兜底只在组内进行 —— 真名组没有头像就留空，绝不跨到匿名组去借。
   */
  const pickFrom = (group) => {
    if (!group.length) return null;
    const head = group[0];
    const avatar = avatarOf(head) || group.map(avatarOf).find(Boolean) || null;
    return { nickname: String(head.nickname).trim(), avatar_url: avatar };
  };

  const realRows = list.filter((r) => !isAnonymousName(r.nickname));
  const anonRows = list.filter((r) => isAnonymousName(r.nickname));

  const picked = pickFrom(realRows) || pickFrom(anonRows) || { nickname: '', avatar_url: null };

  /*
   * 最后兜底（用户 2026-11-16 要求）：
   *   · 真名 + **官方神秘人图**（`/img/webcast/…`）→ 置空，让前端显示昵称首字
   *     （真名配神秘人图不符合逻辑）；
   *   · 真名 + 抖音默认头像（mosaic-legacy）→ **保留**，这是正常用户的头像，
   *     之前把它也判成"不可显示"、一律显示首字，属于误伤；
   *   · 匿名名（神秘人/dou/用户…）→ 它自己的图原样保留，包括官方神秘人图。
   */
  if (picked.avatar_url && realRows.length && /\/img\/webcast\//i.test(picked.avatar_url)) {
    picked.avatar_url = null;
  }
  return picked;
}

module.exports = {
  isAnonymousName,
  isPlaceholderAvatar,
  isDefaultAvatar,
  isBetterAvatar,
  avatarRank,
  pickDisplayUser
};

/**
 * 聚合缓存的失效入口（"改完数据顺手把别人的缓存清掉"）。
 *
 * 背景（2026-11-11 自检）：
 *   · /api/overview 有 5 分钟进程内缓存（CACHE_TTL=300000），过期才重算；
 *   · 但只有「补录礼物」会清它 —— 改礼物价、删场次之后，总览上的钻石/场次
 *     最多要等 5 分钟才变，用户会以为没生效。
 *
 * 这里集中提供 bustOverview()，写操作调用即可。失败不影响主流程（缓存清不掉
 * 最多是旧数据多看几分钟，不能因为清理失败让写操作也失败）。
 */
function bustOverview() {
  try {
    const ov = require('./routes/overview');
    if (typeof ov.clearCache === 'function') ov.clearCache();
  } catch (e) {
    console.warn('[cache] 清 overview 缓存失败（不影响写入）:', e.message);
  }
}

module.exports = { bustOverview };

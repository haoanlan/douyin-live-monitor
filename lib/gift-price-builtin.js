/**
 * 内置礼物单价表（代码兜底）。
 *
 * 原来这张表硬编码在 lib/worker/message-handler.js 里，页面改不了、改一个新礼物就要发版。
 * 现在抽出来，供两处使用：
 *   · lib/worker/message-handler.js —— 采集时兜底
 *   · lib/routes/gift-prices.js    —— 页面上显示"内置价"，方便和库里的实际值对比
 *
 * 优先级（采集时，从低到高）：
 *   消息里的 gift.diamondCount  <  工坊宝箱融合计价  <  本表  <  数据库覆盖表
 *
 * 所以这里只放"抖音消息里价格不可信"的那批礼物。想改价格请用页面（写数据库覆盖表），
 * 不要改这个文件——改了要发版，而页面改完立刻生效。
 */

const GIFT_PRICE_MAP = {
  '闪烁星河': 99, '点点星光': 9, '星光闪耀': 9, '闪耀星辰': 99,
  '钻石跑车': 1500, '豪华跑车': 1200, '钻石兔兔': 360, '钻石热气球': 620,
  '钻石火箭': 12001, '钻石飞艇': 23333, '烈焰跑车': 6000, '至尊超跑': 12000,
  '御风飞机': 9000, '钻石邮轮': 7200,
  '青绿典藏版嘉年华': 36000, '凌霄战机': 18000,
  '无界超跑': 36000, '星际战舰': 36000,
};

/** 取内置价；没有则 undefined（注意 0 是合法价格，不要用 !map[name] 判断） */
function getBuiltinPrice(giftName) {
  if (!giftName) return undefined;
  return Object.prototype.hasOwnProperty.call(GIFT_PRICE_MAP, giftName)
    ? GIFT_PRICE_MAP[giftName]
    : undefined;
}

module.exports = { GIFT_PRICE_MAP, getBuiltinPrice };

/**
 * comboDedupGifts 连击去重逻辑测试
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { comboDedupGifts } = require('../lib/gift-utils');

describe('comboDedupGifts', () => {
  test('空数组返回空数组', () => {
    assert.deepStrictEqual(comboDedupGifts([]), []);
  });

  test('单条礼物直接返回', () => {
    const gifts = [{ id: 1, user_display_id: 'u1', gift_name: '玫瑰', combo_count: 1 }];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 1);
  });

  test('不同用户/礼物/收礼人不去重', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 2, user_display_id: 'u2', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 3, user_display_id: 'u1', gift_name: '嘉年华', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 4, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'b', combo_count: 1 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 4);
  });

  test('同组连击递增只保留最高帧', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 2, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 2 },
      { id: 3, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 3 },
      { id: 4, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 5, repeat_end: 1 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].combo_count, 5);
    assert.strictEqual(result[0].repeat_end, 1);
  });

  test('连击终结帧同值时保留 repeat_end=1 的帧', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 3 },
      { id: 2, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 3, repeat_end: 1 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 2);
    assert.strictEqual(result[0].repeat_end, 1);
  });

  test('两组独立连击各保留最高帧', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 2, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 2, repeat_end: 1 },
      // 新序列开始
      { id: 3, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 1 },
      { id: 4, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 3, repeat_end: 1 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 2);
    // 第一组最高 combo_count=2
    assert.strictEqual(result[0].combo_count, 2);
    // 第二组最高 combo_count=3
    assert.strictEqual(result[1].combo_count, 3);
  });

  test('帧序错乱时取累计件数最高的一帧', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 3, repeat_count: 3 },
      { id: 2, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 2, repeat_count: 2 },
      { id: 3, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 5, repeat_count: 5 },
      { id: 4, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a', combo_count: 4, repeat_count: 4 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].repeat_count, 5);
  });

  test('fallback 到 nickname 当 user_display_id 缺失', () => {
    const gifts = [
      { id: 1, nickname: '用户A', gift_name: '玫瑰', to_nickname: '主播B', combo_count: 1 },
      { id: 2, nickname: '用户A', gift_name: '玫瑰', to_nickname: '主播B', combo_count: 2, repeat_end: 1 },
    ];
    const result = comboDedupGifts(gifts);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].combo_count, 2);
  });

  test('combo_count 缺失时默认为 1', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a' },
      { id: 2, user_display_id: 'u1', gift_name: '玫瑰', to_user_sec_uid: 'a' },
    ];
    const result = comboDedupGifts(gifts);
    // 两条 combo_count 都默认为 1，第二帧 cc === pc 且无 repeat_end，开新序列
    assert.strictEqual(result.length, 2);
  });
  // ---- 一次发多件：序号停在 2，件数从 2 涨到 4，不能切段（场次387 微微 的原始 bug） ----
  test('序号相等但累计件数在涨时不断段', () => {
    const mk = (id, cc, rc, end) => ({ id, user_display_id: 'u1', gift_name: '为你闪耀', to_user_sec_uid: 'a', combo_count: cc, repeat_count: rc, group_count: 1, repeat_end: end, diamond_count: 9, total_diamonds: rc * 9 });
    const gifts = [mk(1, 1, 1), mk(2, 2, 2), mk(3, 2, 4), mk(4, 5, 5), mk(5, 9, 9), mk(6, 9, 9, 1)];
    const r = comboDedupGifts(gifts);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].repeat_count, 9);
  });

  // ---- 上一笔收尾后，新的一笔起点件数可能更大（9 → 11）----
  test('上一帧是终结帧时新起一笔：9 件 + 11 件 = 20 件', () => {
    const mk = (id, cc, rc, end) => ({ id, user_display_id: 'u1', gift_name: '为你闪耀', to_user_sec_uid: 'a', combo_count: cc, repeat_count: rc, group_count: 1, repeat_end: end, diamond_count: 9, total_diamonds: rc * 9 });
    const gifts = [mk(1, 1, 1), mk(2, 2, 2), mk(3, 2, 4), mk(4, 9, 9), mk(5, 9, 9, 1), mk(6, 1, 11), mk(7, 1, 11, 1)];
    const r = comboDedupGifts(gifts);
    const cnt = r.reduce((s, x) => s + (x.repeat_count || 1), 0);
    assert.strictEqual(cnt, 20);
    assert.deepStrictEqual(r.map((x) => x.id), [5, 7]);
  });

  // ---- 场次153 610/加油鸭：三笔整批发 520 / 999 / 520 ----
  test('整批发按终结帧分开：520 + 999 + 520 = 2039', () => {
    const mk = (id, rc, end) => ({ id, user_display_id: 'u1', gift_name: '加油鸭', to_user_sec_uid: 'a', combo_count: 1, repeat_count: rc, group_count: rc, repeat_end: end, diamond_count: 15, total_diamonds: rc * 15 });
    const gifts = [mk(1, 520), mk(2, 520, 1), mk(3, 999), mk(4, 999, 1), mk(5, 520), mk(6, 520, 1)];
    const r = comboDedupGifts(gifts);
    const cnt = r.reduce((s, x) => s + (x.repeat_count || 1), 0);
    assert.strictEqual(cnt, 2039);
    assert.strictEqual(r.length, 3);
  });

  // ---- 取帧按件数，不按序号 ----
  test('段内取累计件数最大的帧（序号大不等于金额大）', () => {
    const gifts = [
      { id: 1, user_display_id: 'u1', gift_name: '星光闪耀', to_user_sec_uid: 'a', combo_count: 2, repeat_count: 2, diamond_count: 9, total_diamonds: 18 },
      { id: 2, user_display_id: 'u1', gift_name: '星光闪耀', to_user_sec_uid: 'a', combo_count: 3, repeat_count: 12, group_count: 10, diamond_count: 9, total_diamonds: 108 },
    ];
    const r = comboDedupGifts(gifts);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].id, 2);
    assert.strictEqual(r[0].repeat_count, 12);
  });

  // ---- 连击中途 combo 被抖音重置回 1，但件数仍在涨：同一条连击，不能切段 ----
  // 真实数据：场次451 硅基生物/为你闪耀 1→4→7→10(combo 3)→21(combo 归 1)→21 收尾
  // 旧逻辑切成 10 + 21 = 31，实际 21。
  test('combo 回落到 1 但累计件数在涨：不切段（10 + 21 不该变成 31）', () => {
    const mk = (id, cc, rc, end) => ({ id, user_display_id: 'u1', gift_name: '为你闪耀',
      to_user_sec_uid: 'a', combo_count: cc, repeat_count: rc, repeat_end: end,
      diamond_count: 9, total_diamonds: rc * 9 });
    const gifts = [mk(1,1,1), mk(2,1,4), mk(3,2,7), mk(4,3,10), mk(5,1,21), mk(6,1,21,1)];
    const r = comboDedupGifts(gifts);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].repeat_count, 21);
    assert.strictEqual(r[0].total_diamonds, 189);
  });

  // ---- 反向保护：真正的新一笔，件数从 1 重新开始，必须照切 ----
  test('新一笔件数从 1 重新计数时必须切段', () => {
    const mk = (id, cc, rc, end) => ({ id, user_display_id: 'u1', gift_name: '玫瑰',
      to_user_sec_uid: 'a', combo_count: cc, repeat_count: rc, repeat_end: end });
    const gifts = [mk(1,3,10,1), mk(2,1,1), mk(3,2,5,1)];
    const r = comboDedupGifts(gifts);
    assert.strictEqual(r.reduce((s,x) => s + (x.repeat_count||1), 0), 15);
    assert.strictEqual(r.length, 2);
  });

});

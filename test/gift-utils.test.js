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


  // ============ ③④ 用 repeat !== group 判「是不是新的一笔」 ============

  // 真实数据：456 场「欲书花叶寄朝云 / 星光营地」
  //   15:24  rep=1 combo=1 group=1  d=1699
  //   18:40  rep=2 combo=1 group=2  d=3398   ← 隔 3.5 小时，新的一笔
  // 旧逻辑（cr > pr）会并成一笔只取 3398，少算 1699
  test('隔几小时的同礼物再送：repeat === group → 两笔（1699 + 3398 不是 3398）', () => {
    const mk = (id, rc, gc, d) => ({ id, user_display_id: 'u1', gift_name: '星光营地',
      to_user_sec_uid: 'a', combo_count: 1, repeat_count: rc, group_count: gc,
      repeat_end: null, total_diamonds: d });
    const gifts = [mk(1, 1, 1, 1699), mk(2, 2, 2, 3398)];
    const r = comboDedupGifts(gifts);
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r.reduce((s, x) => s + x.total_diamonds, 0), 5097);
  });

  // 真实数据：456 场「dou8172221 / 为你举牌」12 帧全是 rep=1 combo=1 group=1，
  // 间隔 109~862 秒。旧逻辑并成一笔只留 199，实际 12 × 199 = 2388
  test('12 帧 repeat=1 group=1 的独立送礼：每一帧都切开（12 × 199）', () => {
    const gifts = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, user_display_id: 'u2', gift_name: '为你举牌', to_user_sec_uid: 'a',
      combo_count: 1, repeat_count: 1, group_count: 1, repeat_end: null,
      diamond_count: 199, total_diamonds: 199,
    }));
    const r = comboDedupGifts(gifts);
    assert.strictEqual(r.length, 12);
    assert.strictEqual(r.reduce((s, x) => s + x.total_diamonds, 0), 2388);
  });

  // 真实数据：451 场 硅基生物 / 为你闪耀 —— group 中途从 3 变 11
  //   rep=1 g=1 → rep=4 g=3 → rep=7 g=3 → rep=10 g=3 → rep=21 g=11 → rep=21 g=11 end
  // repeat !== group 全程成立，是同一笔 21 件
  test('连击中途 group 变化（3→11）仍是同一笔：21 件不是 10+21', () => {
    const mk = (id, cc, rc, gc, end) => ({ id, user_display_id: 'u1', gift_name: '为你闪耀',
      to_user_sec_uid: 'a', combo_count: cc, repeat_count: rc, group_count: gc,
      repeat_end: end, diamond_count: 9, total_diamonds: rc * 9 });
    const gifts = [mk(1,1,1,1), mk(2,1,4,3), mk(3,2,7,3), mk(4,3,10,3), mk(5,1,21,11), mk(6,1,21,11,1)];
    const r = comboDedupGifts(gifts);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].repeat_count, 21);
  });

  // 防误切：长连击里累计件数恰好等于新的 group 值，但 combo 在涨（① 先命中）
  // rep=10 g=3 → rep=11 g=11（combo 2→3）：cc > pc 必须优先判同一笔
  test('累计件数恰好等于新 group 但 combo 在涨：combo 递增优先，仍是同一笔', () => {
    const mk = (id, cc, rc, gc) => ({ id, user_display_id: 'u1', gift_name: '小心心',
      to_user_sec_uid: 'a', combo_count: cc, repeat_count: rc, group_count: gc });
    const gifts = [mk(1, 1, 10, 3), mk(2, 2, 11, 11)];
    const r = comboDedupGifts(gifts);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].repeat_count, 11);
  });

  // 上一帧 repeat_end=1 是硬切分信号，优先于所有组合判据
  test('上一帧终结帧：即使 repeat !== group 也要切', () => {
    const mk = (id, rc, gc, end) => ({ id, user_display_id: 'u1', gift_name: '玫瑰',
      to_user_sec_uid: 'a', combo_count: 1, repeat_count: rc, group_count: gc, repeat_end: end });
    const gifts = [mk(1, 10, 3, 1), mk(2, 12, 3, null)];
    const r = comboDedupGifts(gifts);
    assert.strictEqual(r.length, 2);
  });

});

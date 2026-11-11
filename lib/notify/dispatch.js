/**
 * 按事件把消息分发到所有启用的规则 / 渠道。
 *
 * worker（开播/下播/上场）和路由（测试）都走这里，保证：
 *   · 免打扰时段统一判断
 *   · 每条发送结果都写进 notify_logs（排查"为什么没收到"）
 */
const store = require('./store');
const { sendToChannel } = require('./sender');

/** "HH:MM" → 分钟数 */
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 当前是否在免打扰时段（支持跨零点，如 23:00–08:00） */
function inQuietHours(quiet, date = new Date()) {
  if (!quiet?.start || !quiet?.end) return false;
  const s = toMinutes(quiet.start);
  const e = toMinutes(quiet.end);
  if (s == null || e == null || s === e) return false;
  const cur = date.getHours() * 60 + date.getMinutes();
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/**
 * @param {object} db
 * @param {string} event live_start | live_end_report | anchor_on_stage | ...
 * @param {{title?:string,text?:string}} payload
 * @param {{roomId?:string}} [opts]
 * @returns {Promise<{sent:number,failed:number,skipped:number}>}
 */
async function dispatch(db, event, payload, opts = {}) {
  /*
   * 规则按账号隔离存储，但通知是**全局事件**：开播了要把每个账号自己配的规则都跑一遍，
   * 各发各的渠道（channel_ids 保存时已校验过属于该账号）。
   */
  const rules = store.listAllRules(db).filter((r) => r.event === event && r.enabled);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const rule of rules) {
    /*
     * 规则限定房间时只推对应房间。
     *
     * 原来的判断是「有 room_id 且调用方传了 roomId 且不一致」才跳过 —— 一旦调用方
     * 没传 roomId（以后新增的事件、手工触发等），限定房间的规则就会对所有房间发出，
     * 等于「我不想通知的直播间」照样收到。现在反过来：规则限了房间，房间对不上
     * （包括没传）就跳过。
     */
    if (rule.room_id) {
      // room_id 现在可以是逗号分隔的多个房间（通知规则里多选直播间）
      const targets = String(rule.room_id).split(',').filter(Boolean);
      if (!targets.includes(String(opts.roomId || ''))) continue;
    }
    /*
     * 「关注的人」：规则里勾了人，就只在这些人的事件上发。
     * watch_uids 为空 = 这个房间谁上场都提醒（和直播间为空 = 所有房间 一致）。
     */
    {
      const watchUids = Array.isArray(rule.conditions?.watch_uids) ? rule.conditions.watch_uids : [];
      if (watchUids.length && !watchUids.map(String).includes(String(opts.uid || ''))) continue;
    }
    if (inQuietHours(rule.quiet_hours)) {
      store.addLog(db, {
        owner: rule.owner || '',
        rule_id: rule.id,
        event,
        channel_name: '-',
        payload: JSON.stringify(payload).slice(0, 2000),
        status: 'skipped',
        error: '免打扰时段'
      });
      skipped++;
      continue;
    }
    for (const cid of rule.channel_ids) {
      const channel = store.getChannel(db, cid);
      if (!channel || !channel.enabled) {
        skipped++;
        continue;
      }
      const r = await sendToChannel(channel, { ...payload, event });
      store.addLog(db, {
        owner: rule.owner || '',
        rule_id: rule.id,
        event,
        channel_id: channel.id,
        channel_name: channel.name,
        payload: JSON.stringify(payload).slice(0, 2000),
        status: r.ok ? 'sent' : 'failed',
        error: r.error
      });
      if (r.ok) sent++;
      else failed++;
    }
  }

  return { sent, failed, skipped };
}

module.exports = { dispatch, inQuietHours };

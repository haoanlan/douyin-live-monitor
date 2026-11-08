/**
 * 通知管理路由。
 *
 * 页面四块：事件规则 / 推送渠道 / 消息模板 / 发送记录。
 * 这里只做 HTTP；真正的发送在 lib/notify/sender.js，
 * 后续「开播通知」「下播战报」由 worker 直接调 store + sender，不经过 HTTP。
 */
const authGuard = require('../auth-guard');
const store = require('../notify/store');
const { sendToChannel } = require('../notify/sender');

/** 目前支持的事件（前端下拉用，后续按需求文档扩充） */
const EVENT_CATALOG = [
  { key: 'live_start', label: '开播通知', group: '直播' },
  { key: 'live_end_report', label: '下播战报', group: '直播' },
  { key: 'anchor_on_stage', label: '主播上场', group: '直播' },
  { key: 'live_offline', label: '断播告警', group: '异常' },
  { key: 'online_drop', label: '在线骤降', group: '异常' },
  { key: 'diamond_burst', label: '钻石爆发', group: '异常' },
  { key: 'keyword_hit', label: '关键词命中', group: '异常' }
];

const CHANNEL_TYPES = [
  { key: 'wecom', label: '企业微信机器人', hint: '填 Webhook 完整地址，或只填 key' },
  { key: 'feishu', label: '飞书机器人', hint: '填 Webhook 完整地址，或只填 hook id' },
  { key: 'dingtalk', label: '钉钉机器人', hint: '填 Webhook 完整地址，或只填 access_token' },
  { key: 'webhook', label: '自定义 Webhook', hint: 'POST JSON：{ title, text }' }
];

function ok(res, sendJSON, data) {
  return sendJSON(res, data);
}

module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse } = ctx;
  if (!pathname.startsWith('/api/notify')) return false;

  store.ensure(dbInstance);

  // ---- 元数据：可选事件 / 渠道类型 ----
  if (pathname === '/api/notify/meta' && req.method === 'GET') {
    if (!authGuard.currentUser(req, dbInstance)) return sendError(res, '未登录', 401);
    return ok(res, sendJSON, { events: EVENT_CATALOG, channelTypes: CHANNEL_TYPES });
  }

  // ---- 渠道 ----
  if (pathname === '/api/notify/channels' && req.method === 'GET') {
    if (!authGuard.currentUser(req, dbInstance)) return sendError(res, '未登录', 401);
    return ok(res, sendJSON, { items: store.listChannels(dbInstance) });
  }

  if (pathname === '/api/notify/channels' && req.method === 'POST') {
    if (!authGuard.requireAction(req, res, dbInstance, sendError, 'notify.manage')) return true;
    const body = await bodyParse(req);
    if (!body?.name || !body?.type) return sendError(res, '名称和类型必填', 400);
    const id = store.saveChannel(dbInstance, body);
    return ok(res, sendJSON, { id, items: store.listChannels(dbInstance) });
  }

  if (pathname === '/api/notify/channels/delete' && req.method === 'POST') {
    if (!authGuard.requireAction(req, res, dbInstance, sendError, 'notify.manage')) return true;
    const body = await bodyParse(req);
    if (!body?.id) return sendError(res, '缺少 id', 400);
    store.deleteChannel(dbInstance, body.id);
    return ok(res, sendJSON, { items: store.listChannels(dbInstance) });
  }

  /**
   * 测试发送：可以直接传 { type, config } 试（不必先保存），
   * 也可以传 { id } 试已保存的渠道 —— 后者会写一条发送记录。
   */
  if (pathname === '/api/notify/channels/test' && req.method === 'POST') {
    if (!authGuard.requireAction(req, res, dbInstance, sendError, 'notify.test')) return true;
    const body = (await bodyParse(req)) || {};
    const channel = body.id ? store.getChannel(dbInstance, body.id) : { type: body.type, config: body.config };
    if (!channel) return sendError(res, '渠道不存在', 404);
    const payload = {
      title: body.title || '【测试】抖音直播监控',
      text: body.text || `这是一条测试消息，收到即说明渠道可用。\n时间：${new Date().toLocaleString('zh-CN')}`
    };
    const r = await sendToChannel(channel, payload);
    store.addLog(dbInstance, {
      event: 'test',
      channel_id: channel.id || null,
      channel_name: channel.name || channel.type,
      payload: JSON.stringify(payload).slice(0, 2000),
      status: r.ok ? 'sent' : 'failed',
      error: r.error
    });
    return ok(res, sendJSON, r);
  }

  // ---- 规则 ----
  if (pathname === '/api/notify/rules' && req.method === 'GET') {
    if (!authGuard.currentUser(req, dbInstance)) return sendError(res, '未登录', 401);
    return ok(res, sendJSON, { items: store.listRules(dbInstance) });
  }

  if (pathname === '/api/notify/rules' && req.method === 'POST') {
    if (!authGuard.requireAction(req, res, dbInstance, sendError, 'notify.manage')) return true;
    const body = await bodyParse(req);
    if (!body?.event) return sendError(res, '事件类型必填', 400);
    if (!Array.isArray(body.channel_ids) || !body.channel_ids.length) {
      return sendError(res, '至少选择一个推送渠道', 400);
    }
    const id = store.saveRule(dbInstance, body);
    return ok(res, sendJSON, { id, items: store.listRules(dbInstance) });
  }

  if (pathname === '/api/notify/rules/delete' && req.method === 'POST') {
    if (!authGuard.requireAction(req, res, dbInstance, sendError, 'notify.manage')) return true;
    const body = await bodyParse(req);
    if (!body?.id) return sendError(res, '缺少 id', 400);
    store.deleteRule(dbInstance, body.id);
    return ok(res, sendJSON, { items: store.listRules(dbInstance) });
  }

  // ---- 模板 ----
  if (pathname === '/api/notify/templates' && req.method === 'GET') {
    if (!authGuard.currentUser(req, dbInstance)) return sendError(res, '未登录', 401);
    return ok(res, sendJSON, { items: store.listTemplates(dbInstance) });
  }

  if (pathname === '/api/notify/templates' && req.method === 'POST') {
    if (!authGuard.requireAction(req, res, dbInstance, sendError, 'notify.manage')) return true;
    const body = await bodyParse(req);
    const id = store.saveTemplate(dbInstance, body || {});
    return ok(res, sendJSON, { id, items: store.listTemplates(dbInstance) });
  }

  // ---- 发送记录 ----
  if (pathname === '/api/notify/logs' && req.method === 'GET') {
    if (!authGuard.currentUser(req, dbInstance)) return sendError(res, '未登录', 401);
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(100, Math.max(5, Number(query.size) || 20));
    const status = String(query.status || '');
    return ok(res, sendJSON, store.listLogs(dbInstance, { page, size, status }));
  }

  return sendError(res, 'API 不存在', 404);
};

module.exports.EVENT_CATALOG = EVENT_CATALOG;

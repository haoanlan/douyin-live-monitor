/**
 * 主播上场提醒路由。
 *
 * 关注名单 / 状态 / 事件 都给页面用；
 * POST /api/upstage/frames 是**外部帧入口**：人脸识别通道在 Go 代理里没有 proto
 * （见方法文档第三节），所以由外部采集进程（Python 旁路 dump）解码后 POST 进来。
 *
 * 进度条通道（WebcastGroupLiveContainerChangeMessage）由 worker 内部直接调 engine，
 * 不经过这个 HTTP 口。
 */
const authGuard = require('../auth-guard');
const store = require('../upstage/store');
const engine = require('../upstage/engine');
const rankList = require('../upstage/rank-list');

module.exports = async function (pathname, query, req, res, ctx) {
  const { dbInstance, sendJSON, sendError, bodyParse } = ctx;
  if (!pathname.startsWith('/api/upstage')) return false;

  store.ensureAll(dbInstance);

  const needLogin = () => !authGuard.currentUser(req, dbInstance);
  const needManage = () => !authGuard.requireAction(req, res, dbInstance, sendError, 'upstage.manage');

  // ---- 关注名单 ----
  if (pathname === '/api/upstage/watch' && req.method === 'GET') {
    if (needLogin()) return sendError(res, '未登录', 401);
    const webRid = String(query.webRid || '');
    return sendJSON(res, { items: store.listWatch(dbInstance, webRid || undefined) });
  }

  if (pathname === '/api/upstage/watch' && req.method === 'POST') {
    if (needManage()) return true;
    const body = await bodyParse(req);
    if (!body?.web_rid || !body?.uid) return sendError(res, 'web_rid 和 uid 必填', 400);
    store.upsertWatch(dbInstance, body);
    return sendJSON(res, { items: store.listWatch(dbInstance, String(body.web_rid)) });
  }

  if (pathname === '/api/upstage/watch/delete' && req.method === 'POST') {
    if (needManage()) return true;
    const body = await bodyParse(req);
    if (!body?.id) return sendError(res, '缺少 id', 400);
    store.removeWatch(dbInstance, body.id);
    return sendJSON(res, { items: store.listWatch(dbInstance) });
  }

  // ---- 团员榜映射（页面上「按 uid 添加」时给下拉用）----
  if (pathname === '/api/upstage/members' && req.method === 'GET') {
    if (needLogin()) return sendError(res, '未登录', 401);
    const webRid = String(query.webRid || '');
    if (!webRid) return sendError(res, '缺少 webRid', 400);
    const map = await rankList.getUidNameMap(webRid, { force: String(query.force || '') === '1' });
    const items = [...map.entries()].map(([uid, nickname]) => ({ uid, nickname }));
    const status = await rankList.getStatus(webRid);
    return sendJSON(res, { items, status });
  }

  // ---- 现场识别到的人（公会赛没有团员榜时的发现来源）----
  if (pathname === '/api/upstage/seen' && req.method === 'GET') {
    if (needLogin()) return sendError(res, '未登录', 401);
    const webRid = String(query.webRid || '');
    if (!webRid) return sendError(res, '缺少 webRid', 400);
    return sendJSON(res, { items: store.listSeen(dbInstance, webRid) });
  }

  // ---- 帧入口（外部识别进程调用）----
  if (pathname === '/api/upstage/frames' && req.method === 'POST') {
    /*
     * 这个口给外部采集进程用，所以鉴权走**服务令牌**：
     * 有登录态也行；否则必须带 X-Upstage-Token（lib/upstage/token.js 生成，写在状态页里）。
     */
    const tokenLib = require('../upstage/token');
    const authed = authGuard.currentUser(req, dbInstance) || tokenLib.verify(req);
    if (!authed) return sendError(res, '未授权', 401);
    const body = await bodyParse(req);
    if (!body?.webRid) return sendError(res, '缺少 webRid', 400);
    const result = await engine.ingestFrames(dbInstance, {
      webRid: body.webRid,
      frames: body.frames || [],
      source: body.source === 'container' ? 'container' : 'face'
    });
    return sendJSON(res, result);
  }

  // ---- 状态 ----
  if (pathname === '/api/upstage/status' && req.method === 'GET') {
    if (needLogin()) return sendError(res, '未登录', 401);
    const webRid = String(query.webRid || '');
    const tokenLib = require('../upstage/token');
    /*
     * 不带 webRid 也要能拿到令牌和参数：页面刚打开时还没填房间号，
     * 但用户需要先看到「外部采集进程要用的令牌」。
     */
    return sendJSON(res, {
      runtime: webRid ? engine.getRuntime(webRid) : null,
      rank: webRid ? await rankList.getStatus(webRid) : null,
      states: webRid ? store.listStates(dbInstance, webRid) : [],
      params: {
        confMin: engine.CONF_MIN,
        needHits: engine.NEED_HITS,
        goneSecs: engine.GONE_SECS,
        cooldownSecs: engine.RE_NOTIFY_COOLDOWN_SECS,
        streamGapSecs: engine.STREAM_GAP_SECS
      },
      frameToken: tokenLib.current()
    });
  }

  if (pathname === '/api/upstage/reset' && req.method === 'POST') {
    if (needManage()) return true;
    const body = await bodyParse(req);
    if (!body?.webRid) return sendError(res, '缺少 webRid', 400);
    engine.resetRoom(dbInstance, body.webRid);
    return sendJSON(res, { ok: true });
  }

  // ---- 事件记录 ----
  if (pathname === '/api/upstage/events' && req.method === 'GET') {
    if (needLogin()) return sendError(res, '未登录', 401);
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(100, Math.max(5, Number(query.size) || 20));
    return sendJSON(res, store.listEvents(dbInstance, { webRid: String(query.webRid || ''), page, size }));
  }

  return sendError(res, 'API 不存在', 404);
};

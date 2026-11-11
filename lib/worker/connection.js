/**
 * 每个房间一条 WebSocket 长连接：建连、心跳、指数退避重连
 *
 * 由 monitor.js 拆分而来（逐字搬运，未改动逻辑）。
 */
const { WebSocket } = require('ws');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../../db-sqlite.js');
const api = require('../douyin-api.js');
const ctx = require('./context');
const { loadConfig } = require('./config');
const { createRoomState, getDisplayName } = require('./room-state');
const { setStreamerDir, createSession, saveSession, finalizeSession, generateAndSendReport } = require('./session');
const { handleMessage } = require('./message-handler');
const { ensureBinaryRunning } = require('./proxy-process');
const { rooms } = ctx;

/**
 * 把"开播 / 下播"这类直播事件交给通知系统（notify_rules → notify_channels）。
 *
 * 背景：通知管理的规则表一直存着，但 worker 里**从来没有调用过 dispatch()**，
 * 所以 live_start / live_end_report 两种规则永远不发（只有上场提醒那条接了）。
 *
 * 约定：
 *   · 任何异常都吞掉 —— 通知发不出去绝不能让采集/录制中断；
 *   · dispatch 内部会按 event 找 enabled 的规则，没有规则就是空操作；
 *   · 开播/下播统一走通知系统（notifyLiveEvent），不再有"直发飞书"这条旁路。
 */
async function notifyLiveEvent(room, event, payload) {
  try {
    const inst = db.getDb();
    if (!inst) return;
    const notify = require('../notify/dispatch');
    let body = payload;
    // 下播：如果规则绑了企业微信渠道，就把战报图（base64）一起带上
    if (event === 'live_end_report') body = await withEndReportImage(inst, room, payload);
    const r = await notify.dispatch(inst, event, body, { roomId: String(room.roomId || '') });
    if (r && r.failed) {
      console.warn(`[notify] ${event} 有 ${r.failed} 条发送失败（详见 通知管理 → 发送记录）`);
    }
  } catch (e) {
    console.warn(`[notify] ${event} 调用失败:`, e.message);
  }
}

/**
 * 企业微信机器人可以直接发图片（base64 + md5，≤2MB），飞书 webhook 不行，
 * 所以只有"下播规则里绑了 enabled 的 wecom 渠道"时才去渲这张战报图 ——
 * 否则每次下播都白跑一次 chromium 渲染。
 */
const WECOM_IMAGE_MAX = 2 * 1024 * 1024;

async function withEndReportImage(inst, room, payload) {
  try {
    const store = require('../notify/store');
    const rules = store.listRules(inst).filter((r) => r.event === 'live_end_report' && r.enabled);
    const needImage = rules.some((r) =>
      (r.channel_ids || []).some((cid) => {
        const ch = store.getChannel(inst, cid);
        return ch && ch.enabled && String(ch.type).toLowerCase() === 'wecom';
      })
    );
    if (!needImage) return payload;

    const reportImg = require('../../report-image');
    const data = await reportImg.load(room.roomId);
    if (!data) return payload;
    const pngPath = await reportImg.generateImage(data);
    const buf = fs.readFileSync(pngPath);
    try { fs.unlinkSync(pngPath); } catch (e) { /* ignore */ }
    if (buf.length > WECOM_IMAGE_MAX) {
      console.warn(`[notify] 战报图 ${Math.round(buf.length / 1024)}KB 超过企业微信 2MB 上限，本条只发文字`);
      return payload;
    }
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    return { ...payload, image: { base64: buf.toString('base64'), md5 } };
  } catch (e) {
    console.warn('[notify] 生成战报图失败（本条只发文字）:', e.message);
    return payload;
  }
}

/** 开播提醒的结构化内容（飞书渲染成卡片：红色 header + 两列字段） */
function buildLiveStartPayload(room, data = {}) {
  const name = getDisplayName(room);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const fields = [
    { label: '开播时间', value: hhmm },
    { label: '直播间', value: name }
  ];
  if (room.roomId) fields.push({ label: '房间号', value: String(room.roomId) });
  return {
    title: `🔴 ${name} 开播了`,
    text: data.title ? `**${data.title}**` : '刚开播，正在采集…',
    fields,
    note: `抖音直播监控 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`
  };
}

/**
 * 下播战报的结构化内容（finalizeSession 之后 session 仍在，字段可读）。
 * 纯文本给不支持卡片的渠道；fields 给飞书卡片排版（两列表格）。
 */
function buildLiveEndPayload(room, opts = {}) {
  const name = getDisplayName(room);
  const s = room.session || {};
  const st = s.stats || {};
  const mins =
    s.start_time && s.end_time
      ? Math.round((new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 60000)
      : null;
  // 峰值在线：session.online 里取最大 count（与 dbFlush 里 online_peak 的口径一致）
  const peak = (s.online || []).reduce(
    (max, o) => Math.max(max, parseInt(String(o.count), 10) || 0),
    0
  );
  // 送礼人数 / 钻石合计：finalizeSession 会把 giftUsers 汇总进 room.stats
  const giftUsers = room.stats?.giftUsers || {};
  const senders = Object.keys(giftUsers).length;
  const diamonds = Object.values(giftUsers).reduce((sum, g) => sum + (Number(g.totalDiamonds) || 0), 0);

  const fields = [];
  if (mins != null && mins >= 0) fields.push({ label: '时长', value: `${mins} 分钟` });
  if (peak > 0) fields.push({ label: '峰值在线', value: peak.toLocaleString('zh-CN') });
  fields.push({ label: '弹幕', value: `${st.danmaku || 0} 条` });
  fields.push({ label: '礼物', value: `${st.gift || 0} 件` });
  if (senders > 0) fields.push({ label: '送礼人数', value: `${senders} 人` });
  if (diamonds > 0) fields.push({ label: '钻石', value: diamonds.toLocaleString('zh-CN') });

  /**
   * 卡片内容分工：
   *   · title → 谁下播了
   *   · text  → 只放直播间标题（飞书卡片里数字走 fields，避免同一组数字出现两次）
   *   · plain → 纯文本渠道（企业微信/钉钉/webhook）用的完整文案：标题 + 一行数字摘要
   *   · fields → 卡片里的两列表格
   *   · note  → 场次号 + 结束时间（与开播通知同一格式，带秒）
   */
  const endStr = s.end_time ? new Date(s.end_time).toLocaleString('zh-CN', { hour12: false }) : '';
  const parts = fields.map((f) => `${f.label} ${f.value}`);
  return {
    title: opts.paused ? `⏸ ${name} 已暂停采集` : `🟢 ${name} 下播了`,
    text: s.room_title || '',
    plain: [s.room_title || '', parts.join(' · ')].filter(Boolean).join('\n'),
    fields,
    note: [room.dbSessionId ? `场次 #${room.dbSessionId}` : '', endStr].filter(Boolean).join(' · ')
  };
}

// ====== WebSocket 连接（按房间） ======
function startConnection(roomId, config) {
  if (ctx.isShuttingDown) return;

  let room = rooms.get(roomId);
  if (!room) {
    room = createRoomState(roomId);
    rooms.set(roomId, room);
  }

  // 房间无效（ROOM_NOT_FOUND），不连接
  if (room.invalid) {
    console.log(`[${roomId}] 房间无效，跳过连接`);
    return;
  }

  const wsUrl = `ws://127.0.0.1:1088/ws/${roomId}`;
  console.log(`[${getDisplayName(room)}] 连接: ${wsUrl}`);

  // 清理旧连接，防止重叠
  if (room.ws) {
    try { room.ws.removeAllListeners(); room.ws.close(); } catch(e) {}
  }
  room.ws = new WebSocket(wsUrl);

  room.ws.on('open', () => {
    room.reconnectCount = 0;  // 连接成功，重置退避计数
    // 新连接建立后，上一次连接拿到的直播状态码已经作废，清空它以便
    // /api/rooms 的 statusCode 如实反映"本次连接尚未确认"。
    // 注意：lastTitle（最后已知的直播间标题）不清 —— 它是有用的历史信息，
    // 清掉会让接口在重连瞬间短暂丢失标题。
    room.lastStatusCode = null;
    console.log(`[${getDisplayName(room)}] 已连接，等待直播...`);
  });

  room.ws.on('message', (raw) => {
    try {
      const str = raw.toString();
      const data = JSON.parse(str);

      // ====== 系统消息 ======
      if (data.type === 'system') {
        const event = data.event || '';
        if (event === 'live_status') {
          if (data.livename) room.displayName = data.livename;
          const code = data.code || '';
          const isLive = !!data.live;
          const isEnded = !!data.ended;
          // 记在房间对象上，供 /api/rooms 直接读内存（不再依赖解析日志）
          if (code) room.lastStatusCode = code;
          if (data.title) room.lastTitle = data.title;
          console.log(`[${getDisplayName(room)}] [live_status] code=${code} live=${data.live} ended=${data.ended||false} title=${data.title||''}主播=${data.livename||''}`);

          /*
           * ROOM_STATUS_UNKNOWN：代理读不到房间状态。
           *
           * 实测最常见的原因是 cookie 里的 s_v_web_id（设备验证 id）失效 —— 抖音对直播页返回
           * **HTTP 200 + 0 字节 body**（不是 4xx），代理拿不到页面就一直 UNKNOWN，
           * 外部表现是"开播了但监控完全不知道"，而且日志里只有一行行 UNKNOWN，看不出病因。
           * 这里第一次出现就明确提示，之后每 60 次再提一次，避免刷屏。
           */
          if (code === 'ROOM_STATUS_UNKNOWN') {
            room._unknownCount = (room._unknownCount || 0) + 1;
            if (room._unknownCount === 1 || room._unknownCount % 60 === 0) {
              console.warn(
                `[${getDisplayName(room)}] ⚠ 代理读不到房间状态（ROOM_STATUS_UNKNOWN ×${room._unknownCount}）。` +
                  `通常是 cookie 里的 s_v_web_id 失效（直播页返回 200 空 body）；` +
                  `删掉项目目录下的 .s_v_web_id 再重启代理，会自动换一个新号。`
              );
            }
          } else if (room._unknownCount) {
            room._unknownCount = 0;
          }

          // --- v2.1.0 新增: 基于 code 字段的精确处理 ---

          // ROOM_ENDED: Go代理确认已下播，直接结束session
          if (code === 'ROOM_ENDED' || isEnded) {
            if (room.isRecording) {
              console.log(`[${getDisplayName(room)}] 🟢 确认下播 (code=${code}, ended=${data.ended})`);
              // 清理可能残留的下播定时器
              if (room.liveStopTimer) {
                clearTimeout(room.liveStopTimer);
                room.liveStopTimer = null;
              }
              room.isRecording = false;
              finalizeSession(room);
              console.log(`[${getDisplayName(room)}] session 已保存 (${room.session.stats.danmaku}条弹幕, ${room.session.stats.gift}个礼物)`);
              // 报告图 + 下播通知统一由通知规则发出（notify 的 live_end_report 会带上战报图）
              // 老的 generateAndSendReport 直发已废弃，避免同一份战报发两次
              notifyLiveEvent(room, 'live_end_report', buildLiveEndPayload(room));
            }
            if (room.session) room.session._liveStatus = false;
            console.log(`[${getDisplayName(room)}] 直播已结束，等待下次开播 (${data.message || ''})`);
            return;
          }

          // ROOM_NOT_FOUND: 房间不存在，标记无效，停止重连
          if (code === 'ROOM_NOT_FOUND') {
            console.log(`[${getDisplayName(room)}] ❌ 房间不存在 (${roomId})，停止重连`);
            if (room.isRecording) {
              room.isRecording = false;
              finalizeSession(room);
              generateAndSendReport(room);
            }
            // 标记房间无效，后续重连时跳过
            room.invalid = true;
            if (room.ws) {
              try { room.ws.removeAllListeners(); room.ws.close(); } catch(e) {}
              room.ws = null;
            }
            return;
          }

          // ROOM_OFFLINE / ACCOUNT_OFFLINE_NO_ROOM: 未开播，保持连接等待
          if (code === 'ROOM_OFFLINE' || code === 'ACCOUNT_OFFLINE_NO_ROOM') {
            if (room.session) room.session._liveStatus = false;
            if (!room.isRecording) {
              console.log(`[${getDisplayName(room)}] 直播未开播，等待中... (${data.message || ''})`);
            }
            return;
          }

          // --- 兜底: 兼容旧版 Go代理 (v2.0.x) 的 live_status ---

          // 主播回来时，取消可能残留的下播定时器
          if (isLive && room.liveStopTimer) {
            clearTimeout(room.liveStopTimer);
            room.liveStopTimer = null;
            console.log(`[${getDisplayName(room)}] 🟢 主播回来了，取消下播确认`);
          }

          if (isLive && !room.isRecording) {
            // 🔴 开播
            console.log(`[${getDisplayName(room)}] 🔴 检测到开播！`);
            room.session = createSession(room, roomId);
            room.session.room_title = data.title || '';
            room.session.room_author = data.livename || '';
            if (room.session.room_author) setStreamerDir(room, room.session.room_author);
            room.isRecording = true;
            saveSession(room);
            db.init().then(async () => {
              try {
                const pool = db.getPool();
                /*
                 * 同一房间重新开播前，先把上一条未结束的场次收尾。
                 * 注意：**不能只改 end_time** —— 原来的写法就是只 UPDATE end_time，
                 * 于是这条路径结束的场次 agg_* 全为 0，任何"只读 agg_*"的统计都会静默漏掉它
                 * （实测 session 293 就是这么来的）。这里改成先取出要结束的场次 id，
                 * 再用公共的 recomputeSessionAggregates() 把它们收尾（与 endSession 同一套逻辑）。
                 */
                // pool.query 是 mysql2 风格，返回 [rows, fields]，这里必须解构第一项
                const [openRows] = await pool.query('SELECT id FROM sessions WHERE room_id = ? AND end_time IS NULL', [roomId]);
                await pool.query("UPDATE sessions SET end_time = datetime('now','localtime') WHERE room_id = ? AND end_time IS NULL", [roomId]);
                for (const r of openRows) {
                  if (r && r.id) await db.recomputeSessionAggregates(r.id);
                }
                /*
                 * 老的"直发飞书开播提醒"（feishu.sendText + config.feishu.open_id）已删除：
                 * 开播统一走通知系统的 live_start 规则（见上 notifyLiveEvent），
                 * 渠道在「通知管理 → 渠道」里配，不再依赖 config.yaml 里的 open_id ——
                 * 否则同时配了两套会收到两条一模一样的提醒。
                 */
                const streamerId = await db.upsertStreamer(room.session.room_author || '', roomId, '', '');
                room.dbSessionId = await db.createSession(streamerId, room.session.room_title, roomId);
                room.dbSyncState = { danmaku: 0, gifts: 0, members: 0, online: 0, likes: 0 };
                console.log(`[${getDisplayName(room)}] [db] session #${room.dbSessionId} 已创建`);
                // 执行挂起的更新
                const updates = room.pendingDbUpdates;
                room.pendingDbUpdates = [];
                for (const fn of updates) fn(room.dbSessionId);
              } catch(e) {
                console.error(`[${getDisplayName(room)}] [db] 创建 session 失败:`, e.message);
              }
            });
            console.log(`[${getDisplayName(room)}] 开始录制: ${data.title || ''}`);
            // 通知系统：开播（有规则才发，没规则是空操作）
            notifyLiveEvent(room, 'live_start', buildLiveStartPayload(room, data));
          } else if (!isLive && room.isRecording) {
            // 🟢 可能下播（兜底逻辑，新版Go代理会走 ROOM_ENDED 分支）
            // 如果最近还有数据流入（lastDataTime在60秒内），说明主播只是暂时离开，不启动下播定时器
            const dataAge = room.lastDataTime ? (Date.now() - room.lastDataTime) / 1000 : Infinity;
            if (dataAge < 60) {
              console.log(`[${getDisplayName(room)}] 🟡 live=false 但最近${Math.round(dataAge)}秒有数据流入，跳过下播判定`);
            } else if (!room.liveStopTimer) {
              room.liveStopTimer = setTimeout(() => {
                room.liveStopTimer = null;
                if (!room.isRecording) return;
                // 定时器触发时再次检查：如果期间有新数据流入，取消下播
                const lateDataAge = room.lastDataTime ? (Date.now() - room.lastDataTime) / 1000 : Infinity;
                if (lateDataAge < 60) {
                  console.log(`[${getDisplayName(room)}] 🟡 下播确认时发现最近${Math.round(lateDataAge)}秒有数据，取消下播`);
                  return;
                }
                console.log(`[${getDisplayName(room)}] 🟢 确认下播！`);
                room.isRecording = false;
                finalizeSession(room);
                console.log(`[${getDisplayName(room)}] session 已保存 (${room.session.stats.danmaku}条弹幕, ${room.session.stats.gift}个礼物)`);
                // 战报图由通知规则统一附带，不再单独直发
                // 通知系统：下播战报（30 秒确认这条路径）
                notifyLiveEvent(room, 'live_end_report', buildLiveEndPayload(room));
              }, 30000);
              console.log(`[${getDisplayName(room)}] 🟡 直播可能已结束，30秒后确认...`);
            }
          }

          if (room.session) room.session._liveStatus = isLive;
          if (!isLive && !room.isRecording) {
            console.log(`[${getDisplayName(room)}] 直播未开播，等待中... (${data.message || ''})`);
          }
        } else {
          console.log(`[${getDisplayName(room)}] [系统] ${data.message || JSON.stringify(data)}`);
        }
        return;
      }

      // ====== 直播数据 ======
      if (room.session && room.isRecording) {
        if (data.livename && !room.session.room_author) {
          room.displayName = data.livename;
          console.log(`[${getDisplayName(room)}] 🏷️ 抓到主播名:`, data.livename);
          room.session.room_author = data.livename;
          setStreamerDir(room, data.livename);
          const doUpdate = (sid) => {
            db.updateStreamerName(sid, data.livename, data.avatarThumb || '').catch(e => console.error(`[session] 更新主播名失败:`, e.message));
          };
          if (room.dbSessionId) doUpdate(room.dbSessionId);
          else room.pendingDbUpdates.push(doUpdate);
        }
        if (data.title && !room.session.room_title) {
          room.session.room_title = data.title;
          if (room.dbSessionId) {
            db.getPool().query('UPDATE sessions SET room_title = ? WHERE id = ? AND (room_title IS NULL OR room_title = "")', [data.title, room.dbSessionId]).catch(e => console.error(`[session] 更新标题失败:`, e.message));
          }
        }
        if (data.avatarThumb && !room.session.room_avatar) {
          room.session.room_avatar = data.avatarThumb;
          if (room.dbSessionId) db.updateStreamerAvatar(room.dbSessionId, data.avatarThumb).catch(e => console.error(`[session] 更新头像失败:`, e.message));
        }
      }

      if (room.session) {
        if (!room.isRecording && room.dbSessionId) {
          room.isRecording = true;
          console.log(`[${getDisplayName(room)}] 检测到新数据，恢复录制`);
        }
        if (room.isRecording) {
          handleMessage(room, data);
          saveSession(room);
        }
      }
    } catch (e) {
      const method = (typeof data === 'object' && data) ? (data._method || data.method || data.event || '?') : '?';
      console.error(`[${getDisplayName(room)}] 消息处理错误 [${method}]:`, e.message);
    }
  });

  room.ws.on('close', (code) => {
    console.log(`[${getDisplayName(room)}] 连接断开 (code=${code})`);
    if (ctx.isShuttingDown) return;
    // 房间已被"删除房间"移除 → 绝不重连。
    // 少了这一条，被删掉的房间会因为下面找不到 roomConfig 而继续重连，
    // 并在 startConnection 里重新创建房间状态 —— 房间就"复活"了。
    if (room.removed) {
      console.log(`[${getDisplayName(room)}] 房间已被删除，停止重连`);
      return;
    }
    if (!rooms.has(roomId)) {
      console.log(`[${getDisplayName(room)}] 房间已不在监控列表中（停止/重启中），停止重连`);
      return;
    }
    // 检查房间是否已被暂停，暂停则不重连
    const currentConfig = loadConfig();
    const roomConfig = currentConfig.rooms?.find(r => r.id === roomId);
    if (roomConfig && roomConfig.enabled === false) {
      console.log(`[${getDisplayName(room)}] 房间已暂停，停止重连`);
      return;
    }
    // 房间不存在（ROOM_NOT_FOUND），不再重连
    if (room.invalid) {
      console.log(`[${getDisplayName(room)}] 房间无效，停止重连`);
      return;
    }
    // code=1000 不再直接结束 session — 团播切换主播时 Go 代理会断开 WS，
    // 但直播还在播。下播由 live_status 事件的 30 秒确认机制来处理。
    if (code === 1000 && room.isRecording) {
      console.log(`[${getDisplayName(room)}] WS正常关闭(code=1000)，保持录制状态，尝试重连...`);
      // 清理可能残留的下播确认 timer，防止重连期间误触发
      if (room.liveStopTimer) {
        clearTimeout(room.liveStopTimer);
        room.liveStopTimer = null;
      }
    }
    // 指数退避：base * 2^count，最大 60 秒
    let delay;
    if (code === 1000 && room.isRecording) {
      delay = 2000;  // 录制中 code=1000 快速重连
    } else {
      const base = (config.reconnect_delay_seconds || 10) * 1000;
      delay = Math.min(base * Math.pow(2, room.reconnectCount), 60000);
      room.reconnectCount = Math.min(room.reconnectCount + 1, 10);  // 上限 10 次
    }
    console.log(`[${getDisplayName(room)}] ${delay/1000}秒后重连 (退避第${room.reconnectCount}次)...`);
    setTimeout(async () => {
      // 排队期间房间可能已被移除/暂停，或正在关停 —— 这里再确认一次，避免复活
      if (room.removed || ctx.isShuttingDown || !rooms.has(roomId)) return;
      await ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
      startConnection(roomId, config);
    }, delay);
  });

  room.ws.on('error', (err) => {
    console.log(`[${getDisplayName(room)}] WS错误: ${err.message}`);
    ensureBinaryRunning().catch(e => console.error(`[daemon] ensureBinary 异常:`, e.message));
  });
}

module.exports = {
  startConnection,
  notifyLiveEvent,
  buildLiveEndPayload,
};

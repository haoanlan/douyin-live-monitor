/**
 * 主播上场提醒 —— 状态机
 *
 * 规则来自《主播上场提醒-完整文档》第四节，这里逐条落地：
 *   未提醒 --出现--> 推一次，标「在场中」
 *   在场中 --持续出现--> 不推
 *   在场中 --消失--> 复位（**不通知**，离场是噪音）
 *   未提醒 --再次出现--> 再推（受冷却限制）
 *
 * 参数（文档 4.2 + 坑 4 的建议值）：
 *   CONF_MIN   0.30  置信度门槛（实测最低 0.413，降到 0.30 接住遮挡/背脸帧）
 *   NEED_HITS  2     连续 2 帧才算
 *   GONE_SECS  180   180 秒没帧才判离场（30 秒会因小画格误判，文档坑 4）
 *   RE_NOTIFY_COOLDOWN 600s  同一个人重新上场至少隔 10 分钟再推
 *   STREAM_GAP_SECS   60     全局断流：超过 60 秒没有任何帧 → 不判离场、不复位
 *
 * 名字拿不到 = 挂起不发（文档 4.5 / 坑 2）：命中后先查团员榜，
 * 拿不到就 pending，由 tick() 每 15 秒重试，拿到后用「原始命中时间」补发。
 */
const upstageStore = require('./store');
const { asUid } = require('./uid');
const rankList = require('./rank-list');
const { dispatch } = require('../notify/dispatch');

const CONF_MIN = 0.3;
const NEED_HITS = 2;
const GONE_SECS = 180;
const RE_NOTIFY_COOLDOWN_SECS = 0; // 文档推荐的是 180s 离场判定 + 断流保护，不额外加冷却
const STREAM_GAP_SECS = 60;

/** webRid → 最近一次收到帧的时间（毫秒） */
const lastFrameAt = new Map();
/** webRid → 最近一次帧来源（face / container），用于双通道优先级 */
const lastSource = new Map();

const nowSec = () => Math.floor(Date.now() / 1000);

function markFrame(webRid, source) {
  lastFrameAt.set(String(webRid), Date.now());
  lastSource.set(String(webRid), source);
}

/**
 * 收到一批识别帧。
 * @param {object} db
 * @param {{webRid:string, frames:{uid:string, conf?:number}[], source?:'face'|'container'}} input
 * @returns {Promise<{matched:number, upstaged:number, pending:number}>}
 */
async function ingestFrames(db, { webRid, frames, source = 'face' }) {
  const rid = String(webRid);
  if (!rid || !Array.isArray(frames) || !frames.length) return { matched: 0, upstaged: 0, pending: 0 };

  markFrame(rid, source);

  const watch = upstageStore.listWatch(db, rid).filter((w) => w.enabled);
  if (!watch.length) return { matched: 0, upstaged: 0, pending: 0 };
  const watchMap = new Map(watch.map((w) => [String(w.uid), w]));

  // 同一批里同一 uid 只算一次，取最高置信度
  const byUid = new Map();
  for (const f of frames) {
    // 外部采集进程可能把 uid 以数字传进来（丢精度），统一走 asUid 并给出告警
    const uid = asUid(f?.uid) || asUid(f);
    if (!uid) continue;
    const conf = Number(f?.conf ?? f?.confidence ?? 1);
    const prev = byUid.get(uid);
    const nickname = String(f?.nickname || f?.nick_name || '').trim()
    if (!prev || conf > prev.conf) byUid.set(uid, { uid, conf, nickname: nickname || prev?.nickname || '' })
  }

  let matched = 0;
  let upstaged = 0;
  let pending = 0;
  const ts = nowSec();

  for (const [uid, { conf }] of byUid) {
    /*
     * 先记"现场见过"：公会赛房间没有团员榜（文档坑 17），
     * 只能靠这些 uid 让用户发现"台上这个人是谁"再决定关注。
     */
    const seenName = byUid.get(uid)?.nickname || '';
    upstageStore.upsertSeen(db, { web_rid: rid, uid, nickname: seenName, source });

    const w = watchMap.get(uid);
    if (!w) continue; // 文档坑 1：不在名单里的一律不看，否则一帧刷 5–6 条
    matched++;
    if (conf < CONF_MIN) continue;

    const st = upstageStore.getState(db, rid, uid) || {};
    const hits = (st.hits || 0) + 1;
    const wasPresent = !!st.present;

    if (!wasPresent && hits >= NEED_HITS) {
      // 上升沿：先查名字，拿不到就挂起（绝不发数字）
      const nickname = w.nickname || (await rankList.resolveName(rid, uid));
      // 冷却为 0 表示不冷却：文档的规则是「离场复位后再次出现就再推」
      const cooled = RE_NOTIFY_COOLDOWN_SECS > 0 && st.last_notified_at && ts - st.last_notified_at < RE_NOTIFY_COOLDOWN_SECS;
      if (nickname && !cooled) {
        upstageStore.saveState(db, rid, uid, {
          hits,
          present: 1,
          last_seen_at: ts,
          last_notified_at: ts,
          notified_in_session: 1,
          pending: 0,
          pending_since: null
        });
        await emitOnStage(db, rid, uid, nickname, source);
        upstaged++;
      } else {
        upstageStore.saveState(db, rid, uid, {
          hits,
          present: 1,
          last_seen_at: ts,
          pending: nickname ? 0 : 1,
          pending_since: nickname ? null : ts
        });
        if (!nickname) {
          upstageStore.addEvent(db, {
            web_rid: rid,
            uid,
            nickname: '',
            event: 'pending',
            detail: '命中名单但拿不到昵称，挂起等待补发'
          });
          pending++;
        }
      }
      continue;
    }

    upstageStore.saveState(db, rid, uid, {
      hits,
      present: wasPresent ? 1 : st.present ? 1 : 0,
      last_seen_at: ts
    });
  }

  return { matched, upstaged, pending };
}

async function emitOnStage(db, rid, uid, nickname, source) {
  upstageStore.addEvent(db, {
    web_rid: rid,
    uid,
    nickname,
    event: 'on_stage',
    detail: source ? 来源  : '',
    source
  });
  const payload = {
    title: '主播上场提醒',
    text: `${nickname} 已上场\n房间：${rid}\n时间：${new Date().toLocaleString('zh-CN')}`
  };
  try {
    await dispatch(db, 'anchor_on_stage', payload, { roomId: rid });
  } catch (e) {
    console.warn('[upstage] 发送上场提醒失败:', e.message);
  }
}

/**
 * 定时任务（建议 10 秒一次）：
 *   · 判离场（带全局断流保护）
 *   · 重试挂起的补发
 */
async function tick(db) {
  const states = db.prepare('SELECT * FROM upstage_state WHERE present=1 OR pending=1').all();
  if (!states.length) return;

  const ts = nowSec();
  const nowMs = Date.now();

  for (const st of states) {
    const rid = String(st.web_rid);
    const gapMs = nowMs - (lastFrameAt.get(rid) || 0);

    // 全局断流：这段时间谁都没有帧 → 识别整体断了，不判离场
    if (gapMs > STREAM_GAP_SECS * 1000) continue;

    if (st.pending) {
      // 挂起补发：拿到名字就发，时间仍用原始命中时间
      const nickname = await rankList.resolveName(rid, st.uid);
      if (nickname) {
        upstageStore.saveState(db, rid, st.uid, {
          pending: 0,
          pending_since: null,
          last_notified_at: ts,
          notified_in_session: 1
        });
        upstageStore.addEvent(db, {
          web_rid: rid,
          uid: st.uid,
          nickname,
          event: 'on_stage_late',
          detail: `挂起 ${ts - (st.pending_since || ts)} 秒后补发`
        });
        await dispatch(
          db,
          'anchor_on_stage',
          {
            title: '主播上场提醒',
            text: `${nickname} 已上场\n房间：${rid}\n时间：${new Date().toLocaleString('zh-CN')}`
          },
          { roomId: rid }
        );
      }
      continue;
    }

    if (st.present && st.last_seen_at && ts - st.last_seen_at > GONE_SECS) {
      upstageStore.saveState(db, rid, st.uid, { present: 0, hits: 0 });
      upstageStore.addEvent(db, {
        web_rid: rid,
        uid: st.uid,
        nickname: '',
        event: 'off_stage',
        detail: `静默 ${ts - st.last_seen_at} 秒，复位（不通知）`
      });
    }
  }
}

/**
 * 自动维护（每 60 秒由 web-dashboard 调）：把关注中的房间团员榜预热一遍。
 *
 * 用户的要求是「不需要每次自己去拉接口」：所以只要名单里有这个房间，
 * 后台就按房间定期刷新 uid→昵称映射；命中时零等待就能拿到名字。
 */
async function warmRankMaps(db) {
  const rows = db
    .prepare('SELECT DISTINCT web_rid FROM upstage_watch WHERE enabled=1')
    .all();
  for (const r of rows) {
    try {
      await rankList.getUidNameMap(r.web_rid, { force: true });
    } catch (e) {
      console.warn('[upstage] 预热团员榜失败', r.web_rid, e.message);
    }
  }
}

/** 一场结束 / 重新开播：清空状态，不跨场记忆 */
function resetRoom(db, webRid) {
  upstageStore.resetRoom(db, String(webRid));
  lastFrameAt.delete(String(webRid));
  lastSource.delete(String(webRid));
}

function getRuntime(webRid) {
  const rid = String(webRid);
  const lastAt = lastFrameAt.get(rid) || 0;
  return {
    webRid: rid,
    lastFrameAt: lastAt,
    lastSource: lastSource.get(rid) || '',
    streamGapSecs: lastAt ? Math.round((Date.now() - lastAt) / 1000) : null
  };
}

module.exports = {
  ingestFrames,
  warmRankMaps,
  tick,
  resetRoom,
  getRuntime,
  CONF_MIN,
  NEED_HITS,
  GONE_SECS,
  RE_NOTIFY_COOLDOWN_SECS,
  STREAM_GAP_SECS
};

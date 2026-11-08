/**
 * 上游帧入口（内部用）。
 *
 * worker 收到进度条消息（WebcastGroupLiveContainerChangeMessage.challenge_user_infos）
 * 时调用这里。抽成独立文件是为了：
 *   · message-handler 保持同步、轻量（这里 fire-and-forget）
 *   · 引擎依赖 db / store，只有真正需要时才 require，避免 worker 启动时就加载
 */
let dbRef = null;

/** 由 web-dashboard 启动时注入（不注入则退化为惰性获取） */
function setDb(db) {
  dbRef = db;
}

function getDb() {
  if (dbRef) return dbRef;
  try {
    dbRef = require('../../db-sqlite').getDb();
  } catch {
    dbRef = null;
  }
  return dbRef;
}

/**
 * @param {string} webRid 房间号（页面上的那串数字）
 * @param {{uid:string, conf?:number}[]} frames
 */
function feedContainerFrames(webRid, frames) {
  const db = getDb();
  if (!db || !webRid || !Array.isArray(frames) || !frames.length) return;
  const engine = require('./engine');
  engine.ingestFrames(db, { webRid, frames, source: 'container' }).catch((e) => {
    console.warn('[upstage] 进度条通道处理失败:', e.message);
  });
}

module.exports = { setDb, feedContainerFrames };

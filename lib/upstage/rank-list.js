/**
 * 团员榜：uid → 昵称（方法文档里唯一可靠的名字来源）
 *
 * 接口零 cookie、零签名即可调通（实测 status_code=0），
 * 唯一要求是传**内部 room_id**（不是 web_rid）——room_id 每场可能变，
 * 所以这里带 60 秒缓存，并在映射为空时重新解析 room_id 再查一次（文档坑 3 / 坑 15）。
 */
const douyinApi = require('../douyin-api');
const { asUid } = require('./uid');

const CACHE_TTL_MS = 60 * 1000;
/** web_rid → { roomId, at } */
const roomIdCache = new Map();
/** room_id → { map: Map<uid, nickname>, at } */
const rankCache = new Map();

function normalize(list) {
  const map = new Map();
  for (const item of list || []) {
    const info = item?.user_info || {};
    // 19 位 id 用 number 会丢末位（实测 7450866781424895000 vs id_str ...034），优先 id_str
    const uid = asUid(info);
    const nick = String(info.nickname || '').trim();
    if (uid && nick) map.set(uid, nick);
  }
  return map;
}

/** web_rid（页面上的房间号）→ 内部 room_id */
async function resolveRoomId(webRid) {
  const key = String(webRid);
  const hit = roomIdCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.roomId;
  try {
    const info = await douyinApi.getLiveInfo(key);
    const roomId = info?.room_id && info.room_id !== key ? String(info.room_id) : '';
    if (roomId) roomIdCache.set(key, { roomId, at: Date.now() });
    return roomId;
  } catch (e) {
    console.warn('[upstage] 解析 room_id 失败:', e.message);
    return '';
  }
}

/** 直接按内部 room_id 拉团员榜 */
async function fetchRankList(roomId) {
  const url =
    'https://live.douyin.com/webcast/anchor/group_live/get_group_rank_list/' +
    '?aid=6383&app_name=douyin_web&live_id=1&device_platform=web&language=zh-CN' +
    '&enter_from=web_live&cookie_enabled=true&screen_width=1536&screen_height=864' +
    '&browser_language=zh-CN&browser_platform=Win32&browser_name=Edge&browser_version=156.0.0.0' +
    `&room_id=${encodeURIComponent(roomId)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Referer: 'https://live.douyin.com/'
    }
  });
  const json = await res.json();
  if (json?.status_code !== 0) {
    throw new Error(`团员榜返回 status_code=${json?.status_code}`);
  }
  return normalize(json?.data?.rank_list_users || []);
}

/**
 * 取 uid→昵称映射（带缓存）。
 * 映射为空时会重解析 room_id 再试一次 —— 下播→再开播 room_id 会变（文档坑 15）。
 */
async function getUidNameMap(webRid, { force = false } = {}) {
  const rid = String(webRid);
  const key = rid;
  const hit = rankCache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.map;

  let roomId = await resolveRoomId(rid);
  if (!roomId) return hit?.map || new Map();

  try {
    let map = await fetchRankList(roomId);
    if (!map.size) {
      // 可能是旧 room_id：强制重解析一次
      roomIdCache.delete(rid);
      roomId = await resolveRoomId(rid);
      if (roomId) map = await fetchRankList(roomId);
    }
    rankCache.set(key, { map, at: Date.now(), roomId });
    return map;
  } catch (e) {
    console.warn('[upstage] 拉团员榜失败:', e.message);
    return hit?.map || new Map();
  }
}

/** 单个 uid 的名字：先查榜单缓存，查不到返回空串（调用方据此挂起，绝不发数字） */
async function resolveName(webRid, uid) {
  const map = await getUidNameMap(webRid);
  return map.get(String(uid)) || '';
}

/** 给页面看的状态信息 */
async function getStatus(webRid) {
  const rid = String(webRid);
  const cachedRoom = roomIdCache.get(rid);
  const cachedRank = rankCache.get(rid);
  return {
    webRid: rid,
    roomId: cachedRoom?.roomId || '',
    mappedUsers: cachedRank?.map?.size || 0,
    mappedAt: cachedRank?.at || 0
  };
}

module.exports = { resolveRoomId, fetchRankList, getUidNameMap, resolveName, getStatus };

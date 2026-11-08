/**
 * 极简进程内响应缓存。
 *
 * 为什么需要：本地实测 `/api/gift-prices` 要 1.8~2.7 秒（45 万行 gifts 表按礼物名聚合），
 * 而模板演示页是 mock 数据、秒开 —— 用户对比后自然会觉得"我们这系统加载好久"。
 * 页面骨架能掩盖一部分，但真正的解法是：**同一个查询别每次重算**。
 *
 * 约定：
 *   · 只缓存 GET 且是"读多写少"的重接口
 *   · TTL 到点自动失效；写入路径显式调用 invalidate(prefix) 立即失效
 *   · 进程内 Map，不落盘（重启即空，简单可靠）
 */
const store = new Map() // key -> { data, expireAt }

function get(key) {
  const hit = store.get(key)
  if (!hit) return undefined
  if (hit.expireAt <= Date.now()) {
    store.delete(key)
    return undefined
  }
  return hit.data
}

function set(key, data, ttlMs) {
  store.set(key, { data, expireAt: Date.now() + ttlMs })
}

/** 取缓存，没有就执行 fn 并写入 */
async function cached(key, ttlMs, fn) {
  const hit = get(key)
  if (hit !== undefined) return hit
  const data = await fn()
  set(key, data, ttlMs)
  return data
}

/** 按前缀失效（例如 'gift-prices' 会清掉 'gift-prices:...'） */
function invalidate(prefix) {
  let n = 0
  for (const k of store.keys()) {
    if (k === prefix || k.startsWith(prefix + ':')) {
      store.delete(k)
      n++
    }
  }
  return n
}

function stats() {
  return { size: store.size, keys: [...store.keys()] }
}

module.exports = { get, set, cached, invalidate, stats }

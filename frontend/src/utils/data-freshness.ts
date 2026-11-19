/**
 * 跨页面的「数据已变更」标记。
 *
 * 为什么需要它：总览页（dashboard）是 keep-alive 页，切回来时只做 30 秒节流刷新
 * （见 onActivated）。删除场次后服务端缓存已由 bustOverview() 清掉，前端却因为
 * 「刚拉过不到 30 秒」而不发请求 —— 用户删完立刻切回总览，卡片还是旧数字。
 *
 * 用法：写操作成功后 markDataDirty()；读取方在激活时 consumeDataDirty()，
 * 返回 true 就无条件强制刷新（并绕过服务端缓存），读完自动复位。
 *
 * 刻意不用 Pinia：这里只需要一个进程内布尔值，走 store 反而会和
 * 「不清理数据防 stats 跳变」的既有约定纠缠。
 */
let dirty = false

export function markDataDirty(): void {
  dirty = true
}

export function consumeDataDirty(): boolean {
  const v = dirty
  dirty = false
  return v
}

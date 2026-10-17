/**
 * 滚动条自动隐藏（全局单例）
 *
 * 需求："滚动条默认看不见，滚动时出现，停止滚动一会儿后淡出。"
 *
 * 为什么需要 JS：滚动条的可视性完全由 CSS 决定，而 CSS 没有"这个元素正在滚动"
 * 这种状态选择器 —— 只能由脚本在滚动发生时加一个类，再在停止后移除。
 *
 * 做法：
 *   1. **只装一个** document 级监听，且用捕获阶段（capture: true）。
 *      滚动事件不冒泡，只有捕获阶段才能收到**所有**滚动容器（页面、卡片、
 *      弹窗、表格横向滚动…）的事件，不用给每个元素单独挂。
 *   2. 给**实际滚动的元素**（event.target）加 `dy-scrolling`；根滚动条的事件目标是
 *      document，统一落到 <html> 上。
 *   3. 每个元素一个 700ms 定时器（WeakMap），多个容器交替滚动时互不覆盖；
 *      每次滚动都重置，最后一次滚动结束 700ms 后才移除类。
 *   4. 只加/删一个类，不读写任何布局属性（offsetWidth/scrollTop…），
 *      不改变滚动条宽度与 scrollbar-gutter，因此不会引起内容左右跳。
 *
 * 显示/淡出由 CSS 完成（core/reset.scss）：.dy-scrolling 把滑块颜色从 transparent
 * 过渡回主题色（scrollbar-color + @property 注册的 <color> 变量，见那里注释）。
 *
 * 键盘（方向键 / PageDown / Home-End）与程序化 scrollTop 同样会触发 scroll 事件，
 * 因此与鼠标滚轮、拖拽、触摸共用这一套机制。
 */

/** 滚动中挂在滚动元素上的类名（CSS 里按它显示滑块） */
const SCROLLING_CLASS = 'dy-scrolling'

/** 停止滚动后多久淡出（用户要求"一会儿"；700ms 足够看清滑块又不拖沓） */
const HIDE_DELAY = 700

/** 每个元素独立的隐藏定时器：A 在滚、B 刚滚完时，B 的定时器不会被 A 重置 */
const hideTimers = new WeakMap<Element, number>()

/** 把 scroll 事件的 target 归一化成"滚动条所属的元素" */
function resolveScrollingElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target
  // 根滚动条：Chrome 下 target 是 document，个别环境是 window
  if (target instanceof Document || target === window) return document.documentElement
  return null
}

function reveal(element: Element) {
  element.classList.add(SCROLLING_CLASS)

  const previous = hideTimers.get(element)
  if (previous !== undefined) window.clearTimeout(previous)

  const timer = window.setTimeout(() => {
    hideTimers.delete(element)
    element.classList.remove(SCROLLING_CLASS)
  }, HIDE_DELAY)

  hideTimers.set(element, timer)
}

let installed = false

/**
 * 安装全局滚动监听。幂等：重复调用只会生效一次。
 * 在 main.ts 里、app.mount 之前调用。
 */
export function setupScrollbarAutoHide() {
  if (installed) return
  installed = true

  document.addEventListener(
    'scroll',
    (event) => {
      const element = resolveScrollingElement(event.target)
      if (element) reveal(element)
    },
    // passive：滚动监听里不 preventDefault，别阻塞合成器线程的滚动
    { capture: true, passive: true }
  )
}

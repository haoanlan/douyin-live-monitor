/**
 * 窄屏（手机）判断。
 *
 * 为什么要有这个 hook：画像页 / 场次详情页要在手机上把内容切成 tab，
 * 桌面保持原来的整页滚动。用 matchMedia 而不是 resize 事件，能拿到真实断点变化；
 * 组件卸载时把监听摘掉，避免 keep-alive 页面反复挂载后越积越多。
 *
 * 断点与项目既有约定一致：`(max-width: 767px)` = 手机。
 */
import { onMounted, onUnmounted, ref } from 'vue'

const MOBILE_QUERY = '(max-width: 767px)'

export function useIsMobile() {
  const isMobile = ref(
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false
  )
  let mq: MediaQueryList | null = null

  const onChange = (e: MediaQueryListEvent) => {
    isMobile.value = e.matches
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    mq = window.matchMedia(MOBILE_QUERY)
    isMobile.value = mq.matches
    mq.addEventListener('change', onChange)
  })

  onUnmounted(() => {
    mq?.removeEventListener('change', onChange)
  })

  return { isMobile }
}

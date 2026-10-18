<!--
  手机端悬浮操作：返回上一级 + 一键到顶。

  为什么放全局（布局里的 #app-global）：这两个动作是"页面无关"的通用操作，
  每个页面各加一份会重复实现，还容易漏（画像页就是漏了返回的那个）。
  只在 <768px 显示，桌面本来有关闭键/顶部栏，不需要。

  返回：优先 router.back()（保留上一页的查询条件/滚动位置，搜索页是 keep-alive）；
  没有历史记录（直接打开链接）时退回到菜单里的上级页面。
-->
<template>
  <Transition
    enter-active-class="tad-300 ease-out"
    leave-active-class="tad-200 ease-in"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div v-show="isMobile" class="dy-mobile-fab">
      <button
        v-if="canGoBack"
        type="button"
        class="dy-mobile-fab__btn"
        title="返回上一级"
        aria-label="返回上一级"
        @click="goBack"
      >
        <ArtSvgIcon icon="ri:arrow-left-line" class="text-lg" />
      </button>
      <button
        v-show="showTop"
        type="button"
        class="dy-mobile-fab__btn"
        title="回到顶部"
        aria-label="回到顶部"
        @click="backToTop"
      >
        <ArtSvgIcon icon="ri:arrow-up-line" class="text-lg" />
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { useIsMobile } from '@/hooks/core/useIsMobile'

  defineOptions({ name: 'ArtMobileFab' })

  const router = useRouter()
  const route = useRoute()
  const { isMobile } = useIsMobile()

  /** 首页/登录页没有"上一级"，不显示返回键 */
  const canGoBack = computed(() => route.path !== '/' && route.path !== '/login')

  const showTop = ref(false)
  let container: HTMLElement | null = null
  let onScroll: (() => void) | null = null

  function goBack(): void {
    // history.state.back 为空说明是直接打开的链接，退不回去 → 回菜单首页
    if (window.history.state?.back) router.back()
    else router.push('/')
  }

  /**
   * 回到顶部。
   * 注意：手机上真正滚的是 **window**（实测 #app-main 的 overflow 是 visible、
   * scrollHeight == clientHeight），只给 #app-main 赋 scrollTop 是无效的 ——
   * 桌面的 useCommon().scrollToTop() 就只做了那一步。这里两个都归零。
   */
  function backToTop(): void {
    container = document.getElementById('app-main')
    if (container) container.scrollTop = 0
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  onMounted(() => {
    container = document.getElementById('app-main')
    onScroll = () => {
      const y = Math.max(
        window.scrollY || 0,
        document.scrollingElement?.scrollTop || 0,
        container?.scrollTop || 0
      )
      showTop.value = y > 240
    }
    // 容器和窗口都监听：桌面滚 #app-main，手机滚 window
    container?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  })

  onUnmounted(() => {
    if (container && onScroll) container.removeEventListener('scroll', onScroll)
    if (onScroll) window.removeEventListener('scroll', onScroll)
  })
</script>

<style lang="scss" scoped>
  .dy-mobile-fab {
    position: fixed;
    right: 14px;
    bottom: calc(18px + env(safe-area-inset-bottom, 0px));
    z-index: 2600;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .dy-mobile-fab__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    color: var(--art-gray-700);
    cursor: pointer;
    background: var(--default-box-color);
    border: 1px solid var(--art-card-border);
    border-radius: 50%;
    box-shadow: 0 6px 18px -8px rgb(16 24 40 / 28%);
    transition:
      color 0.15s,
      transform 0.15s;

    &:active {
      color: var(--theme-color);
      transform: scale(0.94);
    }
  }
</style>

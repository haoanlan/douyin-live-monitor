<!-- 布局内容 -->
<!--
  2026-11-09：**整体回退到 Art Design Pro 原版结构**（用户反馈"看模板，他的就很舒服"）。

  之前这里是自己改过的版本：单个 Transition 包 KeepAlive、`:css` 开关 + WAAPI 钩子、
  还给"离开页"加了 position:absolute。结果是两页在同一屏交叠（定位元素绘制在普通流之上），
  切页时会看到上一页 —— 而原版用的是 **两个 Transition + mode="out-in"**：
  旧页先走完、新页才进场，任何时刻只有一页在屏幕上，所以永远不会闪上一页。

  为什么不再自己改：这套动画在历史上被改了三轮（交叉淡入 → 两页糊在一起 → 硬切），
  每次都引入新问题。原版结构是经过验证的，保持同步，只在确有 bug 时才动。
-->
<template>
  <div class="layout-content" :class="{ 'overflow-auto': isFullPage }" :style="containerStyle">
    <div id="app-content-header">
      <!-- 节日滚动 -->
      <ArtFestivalTextScroll v-if="!isFullPage" />

      <!-- 路由信息调试 -->
      <div
        v-if="isOpenRouteInfo === 'true'"
        class="px-2 py-1.5 mb-3 text-sm text-g-500 bg-g-200 border-full-d rounded-md"
      >
        router meta：{{ route.meta }}
      </div>
    </div>

    <RouterView v-if="isRefresh" v-slot="{ Component, route }" :style="contentStyle">
      <!--
        只用一个 Transition（2026-11-11 修「移动端进场次详情闪帧」）

        原来是两个 Transition：缓存页一个、非缓存页一个。从"场次历史"（keepAlive）
        进"场次详情"（非 keepAlive）时**两个容器同时在渲染**，而 mode="out-in"
        只对自己容器内的元素生效 —— 于是旧页（1756px）和新页（876px）同时留在文档流里，
        文档高度到 2736px，移动端就会看到一帧明显的跳动/闪白。

        合成一个 Transition 后，out-in 对整棵子树生效：旧页走完 → 新页才进场，
        任何时刻只有一页在文档流里。KeepAlive 保留（用 exclude 排除不该缓存的页面）。
      -->
      <Transition
        :name="showTransitionMask ? '' : actualTransition"
        mode="out-in"
        appear
        @before-enter="onTransitionEnter"
        @before-leave="onTransitionLeave"
      >
        <KeepAlive :max="10" :exclude="pageKeepAliveExclude">
          <component class="art-page-view" :is="Component" :key="route.path" />
        </KeepAlive>
      </Transition>
    </RouterView>

    <!-- 临时排查用：导航/渲染记录 HUD。只有 URL 带 ?debug=1 时显示，定位完删除。 -->
    <div
      v-if="navDebugOn"
      class="fixed bottom-2 left-2 z-[9999] max-w-[560px] rounded-md bg-black/80 px-3 py-2 text-[11px] leading-[1.5] text-white font-mono whitespace-pre-wrap pointer-events-none"
    >
      {{ navLog.join('\n') || '(no nav yet)' }}
    </div>

    <!-- 全屏页面切换过渡遮罩（用于提升页面切换视觉体验） -->    <Teleport to="body">
      <div
        v-show="showTransitionMask"
        class="fixed top-0 left-0 z-[2000] w-screen h-screen pointer-events-none bg-box"
      />
    </Teleport>
  </div>
</template>
<script setup lang="ts">
  import type { CSSProperties } from 'vue'
  import { useRoute } from 'vue-router'
  import { useAutoLayoutHeight } from '@/hooks/core/useLayoutHeight'
  import { useSettingStore } from '@/store/modules/setting'
  import { useWorktabStore } from '@/store/modules/worktab'

  defineOptions({ name: 'ArtPageContent' })

  const route = useRoute()
  /*
   * 临时导航记录器（排查"切页闪一下上一页"）：URL 带 ?debug=1 时左下角显示最近记录。
   * 记录：路由变化（from → to）、RouterView 当前组件名变化（mounted/activated 的迹象）、
   * 以及每次 Transition 进入/离开的开始时间。定位完删除。
   */
  const navDebugOn = (() => {
    const parse = (s: string) => {
      const q = String(s || '').split('?')[1] || ''
      return new URLSearchParams(q).get('debug') === '1'
    }
    return parse(window.location.hash) || parse(window.location.search)
  })()
  const navLog = ref<string[]>([])
  const pushNav = (msg: string) => {
    if (!navDebugOn) return
    const ts = String(Date.now() % 1000000).padStart(6, '0')
    navLog.value = [...navLog.value.slice(-9), `${ts} ${msg}`]
  }
  if (navDebugOn) {
    const router = useRouter()
    router.afterEach((to, from) => pushNav(`ROUTE ${from.fullPath} → ${to.fullPath}`))
  }

  /** Transition 钩子：记录进/出场（判断是真在过渡，还是没有过渡也在闪） */
  function onTransitionEnter(el: Element) {
    pushNav('ENTER ' + (el instanceof HTMLElement ? el.className.split(' ')[0] : ''))
  }
  function onTransitionLeave(el: Element) {
    pushNav('LEAVE ' + (el instanceof HTMLElement ? el.className.split(' ')[0] : ''))
  }
  const { containerMinHeight } = useAutoLayoutHeight()
  const { pageTransition, containerWidth, refresh } = storeToRefs(useSettingStore())
  const { keepAliveExclude } = storeToRefs(useWorktabStore())

  /**
   * 不允许被 KeepAlive 缓存的页面（参数型详情页）。
   *
   * KeepAlive 的 include/exclude 按**组件 name** 匹配：
   *   · 场次详情 DouyinDetail —— 每场数据都在变，缓存没意义，还会让轮询停不下来
   *   · 用户画像 DouyinProfile
   * 这两个页面路由里本来就没写 keepAlive，这里显式排除，
   * 保证合成单一 Transition 后它们仍是"每次进都重新挂载"。
   */
  const NON_CACHED_PAGE_NAMES = ['DouyinDetail', 'DouyinProfile']
  const pageKeepAliveExclude = computed(() => [...keepAliveExclude.value, ...NON_CACHED_PAGE_NAMES])

  const isRefresh = shallowRef(true)
  const isOpenRouteInfo = import.meta.env.VITE_OPEN_ROUTE_INFO
  const showTransitionMask = ref(false)

  // 标记是否是首次加载（浏览器刷新）
  const isFirstLoad = ref(true)

  // 检查当前路由是否需要使用无基础布局模式
  const isFullPage = computed(() => route.matched.some((r) => r.meta?.isFullPage))
  const prevIsFullPage = ref(isFullPage.value)

  /*
   * 「场次历史 ⇄ 场次详情」之间不做过渡动画。
   *
   * 实测（debug HUD）：这两个页面互切时，out-in 的淡出和进场之间有 240~620ms 的空窗，
   * 期间旧页在淡出、新页还没挂载，看起来就是"闪一下上一页 / 白屏"。
   * 只对这一对页面生效 —— 其它页面（总览、趋势、通知…）的动画完全不受影响。
   */
  const prevPathRef = ref(route.fullPath)
  const routerForTransition = useRouter()
  routerForTransition.beforeEach((to, from) => {
    prevPathRef.value = from.fullPath
  })
  const isDetailPath = (p: string) => p.startsWith('/douyin/detail/')
  const isSessionsPath = (p: string) => p.startsWith('/douyin/sessions')
  const isDetailHistoryPair = computed(() => {
    const a = prevPathRef.value
    const b = route.fullPath
    return (isDetailPath(a) && isSessionsPath(b)) || (isSessionsPath(a) && isDetailPath(b))
  })

  // 切换动画名称：首次加载、从全屏返回、详情⇄历史 时不使用动画
  const actualTransition = computed(() => {
    if (isFirstLoad.value) return ''
    if (prevIsFullPage.value && !isFullPage.value) return ''
    if (isDetailHistoryPair.value) return ''
    return pageTransition.value
  })

  // 监听全屏状态变化，显示过渡遮罩
  watch(isFullPage, (val, oldVal) => {
    if (val !== oldVal) {
      showTransitionMask.value = true
      // 延迟隐藏遮罩，给足时间让页面完成切换
      setTimeout(() => {
        showTransitionMask.value = false
      }, 50)
    }

    nextTick(() => {
      prevIsFullPage.value = val
    })
  })

  const containerStyle = computed(
    (): CSSProperties =>
      isFullPage.value
        ? {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100vh',
            zIndex: 2500,
            background: 'var(--default-bg-color)'
          }
        : {
            maxWidth: containerWidth.value
          }
  )

  const contentStyle = computed(
    (): CSSProperties => ({
      minHeight: containerMinHeight.value
    })
  )

  const reload = () => {
    isRefresh.value = false
    nextTick(() => {
      isRefresh.value = true
    })
  }

  watch(refresh, reload, { flush: 'post' })

  // 组件挂载后标记首次加载完成
  onMounted(() => {
    // 延迟一帧，确保首次渲染完成
    nextTick(() => {
      isFirstLoad.value = false
    })
  })
</script>

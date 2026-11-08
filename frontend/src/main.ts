import App from './App.vue'
import { createApp } from 'vue'
import { initStore } from './store'                 // Store
import { initRouter } from './router'               // Router
import language from './locales'                    // 国际化
import '@styles/core/tailwind.css'                  // tailwind
import '@styles/index.scss'                         // 样式
import '@utils/sys/console.ts'                      // 控制台输出内容
import { setupGlobDirectives } from './directives'
import { setupErrorHandle } from './utils/sys/error-handle'
import { prefetchPagesWhenIdle } from './router/core/prefetch'
// 离线图标：必须在任何组件渲染前注册 —— 否则首屏图标会先走一次运行时 CDN，
// 而这台机器上三个 iconify CDN 域名全部连不上（实测），结果就是图标空白。
import { registerOfflineIcons } from './utils/ui/iconify-loader'
import { setupScrollbarAutoHide } from './utils/ui/scrollbar-auto-hide'
import { useSettingStore } from './store/modules/setting'

registerOfflineIcons()
// 滚动条自动隐藏：全局只装一次 scroll 捕获监听（见 utils/ui/scrollbar-auto-hide.ts）
setupScrollbarAutoHide()

document.addEventListener(
  'touchstart',
  function () {},
  { passive: false }
)

const app = createApp(App)
initStore(app)

/*
 * 一次性迁移：把老默认的页面过渡（自造的 dy-fade-lift）换成模板原版的 slide-left。
 *
 * 为什么必须写迁移而不是只改默认值：pageTransition 是持久化到 localStorage 的，
 * 老用户浏览器里存着 'dy-fade-lift'，改默认值对他们不生效 ——
 * 用户反馈"原版那种切换更舒服"，所以这里主动迁一次；只迁一次（打标记），
 * 之后用户在设置面板里自己选的值不会再被覆盖。
 */
try {
  const MIGRATION_KEY = 'dy-page-transition-migrated-v1'
  if (!localStorage.getItem(MIGRATION_KEY)) {
    const store = useSettingStore()
    if (store.pageTransition === 'dy-fade-lift') store.setPageTransition('slide-left')
    localStorage.setItem(MIGRATION_KEY, '1')
  }
} catch (e) {
  /* 迁移失败不影响启动 */
}
initRouter(app)
setupGlobDirectives(app)
setupErrorHandle(app)

app.use(language)
app.mount('#app')

/*
 * 空闲时预取抖音各页的分包：路由是懒加载的，首次进入某页要先下载它的 JS
 * （生产版实测单个分包 39~124KB）。登录后浏览器空闲时先拉下来，
 * 点菜单时直接命中缓存，跳转不再等 chunk。
 * 只在空闲时跑，不抢首屏资源；失败静默（真进页面时会正常加载）。
 */
prefetchPagesWhenIdle([
  '/douyin/dashboard',
  '/douyin/rooms',
  '/douyin/sessions',
  '/douyin/trends',
  '/douyin/search',
  '/douyin/status',
  '/douyin/detail',
  '/douyin/profile'
])
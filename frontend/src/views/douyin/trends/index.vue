<!--
  趋势分析

  ## 这个页面的核心逻辑（重做过）

  原来它只有「时间范围」一个维度，后端 SQL 是 `WHERE create_time >= ...`，
  把**所有房间**的礼物/弹幕按日期加总 —— 那是"全站总和的日曲线"。

  为什么那样没意义：各房间的基线差几十倍（单场平均钻石从 1.9 万到 99 万），
  加总后的起伏主要反映"今天一共开了几场"，而不是任何一个直播间变好或变差。

  现在改为：**同一房间自己和自己比** —— 每个数据点是一场直播。
  · 选一个房间：看它自己的走势（这次比上次好还是差）
  · 多选几个房间：叠在同一张图对比（这才是"多房间对比"的意义）
  · X 轴默认按**场次**：同一主播一天可能播两场（如下午场 + 晚间场，
    两者峰值能差 3 倍），按日聚合会把它们压成一个点、抹掉这个差异；也可切换按日/周/月
-->
<template>
  <div class="douyin-page dy-stagger p-4">
    <!-- 面包屑统一由顶栏渲染（原来这里那份与顶栏内容一字不差地重复） -->

    <!-- 页头：标题 + 说明 + 筛选（和模板分析页同一套 art-card / art-card-header） -->
    <div class="art-card p-5 mb-5">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="art-card-header !mb-0">
          <div class="title">
            <h4>趋势分析</h4>
            <p>按场次 / 日 / 周 / 月看单个或多个主播的走势，并与上一个等长周期对比</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
        <el-select
        <el-select
          v-model="selectedHosts"
          multiple
          collapse-tags
          collapse-tags-tooltip
          :multiple-limit="4"
          placeholder="选择房间（可多选对比，最多 4 个）"
          style="width: 340px"
          @change="refresh"
        >
          <el-option
            v-for="h in hosts"
            :key="h.hostId"
            :label="h.name"
            :value="h.hostId"
            :disabled="h.sessionCount === 0"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="truncate">{{ h.name }}</span>
              <span class="text-xs text-g-500 shrink-0">{{ h.sessionCount }} 场</span>
            </div>
          </el-option>
        </el-select>
        </div>
        <div class="dy-toolbar-actions">
        <el-radio-group v-model="range" @change="refresh">
          <el-radio-button value="7d">7天</el-radio-button>
          <el-radio-button value="30d">30天</el-radio-button>
          <el-radio-button value="90d">90天</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="xMode" @change="redraw">
          <el-radio-button value="session">按场次</el-radio-button>
          <el-radio-button value="day">按日</el-radio-button>
          <el-radio-button value="week">按周</el-radio-button>
          <el-radio-button value="month">按月</el-radio-button>
        </el-radio-group>
        <el-button :loading="loading" @click="refresh">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />刷新
        </el-button>
        </div>
      </div>
    </div>

    <!--
      失败必须可见（P0-3）：不能把"取不到"显示成"没有数据"。
    -->
    <el-alert
      v-if="queryError"
      type="error"
      :closable="false"
      show-icon
      class="mb-5"
      title="趋势数据加载失败"
    >
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs break-all">{{ queryError }}</span>
        <el-button size="small" type="primary" plain :loading="loading" @click="refresh">
          重试
        </el-button>
      </div>
    </el-alert>

    <!--
      首次加载先占住位置，再出内容（UI-AUDIT P0-3）。
      原来这里的占位块是 `v-loading`（白板 + 转圈）—— 现在换成**图表形状的骨架**：
      左侧纵轴刻度位、底部横轴、几根高低不同的柱子。数据回来时视觉上是"柱子长出来"，
      而不是"白板揭开"（与总览/信息查询页同一套做法）。
      高度按真实图表的 420px 占位，避免数据到达时高度一次性 +896px。
    -->
    <div v-if="loading && !hasData" class="art-card p-5 min-h-[420px]">
      <div class="flex gap-4 h-[300px] mt-4">
        <div class="flex flex-col justify-between py-1 shrink-0">
          <el-skeleton-item v-for="i in 5" :key="i" variant="text" style="width: 42px" />
        </div>
        <div class="flex-1 flex items-end gap-3 min-w-0">
          <el-skeleton-item
            v-for="(h, i) in [42, 68, 55, 82, 61, 74, 48]"
            :key="i"
            variant="rect"
            :style="`flex:1; height:${h}%`"
          />
        </div>
      </div>
      <div class="flex items-center justify-between mt-4">
        <el-skeleton-item variant="text" style="width: 120px" />
        <el-skeleton-item variant="text" style="width: 88px" />
      </div>
    </div>

    <!-- 没选房间：明确提示，而不是给一片空白 -->
    <div v-else-if="!selectedHosts.length" class="art-card p-10">
      <el-empty description="请先在上方选择要分析的房间" :image-size="80">
        <div class="text-xs text-g-500">
          选一个房间看它自己的走势；多选几个可以把它们叠在同一张图上对比。
        </div>
      </el-empty>
    </div>

    <template v-else-if="hasData">
      <!-- 全局 KPI 行（聚合所有已选房间）：钻石 / 送礼用户 / 弹幕 / 时长 / 钻时 / Top10 占比。
           每项带「环比上一个等长周期」，用后端已返回的 prevSummary，不额外请求；无比可数据时显式显示「环比 —」。 -->
      <div class="dy-kpi-row mb-5 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <div v-for="k in kpiCards" :key="k.key" class="art-card p-5">
          <div class="text-[11px] leading-none text-g-500">{{ k.label }}</div>
          <div class="mt-2 flex items-end gap-2 flex-wrap">
            <span class="text-2xl font-semibold leading-none text-g-900 tabular-nums">{{ k.value }}</span>
            <span
              v-if="k.delta !== null"
              class="rounded px-1.5 py-0.5 text-[11px] font-medium leading-none"
              :class="k.delta >= 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'"
            >
              {{ k.delta >= 0 ? '↑' : '↓' }}{{ Math.abs(k.delta).toFixed(1) }}%
            </span>
            <span v-else class="text-[11px] leading-none text-g-400">环比 —</span>
          </div>
          <div v-if="k.hint" class="mt-2 text-[11px] leading-none text-g-400">{{ k.hint }}</div>
        </div>
      </div>

      <!--
        ② 钱和流量从哪来：主播占比
        原来这里是「每个房间一张卡」，里面是四个场均数字 —— 和上方 KPI 是同一批数据，
        用户反馈"林语巷这块很怪"。改成占比条：一眼看出钻石和弹幕主要来自谁。
      -->
      <div class="art-card p-5 mb-5">
        <div class="art-card-header">
          <div class="title">
            <h4>钱和流量从哪来</h4>
            <p>所选房间在「总钻石 / 总弹幕」里的占比，按钻石从高到低</p>
          </div>
        </div>
        <div class="flex flex-col gap-3">
          <div v-for="h in hostShareRows" :key="h.name" class="min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <el-avatar :size="20" :src="h.avatar || undefined" class="shrink-0">{{ h.name?.[0] }}</el-avatar>
              <span class="truncate text-sm text-g-800">{{ h.name }}</span>
              <span class="ml-auto shrink-0 text-[11px] text-g-400">
                {{ h.sessions }} 场 · {{ fmtNum(h.diamonds) }} 钻
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-10 shrink-0 text-[10px] text-g-400">钻石</span>
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-g-200/60">
                <div class="h-full rounded-full bg-theme" :style="{ width: h.dPct + '%' }" />
              </div>
              <span class="w-11 shrink-0 text-right text-[11px] tabular-nums text-g-500">{{ h.dPct.toFixed(1) }}%</span>
            </div>
            <div class="mt-1 flex items-center gap-2">
              <span class="w-10 shrink-0 text-[10px] text-g-400">弹幕</span>
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-g-200/60">
                <div class="h-full rounded-full bg-info" :style="{ width: h.mPct + '%' }" />
              </div>
              <span class="w-11 shrink-0 text-right text-[11px] tabular-nums text-g-500">{{ h.mPct.toFixed(1) }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!--
        ③ 什么时候播效果最好：24 小时 × 周几 的「场均钻石」热力图
        用"场均"而不是"总量"：黄金时段播一场顶三场，看总量只会奖励播得多的人。
      -->
      <div class="art-card p-5 mb-5">
        <div class="art-card-header">
          <div class="title">
            <h4>什么时候播效果最好</h4>
            <p>
              横轴 0–23 点、纵轴周几，颜色是该时段的场均钻石<template v-if="bestSlot"> · 最佳 {{ bestSlot.weekday }} {{ bestSlot.hour }} 点，场均 {{ fmtNum(bestSlot.avg) }} 钻（{{ bestSlot.count }} 场）</template>
            </p>
          </div>
        </div>
        <!--
          用 CSS 网格画热力图，不用 echarts：
          heatmap 在"类目轴 + 坐标名"这套组合上试了三轮都画不出格子（下标/类目名都对不上），
          而这里只有 168 个格子，div + 背景色最稳，还自带响应式。
        -->
        <div class="mt-2 flex gap-2">
          <!-- 周几标签 -->
          <div class="flex shrink-0 flex-col gap-[3px] pt-[14px]">
            <div v-for="w in WEEK_LABELS" :key="w" class="flex h-4 items-center text-[10px] text-g-400">
              {{ w }}
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <!-- 小时刻度 -->
            <div class="mb-1 grid gap-[3px]" style="grid-template-columns: repeat(24, minmax(0, 1fr))">
              <div
                v-for="h in 24"
                :key="'h' + h"
                class="text-center text-[9px] leading-none text-g-400"
              >
                {{ (h - 1) % 3 === 0 ? h - 1 : '' }}
              </div>
            </div>
            <div class="flex flex-col gap-[3px]">
              <div v-for="w in WEEK_LABELS" :key="w" class="grid gap-[3px]" style="grid-template-columns: repeat(24, minmax(0, 1fr))">
                <div
                  v-for="c in heatCellsFor(w)"
                  :key="w + c.hour"
                  class="h-4 rounded-[3px] transition-colors"
                  :style="{ background: c.bg }"
                  :title="c.title"
                />
              </div>
            </div>
          </div>
        </div>
      </div>


      <!-- 指标开关：自己选要看哪些 -->
      <div class="art-card p-4 mb-5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm text-g-600 mr-1">显示指标</span>
          <el-check-tag
            v-for="m in allMetrics"
            :key="m.key"
            :checked="activeMetrics.includes(m.key)"
            @change="(v: boolean) => toggleMetric(m.key, v)"
          >
            {{ m.label }}
          </el-check-tag>
        </div>
      </div>

      <!--
        每个指标一张图。
        不做多指标叠一张：量级差太大（钻石 6 位数 vs 峰值 3 位数），
        共用一根轴会把小的那条压成贴地直线 —— 这是原来「时间线」犯过的错。

        这里用「全部渲染 + v-show 切换」而不是 v-for + 动态 :ref：
        函数式 :ref 每次渲染都会生成新闭包，会触发
        "Maximum recursive updates exceeded"（实测踩到过）。
        固定 ref 引用 + v-show 没有这个问题，图表实例也不用来回销毁重建。

        :data-metric 不是摆设：allMetrics 是 script setup 的 const，
        编译器把该 v-for 标成 STABLE_FRAGMENT，纯静态子节点不会进
        dynamicChildren，patch 时被整体跳过 —— v-show 的 updated 钩子
        永远不执行，勾选非默认指标后卡片一直是 display:none（实测踩到过）。
        给元素一个动态 prop（pf>0）才会被收集进 dynamicChildren、走正常 patch。
      -->
      <!-- 指标图：宽屏两列并排（原来一列竖排 4 张、每张 288px，一屏放不下又不精致） -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
      <div
        v-for="m in allMetrics"
        v-show="activeMetrics.includes(m.key)"
        :key="m.key"
        :data-metric="m.key"
        class="art-card p-5"
      >
        <div class="art-card-header">
          <div class="title flex items-center gap-2">
            <ArtSvgIcon :icon="m.icon" class="text-theme" />
            <div>
              <h4>{{ m.label }}</h4>
              <p>{{ m.hint }}</p>
            </div>
          </div>
          <span class="text-[11px] text-g-400">{{ xAxisLabel }}</span>
        </div>
        <!-- ref 用静态 key，配合下面的 chartRefs 记录 -->
        <div :ref="recordChart(m.key)" class="h-56"></div>
      </div>

      </div>

    </template>

    <div v-else-if="!queryError" class="art-card p-10">
      <el-empty description="该时间范围内没有数据" :image-size="80">
        <div class="text-xs text-g-500">
          可以换一个更长的时间范围，或先确认这些房间是否已开始采集。
        </div>
      </el-empty>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
  import { storeToRefs } from 'pinia'
  import { useChartOps } from '@/hooks/core/useChart'
  import { useSettingStore } from '@/store/modules/setting'  import { ElMessage } from 'element-plus'
  import { echarts } from '@/plugins/echarts'
  import {
    fetchHostTrends,
    fetchStreamers,
    type HostTrendSummary,
    type HostTrendSeries,
    type TrendMetricKey
  } from '@/api/douyin'
  import { apiErrorMessage } from '@/utils/douyin-error'
  import { fmtNum, fmtTime } from '@/utils/format'

  defineOptions({ name: 'DouyinTrends' })

  // 场次明细表已删（用户要求），跳详情用的 router 也一并移除

  const loading = ref(true)
  const queryError = ref('')
  const hosts = ref<{ hostId: number; name: string; avatar: string | null; sessionCount: number }[]>([])
  const selectedHosts = ref<number[]>([])
  const series = ref<HostTrendSeries[]>([])
  const range = ref('30d')
  /** X 轴粒度：场次（默认）/ 日 / 周 / 月 */
  const xMode = ref<'session' | 'day' | 'week' | 'month'>('day')


  const hasData = computed(() => series.value.some((s) => s.points.length > 0))

  /** KPI 卡上展示的四项（平均每场） */
  const kpiKeys = [
    { key: 'avgPeakOnline', label: '平均峰值在线', fmt: (v: number) => fmtNum(v) },
    { key: 'avgDiamonds', label: '平均钻石/场', fmt: (v: number) => fmtNum(v) },
    { key: 'avgDanmaku', label: '平均弹幕/场', fmt: (v: number) => fmtNum(v) },
    { key: 'avgDurationMinutes', label: '平均时长', fmt: (v: number) => `${v}分` }
  ]

  /** 全部可选指标 */
  const allMetrics: { key: TrendMetricKey; label: string; icon: string; hint: string }[] = [
    { key: 'peakOnline', label: '峰值在线', icon: 'ri:signal-wifi-line', hint: '每场最高同时在线人数' },
    { key: 'diamonds', label: '钻石', icon: 'ri:diamond-line', hint: '每场礼物收入（去重后）' },
    { key: 'danmaku', label: '弹幕', icon: 'ri:chat-3-line', hint: '每场弹幕条数' },
    { key: 'gifts', label: '礼物数', icon: 'ri:gift-2-line', hint: '每场礼物件数' },
    { key: 'users', label: '参与用户', icon: 'ri:group-line', hint: '每场发过弹幕或送礼的人数' },
    { key: 'durationMinutes', label: '时长', icon: 'ri:time-line', hint: '每场直播分钟数' },
    {
      key: 'diamondsPerHour',
      label: '钻/时',
      icon: 'ri:speed-up-line',
      hint: '每小时钻石，排除"播得久所以赚得多"'
    },
    {
      key: 'danmakuPerThousand',
      label: '弹幕/千人',
      icon: 'ri:chat-smile-2-line',
      hint: '每千名在线观众的弹幕量，衡量互动热度'
    }
  ]

  /** 默认只看这三个：监测场景最关心的就是"人多不多、赚不赚、聊不聊" */
  const activeMetrics = ref<TrendMetricKey[]>(['peakOnline', 'diamonds', 'danmaku'])

  /**
   * 切换指标显示。
   *
   * 注意：`el-check-tag` 的 change 事件传出的是**新值**（它内部已经做了 `!checked`），
   * 所以这里必须用传进来的 
ext`，不能再按当前状态取反一次 ——
   * 两个反相会互相抵消，表现就是"点了没反应"（实测踩到过）。
   */
  function toggleMetric(key: TrendMetricKey, next: boolean) {
    const i = activeMetrics.value.indexOf(key)
    if (next) {
      if (i < 0) activeMetrics.value.push(key)
    } else {
      // 至少留一个，否则页面会空掉。必须说出来，否则用户看到的是"点了没反应"（UI-AUDIT P2-12）
      if (activeMetrics.value.length === 1) {
        ElMessage.info('至少保留一个指标')
        return
      }
      if (i >= 0) activeMetrics.value.splice(i, 1)
    }
  }

  /**
   * 指标 → 图表容器 DOM 的映射。
   *
   * 故意用普通对象（不是 ref）：它只在渲染后被写入、在 redraw 里被读取，
   * 不参与响应式。放进响应式里会在写它的同时触发重渲染，正是
   * "Maximum recursive updates exceeded" 的成因之一。
   */
  const chartEls: Record<string, HTMLElement> = {}
  function recordChart(key: string) {
    return (el: unknown) => {
      if (el instanceof HTMLElement) chartEls[key] = el
    }
  }

  /** 与上一周期比：只在有 prevSummary 时给 */
  function delta(s: HostTrendSeries, key: string) {
    const prev = s.prevSummary as Record<string, number> | null
    if (!prev) return null
    const cur = s.summary[key as keyof HostTrendSummary] as number
    const old = prev[key]
    if (!old || old <= 0 || cur === undefined) return null
    const pct = Math.round(((cur - old) / old) * 100)
    if (!Number.isFinite(pct) || pct === 0) return null
    return { up: pct > 0, pct: Math.abs(pct) }
  }

  /**
   * 按 X 轴粒度把「每场」的点聚合。
   * 按场次时原样返回；按日/周/月时同一区间的场次取**平均**（不是求和）——
   * 求和会让"播得多的那天"看起来更好，而我们要看的是"每场表现"。
   */
  function bucketKey(startAt: string): string {
    const d = new Date(String(startAt).replace(' ', 'T'))
    if (Number.isNaN(d.getTime())) return String(startAt).slice(0, 10)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    if (xMode.value === 'day') return `${y}-${m}-${day}`
    if (xMode.value === 'month') return `${y}-${m}`
    // 周：以周一为界
    const wd = d.getDay()
    const diff = wd === 0 ? 6 : wd - 1
    const mon = new Date(d)
    mon.setDate(d.getDate() - diff)
    return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
  }

  const xAxisLabel = computed(() => {
    const map: Record<string, string> = {
      session: 'X 轴：每场直播',
      day: 'X 轴：按日（当天多场取平均）',
      week: 'X 轴：按周（当周多场取平均）',
      month: 'X 轴：按月（当月多场取平均）'
    }
    return map[xMode.value]
  })

  interface Bucket {
    label: string
    keys: TrendMetricKey[]
    /** 每个指标的累加值 + 场次数，最后取平均 */
    acc: Record<string, number>
    count: number
    sessions: number[]
  }

  /** 把一个序列转成 X 轴标签 + 各指标的数值数组 */
  function toAxis(s: HostTrendSeries, metricKeys: TrendMetricKey[]) {
    if (xMode.value === 'session') {
      return {
        labels: s.points.map((p) => fmtTime(p.startAt)),
        values: metricKeys.map((k) => s.points.map((p) => (p[k] as number) ?? 0)),
        points: s.points
      }
    }
    const order: string[] = []
    const map = new Map<string, Bucket>()
    for (const p of s.points) {
      const k = bucketKey(p.startAt)
      if (!map.has(k)) {
        map.set(k, { label: k, keys: metricKeys, acc: {}, count: 0, sessions: [] })
        order.push(k)
      }
      const b = map.get(k)!
      for (const mk of metricKeys) b.acc[mk] = (b.acc[mk] || 0) + ((p[mk] as number) ?? 0)
      b.count += 1
      b.sessions.push(p.sessionId)
    }
    const buckets = order.map((k) => map.get(k)!).sort((a, b) => a.label.localeCompare(b.label))
    return {
      labels: buckets.map((b) => b.label),
      values: metricKeys.map((mk) => buckets.map((b) => Math.round((b.acc[mk] || 0) / b.count))),
      points: buckets.flatMap((b) => b.sessions)
    }
  }

  /** 等一帧，让 v-show 的 display 变更真正生效（浏览器需要一次样式计算） */
  function nextFrame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }

  /**
   * 等某个图表的容器变成可见且有尺寸。
   *
   * 为什么不能只用 `await nextTick()`：在 `flush: 'post'` 的 watcher 里，
   * nextTick 会**立即** resolve，而此时 v-show 改的 display 还没被浏览器计算，
   * clientWidth 依旧是 0（实测刚勾选的容器是 `0x0`）——
   * 于是被"尺寸为 0 就跳过"的守卫拦掉，图永远画不出来。
   * 这里显式轮询到可见为止，最多等 ~500ms。
   */
  async function waitVisible(el: HTMLElement, tries = 25): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
      if (el.clientWidth > 0 && el.clientHeight > 0) return true
      await nextFrame()
    }
    return el.clientWidth > 0 && el.clientHeight > 0
  }

  /** 用柱状图呈现的"量类"指标；人数/比率/时长仍用折线 */
  const BAR_METRICS = ['diamonds', 'danmaku', 'gifts']

  /** 模板的图表主题（调色板/字号），与 Art Design Pro 的图表组件保持一致 */
  const chartOps = computed(() => useChartOps())
  const { isDark } = storeToRefs(useSettingStore())

  /** 渲染/重绘所有指标图 */
  async function redraw() {
    await nextTick()
    for (const m of allMetrics) {
      if (!activeMetrics.value.includes(m.key)) continue
      const el = chartEls[m.key]
      if (!el) continue
      // 等容器真正显示出来（见 waitVisible 的说明）
      if (!(await waitVisible(el))) continue
      const existing = echarts.getInstanceByDom(el)
      if (existing) existing.dispose()
      if (!series.value.length) continue
      const chart = echarts.init(el)

      // 用第一个序列的 X 轴（按场次时各房间场次不同，无法对齐 —— 这是"按场次"的固有限制，
      // 所以多房间对比时提示用日期粒度）
      const aligned = xMode.value !== 'session'
      const first = toAxis(series.value[0], [m.key])
      const labels = first.labels

      /*
       * 样式全部对齐模板的图表组件（hooks/core/useChart.ts 的 getSplitLineStyle 等）：
       *   · 网格线用**虚线**（#EDEDED / 暗色 #444），坐标轴线与刻度隐藏
       *   · 调色板用 useChartOps().colors（主色 + #4ABEFF + #14DEBA + #FFAF20 …）
       *   · 折线去掉圆点、线宽 2.5；柱状圆角 6、最大宽度 18
       * 之前这里是 echarts 默认样式（实线网格 + 默认蓝），所以看着"不如模板精致"。
       */
      const theme = chartOps.value
      const axisColor = isDark.value ? '#444' : '#EDEDED'
      const labelColor = '#999'
      const splitLine = { show: true, lineStyle: { color: axisColor, width: 1, type: 'dashed' } }
      const axisLine = { show: false, lineStyle: { color: axisColor } }

      const option: Record<string, unknown> = {
        color: theme.colors,
        textStyle: { fontSize: 12, color: labelColor },
        tooltip: {
          trigger: 'axis',
          valueFormatter: (v: number) => fmtNum(v),
          backgroundColor: isDark.value ? 'rgba(30,30,32,0.95)' : 'rgba(255,255,255,0.98)',
          borderWidth: 1,
          borderColor: axisColor,
          borderRadius: 8,
          padding: [8, 12],
          textStyle: { fontSize: 12, color: isDark.value ? '#eee' : '#333' }
        },
        legend: {
          data: series.value.map((s) => s.name),
          type: 'scroll',
          bottom: 0,
          left: 'center',
          icon: 'circle',
          itemWidth: 8,
          itemHeight: 8,
          itemGap: 16,
          textStyle: { fontSize: 12, color: labelColor }
        },
        grid: { left: 8, right: 16, top: 16, bottom: 36, containLabel: true },
        xAxis: {
          type: 'category',
          data: labels,
          axisLine,
          axisTick: { show: false },
          axisLabel: {
            fontSize: 11,
            color: labelColor,
            rotate: 0,
            // 日期只留 MM-DD；标签多时自动抽稀，避免挤成一团
            formatter: (v: string) => (typeof v === 'string' && v.length >= 10 ? v.slice(5) : v),
            interval: labels.length > 14 ? Math.ceil(labels.length / 12) - 1 : 0,
            hideOverlap: true
          }
        },
        yAxis: {
          type: 'value',
          axisLine,
          axisTick: { show: false },
          splitLine,
          axisLabel: { fontSize: 11, color: labelColor, formatter: (v: number) => fmtNum(v) }
        },
        series: series.value.map((s, i) => {
          const ax = toAxis(s, [m.key])
          const isBar = BAR_METRICS.includes(m.key)
          return {
            name: s.name,
            // 量类指标用柱（一眼看量级），比率/人数类用折线
            type: isBar ? 'bar' : 'line',
            smooth: true,
            showSymbol: false,
            symbolSize: 0,
            connectNulls: true,
            ...(isBar
              ? {
                  barMaxWidth: 18,
                  itemStyle: { borderRadius: [6, 6, 0, 0], opacity: 0.9 },
                  emphasis: { focus: 'series' }
                }
              : {
                  lineStyle: { width: 2.5 },
                  areaStyle:
                    series.value.length === 1
                      ? {
                          opacity: 0.16,
                          color: {
                            type: 'linear',
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [
                              { offset: 0, color: theme.colors[i % theme.colors.length] },
                              { offset: 1, color: 'rgba(255,255,255,0)' }
                            ]
                          }
                        }
                      : undefined
                }),
            data: ax.values[0]
          }
        })
      }
      chart.setOption(option)
      // 多房间时 X 轴按场次无法对齐，给出说明而不是画错
      if (!aligned && series.value.length > 1) {
        chart.setOption({
          graphic: [
            {
              type: 'text',
              right: 12,
              top: 8,
              style: {
                text: '多房间对比建议切到"按日"，各房间场次数不同无法按场次对齐',
                fontSize: 11,
                fill: '#8a94a6'
              }
            }
          ]
        })
      }
    }
  }

  function disposeCharts() {
    // chartEls 是普通对象（Record），不是数组 —— 原来写 .forEach 会在卸载时抛
    // TypeError: chartEls.forEach is not a function，echarts 实例全部泄漏。
    Object.values(chartEls).forEach((el) => echarts.getInstanceByDom(el)?.dispose())
  }

  async function loadHosts() {
    try {
      /**
       * 用 /api/streamers：它返回 `{ id, name, avatar, session_count, sec_uid }`，
       * 其中 `id` 就是趋势接口要的 streamer 主键，`session_count` 可直接用来排序。
       *
       * 注意别用 /api/streamers 里的 `sec_uid` 当 id —— 那是真的抖音 sec_uid（字符串），
       * 不是主键。另外 /api/rooms 只包含"已监控"的房间，会漏掉部分主播，
       * 所以这里用 streamers 全量。
       */
      const list = await fetchStreamers()
      hosts.value = list
        .map((h) => ({
          hostId: Number(h.id),
          name: h.name,
          // 后端返回的是 avatar（不是 avatar_url）—— 读错字段会让这排头像永远空白（审计 P1-15）
        avatar: h.avatar ?? h.avatar_url ?? null,
          sessionCount: h.session_count ?? 0
        }))
        .filter((h) => Number.isFinite(h.hostId))
      // 默认选场次最多的那个房间，省一步操作
      if (!selectedHosts.value.length) {
        const best = [...hosts.value].sort((a, b) => b.sessionCount - a.sessionCount)[0]
        if (best && best.sessionCount > 0) selectedHosts.value = [best.hostId]
      }
    } catch (e) {
      queryError.value = apiErrorMessage(e, '房间列表加载失败')
    }
  }

  /** 数据加载时间（供 onActivated 节流判断用） */
  let lastLoadedAt = 0

  async function refresh() {
    if (!selectedHosts.value.length) {
      series.value = []
      loading.value = false
      return
    }
    loading.value = true
    try {
      const data = await fetchHostTrends(selectedHosts.value, range.value)
      series.value = data.series || []
      queryError.value = ''
      lastLoadedAt = Date.now()
      await redraw()
    } catch (e) {
      queryError.value = apiErrorMessage(e, '趋势数据加载失败')
    } finally {
      loading.value = false
    }
  }

  /**
   * ② 钱和流量从哪来：按钻石 / 弹幕算每个主播的占比。
   * 数据直接来自 series 的 summary（后端已经按时间范围聚好），不需要额外请求。
   */
  const hostShareRows = computed(() => {
    const totalD = series.value.reduce((a, s) => a + (s.summary.totalDiamonds || 0), 0)
    const totalM = series.value.reduce((a, s) => a + (s.summary.totalDanmaku || 0), 0)
    return series.value
      .map((s) => ({
        name: s.name,
        avatar: s.avatar,
        sessions: s.summary.sessions || 0,
        diamonds: s.summary.totalDiamonds || 0,
        dPct: totalD > 0 ? ((s.summary.totalDiamonds || 0) / totalD) * 100 : 0,
        mPct: totalM > 0 ? ((s.summary.totalDanmaku || 0) / totalM) * 100 : 0
      }))
      .sort((a, b) => b.diamonds - a.diamonds)
  })

  /* ===== ③ 什么时候播效果最好：24×7 热力图 ===== */

  const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

  /** 每格累计：钻石之和 / 场次数（点里没有直播时长的，用场次做分母就是"场均"） */
  const heatBuckets = computed(() => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ sum: 0, n: 0 })))
    for (const s of series.value) {
      for (const p of s.points) {
        if (!p.hasData || !p.startAt) continue
        const d = new Date(String(p.startAt).replace(' ', 'T'))
        if (Number.isNaN(d.getTime())) continue
        const wd = (d.getDay() + 6) % 7 // 0=周一
        const hh = d.getHours()
        grid[wd][hh].sum += Number(p.diamonds) || 0
        grid[wd][hh].n += 1
      }
    }
    return grid
  })

  /** 最佳时段（场均钻石最高，且至少 1 场） */
  const bestSlot = computed(() => {
    let best: { weekday: string; hour: number; avg: number; count: number } | null = null
    const grid = heatBuckets.value
    for (let wd = 0; wd < 7; wd++) {
      for (let hh = 0; hh < 24; hh++) {
        const b = grid[wd][hh]
        if (!b.n) continue
        const avg = b.sum / b.n
        if (!best || avg > best.avg) {
          best = { weekday: WEEK_LABELS[wd], hour: hh, avg: Math.round(avg), count: b.n }
        }
      }
    }
    return best
  })

  /**
   * 热力图的格子数据（168 格）。
   * ratio 用**中位数**做分母：一场 205 万的爆发场会把 max 顶到 200 万，
   * 其余几万的格子就全变成最浅色，看起来像"没有数据"。
   */
  const heatScale = computed(() => {
    const grid = heatBuckets.value
    const avgs: number[] = []
    for (let wd = 0; wd < 7; wd++) {
      for (let hh = 0; hh < 24; hh++) {
        const b = grid[wd][hh]
        if (b.n) avgs.push(b.sum / b.n)
      }
    }
    avgs.sort((a, b) => a - b)
    const mid = avgs.length ? avgs[Math.floor((avgs.length - 1) * 0.5)] : 0
    return Math.max(1, mid)
  })

  /** 按周几取一行 24 个格子 */
  function heatCellsFor(weekday: string) {
    const wd = WEEK_LABELS.indexOf(weekday)
    const grid = heatBuckets.value
    const scale = heatScale.value
    return Array.from({ length: 24 }, (_, hh) => {
      const b = grid[wd]?.[hh] || { sum: 0, n: 0 }
      const avg = b.n ? b.sum / b.n : 0
      const ratio = b.n ? Math.min(1, avg / scale) : 0
      return {
        hour: hh,
        avg,
        bg: b.n ? `rgba(99, 102, 241, ${(0.12 + ratio * 0.78).toFixed(3)})` : 'transparent',
        title: b.n ? `${weekday} ${hh}:00 · 场均 ${fmtNum(Math.round(avg))} 钻（${b.n} 场）` : `${weekday} ${hh}:00 · 没有场次`
      }
    })
  }

  /** 全局 KPI（聚合所有已选房间）+ 环比（后端 prevSummary） */
  const kpiCards = computed(() => {
    const ss = series.value
    if (!ss.length) return []
    const nf = (n: number) => new Intl.NumberFormat('zh-CN').format(Math.round(n))
    const pts = ss.flatMap((s) => s.points.filter((p) => p.hasData))
    const sum = (k: 'diamonds' | 'users' | 'danmaku' | 'durationMinutes') => pts.reduce((a, p) => a + (Number(p[k]) || 0), 0)
    const diamonds = sum('diamonds'), users = sum('users'), danmaku = sum('danmaku'), minutes = sum('durationMinutes')
    const hours = minutes / 60
    const days = new Set(pts.map((p) => (p.startAt || '').slice(0, 10)).filter(Boolean)).size
    const prevs = ss.map((s) => s.prevSummary).filter((x): x is NonNullable<typeof x> => !!x)
    const prevAvg = (k: 'avgDiamonds' | 'avgDanmaku' | 'avgDurationMinutes') =>
      prevs.length ? prevs.reduce((a, p) => a + (Number(p[k]) || 0), 0) / prevs.length : null
    const prevSessions = prevs.reduce((a, p) => a + (p.sessions || 0), 0)
    const prevTotal = (k: 'avgDiamonds' | 'avgDanmaku' | 'avgDurationMinutes') => {
      const a = prevAvg(k)
      return a != null && prevSessions ? a * prevSessions : null
    }
    const pct = (cur: number, prev: number | null) => (prev && prev > 0 ? ((cur - prev) / prev) * 100 : null)
    const withTop10 = ss.filter((s) => typeof s.summary.top10Share === 'number')
    const top10 = withTop10.length ? withTop10.reduce((a, s) => a + (s.summary.top10Share || 0), 0) / withTop10.length : null
    const per = (v: number, n: number) => (n > 0 ? nf(v / n) : '—')
    return [
      { key: 'diamonds', label: '总钻石', value: nf(diamonds), delta: pct(diamonds, prevTotal('avgDiamonds')), hint: '场均 ' + per(diamonds, pts.length) },
      { key: 'users', label: '送礼用户（人次）', value: nf(users), delta: null, hint: '场均 ' + per(users, pts.length) },
      { key: 'danmaku', label: '弹幕数', value: nf(danmaku), delta: pct(danmaku, prevTotal('avgDanmaku')), hint: '场均 ' + per(danmaku, pts.length) },
      { key: 'duration', label: '总时长', value: Math.round(hours) + ' 小时', delta: pct(minutes, prevTotal('avgDurationMinutes')), hint: '开播 ' + days + ' 天 · 场均 ' + per(minutes, pts.length) + ' 分钟' },
      { key: 'dph', label: '钻 / 时', value: hours > 0 ? nf(diamonds / hours) : '—', delta: null, hint: '按总时长折算' },
      { key: 'top10', label: 'Top10 占比', value: top10 == null ? '—' : top10.toFixed(1) + '%', delta: null, hint: '前 10 名用户贡献的钻石占比' }
    ]
  })

  // 指标开关变化时只重绘，不用重新请求。
  // flush: 'post' → 回调在 DOM 更新**之后**执行，这样刚勾上的图表容器已经显示、
  // 拿得到真实尺寸（默认 'pre' 会在 DOM 更新前跑，容器还是 display:none）。
  watch(activeMetrics, () => redraw(), { deep: true, flush: 'post' })

  /**
   * 图表跟随视口变化（UI-AUDIT P0-4）。
   *
   * 原来没有任何 resize 监听：窗口缩小后 canvas 仍按旧宽度绘制，超出部分被容器裁掉
   * （实测 1024 视口下 canvas 仍是 1443px）。这页又是 keep-alive，切回来也不会重建，
   * 所以窗口改过大小后必须主动 resize。
   */
  let resizeTimer: number | undefined
  function handleResize() {
    if (resizeTimer) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      for (const m of allMetrics) {
        const el = chartEls[m.key]
        if (el) echarts.getInstanceByDom(el)?.resize()
      }
    }, 150)
  }

  onMounted(async () => {
    window.addEventListener('resize', handleResize)
    await loadHosts()
    await refresh()
  })

  // keep-alive：切回来时容器宽度可能已经变了（侧边栏折叠、窗口缩放），补一次 resize；
  // 同时**补一次取数** —— 这页没有轮询，原来切走期间结束的场次回来也看不到（审计 P2-14）。
  // 用 30 秒节流，避免在标签页之间来回点时反复打接口。
  onActivated(async () => {
    nextTick(() => handleResize())
    if (Date.now() - lastLoadedAt < 30000) return
    await loadHosts()
    await refresh()
  })

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    if (resizeTimer) window.clearTimeout(resizeTimer)
    disposeCharts()
  })
</script>

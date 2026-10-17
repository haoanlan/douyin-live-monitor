<template>
  <div class="douyin-page dy-stagger p-4">
    <!-- 失败：与「没有数据」区分开，并给重试入口（与其它抖音页一致） -->
    <QueryErrorState
      v-if="queryError && !loading"
      class="mb-5"
      :message="queryError"
      :retrying="loading"
      @retry="refresh"
    />

    <!--
      首屏骨架：与真实列表**同形**（一条条卡片、同样的网格列数），数据到达时不跳高度。
    -->
    <div v-else-if="loading && !groups.length" class="combined-list-zone mb-5">
      <div class="combined-list">
        <div v-for="i in 9" :key="i" class="combined-item combined-item--ghost">
          <el-skeleton-item variant="text" style="width: 14px; height: 14px" />
          <div class="combined-item__body">
            <el-skeleton-item variant="text" style="width: 86%" />
            <el-skeleton-item variant="text" style="width: 46%" />
            <el-skeleton-item variant="text" style="width: 68%" />
          </div>
        </div>
      </div>
    </div>

    <!-- 没有主播可合并 -->
    <div v-else-if="!groups.length" class="art-card px-5 py-8 mb-5">
      <div class="flex flex-col items-center text-center">
        <div class="size-11 rounded-full flex-cc bg-theme/10 mb-3">
          <ArtSvgIcon icon="ri:merge-cells-horizontal" class="text-xl text-theme" />
        </div>
        <div class="text-sm font-medium text-g-900">暂无可合并的主播</div>
        <p class="mt-1.5 text-xs text-g-600">
          监控列表里还没有主播，先到「房间管理」添加一个直播间。
        </p>
        <el-button class="mt-4" type="primary" plain @click="router.push('/douyin/rooms')">
          <ArtSvgIcon icon="ri:arrow-left-line" class="mr-1" />
          去房间管理
        </el-button>
      </div>
    </div>

    <template v-else>
      <!--
        筛选行：主播（多选下拉，可搜索）+ 时间（日期范围）。
        主播不用平铺标签 —— 直播间会越来越多，标签铺不下；
        下拉自带搜索与折叠，几十个直播间也只占一行。
      -->
      <div class="art-card combined-filters mb-5">
        <div class="combined-filter-row">
          <div class="combined-filter-item">
            <span class="combined-filter-label">主播</span>
            <el-select
              v-model="filterStreamerIds"
              class="combined-filter-select"
              multiple
              filterable
              clearable
              collapse-tags
              collapse-tags-tooltip
              :max-collapse-tags="2"
              placeholder="全部主播"
            >
              <el-option
                v-for="o in streamerOptions"
                :key="String(o.id)"
                :label="`${o.name}（${o.count} 场）`"
                :value="o.id"
              />
            </el-select>
          </div>

          <div class="combined-filter-item">
            <span class="combined-filter-label">时间</span>
            <el-date-picker
              v-model="dateRange"
              class="combined-filter-date"
              type="daterange"
              unlink-panels
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              :shortcuts="dateShortcuts"
            />
          </div>

          <!-- 快捷操作都只作用于**当前筛选结果**（见脚本里各自的注释） -->
          <div class="combined-filter-actions">
            <el-button
              :disabled="!filteredRows.length"
              title="选中筛选结果里开始时间最新的 3 场（会替换掉筛选结果内原有的选择，筛选外的选择保留）"
              @click="selectRecentFiltered"
            >
              <ArtSvgIcon icon="ri:time-line" class="mr-1" />
              最近 {{ recentCount }} 场
            </el-button>
            <el-button
              :disabled="!filteredRows.length"
              :title="`把筛选出的 ${filteredRows.length} 场全部选中（筛选范围外已选的场次保留）`"
              @click="selectAllFiltered"
            >
              <ArtSvgIcon icon="ri:list-check" class="mr-1" />
              全选筛选结果
            </el-button>
            <!--
              跨直播间合并的常见形态：「一场活动里每个直播间各取最近一场」。
              逐个主播去点太慢，这里按当前筛选范围，每个主播各取开始时间最新的一场。
            -->
            <el-button
              :disabled="streamerOptions.length < 2"
              title="跨直播间合并用：当前范围内每个主播各选最近的一场（已在选择里的场次保留）"
              @click="selectLatestPerStreamer"
            >
              <ArtSvgIcon icon="ri:live-line" class="mr-1" />
              每个主播最近 1 场
            </el-button>
            <el-button :disabled="!selectedIds.size" @click="clearSelection">清空选择</el-button>
            <el-button :loading="loading" title="重新拉取主播与场次" @click="refresh">
              <ArtSvgIcon icon="ri:refresh-line" />
            </el-button>
          </div>
        </div>
      </div>

      <!--
        同一主播「相邻场次」里的强信号：上一场结束到这一场开始只隔了几十分钟。
        抖音直播被切断重开后，同一场直播会落成两条场次记录 —— 这类几乎总是要合起来看的。
        这里直接列出最近几组并给一键入口；列表里对应的两条之间也会有一条「间隔」连接条。
      -->
      <div v-if="cutPairs.length" class="art-card combined-reco mb-5">
        <div class="combined-reco__head">
          <ArtSvgIcon icon="ri:link" class="text-theme shrink-0" />
          <span class="combined-reco__title">
            同一直播间的相邻场次 · {{ cutPairs.length }} 组间隔不到 {{ TIGHT_GAP_MIN }} 分钟
          </span>
          <span class="combined-reco__hint">多半是直播被切断后重开，通常要合起来看</span>
          <el-button
            v-if="cutPairs.length > RECO_LIMIT"
            text
            class="ml-auto shrink-0"
            @click="recoExpanded = !recoExpanded"
          >
            {{ recoExpanded ? '收起' : `展开全部 ${cutPairs.length} 组` }}
          </el-button>
        </div>
        <div class="combined-reco__grid">
          <div v-for="p in visibleCutPairs" :key="p.key" class="combined-reco__item">
            <div class="combined-reco__head-row">
              <span class="combined-reco__name" :title="p.streamerName">{{ p.streamerName }}</span>
              <span class="combined-reco__gap">间隔 {{ fmtGap(p.minutes) }}</span>
              <button type="button" class="combined-reco__btn" @click="selectPair(p)">
                合并这两场
              </button>
            </div>
            <div class="combined-reco__ranges">
              {{ p.prevText }} <span class="combined-reco__arrow">＋</span> {{ p.nextText }}
            </div>
          </div>
        </div>
      </div>

      <!--
        场次列表：**不要卡片外壳**（原来是 art-card + 「当前 N 场」工具条）。
        204 场本来就是这一页的主体，套一层卡面只是多一圈边和多一个计数；
        排序按钮单独一行靠右，列表直接铺在页面上。
      -->
      <div class="combined-list-zone mb-24">
        <div class="combined-list-toolbar">
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="combined-sort"
              :class="{ 'combined-sort--on': sortKey === 'time' }"
              title="按开始时间排序（再点一次切换正序/倒序）"
              @click="toggleSort('time')"
            >
              时间
              <ArtSvgIcon :icon="sortIcon('time')" />
            </button>
            <button
              type="button"
              class="combined-sort"
              :class="{ 'combined-sort--on': sortKey === 'diamonds' }"
              title="按钻石排序（再点一次切换正序/倒序）"
              @click="toggleSort('diamonds')"
            >
              钻石
              <ArtSvgIcon :icon="sortIcon('diamonds')" />
            </button>
          </div>
        </div>

        <div class="combined-list">
          <div
            v-for="row in filteredRows"
            :key="row.id"
            class="combined-item"
            :class="selectedIds.has(row.id) ? 'combined-item--on' : ''"
            :aria-selected="selectedIds.has(row.id)"
            :title="rowTitle(row)"
            @click="toggle(row.id)"
          >
            <!--
              这场是接着上一场的（同一主播、间隔 ≤30 分钟）：多半是直播被切断重开，
              所以在这张卡上方给一条"距上一场 X 分钟 + 合并这两场"。
              网格里卡片一行好几个，没有"上一行"可言，所以这条跟着**较晚的那一场**走。
            -->
            <div v-if="pairOf(row.id)" class="combined-cont">
              <span class="combined-cont__text">
                <ArtSvgIcon icon="ri:arrow-up-double-line" class="text-g-400" />
                距上一场 {{ fmtGap(pairOf(row.id)?.minutes) }}
              </span>
              <button
                type="button"
                class="combined-cont__btn"
                title="同时选中这两场（同一主播的相邻两场）"
                @click.stop="selectPair(pairOf(row.id))"
              >
                合并这两场
              </button>
            </div>

            <!--
              勾选框的状态完全由 selectedIds 驱动（只给 :model-value）。
              @click.stop 拦住冒泡，否则这次点击会先由本选框处理、再被整张卡的
              @click 处理一次 —— 两下互相抵消，表现是"点勾选框没反应"。
              真正的切换走 @change（一次用户点击只产生一次 change）。
            -->
            <el-checkbox
              :model-value="selectedIds.has(row.id)"
              :aria-label="`选择场次 #${row.id}`"
              @click.stop
              @change="toggle(row.id)"
            />
            <div class="combined-item__body">
              <div class="combined-item__time">
                {{ fmtSessionRange(row.startedAt, row.endedAt, narrow) }}
              </div>
              <div class="combined-item__meta">
                <span class="combined-item__streamer" :title="row.streamerName">
                  {{ row.streamerName }}
                </span>
                <span v-if="row.isLive" class="combined-item__live">直播中</span>
                <span v-if="row.durationMin" class="combined-item__dur">
                  {{ fmtDur(row.durationMin) }}
                </span>
              </div>
              <div class="combined-item__stats">
                <span :title="`钻石 ${fmtFull(row.diamonds)}`">
                  <ArtSvgIcon icon="ri:diamond-line" />{{ fmtNum(row.diamonds) }}
                </span>
                <span :title="`礼物 ${fmtFull(row.gifts)}`">
                  <ArtSvgIcon icon="ri:gift-2-line" />{{ fmtNum(row.gifts) }}
                </span>
                <span :title="`弹幕 ${fmtFull(row.danmaku)}`">
                  <ArtSvgIcon icon="ri:chat-3-line" />{{ fmtNum(row.danmaku) }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="!filteredRows.length" class="combined-empty">
            <ArtSvgIcon icon="ri:file-list-3-line" class="text-xl text-g-400" />
            <div class="text-sm text-g-600">当前筛选条件下没有场次</div>
            <el-button v-if="hasFilter" text bg @click="resetFilters">清空筛选条件</el-button>
          </div>
        </div>
      </div>
    </template>

    <!-- 底部浮动操作条：只在有场次可选时出现 -->
    <div v-if="groups.length" class="dy-combined-bar">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-sm text-g-700 shrink-0">
          已选 <b class="text-theme">{{ selectedIds.size }}</b> 场
        </span>
        <!-- 跨直播间合并时必须一眼看出"这几个主播各选了几场"，否则合完才发现比例失衡 -->
        <span
          v-if="selectedBreakdown"
          class="text-xs text-g-500 truncate"
          :title="selectedBreakdown"
        >
          {{ selectedBreakdown }}
        </span>
        <span
          class="text-sm text-g-700 shrink-0"
          :title="`所选场次钻石合计（精确值 ${fmtFull(selectedDiamonds)}）`"
        >
          合计 <b class="text-theme">{{ fmtNum(selectedDiamonds) }}</b> 钻
        </span>
        <el-button v-if="selectedIds.size" text @click="clearSelection">清空</el-button>
      </div>
      <!--
        点击兜底：Element 的 disabled 按钮在 Chrome 里**不派发 click**，
        所以「未满 2 场时点一下要提示」这条靠外层 span 接住 ——
        锁定态给按钮加 pointer-events:none，事件就落到这层 span 上。
      -->
      <span class="dy-combined-bar__cta" @click="onMergeClick">
        <el-button
          type="primary"
          class="dy-combined-bar__btn"
          :class="{ 'is-locked': selectedIds.size < 2 }"
          :disabled="selectedIds.size < 2 || merging"
          :loading="merging"
          @click="viewCombined"
        >
          <ArtSvgIcon icon="ri:merge-cells-horizontal" class="mr-1" />
          查看合并
        </el-button>
      </span>
    </div>

    <!-- ===================== 合并结果弹窗 ===================== -->
    <!--
      合并结果弹窗。
      尺寸从 820px 放宽到 1180（上限 94vw）—— 原来 820px 里还要塞三个 tab，
      一次只看得到一个榜、列表限高 420px（约 7 行），大屏空间全浪费；
      现在三个榜并排同时可见，列表吃满高度（见下面的 .dy-combined-panel__list）。
    -->
    <el-dialog
      v-model="dialogVisible"
      width="1180"
      class="dy-combined-dialog"
      align-center
      :close-on-click-modal="false"
    >
      <template #header>
        <div class="flex items-center gap-3">
          <div class="size-10 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon icon="ri:merge-cells-horizontal" class="text-lg text-theme" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-base font-medium text-g-900">数据合并结果</div>
            <div class="text-xs text-g-500 mt-0.5 truncate">
              <template v-if="result">
                已合并 {{ result.session_ids.length }} 场直播 · 来自
                {{ combinedStreamerCount }} 个主播
              </template>
              <template v-else>正在合并 {{ pendingIds.length }} 场直播的数据…</template>
            </div>
          </div>
        </div>
      </template>

      <!-- 合并中 -->
      <div v-if="merging && !result" class="flex flex-col gap-4">
        <el-row :gutter="16">
          <el-col v-for="i in 4" :key="i" :xs="12" :sm="6">
            <div class="rounded-xl bg-g-100/50 h-20 mb-4"></div>
          </el-col>
        </el-row>
        <el-skeleton :rows="6" animated />
      </div>

      <!-- 失败：留在弹窗里给重试，而不是关掉弹窗只弹一条 toast -->
      <QueryErrorState
        v-else-if="mergeError"
        :message="mergeError"
        :retrying="merging"
        @retry="viewCombined"
      />

      <template v-else-if="result">
        <!-- 4 张统计卡 -->
        <el-row :gutter="16">
          <el-col v-for="c in statCards" :key="c.label" :xs="12" :sm="6">
            <div class="art-card h-20 mb-4 flex items-center justify-between px-4" :title="c.title">
              <div class="min-w-0">
                <div class="text-xs text-g-500">{{ c.label }}</div>
                <div class="text-[20px] font-medium text-g-900 mt-1 leading-none truncate">
                  {{ c.value }}
                </div>
              </div>
              <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
                <ArtSvgIcon :icon="c.icon" class="text-base text-theme" />
              </div>
            </div>
          </el-col>
        </el-row>

        <!--
          本次合并包含的场次。
          原来只在头部把 id 连成一串（"场次 252、207"）—— 认不出是哪天哪场，
          看完数据也没法跳过去核对。现在给主播名 + 开始时间，并且可点进详情。
        -->
        <div v-if="combinedSessionChips.length" class="flex flex-wrap items-center gap-1.5 mb-4">
          <span class="text-xs text-g-500 shrink-0">包含场次</span>
          <button
            v-for="s in combinedSessionChips"
            :key="s.id"
            class="dy-combined-chip dy-pressable"
            :title="`打开场次 #${s.id} 的详情`"
            @click="openSessionDetail(s.id)"
          >
            {{ s.streamer }} · {{ fmtSessionRange(s.started_at, null) }}
          </button>
        </div>

        <!--
          三个榜单**并排同时可见**（原来是三个 tab，一次只看得到一个，
          想对照"送礼榜前几名在弹幕榜上排第几"就得来回切）。
          窄屏自动堆成一列。
        -->
        <div class="dy-combined-panels">
          <section class="dy-combined-panel">
            <div class="dy-combined-panel__head">
              <span>礼物排行</span>
              <span class="text-xs text-g-500">按钻石降序 Top {{ result.gifts.length }}</span>
            </div>
            <div class="dy-combined-panel__list">
              <div
                v-for="(g, i) in result.gifts"
                :key="g.user_sec_uid || g.nickname"
                class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="avatarSrc(g.avatar_url)" class="shrink-0">
                  {{ g.nickname?.[0] || '?' }}
                </el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ g.nickname }}</span>
                <div class="text-right shrink-0">
                  <div class="text-sm font-bold text-theme" :title="fmtFull(g.total_diamonds)">
                    {{ fmtFull(g.total_diamonds) }}
                  </div>
                  <div class="text-xs text-g-500">{{ fmtFull(g.gift_count) }} 个礼物</div>
                </div>
              </div>
              <div v-if="!result.gifts.length" class="text-xs text-g-500 py-6 text-center">
                所选场次暂无礼物数据
              </div>
            </div>
          </section>

          <section class="dy-combined-panel">
            <div class="dy-combined-panel__head">
              <span>主播排行</span>
              <span class="text-xs text-g-500">共 {{ result.anchorRanking.length }} 位</span>
            </div>
            <div class="dy-combined-panel__list">
              <div
                v-for="(a, i) in result.anchorRanking"
                :key="a.anchor_sec_uid || a.anchor_name"
                class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="avatarSrc(a.anchor_avatar)" class="shrink-0">
                  {{ a.anchor_name?.[0] || '?' }}
                </el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ a.anchor_name }}</span>
                <div class="text-right shrink-0">
                  <div class="text-sm font-bold text-theme" :title="fmtFull(a.total_diamonds)">
                    {{ fmtFull(a.total_diamonds) }}
                  </div>
                  <div class="text-xs text-g-500">{{ fmtFull(a.user_count) }} 人送礼</div>
                </div>
              </div>
              <div v-if="!result.anchorRanking.length" class="text-xs text-g-500 py-6 text-center">
                所选场次暂无主播数据
              </div>
            </div>
          </section>

          <section class="dy-combined-panel">
            <div class="dy-combined-panel__head">
              <span>弹幕排行</span>
              <span class="text-xs text-g-500"
                >按条数降序 Top {{ result.danmakuRanking.length }}</span
              >
            </div>
            <div class="dy-combined-panel__list">
              <div
                v-for="(d, i) in result.danmakuRanking"
                :key="d.user_sec_uid || d.nickname"
                class="dy-rank-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="avatarSrc(d.avatar)" class="shrink-0">
                  {{ d.nickname?.[0] || '?' }}
                </el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ d.nickname }}</span>
                <span class="text-sm font-bold text-g-800 shrink-0">
                  {{ fmtFull(d.msg_count) }} 条
                </span>
              </div>
              <div v-if="!result.danmakuRanking.length" class="text-xs text-g-500 py-6 text-center">
                所选场次暂无弹幕数据
              </div>
            </div>
          </section>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onActivated, onMounted, onUnmounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import {
    fetchCombinedSessions,
    fetchSessions,
    fetchStreamers,
    type CombinedResult,
    type Session,
    type Streamer
  } from '@/api/douyin'
  import { apiErrorMessage } from '@/utils/douyin-error'
  import { fmtFull, fmtNum, fmtSessionRange, rankClass, toDate } from '@/utils/format'

  /*
   * keep-alive 的匹配靠组件 name（与路由 name 一致）。
   * 路由 meta 里写了 keepAlive: true，名字对不上缓存就静默失效。
   */
  defineOptions({ name: 'DouyinCombined' })

  /** 一个主播 + 它的场次（组内已按开始时间倒序） */
  interface StreamerGroup {
    streamer: Streamer
    sessions: Session[]
  }

  /**
   * 一条场次 = 一场直播（把 groups 里的场次摊平，带上主播名）。
   *
   * 为什么要摊平：筛选和排序都是"跨主播"的动作 —— 主播多选、按时间/钻石排序，
   * 在"主播 → 场次"的嵌套结构上做会到处写 flatMap；摊平后就是一次 filter + sort。
   */
  interface SessionItem {
    id: number
    streamerId: string | number
    streamerName: string
    startedAt: Session['started_at']
    endedAt: Session['ended_at']
    isLive: boolean
    diamonds: number
    gifts: number
    danmaku: number
    /** 时长（分钟）；没结束时间（还在直播 / 异常退出）给 null */
    durationMin: number | null
    /** 开始时间毫秒（排序用；解析不出来给 0，排在最后，不炸排序） */
    ms: number
  }

  /** 排序字段；默认按开始时间降序（最近开的播在最上面） */
  type SortKey = 'time' | 'diamonds'

  const router = useRouter()

  const groups = ref<StreamerGroup[]>([])
  const loading = ref(true)
  /** 取数失败的真实原因；非空时显示错误态而不是空态 */
  const queryError = ref('')

  /** 已勾选的场次 id（Set 让 toggle 是 O(1)；每次都换一个新 Set，响应式不依赖集合插桩） */
  const selectedIds = ref<Set<number>>(new Set())

  /** 主播筛选：空数组 = 全部（el-select 的 clearable 清空后也是空数组） */
  const filterStreamerIds = ref<Array<string | number>>([])
  /**
   * 时间范围：日期选择器（空 = 不限）。
   * 之前是「全部 / 24 小时 / 7 天 / 30 天」四个固定档，活动常常落在"9 月 3 日到 9 月 5 日"
   * 这种具体区间上，固定档选不出来，所以换成日期范围。
   */
  const dateRange = ref<[Date, Date] | null>(null)

  /** 日期选择器的快捷项（等价于原来的 24 小时 / 7 天 / 30 天，用起止日期表达） */
  const dateShortcuts = [
    {
      text: '今天',
      value: () => {
        const end = new Date()
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        return [start, end]
      }
    },
    {
      text: '最近 7 天',
      value: () => {
        const end = new Date()
        const start = new Date()
        start.setDate(start.getDate() - 6)
        start.setHours(0, 0, 0, 0)
        return [start, end]
      }
    },
    {
      text: '最近 30 天',
      value: () => {
        const end = new Date()
        const start = new Date()
        start.setDate(start.getDate() - 29)
        start.setHours(0, 0, 0, 0)
        return [start, end]
      }
    },
    {
      text: '本月',
      value: () => {
        const end = new Date()
        const start = new Date()
        start.setDate(1)
        start.setHours(0, 0, 0, 0)
        return [start, end]
      }
    }
  ]

  /** 当前排序字段 + 方向（false = 降序） */
  const sortKey = ref<SortKey>('time')
  const sortAsc = ref(false)

  const merging = ref(false)
  const mergeError = ref('')
  const dialogVisible = ref(false)
  const result = ref<CombinedResult | null>(null)
  /** 正在合并的场次 id（弹窗头部在结果到达前用它显示进度） */
  const pendingIds = ref<number[]>([])

  /** 窄屏（<768px）用短格式时间 */
  const narrow = ref(false)
  let narrowMq: MediaQueryList | null = null
  const onNarrowChange = (e: MediaQueryListEvent) => {
    narrow.value = e.matches
  }

  /*
   * 本次合并包含的场次（给弹窗一个"看的是哪几场"的上下文）。
   *
   * 原来只在头部把场次 id 用顿号连成一串（"场次 252、207"）—— 既认不出是哪天哪场，
   * 看完数据也没法直接跳过去核对。这里从已加载的分组里查出开始时间与主播名，
   * 渲染成可点的 chips（点击进该场次详情）。
   */
  /** 弹窗里"包含场次"chip 的展示数据 */
  interface CombinedChip {
    id: number
    started_at: Session['started_at']
    streamer: string
  }

  const combinedSessionChips = computed<CombinedChip[]>(() => {
    const ids = result.value?.session_ids?.length ? result.value.session_ids : pendingIds.value
    const byId = new Map<number, CombinedChip>()
    for (const g of groups.value) {
      for (const s of g.sessions) {
        byId.set(s.id, { id: s.id, started_at: s.started_at, streamer: g.streamer.name })
      }
    }
    return ids.map((id) => byId.get(id)).filter((c): c is CombinedChip => !!c)
  })

  /** 本次合并涉及几个主播（弹窗头部用来说明"跨了几个直播间"） */
  const combinedStreamerCount = computed(
    () => new Set(combinedSessionChips.value.map((c) => c.streamer)).size
  )

  /** 跳到场次详情；先关弹窗，避免返回时还被它盖着 */
  function openSessionDetail(id: number) {
    dialogVisible.value = false
    router.push(`/douyin/detail/${id}`)
  }

  /** 场次开始时间 → 毫秒；解析不出来给 0（排在最后，不炸排序） */
  function startMs(s: Session) {
    return toDate(s.started_at)?.getTime() ?? 0
  }

  /** 全部场次摊平成条目（数据源只有 groups 一份，避免两处状态不同步） */
  const allRows = computed<SessionItem[]>(() =>
    groups.value.flatMap((g) =>
      g.sessions.map((s) => {
        const startedMs = startMs(s)
        const endedMs = toDate(s.ended_at)?.getTime() ?? 0
        return {
          id: s.id,
          streamerId: g.streamer.id,
          streamerName: g.streamer.name || s.streamer_name || '未知主播',
          startedAt: s.started_at,
          endedAt: s.ended_at,
          isLive: !!s.is_live,
          diamonds: s.total_diamonds || 0,
          gifts: s.gift_count || 0,
          danmaku: s.danmaku_count || 0,
          durationMin: endedMs > startedMs ? Math.round((endedMs - startedMs) / 60000) : null,
          ms: startedMs
        }
      })
    )
  )

  /** 主播下拉的选项：主播名 + 场次数（场次数来自已加载的分组，与列表条数同源） */
  const streamerOptions = computed(() =>
    groups.value.map((g) => ({
      id: g.streamer.id,
      name: g.streamer.name || '未知主播',
      count: g.sessions.length
    }))
  )

  /** 该行是否落在当前的时间范围内（按**开始时间**算；用户选"9/3 到 9/5"时指的就是这几天开的播） */
  function inRange(ms: number) {
    const r = dateRange.value
    if (!r || !r[0] || !r[1]) return true
    const start = new Date(r[0])
    start.setHours(0, 0, 0, 0)
    const end = new Date(r[1])
    end.setHours(23, 59, 59, 999)
    return ms >= start.getTime() && ms <= end.getTime()
  }

  function resetFilters() {
    filterStreamerIds.value = []
    dateRange.value = null
  }

  const hasFilter = computed(() => filterStreamerIds.value.length > 0 || !!dateRange.value)

  /**
   * 当前筛选 + 排序后的行。
   * filter 已返回新数组，所以这里的 sort 不会改动 allRows。
   */
  const filteredRows = computed<SessionItem[]>(() => {
    const picked = filterStreamerIds.value
    const rows = allRows.value.filter(
      (r) => (!picked.length || picked.includes(r.streamerId)) && inRange(r.ms)
    )
    const dir = sortAsc.value ? 1 : -1
    const key = sortKey.value
    return rows.sort((a, b) => (key === 'time' ? a.ms - b.ms : a.diamonds - b.diamonds) * dir)
  })

  /* ============ 相邻场次（这一页的主场景） ============
   * 判定「同一直播间相邻场次」：同一主播、按开始时间紧挨着的两场，且上一场结束到这一场
   * 开始之间几乎没断（≤ TIGHT_GAP_MIN 分钟）。这类基本都是直播被切断后重开，
   * 数据要合起来看才有意义 —— 既要能自动找出来（推荐条），也要在列表里挨着展示（连接条）。
   */
  /** 两场之间断不超过这么多分钟，才当成「同一场被切断」 */
  const TIGHT_GAP_MIN = 30
  /** 推荐条默认最多列几组，再多折叠 */
  const RECO_LIMIT = 3
  const recoExpanded = ref(false)

  /** 上一场结束 → 这一场开始的间隔（分钟）；算不出来给 null */
  function rowGapMinutes(older: SessionItem, newer: SessionItem): number | null {
    const nextStart = newer.ms || toDate(newer.startedAt)?.getTime()
    if (!nextStart) return null
    // 上一场没结束时间（还在直播 / 异常退出）时退化成"按开始时间估"
    const prevEnd = toDate(older.endedAt)?.getTime() ?? older.ms
    if (!prevEnd) return null
    return Math.round((nextStart - prevEnd) / 60000)
  }

  /**
   * 推荐条里的紧凑时间段："09/30 15:00–15:34"。
   *
   * 不用 fmtSessionRange 是因为它在两场并排时会写成
   * 「09/30 15:00 → 15:34 ＋ 09/30 15:35 → 16:33」—— 一行三个箭头、还重复一次日期，
   * 读起来分不清哪头是哪头。这里用 en dash 表示"起–止"，两场之间只用 ＋ 连。
   */
  function compactRange(start: any, end: any): string {
    const s = toDate(start)
    if (!s) return '-'
    const p2 = (n: number) => String(n).padStart(2, '0')
    const day = `${p2(s.getMonth() + 1)}/${p2(s.getDate())}`
    const st = `${p2(s.getHours())}:${p2(s.getMinutes())}`
    const e = toDate(end)
    if (!e) return `${day} ${st}–进行中`
    const sameDay =
      e.getFullYear() === s.getFullYear() &&
      e.getMonth() === s.getMonth() &&
      e.getDate() === s.getDate()
    const et = sameDay
      ? `${p2(e.getHours())}:${p2(e.getMinutes())}`
      : `${p2(e.getMonth() + 1)}/${p2(e.getDate())} ${p2(e.getHours())}:${p2(e.getMinutes())}`
    return `${day} ${st}–${et}`
  }

  /** 一对相邻场次（推荐条和列表里的接续提示共用同一份数据） */
  interface CutPair {
    key: string
    streamerName: string
    /** 间隔分钟（负数 = 两场时间有重叠） */
    minutes: number
    /** 要一起选中的两场（较早、较晚） */
    pairIds: [number, number]
    /** 两场各自的紧凑时间段（推荐条上并排显示） */
    prevText: string
    nextText: string
    /** 较晚那场的开始时间（推荐条按它倒序，最近的排前面） */
    newestMs: number
  }

  function toCutPair(older: SessionItem, newer: SessionItem, minutes: number): CutPair {
    return {
      key: `${older.id}-${newer.id}`,
      streamerName: older.streamerName,
      minutes,
      pairIds: [older.id, newer.id],
      prevText: compactRange(older.startedAt, older.endedAt),
      nextText: compactRange(newer.startedAt, newer.endedAt),
      newestMs: newer.ms
    }
  }

  /** 全量里所有「同一直播间、间隔不到 TIGHT_GAP_MIN 分钟」的相邻场次对 */
  const cutPairs = computed<CutPair[]>(() => {
    const byStreamer = new Map<string | number, SessionItem[]>()
    for (const r of allRows.value) {
      const list = byStreamer.get(r.streamerId)
      if (list) list.push(r)
      else byStreamer.set(r.streamerId, [r])
    }
    const picked = filterStreamerIds.value
    const out: CutPair[] = []
    for (const list of byStreamer.values()) {
      /*
       * 推荐条跟着筛选走：已经收窄到某个主播（或某段时间）时，
       * 还在上面列别的主播的相邻场次就是噪音 —— 用户下一步要点的是列表里那些条目。
       */
      if (picked.length && !picked.includes(list[0].streamerId)) continue
      const asc = [...list].sort((a, b) => a.ms - b.ms)
      for (let i = 1; i < asc.length; i++) {
        const minutes = rowGapMinutes(asc[i - 1], asc[i])
        // 负数是两场时间重叠（旧场次没收尾就开了新的），同样值得合并，照收
        if (minutes === null || minutes > TIGHT_GAP_MIN) continue
        // 以**较晚**那场的开始时间判断是否在时间范围内（用户筛"最近 7 天"时指的就是这场）
        if (!inRange(asc[i].ms)) continue
        out.push(toCutPair(asc[i - 1], asc[i], minutes))
      }
    }
    return out.sort((a, b) => b.newestMs - a.newestMs)
  })

  const visibleCutPairs = computed(() =>
    recoExpanded.value ? cutPairs.value : cutPairs.value.slice(0, RECO_LIMIT)
  )

  /**
   * 「这场是接着上一场的」查询表：key = 较晚那场的 id。
   *
   * 用 id 而不是列表下标 —— 卡片是网格排布（一行好几个），没有"上一行"这个概念；
   * 换排序时下标全变，id 也不会变，所以这条提示在任何排序下都落在同一张卡上。
   */
  const pairOfNewer = computed(() => {
    const map = new Map<number, CutPair>()
    for (const p of cutPairs.value) map.set(p.pairIds[1], p)
    return map
  })

  function pairOf(id: number) {
    return pairOfNewer.value.get(id)
  }

  /** 一键选中一对相邻场次（推荐条 / 分隔行共用） */
  function selectPair(p: CutPair | null | undefined) {
    if (!p) return
    const next = new Set(selectedIds.value)
    for (const id of p.pairIds) next.add(id)
    selectedIds.value = next
  }

  /** 间隔的展示文案 */
  function fmtGap(minutes: number | null | undefined): string {
    if (minutes === null || minutes === undefined) return '-'
    if (minutes < 0) return '时间有重叠'
    if (minutes < 1) return '不到 1 分钟'
    if (minutes < 60) return `${minutes} 分钟`
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`
  }

  /**
   * 「每个主播最近 1 场」：跨直播间合并的常见形态 —— 一场活动里每个直播间各取最近一场。
   * 作用范围是当前主播筛选（没筛 = 全部主播），只新增不取消已有选择。
   */
  function selectLatestPerStreamer() {
    const picked = filterStreamerIds.value
    const scope = picked.length
      ? allRows.value.filter((r) => picked.includes(r.streamerId))
      : allRows.value
    const latest = new Map<string | number, SessionItem>()
    for (const r of scope) {
      const cur = latest.get(r.streamerId)
      if (!cur || r.ms > cur.ms) latest.set(r.streamerId, r)
    }
    const next = new Set(selectedIds.value)
    for (const r of latest.values()) next.add(r.id)
    selectedIds.value = next
  }

  /** 浮动条上的「各主播各选了几场」（跨直播间合并时确认比例，别合完才发现失衡） */
  const selectedBreakdown = computed(() => {
    if (!selectedIds.value.size) return ''
    const counts = new Map<string, number>()
    for (const r of allRows.value) {
      if (!selectedIds.value.has(r.id)) continue
      counts.set(r.streamerName, (counts.get(r.streamerName) || 0) + 1)
    }
    const items = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const head = items
      .slice(0, 3)
      .map(([name, n]) => `${name} ${n}`)
      .join(' · ')
    return items.length > 3 ? `${head} 等 ${items.length} 个主播` : head
  })

  /** 所选场次的钻石合计（浮动条上的「合计 X 钻」） */
  const selectedDiamonds = computed(() =>
    allRows.value.reduce((sum, r) => (selectedIds.value.has(r.id) ? sum + r.diamonds : sum), 0)
  )

  /** 点排序按钮切换：同一个再点一次换方向；换字段时先给降序（先看最大的那几场） */
  function toggleSort(k: SortKey) {
    if (sortKey.value === k) sortAsc.value = !sortAsc.value
    else {
      sortKey.value = k
      sortAsc.value = false
    }
  }

  /** 排序按钮的箭头：非当前排序项给中性双箭头（低透明度），当前项给粗单箭头 */
  function sortIcon(k: SortKey) {
    if (sortKey.value !== k) return 'ri:arrow-up-down-fill'
    return sortAsc.value ? 'ri:arrow-up-wide-fill' : 'ri:arrow-down-wide-fill'
  }

  /** 时长文案：4080 → "3h 20m" */
  function fmtDur(minutes: number | null): string {
    if (!minutes || minutes <= 0) return ''
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (!h) return `${m}m`
    return m ? `${h}h ${m}m` : `${h}h`
  }

  /** 条目 title：完整时间范围 + 三项指标（窄屏时间会缩略，完整信息挂这里） */
  function rowTitle(row: SessionItem) {
    return (
      `场次 #${row.id}\n` +
      `${fmtSessionRange(row.startedAt, row.endedAt)}\n` +
      `钻石 ${fmtFull(row.diamonds)} · 礼物 ${fmtFull(row.gifts)} · 弹幕 ${fmtFull(row.danmaku)}`
    )
  }

  /* ============ 三个快捷操作（都只作用于**当前筛选结果**） ============
   * 主用法是"合同一个直播间的相邻几场"：先把主播筛到一个（或几个），
   * 再用下面三个按钮批量操作，最后点「查看合并」。
   */
  const recentCount = 3

  /**
   * 「最近 N 场」：把**筛选结果里**开始时间最新的 3 场设为已选。
   *
   * 语义是**替换筛选结果内的选择**，不是追加：用户点这个按钮的意图是
   * "我要合的就是这几场"，追加会把之前在这个范围内点乱选的那些场次一起带进去，
   * 还得手动去清。筛选范围**外**已选的场次不动 —— 那是在别的筛选条件（比如另一个
   * 主播）下特意选好的，不该被这里的操作牵连。
   */
  function selectRecentFiltered() {
    const next = new Set(selectedIds.value)
    for (const r of filteredRows.value) next.delete(r.id)
    const recent = [...filteredRows.value].sort((a, b) => b.ms - a.ms).slice(0, recentCount)
    for (const r of recent) next.add(r.id)
    selectedIds.value = next
  }

  /**
   * 「全选筛选结果」：把筛选结果**并入**选择（只新增，不取消已有的）。
   * 筛选在这里的用途就是"缩小范围后一次多选"，所以不提供"再点一次反选"的隐藏语义
   * —— 要取消请用「清空选择」或直接点行。
   */
  function selectAllFiltered() {
    const next = new Set(selectedIds.value)
    for (const r of filteredRows.value) next.add(r.id)
    selectedIds.value = next
  }

  /** 「清空选择」：清掉所有已选（含筛选范围外的），彻底回到 0 */
  function clearSelection() {
    selectedIds.value = new Set()
  }

  const statCards = computed(() => {
    const s = result.value?.summary
    return [
      {
        label: '总钻石',
        icon: 'ri:diamond-line',
        value: fmtNum(s?.total_diamonds),
        title: `精确值 ${fmtFull(s?.total_diamonds)}`
      },
      {
        label: '总礼物',
        icon: 'ri:gift-2-line',
        value: fmtNum(s?.total_gifts),
        title: `精确值 ${fmtFull(s?.total_gifts)}`
      },
      {
        label: '总弹幕',
        icon: 'ri:chat-3-line',
        value: fmtNum(s?.total_danmaku),
        title: `精确值 ${fmtFull(s?.total_danmaku)}`
      },
      {
        label: '独立用户',
        /*
         * 口径必须写清楚：后端是把每场的预聚合 agg_users 相加（sessions.js:416），
         * 同一个人看了两场会被算两次 —— 不能读成「跨场次去重后的独立用户」。
         */
        icon: 'ri:user-3-line',
        value: fmtNum(s?.user_count),
        title: `各场次用户数之和（未跨场次去重）精确值 ${fmtFull(s?.user_count)}`
      }
    ]
  })

  /**
   * el-avatar 的 src 只接受 `string | undefined`，而后端这几个头像字段**实测会返回 null**
   * （主播头像尤其常见）。类型保留 `| null` 保持诚实，在这里统一收口成 undefined
   * —— 不写成 `|| undefined` 散在模板里十几处，改的时候容易漏。
   */
  function avatarSrc(url?: string | null): string | undefined {
    return url || undefined
  }

  /**
   * 拉主播列表 → **并发**拉每个主播的场次 → 按主播分组。
   *
   * 单个主播的场次接口失败**不拖垮整页**：那一组给空列表，
   * 其它主播照常可选（否则一个主播挂了整个合并功能就没了）。
   */
  async function refresh() {
    const isFirst = !groups.value.length
    if (isFirst) loading.value = true
    try {
      const streamers = await fetchStreamers()
      const list = Array.isArray(streamers) ? streamers : []
      const settled = await Promise.all(
        list.map(async (streamer) => {
          try {
            const rows = await fetchSessions(String(streamer.id))
            return { streamer, sessions: Array.isArray(rows) ? rows : [] }
          } catch {
            return { streamer, sessions: [] as Session[] }
          }
        })
      )
      groups.value = settled.map(({ streamer, sessions }) => ({
        streamer,
        // 组内按开始时间倒序（最近的场次排最上面）
        sessions: [...sessions].sort((a, b) => startMs(b) - startMs(a))
      }))
      // 刷新后可能有的场次没了：把失效的选择清掉，避免「已选 N 场」与实际不符
      const alive = new Set(groups.value.flatMap((g) => g.sessions.map((s) => s.id)))
      selectedIds.value = new Set([...selectedIds.value].filter((id) => alive.has(id)))
      // 主播筛选同理：选了的主播在监控列表里没了，就要从筛选条件里摘掉
      const aliveStreamers = new Set(groups.value.map((g) => g.streamer.id))
      filterStreamerIds.value = filterStreamerIds.value.filter((id) => aliveStreamers.has(id))
      queryError.value = ''
    } catch (e) {
      queryError.value = apiErrorMessage(e, '主播列表加载失败')
    } finally {
      loading.value = false
    }
  }

  function toggle(id: number) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  /** 外层容器的点击兜底：锁定态的按钮收不到 click（disabled），由这里给提示 */
  function onMergeClick() {
    if (selectedIds.value.size >= 2) return
    ElMessage.warning('请至少选择 2 个场次')
  }

  async function viewCombined() {
    const ids = [...selectedIds.value]
    if (ids.length < 2) {
      ElMessage.warning('请至少选择 2 个场次')
      return
    }
    if (merging.value) return
    pendingIds.value = ids
    merging.value = true
    mergeError.value = ''
    result.value = null
    dialogVisible.value = true
    try {
      result.value = await fetchCombinedSessions(ids)
    } catch (e) {
      mergeError.value = apiErrorMessage(e, '合并失败')
    } finally {
      merging.value = false
    }
  }

  // keep-alive：切回来时刷新一次（首次挂载 mounted 与 activated 都会触发，跳过重复请求）
  let activatedOnce = false
  onMounted(() => {
    narrowMq = window.matchMedia('(max-width: 767px)')
    narrow.value = narrowMq.matches
    narrowMq.addEventListener('change', onNarrowChange)
    refresh()
  })
  onActivated(() => {
    if (!activatedOnce) {
      activatedOnce = true
      return
    }
    refresh()
  })
  onUnmounted(() => {
    narrowMq?.removeEventListener('change', onNarrowChange)
  })
</script>

<style scoped>
  /* ============ 筛选行 ============ */
  /*
   * .art-card 本身**没有内边距**（各页自己加 p-4 / p-5），而工具条用的是 .dy-toolbar 的 20px。
   * 这里不补内边距的话，「主播」「时间」这些标签会贴着卡片边框（实测 1px）。
   * 统一成 20px，和工具条、列表工具条的文字左边缘对齐。
   */
  .combined-filters {
    padding: 16px 20px;
  }

  .combined-reco {
    padding: 16px 20px;
  }

  /*
   * 筛选行：主播下拉 + 日期范围 + 快捷操作，一行排开，窄了自动换行。
   * 主播从"平铺标签"换回下拉多选 —— 直播间会越来越多，标签铺不下；
   * 下拉自带搜索、折叠已选标签，几十个直播间也只占一行。
   */
  .combined-filter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
  }

  .combined-filter-item {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .combined-filter-label {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--dy-text-muted);
  }

  /* 给固定宽度，否则默认 240px 会把日期挤到第二行 */
  .combined-filter-select {
    width: 240px;
  }

  .combined-filter-date {
    width: 268px;
  }

  /* 快捷操作靠右；换行时自成一组 */
  .combined-filter-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  /* ============ 相邻场次推荐条 ============ */
  .combined-reco__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .combined-reco__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--art-gray-800);
  }

  .combined-reco__hint {
    font-size: 11px;
    color: var(--dy-text-muted);
  }

  /*
   * 推荐条也走"一横多个"：每组一张小卡，按宽度自动 1/2/3/4 列。
   * 这里用 auto-fit（不是 auto-fill）——只有 3 组时卡片会**撑满整行**，
   * auto-fill 会让它们挤在左边、右边空一大片，看着像没对齐。
   */
  .combined-reco__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 8px;
    margin-top: 8px;
  }

  .combined-reco__item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding: 8px 10px;
    background: var(--art-gray-100);
    border: 1px solid var(--art-card-border);
    border-radius: 10px;
  }

  .combined-reco__head-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  /* 「合并这两场」贴到卡片右边缘：卡片里唯一的动作，别跟文字挤在一起 */
  .combined-reco__head-row .combined-reco__btn {
    margin-left: auto;
  }

  .combined-reco__name {
    overflow: hidden;
    font-size: 12px;
    font-weight: 600;
    color: var(--art-gray-800);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .combined-reco__ranges {
    font-size: 12px;
    color: var(--dy-text-primary);
    font-variant-numeric: tabular-nums;
  }

  .combined-reco__arrow {
    color: var(--dy-text-muted);
  }

  .combined-reco__gap {
    font-size: 11px;
    color: var(--theme-color);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* 一键「合并这两场」：做成轻量文字按钮，不跟主按钮抢注意力 */
  .combined-reco__btn,
  .combined-cont__btn {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 22px;
    padding: 0 8px;
    font-size: 11px;
    color: var(--theme-color);
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }

  .combined-reco__btn:hover,
  .combined-cont__btn:hover {
    background: color-mix(in srgb, var(--theme-color) 12%, transparent);
    border-color: color-mix(in srgb, var(--theme-color) 30%, transparent);
  }

  /* ============ 场次卡片「接着上一场」的提示条 ============ */
  /*
   * 卡片是网格里的一个格子，没有"上一行"可言，所以这条提示挂在**较晚那一场**的卡上方：
   * 一条虚线分隔 + 「距上一场 X 分钟」+ 一键合并。
   */
  .combined-cont {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    grid-column: 1 / -1;
    padding-bottom: 6px;
    font-size: 11px;
    color: var(--dy-text-muted);
    border-bottom: 1px dashed var(--art-card-border);
  }

  .combined-cont__text {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .combined-cont__btn {
    margin-left: auto;
  }

  /* ============ 场次列表（卡片网格，不用表格） ============ */
  /* 列表不再套卡片外壳：204 场本身就是这一页的主体，多一层卡面只是多一圈边 */
  .combined-list-zone {
    min-width: 0;
  }

  /* 排序行：无边框，靠右；只放两个排序按钮 */
  .combined-list-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-bottom: 8px;
  }

  /* 排序：两个小胶囊，当前排序的那颗高亮（箭头方向见 sortIcon） */
  .combined-sort {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 24px;
    padding: 0 8px;
    font-size: 12px;
    color: var(--dy-text-muted);
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    transition:
      color 0.15s,
      background-color 0.15s;
  }

  .combined-sort:hover {
    color: var(--theme-color);
    background: var(--art-gray-100);
  }

  .combined-sort--on {
    font-weight: 600;
    color: var(--theme-color);
    background: color-mix(in srgb, var(--theme-color) 10%, transparent);
  }

  /*
   * 滚动区：204 场全渲染，滚动只发生在这个容器里（页面本身不被拉成十几屏）。
   * 列数交给 auto-fill：宽屏 5 列、笔记本 4 列、平板 2~3 列、手机 1 列，不用写断点。
   * 260px 是实测能放下「2026/10/15 15:32 → 17:54」一行 + 三项指标的最小宽度。
   *
   * 两个边界上的坑，都在这里处理掉：
   *   1. scrollbar-gutter: stable —— 不加的话，滚动条出现/消失会让可用宽度跳 10px，
   *      列宽跟着变，最后一行卡片看起来"被切掉一截"；
   *   2. 右边多留几 px：1fr 的列宽是带小数的（如 312.6px），Chrome 会向上取整，
   *      贴着内边距时会把最后一列的圆角切掉。
   *
   * 列表现在不套卡片外壳，左内边距归零 —— 卡片左边缘直接跟筛选卡的左边缘对齐。
   */
  .combined-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
    align-items: start;
    max-height: 62vh;
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding: 2px 14px 2px 0;
  }

  /* 一张场次卡：勾选框 + （可选）接续条 + 时间/主播/时长 + 三项指标 */
  .combined-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 6px 8px;
    align-items: start;
    padding: 8px 10px;
    cursor: pointer;
    background: var(--default-box-color);
    border: 1px solid var(--art-card-border);
    border-radius: 10px;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }

  .combined-item:hover {
    background: var(--art-gray-100);
    border-color: var(--art-gray-200);
  }

  /* 选中：主题色描边 + 淡主题底（不引入新配色） */
  .combined-item--on {
    background: color-mix(in srgb, var(--theme-color) 8%, transparent);
    border-color: var(--theme-color);
  }

  .combined-item--on:hover {
    background: color-mix(in srgb, var(--theme-color) 12%, transparent);
  }

  /* 骨架条目不可点、不给 hover 反馈（它不是数据） */
  .combined-item--ghost {
    cursor: default;
  }

  .combined-item--ghost:hover {
    background: var(--art-gray-100);
  }

  /* el-checkbox 默认 32px 高，会把条目撑高一行 */
  .combined-item :deep(.el-checkbox) {
    height: 20px;
    margin-right: 0;
  }

  .combined-item :deep(.el-checkbox__input) {
    height: 20px;
  }

  .combined-item__body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  /* 主播 + 时长这一行：主播名占位可截断，时长永远贴右边 */
  .combined-item__meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  /* 时间是一行里最该先看的信息：加粗 + 等宽数字，跨天也不会左右晃 */
  .combined-item__time {
    font-size: 13px;
    font-weight: 600;
    color: var(--dy-text-primary);
    font-variant-numeric: tabular-nums;
  }

  /* 主播名做成小胶囊：跨直播间合并时一眼看出这条属于哪个直播间 */
  .combined-item__streamer {
    max-width: 100%;
    height: 18px;
    padding: 0 7px;
    overflow: hidden;
    font-size: 11px;
    line-height: 18px;
    color: var(--art-gray-600);
    text-overflow: ellipsis;
    white-space: nowrap;
    background: var(--default-box-color);
    border: 1px solid var(--art-card-border);
    border-radius: 999px;
  }

  .combined-item__live {
    font-size: 11px;
    font-weight: 600;
    color: var(--el-color-danger);
  }

  .combined-item__dur {
    margin-left: auto;
    font-size: 11px;
    color: var(--dy-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .combined-item__stats {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    font-size: 11px;
    color: var(--dy-text-muted);
  }

  .combined-item__stats span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .combined-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    grid-column: 1 / -1;
    padding: 32px 0;
    font-size: 12px;
    color: var(--dy-text-muted);
  }

  /*
   * 底部浮动操作条。
   *
   * 故意**不挂** `.art-card` / `.dy-toolbar`：那两个类会被 mobile-check 的
   * 「卡片左右边与页面容器对齐」扫描命中，而固定定位的元素左右边天然不等宽，
   * 会被误报成对齐问题。这里自带一套卡面样式（同一个 --default-box-color 底色）。
   */
  .dy-combined-bar {
    position: fixed;
    left: 50%;
    bottom: 24px;
    z-index: 20;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 16px;
    max-width: calc(100vw - 24px);
    padding: 10px 16px;
    background: var(--default-box-color);
    border: 1px solid var(--art-gray-200);
    border-radius: 12px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 12%);
  }

  /* 锁定态：让 click 穿过按钮落到外层 span 上，「点一下给提示」才生效 */
  .dy-combined-bar__btn.is-locked {
    pointer-events: none;
  }

  .dy-combined-bar__cta {
    display: inline-flex;
  }

  /* ============ 窄屏（<768px） ============ */
  /*
   * 卡片网格靠 auto-fill 自己掉到 1 列，这里只把间距、字号收一收；
   * 时间用短格式（省年份，见脚本里的 narrow），免得一张卡里时间折成两行。
   */
  @media (max-width: 767px) {
    /*
     * 筛选行在手机上竖排：主播下拉、日期范围各占一整行，
     * 快捷操作整行靠左排开（不再 ml-auto 右推）。
     */
    .combined-filter-row {
      gap: 10px;
    }

    .combined-filter-item {
      flex: 1 1 100%;
    }

    .combined-filter-select,
    .combined-filter-date {
      flex: 1;
      width: auto;
      min-width: 0;
    }

    .combined-filter-actions {
      margin-left: 0;
    }

    /*
     * 窄屏上推荐条的标题会折行，「展开全部」跟着换到第二行时
     * 被 ml-auto 顶到最右边、孤零零飘着 —— 这里取消右推，让它贴着文字。
     */
    .combined-reco__head .el-button {
      margin-left: 0 !important;
    }

    .combined-list {
      padding: 2px 10px 2px 0;
    }

    /* 窄屏卡片更窄，四周收一点（与筛选卡同一档 14px） */
    .combined-filters,
    .combined-reco {
      padding: 12px 14px;
    }

    .combined-item {
      padding: 9px 10px;
    }

    .combined-reco__grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* ============ 合并结果弹窗（三个榜单并排） ============ */

  /* 弹窗宽度：1180 在 1024 之类的小屏会超出视口，这里夹一道 */
  :deep(.dy-combined-dialog) {
    max-width: 94vw;
  }

  /* 三块并排；窄屏（<1280）堆成一列 */
  .dy-combined-panels {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  /* 每块：浅灰底 + 边框，头部固定、列表自己滚（三块互不影响） */
  .dy-combined-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 12px;
    background: var(--art-gray-100);
    border: 1px solid var(--art-card-border);
    border-radius: 12px;
  }

  .dy-combined-panel__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 600;
    color: var(--art-gray-800);
  }

  /*
   * 列表高度：桌面 52vh（1440×900 下约 12-13 行，Top20 基本一屏看完）。
   * 原来三个榜挤在一个 tab 里、列表限高 420px（约 7 行），看 Top20 要滚动还要来回切。
   */
  .dy-combined-panel__list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 52vh;
    overflow-y: auto;
    padding-right: 2px;
  }

  /* 场次 chip：主播名 + 开始时间，点了进该场次详情 */
  .dy-combined-chip {
    display: inline-flex;
    align-items: center;
    max-width: 230px;
    height: 26px;
    padding: 0 10px;
    overflow: hidden;
    font-size: 12px;
    color: var(--art-gray-700);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    background: var(--art-gray-100);
    border: 1px solid var(--art-card-border);
    border-radius: 999px;
    transition:
      color 0.15s,
      background-color 0.15s,
      border-color 0.15s;
  }

  .dy-combined-chip:hover {
    color: var(--theme-color);
    background: color-mix(in srgb, var(--theme-color) 10%, transparent);
    border-color: color-mix(in srgb, var(--theme-color) 30%, transparent);
  }

  @media (max-width: 1279px) {
    .dy-combined-panels {
      grid-template-columns: minmax(0, 1fr);
    }

    /*
     * 堆叠时**不再给每块各自限高**：实测三块各 40vh 会让弹窗长到 1644px（视口才 900），
     * 而且三块各自可滚 → 手机上嵌套滚动，很难操作。
     * 改成：三块列表全部展开，滚动交给**弹窗内容区一个滚动条**（下面那条）。
     */
    .dy-combined-panel__list {
      max-height: none;
      overflow: visible;
      padding-right: 0;
    }

    :deep(.dy-combined-dialog .el-dialog__body) {
      max-height: 68vh;
      overflow-y: auto;
    }
  }

  @media (max-width: 640px) {
    .dy-combined-bar {
      left: 12px;
      right: 12px;
      bottom: 12px;
      transform: none;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 12px;
    }
  }
</style>

<template>
  <div class="douyin-page dy-stagger p-4">
    <!--
      工具条。
      「筛选出 N / 共 M 场」放在这里而不是表格下面：204 场里当前筛出几场，
      是决定"下一步点不点全选"的第一信息。
    -->
    <div class="dy-toolbar art-card mb-5 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-2.5 min-w-0">
        <span class="font-bold text-g-900 shrink-0">数据合并查看</span>
        <span class="text-xs text-g-500 truncate">
          同一主播的相邻场次、或跨主播的场次，勾选后合成一份 · 当前
          <b class="combined-count text-theme">{{ filteredRows.length }}</b> / 共
          {{ totalSessions }} 场
        </span>
      </div>
      <div class="dy-toolbar-actions">
        <el-button :loading="loading" @click="refresh">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />刷新
        </el-button>
      </div>
    </div>

    <!-- 失败：与「没有数据」区分开，并给重试入口（与其它抖音页一致） -->
    <QueryErrorState
      v-if="queryError && !loading"
      class="mb-5"
      :message="queryError"
      :retrying="loading"
      @retry="refresh"
    />

    <!--
      首屏骨架：与真实列表**同形**（一条条卡片），数据到达时不会跳高度。
    -->
    <div v-else-if="loading && !groups.length" class="art-card combined-list-card mb-5">
      <div class="combined-list">
        <div v-for="i in 6" :key="i" class="combined-item combined-item--ghost">
          <el-skeleton-item variant="text" style="width: 14px; height: 14px" />
          <div class="combined-item__body">
            <div class="combined-item__head">
              <el-skeleton-item variant="text" style="width: 220px" />
              <el-skeleton-item variant="text" style="width: 96px" />
            </div>
            <div class="combined-item__stats">
              <el-skeleton-item variant="text" style="width: 140px" />
            </div>
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
        筛选行。
        这一页的主用法是「合**同一直播间**的相邻几场」：204 场里先按主播收窄，
        再按时间收窄，剩下的就是"这几天那几场"，一次全选即可。
        所以两个筛选器（主播 / 时间）是这一页最该好用的东西，放在列表正上方。
      -->
      <div class="art-card combined-filters mb-5 flex items-center gap-x-4 gap-y-3 flex-wrap">
        <!--
          主播筛选：平铺成一排标签（带场次数），占满一整行。
          主用法是「合同一个直播间的相邻几场」—— 点一下标签就只剩这个主播，比下拉多选少两步；
          再点一次取消，多选几个主播就是跨直播间合并。场次数直接写在标签上，不用展开看。
        -->
        <div class="flex items-center gap-x-3 gap-y-2 flex-wrap w-full min-w-0">
          <span class="text-xs text-g-500 shrink-0">主播</span>
          <div class="combined-chips" role="group" aria-label="按主播筛选">
            <button
              type="button"
              class="combined-chip"
              :class="{ 'combined-chip--on': !filterStreamerIds.length }"
              title="显示全部主播的场次"
              @click="filterStreamerIds = []"
            >
              全部
              <span class="combined-chip__count">{{ totalSessions }}</span>
            </button>
            <button
              v-for="o in streamerOptions"
              :key="String(o.id)"
              type="button"
              class="combined-chip"
              :class="{ 'combined-chip--on': isStreamerPicked(o.id) }"
              :title="`只看「${o.name}」的场次；再点一次取消`"
              @click="toggleStreamer(o.id)"
            >
              {{ o.name }}
              <span class="combined-chip__count">{{ o.count }}</span>
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-xs text-g-500 shrink-0">时间</span>
          <el-radio-group v-model="filterRange" class="combined-filter-range">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="24h">24 小时</el-radio-button>
            <el-radio-button value="7d">7 天</el-radio-button>
            <el-radio-button value="30d">30 天</el-radio-button>
          </el-radio-group>
        </div>

        <!-- 快捷操作都只作用于**当前筛选结果**（见脚本里各自的注释） -->
        <div class="flex items-center gap-x-2 gap-y-2 flex-wrap ml-auto min-w-0">
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
        <div class="flex flex-col">
          <div v-for="p in visibleCutPairs" :key="p.key" class="combined-reco__row">
            <span class="combined-reco__streamer" :title="p.streamerName">{{
              p.streamerName
            }}</span>
            <span class="combined-reco__range">{{ p.prevLabel }}</span>
            <span class="combined-reco__arrow">↔</span>
            <span class="combined-reco__range">{{ p.nextLabel }}</span>
            <span class="combined-reco__gap">间隔 {{ fmtGap(p.minutes) }}</span>
            <button type="button" class="combined-reco__btn" @click="selectPair(p)">
              合并这两场
            </button>
          </div>
        </div>
      </div>

      <div class="art-card combined-list-card mb-24">
        <div class="combined-list-toolbar">
          <span class="text-xs text-g-500">当前 {{ filteredRows.length }} 场</span>
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
          <template v-for="(row, i) in filteredRows" :key="row.id">
            <!--
              同一主播相邻两场之间的连接条。
              直播被切断重开后两场之间只隔几分钟，这种只有挨着看才看得出关系，
              所以把间隔画在两条目中间，并自带一键「合并这两场」，不用先找再逐个勾。
            -->
            <div v-if="rowGaps[i]" class="combined-link">
              <span class="combined-link__text">距上一场 {{ fmtGap(rowGaps[i]?.minutes) }}</span>
              <button
                type="button"
                class="combined-link__btn"
                title="同时选中这两场（同一主播的相邻两场）"
                @click.stop="selectPair(rowGaps[i])"
              >
                <ArtSvgIcon icon="ri:add-line" />
                合并这两场
              </button>
            </div>

            <!-- 整条目可点：拖选相邻几场时不用瞄准那个 14px 的复选框 -->
            <div
              class="combined-item"
              :class="selectedIds.has(row.id) ? 'combined-item--on' : ''"
              :aria-selected="selectedIds.has(row.id)"
              :title="rowTitle(row)"
              @click="toggle(row.id)"
            >
              <!--
                勾选框的状态完全由 selectedIds 驱动（只给 :model-value）。
                @click.stop 拦住冒泡，否则这次点击会先由本选框处理、再被整条的
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
                <div class="combined-item__head">
                  <span class="combined-item__time">
                    {{ fmtSessionRange(row.startedAt, row.endedAt, narrow) }}
                  </span>
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
          </template>

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
  type RangeKey = 'all' | '24h' | '7d' | '30d'

  const router = useRouter()

  const groups = ref<StreamerGroup[]>([])
  const loading = ref(true)
  /** 取数失败的真实原因；非空时显示错误态而不是空态 */
  const queryError = ref('')

  /** 已勾选的场次 id（Set 让 toggle 是 O(1)；每次都换一个新 Set，响应式不依赖集合插桩） */
  const selectedIds = ref<Set<number>>(new Set())

  /** 主播筛选：空数组 = 全部（el-select 的 clearable 清空后也是空数组） */
  const filterStreamerIds = ref<Array<string | number>>([])
  /** 时间范围：按**开始时间**距今算（用户说"最近 7 天"时想的是"这几天开的播"） */
  const filterRange = ref<RangeKey>('all')
  const RANGE_MS: Record<Exclude<RangeKey, 'all'>, number> = {
    '24h': 864e5,
    '7d': 7 * 864e5,
    '30d': 30 * 864e5
  }

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

  const totalSessions = computed(() => allRows.value.length)

  /** 主播标签的选项：主播名 + 场次数（场次数来自已加载的分组，与列表条数同源） */
  const streamerOptions = computed(() =>
    groups.value.map((g) => ({
      id: g.streamer.id,
      name: g.streamer.name || '未知主播',
      count: g.sessions.length
    }))
  )

  /** 主播标签是否被选中（多选几个主播 = 跨直播间合并） */
  function isStreamerPicked(id: string | number) {
    return filterStreamerIds.value.includes(id)
  }

  function toggleStreamer(id: string | number) {
    const picked = filterStreamerIds.value
    filterStreamerIds.value = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]
  }

  /** 该行是否落在当前的时间范围内 */
  function inRange(ms: number) {
    if (filterRange.value === 'all') return true
    return ms >= Date.now() - RANGE_MS[filterRange.value]
  }

  function resetFilters() {
    filterStreamerIds.value = []
    filterRange.value = 'all'
  }

  const hasFilter = computed(
    () => filterStreamerIds.value.length > 0 || filterRange.value !== 'all'
  )

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

  /** 每个场次 → 同一主播里**更早**那一场的 id（升序相邻关系） */
  const prevOf = computed(() => {
    const map = new Map<number, number>()
    for (const g of groups.value) {
      const asc = [...g.sessions].sort((a, b) => startMs(a) - startMs(b))
      for (let i = 1; i < asc.length; i++) map.set(asc[i].id, asc[i - 1].id)
    }
    return map
  })

  /** 上一场结束 → 这一场开始的间隔（分钟）；算不出来给 null */
  function rowGapMinutes(older: SessionItem, newer: SessionItem): number | null {
    const nextStart = newer.ms || toDate(newer.startedAt)?.getTime()
    if (!nextStart) return null
    // 上一场没结束时间（还在直播 / 异常退出）时退化成"按开始时间估"
    const prevEnd = toDate(older.endedAt)?.getTime() ?? older.ms
    if (!prevEnd) return null
    return Math.round((nextStart - prevEnd) / 60000)
  }

  /** 一对相邻场次（推荐条和列表连接条共用同一份数据） */
  interface CutPair {
    key: string
    streamerName: string
    /** 间隔分钟（负数 = 两场时间有重叠） */
    minutes: number
    /** 要一起选中的两场（较早、较晚） */
    pairIds: [number, number]
    prevLabel: string
    nextLabel: string
    /** 较晚那场的开始时间（推荐条按它倒序，最近的排前面） */
    newestMs: number
  }

  function toCutPair(older: SessionItem, newer: SessionItem, minutes: number): CutPair {
    return {
      key: `${older.id}-${newer.id}`,
      streamerName: older.streamerName,
      minutes,
      pairIds: [older.id, newer.id],
      prevLabel: fmtSessionRange(older.startedAt, older.endedAt, true),
      nextLabel: fmtSessionRange(newer.startedAt, newer.endedAt, true),
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
   * 列表里每一条**上方**要不要插一条「间隔」连接条（null = 不插）。
   * 只在按时间排序时成立 —— 按钻石排序时两条相邻跟时间无关，插连接条是误导。
   */
  const rowGaps = computed<Array<CutPair | null>>(() => {
    const rows = filteredRows.value
    const out: Array<CutPair | null> = new Array(rows.length).fill(null)
    if (sortKey.value !== 'time') return out
    for (let i = 1; i < rows.length; i++) {
      // 降序时上一行是较新的那一场，升序时相反
      const older = sortAsc.value ? rows[i - 1] : rows[i]
      const newer = sortAsc.value ? rows[i] : rows[i - 1]
      if (older.streamerId !== newer.streamerId) continue
      // 只认"真的挨着的两场"：中间被别的场次隔着（比如同主播中间那场被筛掉了）就不插
      if (prevOf.value.get(newer.id) !== older.id) continue
      const minutes = rowGapMinutes(older, newer)
      if (minutes === null || minutes > TIGHT_GAP_MIN) continue
      out[i] = toCutPair(older, newer, minutes)
    }
    return out
  })

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
   * 主播标签：一排圆角小标签（名字 + 场次数）。
   * 用它替掉原来的下拉多选 —— 9 个主播平铺时"每个主播多少场"直接可见，
   * 且主用法（只看某一个主播）从「展开下拉 → 取消全选 → 勾一个」变成「点一下」。
   */
  .combined-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }

  .combined-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--art-gray-700);
    cursor: pointer;
    background: var(--art-gray-100);
    border: 1px solid var(--art-card-border);
    border-radius: 999px;
    transition:
      color 0.15s,
      background-color 0.15s,
      border-color 0.15s;
  }

  .combined-chip:hover {
    color: var(--theme-color);
    border-color: color-mix(in srgb, var(--theme-color) 30%, transparent);
  }

  .combined-chip--on {
    font-weight: 600;
    color: var(--theme-color);
    background: color-mix(in srgb, var(--theme-color) 12%, transparent);
    border-color: color-mix(in srgb, var(--theme-color) 40%, transparent);
  }

  .combined-chip__count {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    opacity: 0.65;
  }

  .combined-chip--on .combined-chip__count {
    opacity: 0.9;
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

  .combined-reco__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
    border-top: 1px dashed var(--art-card-border);
  }

  .combined-reco__row:first-child {
    margin-top: 4px;
  }

  .combined-reco__streamer {
    max-width: 180px;
    overflow: hidden;
    font-size: 12px;
    font-weight: 600;
    color: var(--art-gray-800);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .combined-reco__range {
    font-size: 12px;
    color: var(--dy-text-primary);
    font-variant-numeric: tabular-nums;
  }

  .combined-reco__arrow {
    font-size: 12px;
    color: var(--dy-text-muted);
  }

  .combined-reco__gap {
    font-size: 11px;
    color: var(--theme-color);
    font-variant-numeric: tabular-nums;
  }

  /* 一键「合并这两场」：做成轻量文字按钮，不跟主按钮抢注意力 */
  .combined-reco__btn,
  .combined-link__btn {
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

  .combined-reco__btn {
    margin-left: auto;
  }

  .combined-reco__btn:hover,
  .combined-link__btn:hover {
    background: color-mix(in srgb, var(--theme-color) 12%, transparent);
    border-color: color-mix(in srgb, var(--theme-color) 30%, transparent);
  }

  /* ============ 相邻场次连接条 ============ */
  /*
   * 夹在两条场次中间的细条：左侧一段虚线竖轨表示"这两场是接着的"，
   * 右边给间隔与一键合并。刻意做得很轻（11px 灰字），不打断列表的节奏。
   */
  .combined-link {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-left: 22px;
    padding: 1px 4px;
    font-size: 11px;
    color: var(--dy-text-muted);
  }

  .combined-link::before {
    content: '';
    width: 2px;
    height: 14px;
    background: repeating-linear-gradient(to bottom, var(--theme-color) 0 2px, transparent 2px 4px);
    border-radius: 2px;
    opacity: 0.55;
  }

  .combined-link__btn {
    margin-left: auto;
  }

  /* ============ 场次列表（卡片式，不用表格） ============ */
  /* 卡片自带内边距会破坏工具条与列表的贴边，这里清零并裁掉圆角外的溢出 */
  .combined-list-card {
    padding: 0;
    overflow: hidden;
  }

  .combined-list-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--art-card-border);
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

  /* 滚动区：204 场全渲染，滚动只发生在这个容器里（页面本身不被拉成十几屏） */
  .combined-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 58vh;
    overflow-y: auto;
    padding: 12px 16px;
  }

  /* 一条场次：勾选框 + 时间/主播/时长 + 三项指标 */
  .combined-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    background: var(--art-gray-100);
    border: 1px solid transparent;
    border-radius: 10px;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }

  .combined-item:hover {
    background: var(--art-gray-200);
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
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .combined-item__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
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
    max-width: 200px;
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
   * 卡片式列表在手机上天然竖排，只需要把间距、字号收一收；
   * 时间用短格式（省年份，见脚本里的 narrow），避免一条目里时间折两行。
   */
  @media (max-width: 767px) {
    /*
     * 主播标签在手机上改成**一行横滑**：9 个主播平铺会占到 250px 高，
     * 把列表推到首屏之外；横滑只占一行，滑动时才出现滚动条（全局自动隐藏）。
     */
    .combined-chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .combined-chip {
      flex: 0 0 auto;
    }

    .combined-list {
      max-height: 62vh;
      padding: 10px 12px;
    }

    .combined-item {
      padding: 9px 10px;
    }

    .combined-item__time {
      font-size: 12px;
    }

    .combined-item__streamer {
      max-width: 120px;
    }

    .combined-item__dur {
      margin-left: 0;
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

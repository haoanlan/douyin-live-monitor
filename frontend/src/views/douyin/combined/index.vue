<template>
  <div class="douyin-page dy-stagger p-4">
    <!-- 顶栏（筛选行）：**始终渲染**，不放在数据分支里 —— 否则加载中它不存在、数据回来才整块出现（"闪现"）。 -->
      <div class="art-card combined-filters mb-5">
        <div class="combined-filter-row">
          <div class="combined-filter-item combined-filter-item--select">
            <el-select
              v-model="filterStreamerIds"
              class="combined-filter-select"
              multiple
              filterable
              clearable
              collapse-tags
              collapse-tags-tooltip
              :max-collapse-tags="1"
              placeholder=""
              aria-label="筛选主播"
            >
              <!--
                label 只放主播名：el-select 的已选标签显示的是 label，
                把「（147 场）」写进 label 会让标签变宽、两个就换行，把整块筛选条撑高。
                场次数改在选项内部显示，不影响标签。
              -->
              <!--
                未选主播时显示「全部主播」：走 prefix 插槽，渲染在 wrapper 内部的正常文档流里
                （Element 自带的多选占位层是 absolute + z-index:-1，会被底色盖住）。
              -->
              <template #prefix>
                <span v-if="!filterStreamerIds.length" class="combined-select-ph">全部主播</span>
              </template>
              <el-option
                v-for="o in streamerOptions"
                :key="String(o.id)"
                :label="o.name"
                :value="o.id"
              >
                <span class="combined-option">
                  <span class="combined-option__name">{{ o.name }}</span>
                  <span class="combined-option__count">{{ o.count }} 场</span>
                </span>
              </el-option>
            </el-select>
          </div>

          <!-- 时间：日期范围（桌面手机同一套，不再挂快捷项） -->
          <div class="combined-filter-item">
            <el-date-picker
              v-model="dateRange"
              class="combined-filter-date"
              type="daterange"
              unlink-panels
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
            />
          </div>

          <!--
            选中情况 + 操作。三个按钮**位置固定**（清空改成常驻 + 未选时禁用），
            否则「清空」随选择出现/消失，右边几个按钮会左右跳一下。
            未满 2 场时「查看合并」禁用 —— Chrome 不给 disabled 按钮派发 click，
            所以提示挂在外层 span 上（锁定态给按钮 pointer-events: none）。
          -->
          <div class="combined-selection">
            <span class="combined-selection__count">
              已选 <b>{{ selectedIds.size }}</b> 场
            </span>
            <span class="combined-selection__actions">
              <!--
                一个按钮两用：没选时是「全选」（选中当前筛选结果），有选时变「清空」。
                原来两个按钮并排，位置固定但占地方；合成一个后右边只留合并按钮。
              -->
              <el-button
                :disabled="!filteredRows.length && !selectedIds.size"
                :title="selectedIds.size ? '清空已选场次' : '把当前筛选结果里的场次全部选中'"
                @click="toggleSelectAll"
              >
                {{ selectedIds.size ? '清空' : '全选' }}
              </el-button>
              <span class="combined-selection__cta" @click="onMergeClick">
                <el-button
                  type="primary"
                  class="combined-merge-btn"
                  :class="{ 'is-locked': selectedIds.size < 2 }"
                  :disabled="selectedIds.size < 2 || merging"
                  :loading="merging"
                  @click="viewCombined"
                >
                  <!--
                    loading 时 Element 会自己插一个转圈图标，这里把原图标去掉，
                    宽度才不会因为"多塞一个图标"而变（再配合 .combined-merge-btn 的 min-width）
                  -->
                  <ArtSvgIcon v-if="!merging" icon="ri:merge-cells-horizontal" class="mr-1" />
                  查看合并
                </el-button>
              </span>
            </span>
          </div>
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
      首屏骨架：与真实列表**同形**（一条条卡片、同样的网格列数），数据到达时不跳高度。
    -->
    <div v-else-if="loading && !groups.length" class="combined-list-zone mb-5">
      <div class="combined-list">
        <div v-for="i in 20" :key="i" class="combined-item combined-item--ghost">
          <el-skeleton-item variant="text" style="width: 14px; height: 14px" />
          <div class="combined-item__body">
            <div class="combined-item__head">
              <el-skeleton-item variant="circle" style="width: 32px; height: 32px" />
              <div class="combined-item__text">
                <el-skeleton-item variant="text" style="width: 58%" />
                <el-skeleton-item variant="text" style="width: 84%" />
              </div>
            </div>
            <div class="combined-item__stats">
              <el-skeleton-item variant="text" style="width: 124px" />
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
        筛选行：主播（多选下拉，可搜索）+ 时间（日期范围）。
        主播不用平铺标签 —— 直播间会越来越多，标签铺不下；
        下拉自带搜索与折叠，几十个直播间也只占一行。
      -->


      <!--
        场次列表：不要卡片外壳，也不要排序行 —— 永远按开始时间倒序（最近的播在最上面）。
        204 场本来就是这一页的主体，多一层卡面/工具条只是多一圈边。
      -->
      <div class="combined-list-zone mb-5">
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

            <!-- 直接照「场次历史」的卡片：头像 + 标题/时间 + 状态标签，下面一条数据行 -->
            <div class="combined-item__body">
              <div class="combined-item__head">
                <el-avatar :size="36" :src="avatarSrc(row.avatar)" class="combined-item__avatar">
                  {{ row.streamerName?.[0] || '播' }}
                </el-avatar>
                <div class="combined-item__text">
                  <!-- 标题位置放直播间名字（原来这里是「场次 #303」） -->
                  <div class="combined-item__title" :title="row.streamerName">
                    {{ row.streamerName }}
                  </div>
                  <div class="combined-item__time">
                    {{ fmtSessionRange(row.startedAt, row.endedAt, true) }}
                    <template v-if="row.durationMin"> · {{ fmtDur(row.durationMin) }}</template>
                  </div>
                </div>
                <el-tag
                  :type="row.isLive ? 'danger' : 'info'"
                  size="small"
                  effect="light"
                  class="combined-item__status shrink-0 !border-none"
                >
                  {{ row.isLive ? '直播中' : '已结束' }}
                </el-tag>
              </div>

              <!-- 数据行：虚线分隔 + 三项指标，右下角放场次号（原来那里是下载/删除按钮） -->
              <div class="combined-item__stats">
                <span :title="`钻石 ${fmtFull(row.diamonds)}`">
                  <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />{{ fmtNum(row.diamonds) }}
                </span>
                <span :title="`礼物 ${fmtFull(row.gifts)}`">
                  <ArtSvgIcon icon="ri:gift-2-line" class="text-g-400" />{{ fmtNum(row.gifts) }}
                </span>
                <span :title="`弹幕 ${fmtFull(row.danmaku)}`">
                  <ArtSvgIcon icon="ri:chat-3-line" class="text-g-400" />{{ fmtNum(row.danmaku) }}
                </span>
                <span class="combined-item__id">场次 #{{ row.id }}</span>
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
          <!--
            总数据报告：和场次历史页那张同一套模板。按钮定位复用全局 .rank-dl-btn 规则
            （绝对定位、与关闭键同一中心线），否则又会像上次那样"按钮没对齐"。
          -->
          <button
            class="rank-dl-btn flex-cc rounded-lg text-g-600 hover:bg-g-100 hover:text-theme disabled:opacity-50"
            :disabled="reportDownloading || !result"
            :title="reportDownloading ? '正在生成合并报告…' : '下载总数据报告'"
            aria-label="下载总数据报告"
            @click="downloadCombinedReport"
          >
            <ArtSvgIcon
              :icon="reportDownloading ? 'ri:loader-4-line' : 'ri:download-line'"
              class="text-base"
              :class="reportDownloading ? 'animate-spin' : ''"
            />
          </button>
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
        <!--
          4 张统计卡：用 grid 而不是 el-row/el-col —— el-row 的 :gutter 会给行加负边距，
          在弹窗里正好溢出 8px（实测弹窗横向滚动条就是这么来的）。
        -->
        <div class="combined-stat-grid">
          <div
            v-for="c in statCards"
            :key="c.label"
            class="art-card h-20 flex items-center justify-between px-4"
            :title="c.title"
          >
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
        </div>

        <!--
          本次合并包含的场次：最多显示 3 场，其余折成「+N 场」（一场活动能合十几场，
          全列出来会把弹窗顶部撑得很高）。点 chip 进该场次详情。
        -->
        <div
          v-if="combinedSessionChips.length"
          class="combined-chips flex items-center gap-1.5 mb-4"
        >
          <span class="text-xs text-g-500 shrink-0">包含场次</span>
          <button
            v-for="s in combinedSessionChips.slice(0, 3)"
            :key="s.id"
            class="dy-combined-chip dy-pressable"
            :title="`${s.streamer} · ${fmtSessionRange(s.started_at, null)}（点击打开场次 #${s.id}）`"
            @click="openSessionDetail(s.id)"
          >
            <!--
              文字必须包一层：chip 是 inline-flex，text-overflow: ellipsis 在
              flex 容器上不生效（原来就是这么被硬裁成「…19:3」的）。
              这层 span 成为 flex item 后被 blockify，省略号才真的出现。
            -->
            <span class="dy-combined-chip__text">
              {{ s.streamer }} · {{ fmtSessionRange(s.started_at, null) }}
            </span>
          </button>
          <span
            v-if="combinedSessionChips.length > 3"
            class="dy-combined-chip dy-combined-chip--more"
            :title="
              combinedSessionChips
                .slice(3)
                .map((s) => `#${s.id} ${s.streamer}`)
                .join('\n')
            "
          >
            +{{ combinedSessionChips.length - 3 }} 场
          </span>
        </div>

        <!--
          三个榜单用「场次详情」页那套卡片（art-card + art-card-header + dy-detail-row）：
          排名徽标、头像、昵称、主数值 + 次数值，同一个视觉语言，不用另造一套。
          桌面并排三列；手机端换成 tab 切换（一列三张太高，弹窗里滚不动）。
        -->
        <div v-if="!isMobile" class="combined-rank-grid">
          <section v-for="p in rankPanels" :key="p.key" class="art-card p-5 flex flex-col">
            <div class="art-card-header">
              <div class="title">
                <h4>{{ p.title }}</h4>
                <p>{{ p.sub }}</p>
              </div>
            </div>
            <div class="dy-scroll combined-rank-list mt-4">
              <div
                v-for="(row, i) in p.rows"
                :key="row.id"
                class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
                :class="row.raw ? 'cursor-pointer hover:bg-g-100' : ''"
                :role="row.raw ? 'button' : undefined"
                :tabindex="row.raw ? 0 : undefined"
                :aria-label="row.raw ? `查看 ${row.name} 收到的礼物` : undefined"
                @click="row.raw && openAnchorPeople(row.raw)"
                @keydown.enter.prevent="row.raw && openAnchorPeople(row.raw)"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="avatarSrc(row.avatar)" class="shrink-0">
                  {{ row.name?.[0] || '?' }}
                </el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ row.name }}</span>
                <div class="text-right shrink-0">
                  <div class="text-sm font-bold text-theme" :title="row.value">{{ row.value }}</div>
                </div>
              </div>
              <el-empty v-if="!p.rows.length" :description="p.empty" :image-size="60" />
            </div>
          </section>
        </div>

        <el-tabs v-else v-model="rankTab" class="combined-rank-tabs">
          <el-tab-pane v-for="p in rankPanels" :key="p.key" :label="p.title" :name="p.key">
            <div class="dy-scroll combined-rank-list">
              <div
                v-for="(row, i) in p.rows"
                :key="row.id"
                class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
                :class="row.raw ? 'cursor-pointer hover:bg-g-100' : ''"
                :role="row.raw ? 'button' : undefined"
                :tabindex="row.raw ? 0 : undefined"
                :aria-label="row.raw ? `查看 ${row.name} 收到的礼物` : undefined"
                @click="row.raw && openAnchorPeople(row.raw)"
                @keydown.enter.prevent="row.raw && openAnchorPeople(row.raw)"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="avatarSrc(row.avatar)" class="shrink-0">
                  {{ row.name?.[0] || '?' }}
                </el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ row.name }}</span>
                <div class="text-right shrink-0">
                  <div class="text-sm font-bold text-theme" :title="row.value">{{ row.value }}</div>
                </div>
              </div>
              <el-empty v-if="!p.rows.length" :description="p.empty" :image-size="60" />
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-dialog>

    <!--
      「感谢榜单」：点主播排行里某一行 → 这个主播在所选场次里收到的礼物（谁送了多少）。
      结构和场次详情页那个弹窗一致：标题栏右侧一颗下载图标，点开切成模板网格，
      选模板就按「这次合并的场次」渲染并逐页下载该主播的感谢榜单。
    -->
    <el-dialog
      v-model="peopleDialogVisible"
      width="520"
      class="combined-people-dialog"
      align-center
      :close-on-click-modal="false"
    >
      <template #header>
        <div class="flex items-center gap-3">
          <el-avatar :size="40" :src="avatarSrc(peopleAnchorAvatar)" class="shrink-0">
            {{ peopleAnchorName?.[0] || '?' }}
          </el-avatar>
          <div class="min-w-0 flex-1">
            <div class="text-base font-medium text-g-900 truncate">{{ peopleAnchorName }}</div>
            <div class="text-xs text-g-500 mt-0.5">
              所选 {{ selectedIds.size }} 场里收到礼物的人 · {{ peopleList.length }} 人
            </div>
          </div>
          <button
            class="rank-dl-btn flex-cc rounded-lg text-g-600 hover:bg-g-100 hover:text-theme disabled:opacity-50"
            :disabled="rankDownloading || !rankThemes.length"
            :title="rankPickerOpen ? '返回榜单' : '下载感谢榜单'"
            :aria-label="rankPickerOpen ? '返回榜单' : '下载感谢榜单'"
            @click="rankPickerOpen = !rankPickerOpen"
          >
            <ArtSvgIcon
              :icon="
                rankDownloading
                  ? 'ri:loader-4-line'
                  : rankPickerOpen
                    ? 'ri:arrow-left-line'
                    : 'ri:download-line'
              "
              class="text-base"
              :class="rankDownloading ? 'animate-spin' : ''"
            />
          </button>
        </div>
      </template>

      <!-- 选模板：选完自动下载并切回名单 -->
      <div v-if="rankPickerOpen" class="max-h-80 overflow-y-auto">
        <div class="mb-2.5 text-xs text-g-500">选择模板（选完自动下载这次合并的感谢榜单）</div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <button
            v-for="t in rankThemes"
            :key="t"
            class="dy-pressable rounded-xl border px-3 py-2.5 text-left transition-colors"
            :class="
              t === rankTheme
                ? 'border-theme bg-theme/5 text-theme'
                : 'border-g-200 text-g-700 hover:border-theme/50 hover:bg-g-100/60'
            "
            :disabled="rankDownloading"
            @click="onPickRankTheme(t)"
          >
            <div class="text-sm font-medium truncate">{{ rankThemeLabel(t) }}</div>
            <div class="mt-0.5 text-[11px] text-g-400 truncate">{{ t }}</div>
          </button>
        </div>
      </div>

      <div v-else class="flex flex-col gap-2.5 max-h-80 overflow-y-auto">
        <div
          v-for="(p, i) in peopleList"
          :key="`${p.user_sec_uid || p.nickname}-${i}`"
          class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
        >
          <span class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0" :class="rankClass(i)">
            {{ i + 1 }}
          </span>
          <el-avatar :size="28" :src="avatarSrc(p.avatar_url)" class="shrink-0">
            {{ p.nickname?.[0] || '?' }}
          </el-avatar>
          <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ p.nickname }}</span>
          <span class="text-sm font-bold text-theme shrink-0">{{ fmtFull(p.total_diamonds) }}</span>
        </div>
        <el-skeleton v-if="peopleLoading && !peopleList.length" :rows="4" animated />
        <el-empty
          v-else-if="!peopleList.length"
          description="所选场次里这个主播没有收到礼物"
          :image-size="60"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onActivated, onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import {
    fetchCombinedAnchorPeople,
    fetchCombinedSessions,
    fetchRankThemes,
    fetchSessions,
    fetchStreamers,
    getCombinedRankImageUrl,
    getCombinedReportUrl,
    type CombinedAnchorItem,
    type CombinedAnchorPerson,
    type CombinedResult,
    type Session,
    type Streamer
  } from '@/api/douyin'
  import { downloadWithAuth } from '@/utils/download'
  import { apiErrorMessage } from '@/utils/douyin-error'
  import { fmtFull, fmtNum, fmtSessionRange, rankClass, toDate } from '@/utils/format'
  import { rankThemeLabel } from '@/utils/rank-themes'
  import { useIsMobile } from '@/hooks/core/useIsMobile'

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
    /** 主播头像（卡片左侧那个圆形头像；后端可能给 null/空串） */
    avatar: string
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

  const router = useRouter()

  const groups = ref<StreamerGroup[]>([])
  const loading = ref(true)
  /** 取数失败的真实原因；非空时显示错误态而不是空态 */
  const queryError = ref('')

  /** 已勾选的场次 id（Set 让 toggle 是 O(1)；每次都换一个新 Set，响应式不依赖集合插桩） */
  const selectedIds = ref<Set<number>>(new Set())

  /** 主播筛选：空数组 = 全部（el-select 的 clearable 清空后也是空数组） */
  const filterStreamerIds = ref<Array<string | number>>([])
  /** 时间范围（空 = 不限）：桌面手机同一个 daterange 控件 */
  const dateRange = ref<[Date, Date] | null>(null)

  const merging = ref(false)
  const mergeError = ref('')
  const dialogVisible = ref(false)
  const result = ref<CombinedResult | null>(null)
  /** 正在合并的场次 id（弹窗头部在结果到达前用它显示进度） */
  const pendingIds = ref<number[]>([])

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

  /** 窄屏（<768px）弹窗里的榜单改用 tab 切换（三列并排在手机上一列都看不清） */
  const { isMobile } = useIsMobile()
  /** 手机端当前选中的榜单 tab */
  const rankTab = ref('gifts')

  /**
   * 弹窗里的三个榜单：统一成同一套行结构，桌面并排三列、手机 tab 切换共用。
   * 行的样式直接沿用场次详情页的 .dy-detail-row（排名徽标 + 头像 + 昵称 + 数值）。
   * 主播榜的每行带上原始对象（raw），点它就能查这个主播在所选场次里的送礼人员。
   */
  interface RankRow {
    id: string
    name: string
    avatar?: string | null
    value: string
    raw?: CombinedAnchorItem
  }
  interface RankPanel {
    key: string
    title: string
    sub: string
    rows: RankRow[]
    empty: string
  }

  const rankPanels = computed<RankPanel[]>(() => {
    const r = result.value
    if (!r) return []
    return [
      {
        key: 'gifts',
        title: '礼物排行',
        sub: `按钻石降序 Top ${r.gifts.length}`,
        rows: r.gifts.map((g) => ({
          id: g.user_sec_uid || g.nickname,
          name: g.nickname,
          avatar: g.avatar_url,
          value: fmtFull(g.total_diamonds)
        })),
        empty: '所选场次暂无礼物数据'
      },
      {
        key: 'anchors',
        title: '主播排行',
        sub: `共 ${r.anchorRanking.length} 位`,
        rows: r.anchorRanking.map((a) => ({
          id: a.anchor_sec_uid || a.anchor_name,
          name: a.anchor_name,
          avatar: a.anchor_avatar,
          value: fmtFull(a.total_diamonds),
          raw: a
        })),
        empty: '所选场次暂无主播数据'
      },
      {
        key: 'danmaku',
        title: '弹幕排行',
        sub: `按条数降序 Top ${r.danmakuRanking.length}`,
        rows: r.danmakuRanking.map((d) => ({
          id: d.user_sec_uid || d.nickname,
          name: d.nickname,
          avatar: d.avatar,
          value: `${fmtFull(d.msg_count)} 条`
        })),
        empty: '所选场次暂无弹幕数据'
      }
    ]
  })

  /* ==================== 感谢榜单下载（选主播 → 送礼人员 → 选模板 → 逐页下载） ==================== */
  const peopleDialogVisible = ref(false)
  const peopleAnchorName = ref('')
  const peopleAnchorAvatar = ref('')
  const peopleList = ref<CombinedAnchorPerson[]>([])
  const peopleLoading = ref(false)

  const rankTheme = ref('')
  const rankThemes = ref<string[]>([])
  const rankDefaultTheme = ref('depth-glass')
  const rankDownloading = ref(false)
  /** 总数据报告生成中（弹窗右上角那颗下载键转圈用） */
  const reportDownloading = ref(false)
  const rankPickerOpen = ref(false)

  async function ensureRankThemes() {
    if (rankThemes.value.length) return
    try {
      const r = await fetchRankThemes()
      rankThemes.value = r.themes || []
      rankDefaultTheme.value = r.default || 'depth-glass'
      if (!rankTheme.value) rankTheme.value = rankDefaultTheme.value
    } catch (e) {
      console.warn('[rank-image] 模板清单获取失败:', apiErrorMessage(e, ''))
    }
  }

  /** 点主播排行里的一行：拉这个主播在所选场次里的送礼人员 */
  async function openAnchorPeople(row: CombinedAnchorItem) {
    peopleAnchorName.value = row.anchor_name
    peopleAnchorAvatar.value = row.anchor_avatar || ''
    peopleList.value = []
    rankPickerOpen.value = false
    peopleDialogVisible.value = true
    peopleLoading.value = true
    void ensureRankThemes()
    try {
      const r = await fetchCombinedAnchorPeople([...selectedIds.value], row.anchor_name)
      peopleList.value = r.people || []
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '送礼人员加载失败'))
    } finally {
      peopleLoading.value = false
    }
  }

  /** 选模板 → 立刻下载这个主播的感谢榜单（多场次合并口径，分页下完） */
  async function onPickRankTheme(theme: string) {
    rankTheme.value = theme
    rankPickerOpen.value = false
    await downloadPeopleRank()
  }

  async function downloadPeopleRank() {
    const ids = [...selectedIds.value]
    if (!ids.length || !peopleAnchorName.value) return
    if (ids.length > 20) {
      ElMessage.warning('合并感谢榜单最多支持 20 场，请减少选择的场次')
      return
    }
    await ensureRankThemes()
    const theme = rankTheme.value || rankDefaultTheme.value
    rankDownloading.value = true
    let pages = 1
    let ok = 0
    try {
      for (let p = 1; p <= pages; p++) {
        await downloadWithAuth(
          getCombinedRankImageUrl(ids, {
            theme,
            page: p,
            to: peopleAnchorName.value,
            avatar: peopleAnchorAvatar.value
          }),
          `感谢榜单_${peopleAnchorName.value}_${theme}_第${p}页.jpg`,
          (headers) => {
            const t = Number((headers['x-total-pages'] as string) || 1)
            if (Number.isFinite(t) && t > 0) pages = Math.min(Math.floor(t), 20)
          }
        )
        ok++
      }
      ElMessage.success(ok > 1 ? `已下载 ${ok} 张感谢榜单` : '感谢榜单已下载')
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '感谢榜单下载失败'))
    } finally {
      rankDownloading.value = false
    }
  }

  /** 总数据报告：和场次历史页那张同一套模板，只是喂给它的数据是这几场合并后的 */
  async function downloadCombinedReport() {
    const ids = [...selectedIds.value]
    if (ids.length < 2) return
    if (ids.length > 10) {
      ElMessage.warning('总数据报告最多支持 10 场合并，请减少选择的场次')
      return
    }
    reportDownloading.value = true
    try {
      await downloadWithAuth(getCombinedReportUrl(ids), `合并报告_${ids.length}场.jpg`)
      ElMessage.success('合并报告已下载')
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '报告下载失败'))
    } finally {
      reportDownloading.value = false
    }
  }

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
          avatar: g.streamer.avatar || s.streamer_avatar || '',
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
   * 当前筛选后的行，**固定按开始时间倒序**（最近的播在最上面）。
   * 这一页不再提供排序切换：合并看的是"同一段时间的几场"，按时间排是唯一合理的顺序。
   * filter 已返回新数组，所以这里的 sort 不会改动 allRows。
   */
  const filteredRows = computed<SessionItem[]>(() => {
    const picked = filterStreamerIds.value
    return allRows.value
      .filter((r) => (!picked.length || picked.includes(r.streamerId)) && inRange(r.ms))
      .sort((a, b) => b.ms - a.ms)
  })

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

  /**
   * 「全选」：把**当前筛选结果**并入选择（只新增，不取消已有的）。
   * 筛选在这里的用途就是"缩小范围后一次多选"，所以不提供"再点一次反选"的隐藏语义
   * —— 要取消请用「清空」或直接点卡片。
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

  /** 一个按钮两用：有选中就清空，没选中就全选当前筛选结果 */
  function toggleSelectAll() {
    if (selectedIds.value.size) clearSelection()
    else selectAllFiltered()
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
         * 现在是真的跨场次去重：后端把所选场次的「送礼人 + 发言者」按
         * user_sec_uid（没有就退化成昵称）求并集，同一个人看两场只算一次。
         * user_count_sum 是各场 agg_users 直接相加的旧口径，放在 tooltip 里做对照。
         */
        icon: 'ri:user-3-line',
        value: fmtNum(s?.user_count),
        title:
          `跨场次去重后的真实人数（送过礼或发过言的人）精确值 ${fmtFull(s?.user_count)}` +
          (s?.user_count_sum != null ? `；各场用户数相加为 ${fmtFull(s.user_count_sum)}` : '')
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
    refresh()
  })
  onActivated(() => {
    if (!activatedOnce) {
      activatedOnce = true
      return
    }
    refresh()
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

  /* 未选主播时的「全部主播」：prefix 插槽里的静态文字，天然在框内 */
  .combined-select-ph {
    margin-right: 4px;
    font-size: 13px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
  }

  /* 给固定宽度，否则默认 240px 会把日期挤到第二行 */
  .combined-filter-select {
    width: 240px;
  }

  /*
   * 多选时已选标签**不许换行**：Element 默认 flex-wrap: wrap，
   * 标签一多就叠成两行，把整块筛选条从 46px 撑到 70px+（用户反馈"高度被顶高"）。
   * 这里强制单行 + 省略号，多余的用「+N」折叠（collapse-tags + max-collapse-tags=1）。
   */
  .combined-filter-select :deep(.el-select__selection),
  .combined-filter-select :deep(.el-select__tags) {
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .combined-filter-select :deep(.el-tag),
  .combined-filter-select :deep(.el-select__selected-item) {
    max-width: 132px;
  }

  .combined-filter-select :deep(.el-tag__content) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /*
   * 下拉选项：主播名靠左、场次数靠右。
   * 右边留 18px 是给选中那个对勾的位置 —— 不留的话「147 场」和 ✓ 挤在一起；
   * 所有选项都留同样宽度，选中/未选中的场次数才能上下对齐。
   */
  .combined-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-right: 18px;
  }

  .combined-option__name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .combined-option__count {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--dy-text-muted);
  }

  .combined-filter-date {
    width: 268px;
  }

  /* ============ 场次列表（卡片网格，不用表格） ============ */
  /* 列表不再套卡片外壳：204 场本身就是这一页的主体，多一层卡面只是多一圈边 */
  .combined-list-zone {
    min-width: 0;
  }

  /*
   * 列宽：卡片里要放「头像 + 直播名字 + 状态标签」和一行完整的时间段，
   * 260px 时跨天写法（10/15 15:32 → 10/16 03:17）会被挤成省略号，实测 340px 起才放得下。
   * 于是 1872px 宽下是 4 列（不是 6 列），1440px 下 3 列，1024px 下 2 列，手机 1 列。
   */
  .combined-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 8px;
    align-items: start;
    padding: 0;
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

  /*
   * hover：边界必须比常态**更明显**。
   * 原来写的是 --art-gray-200 (#f2f4f5) —— 那正好是页面底色，hover 后整圈描边
   * 和背景融在一起，看起来"顶部边框线没了"。改成主题色淡淡描一圈。
   */
  .combined-item:hover {
    background: var(--art-gray-100);
    border-color: color-mix(in srgb, var(--theme-color) 32%, var(--art-card-border));
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

  /* 头像 + 主播名/时间段 + 状态：整行固定两行文字的高度，卡片高度才统一 */
  .combined-item__head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .combined-item__avatar {
    flex-shrink: 0;
  }

  /* 标题位置是直播间名字（继承「场次历史」的 .font-medium text-sm text-g-900） */
  .combined-item__title {
    overflow: hidden;
    font-size: 14px;
    font-weight: 500;
    color: var(--art-gray-900);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 次行：时间段 + 时长，单行省略（跨天 33 字符也不换行） */
  .combined-item__time {
    overflow: hidden;
    font-size: 12px;
    line-height: 16px;
    color: var(--dy-text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* 两行文字块：高度与 36px 头像对齐 */
  .combined-item__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
  }

  /* 状态标签：直接沿用场次历史的 el-tag(danger/info)，不吃卡片高度 */
  .combined-item__status {
    align-self: flex-start;
  }

  /*
   * 指标行：**不许换行** —— 换成两行会让同排卡片高度差 28px（实测 80 / 108）。
   * 三个数字都 nowrap，放不下时省略；实测最长「367.95万 / 8,059 / 6,375」在 260px 列宽下仍放得下。
   */
  .combined-item__stats {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 10px;
    margin-top: 2px;
    padding-top: 6px;
    font-size: 11px;
    color: var(--dy-text-muted);
    border-top: 1px dashed var(--art-card-border);
  }

  .combined-item__stats span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 场次号贴在数据行最右（原来那个位置是下载/删除按钮） */
  .combined-item__id {
    flex-shrink: 0;
    margin-left: auto;
    color: var(--dy-text-muted);
    font-variant-numeric: tabular-nums;
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

  /* 选中情况 + 合并入口：原来在底部浮动条上，现在跟着筛选行走 */
  .combined-selection {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin-left: auto;
  }

  /* 字号跟按钮（14px）保持一致，否则「已选 N 场」比按钮矮一截、看着像没对齐 */
  .combined-selection__count {
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1;
    color: var(--dy-text-primary);
    white-space: nowrap;
  }

  /* 右侧操作组：三个按钮固定位置，不随选择状态增删（否则会左右跳） */
  .combined-selection__actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* 选中区与筛选控件之间一条竖线，视觉上分开「筛选」和「操作」 */
  .combined-selection {
    padding-left: 16px;
    border-left: 1px solid var(--art-card-border);
  }

  .combined-selection__count b {
    font-weight: 600;
    color: var(--theme-color);
  }

  .combined-selection__cta {
    display: inline-flex;
  }

  /* 锁定态：让 click 穿过按钮落到外层 span 上，「点一下给提示」才生效 */
  .combined-selection__cta .is-locked {
    pointer-events: none;
  }
  /* ============ 窄屏（<768px） ============ */
  /*
   * 卡片网格靠 auto-fill 自己掉到 1 列，这里只把间距、字号收一收；
   * 时间用短格式（省年份，见脚本里的 narrow），免得一张卡里时间折成两行。
   */
  @media (max-width: 767px) {
    /*
     * 手机上把顶栏压成三行：
     *   1. 主播下拉（整行）
     *   2. 日期范围（整行）
     *   3. 「已选 N 场 ........ 全选  查看合并」（一行，不再各占一行）
     */
    .combined-filters {
      padding: 10px 12px;
    }

    .combined-filter-row {
      gap: 8px;
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

    /* 选中区：不再画左侧竖线，改成一行「已选 N 场 ……… 按钮」 */
    .combined-selection {
      flex-wrap: nowrap;
      width: 100%;
      margin-left: 0;
      padding-left: 0;
      border-left: none;
    }

    .combined-selection__count {
      font-size: 13px;
    }

    /* 按钮往右靠，跟左边的「已选 N 场」拉开 */
    .combined-selection__actions {
      margin-left: auto;
      gap: 6px;
    }

    /* 手机上把按钮收窄一点，两个按钮才放得下一行 */
    .combined-selection__actions :deep(.el-button) {
      padding: 8px 10px;
      font-size: 13px;
    }

    .combined-list {
      padding: 0;
    }

    .combined-item {
      padding: 9px 10px;
    }
  }
  /*
   * 手机上的日期范围面板：Element 的 daterange 面板是**两个整月并排**（约 646px），
   * 390 宽的视口里装不下，两个月份会挤在一起互相压住。
   * 这里只调弹层（不影响输入框本身）：面板收窄成单列、两个月份上下排，面板内部自己滚。
   * 弹层是 teleport 到 body 的，所以必须用 :global 才选得到。
   */
  @media (max-width: 767px) {
    :global(.el-picker-panel.el-date-range-picker) {
      width: 322px !important;
    }

    :global(.el-date-range-picker .el-picker-panel__body) {
      max-height: 62vh;
      overflow-y: auto;
    }

    /* 左右两个月改成上下排 */
    :global(.el-date-range-picker__content) {
      float: none;
      width: 100% !important;
      padding: 0;
    }

    :global(.el-date-range-picker__content.is-right) {
      border-left: none;
      border-top: 1px solid var(--art-card-border);
      margin-top: 8px;
      padding-top: 8px;
    }
  }
  /* ============ 合并结果弹窗（三个榜单并排） ============ */

  /*
   * 弹窗固定高度、自身不滚动：
   * 高度 min(820px, 86vh) 让任何视口都装得下；header 固定，body 变 flex 容器，
   * 多出来的高度给三张榜单卡，滚动只发生在**列表内部**。
   * 原来是 body 上 max-height + overflow:auto → 纵向滚（最后一张卡被切）、
   * 横向还冒一条滚动条（用户截图就是那样）。
   */
  :deep(.dy-combined-dialog) {
    display: flex;
    flex-direction: column;
    height: min(820px, 86vh);
    max-width: 94vw;
    overflow: hidden;
  }

  :deep(.dy-combined-dialog .el-dialog__body) {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  /* 统计卡 / 场次 chips 不参与拉伸 */
  :deep(.dy-combined-dialog .el-dialog__body > .el-row) {
    flex-shrink: 0;
  }

  /* 4 张统计卡：4 列（手机 2 列），间距 16 */
  .combined-stat-grid {
    display: grid;
    flex-shrink: 0;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 16px;
  }

  /* 「包含场次」：桌面换行；手机一行横向滑（两行 chip 会把榜单高度挤掉） */
  .combined-chips {
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  @media (max-width: 767px) {
    .combined-chips {
      flex-wrap: nowrap;
      padding-bottom: 2px;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .combined-chips::-webkit-scrollbar {
      display: none;
    }

    .combined-chips .dy-combined-chip {
      flex-shrink: 0;
    }
  }

  /* 「查看合并」按钮：给个最小宽度，loading 时换图标也不会把按钮撑宽/缩窄 */
  .combined-merge-btn {
    min-width: 116px;
  }

  /*
   * 桌面：三张榜单卡并排，占满剩余高度。
   *
   * overflow 必须 visible：全局的 .douyin-page .art-card:hover 会 translateY(-2px)，
   * 网格若 overflow: hidden，抬起的那 2px（正好是顶部边框）会被直接裁掉 ——
   * 用户看到的「hover 时顶部边框线没了」就是这个。裁切交给每张卡自己（见下一条）。
   */
  .combined-rank-grid {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    min-height: 0;
    overflow: visible;
  }

  .combined-rank-grid > .art-card {
    height: 100%;
    min-width: 0;
    overflow: hidden;
  }

  /*
   * 榜单列表：唯一会滚的区域（只纵向，横向禁止）。
   * 行高统一 48px —— 弹幕没有第二行，不固定的话那栏每行会比礼物/主播矮 14px。
   */
  .combined-rank-list {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding-right: 2px;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .combined-rank-list .dy-detail-row {
    flex-shrink: 0;
    height: 48px;
  }

  /*
   * 手机端：把空间尽量让给榜单。
   * 弹窗 86vh → 92vh、统计卡 80 → 62px、各处外边距收窄 —— 实测榜单可视高度从
   * 约 4.5 行（300px）涨到约 8 行（460px）。
   */
  @media (max-width: 767px) {
    :deep(.dy-combined-dialog) {
      height: 92vh;
    }

    :deep(.dy-combined-dialog .el-dialog__header) {
      padding-bottom: 6px;
    }

    .combined-stat-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }

    .combined-stat-grid > .art-card {
      height: 62px;
      padding-inline: 12px;
    }

    .combined-chips {
      margin-bottom: 8px;
    }
  }
  /* 手机端：tab 占满剩余高度，只有列表滚 */
  .combined-rank-tabs {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .combined-rank-tabs :deep(.el-tabs__header) {
    flex-shrink: 0;
    margin-bottom: 8px;
  }

  .combined-rank-tabs :deep(.el-tabs__content) {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /*
   * tab 面板得是 flex 列容器，里面的列表（flex:1 + min-height:0）才能拿到可用高度并自己滚。
   * 只写 height:100% 时列表按内容算高，超出部分被 content 的 overflow:hidden 直接裁掉，
   * 连滚动条都没有 —— 手机上就表现为"下面是死的、滚不动"。
   */
  .combined-rank-tabs :deep(.el-tab-pane) {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  /* 场次 chip：主播名 + 开始时间，点了进该场次详情 */
  .dy-combined-chip {
    display: inline-flex;
    align-items: center;
    max-width: 260px;
    height: 26px;
    padding: 0 10px;
    overflow: hidden;
    font-size: 12px;
    color: var(--art-gray-700);
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

  /*
   * 省略号挂在文字这层上：chip 本身是 inline-flex（为了垂直居中），
   * 而 text-overflow 在 flex 容器上不生效 —— 之前主播名长一点就直接被裁成
   * 「…19:3」，连省略号都没有。span 作为 flex item 会被 blockify，才支持省略号。
   */
  .dy-combined-chip__text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dy-combined-chip:hover {
    color: var(--theme-color);
    background: color-mix(in srgb, var(--theme-color) 10%, transparent);
    border-color: color-mix(in srgb, var(--theme-color) 30%, transparent);
  }

  /* 「+N 场」不是按钮，别给手型 */
  .dy-combined-chip--more {
    color: var(--art-gray-500);
    cursor: default;
  }

  .dy-combined-chip--more:hover {
    color: var(--art-gray-500);
    background: var(--art-gray-100);
    border-color: var(--art-card-border);
  }
</style>

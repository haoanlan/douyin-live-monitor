<template>
  <!--
    关于"透明白色遮罩"（用户两次反馈，最后定位在这里）：
      原来这一页在刷新时会把**整个页面**降到 opacity: 0.6：
        :class="loading && detail ? 'opacity-60' : ''"
      白底大卡片上，整页 60% 不透明看起来就是"蒙了一层白纱"。
      触发时机不只是手动刷新 —— 这页被 keep-alive 缓存，**每次切回场次详情**
      onActivated 都会重新取数，于是每次进入都先"白"一下。
      实测其它页没有这个处理，所以只有场次详情看着"还是那样"。
    现在：整页变淡去掉；刷新进度由工具条的刷新按钮转圈表达（原本就有）。
      首次进入由骨架承担（见下面的统计卡/榜单骨架），不会有空窗。
    也不再用 v-loading 全屏遮罩：这页数据没到时已有同形骨架，再盖白板既多余又廉价。
  -->
  <div class="douyin-page dy-stagger p-4">
    <!-- 面包屑统一由顶栏渲染；"回到该主播场次列表"的入口移到下面的工具条上 -->

    <!-- 失败必须说出来（UI-AUDIT P1-11）：否则页面停在全 0 的假数据上 -->
    <QueryErrorState
      v-if="queryError"
      class="mb-5"
      :message="queryError"
      :retrying="loading"
      @retry="refresh"
    />

    <!-- 场次头部 -->
    <div
      class="art-card dy-toolbar dy-session-head mb-5 flex items-center justify-between gap-4 flex-wrap"
    >
      <div class="flex items-center gap-3.5 min-w-0">
        <el-avatar :size="48" :src="detail?.session?.streamer_avatar" class="shrink-0">{{
          detail?.session?.streamer_name?.[0] || '场'
        }}</el-avatar>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <!--
              手机端第一行放**直播间名字**（主播名），桌面端放直播标题：
              之前手机上第一行是 room_title、第二行是「主播名 · 时间」，
              主播名一长就把时间挤成「10/…」（用户截图）。
              现在手机两行：名字一行、时间一行，时间不会再被挤。
            -->
            <span class="text-base font-medium text-g-900 truncate sm:hidden">
              {{ detail?.session?.streamer_name || detail?.session?.room_title || '场次详情' }}
            </span>
            <span class="hidden text-base font-medium text-g-900 truncate sm:inline">
              {{ detail?.session?.room_title || detail?.session?.title || '场次详情' }}
            </span>
            <el-tag v-if="detail?.session?.is_live" type="danger" size="small" class="!border-none"
              >直播中</el-tag
            >
          </div>
          <!--
            手机端：只有时间（一行）；桌面：主播名 · 时间。
            窄屏用省年份的紧凑写法，避免折行把头部撑高（加载前后按钮位置会跳）。
          -->
          <div class="dy-session-head__time text-xs text-g-500 mt-1 truncate">
            <template v-if="detail?.session?.start_time">
              <span class="sm:hidden">{{
                fmtSessionRange(detail.session.start_time, detail.session.end_time, true)
              }}</span>
            </template>
            <span class="hidden sm:inline">{{ detail?.session?.streamer_name || '' }}</span>
            <template v-if="detail?.session?.start_time">
              <span class="hidden sm:inline"
                >· {{ fmtSessionRange(detail.session.start_time, detail.session.end_time) }}</span
              >
            </template>
          </div>
        </div>
      </div>
      <!--
        dy-session-head__actions：窄屏独占一行并右对齐。
        原来这一行跟着 flex-wrap 走：加载中标题短（"场次详情"）按钮留在第一行右侧，
        数据到了标题变长就整体换行 —— 按钮从右上角跳到第二行左侧，
        用户反馈"加载前后按钮位置都不一样"。固定成独立一行后与内容长度无关。
      -->
      <div class="dy-session-head__actions flex items-center gap-2">
        <!--
          面包屑统一到顶栏后，"回到该主播的场次列表"（原来只存在于页面内面包屑、
          且带着 hostId）需要一个新的明确入口 —— 这是详情页最主要的回退路径。
        -->
        <!--
          始终渲染（加载中禁用），不要 v-if="streamerId"：
          streamerId 来自 detail.session，加载完成前为空 —— 原来加载时只有「刷新」一个按钮，
          数据到了才多出「场次列表」，两个按钮整体左移，用户看到的就是
          "加载前后按钮位置都不一样"。常驻 + 禁用则宽度与位置全程不变。
        -->
        <el-button
          class="dy-session-head__btn"
          :disabled="!streamerId"
          title="回到该主播的场次列表"
          aria-label="回到该主播的场次列表"
          @click="router.push({ path: '/douyin/sessions', query: { hostId: streamerId } })"
        >
          <ArtSvgIcon icon="ri:arrow-left-line" /><span class="dy-session-head__btn-label">场次列表</span>
        </el-button>
        <el-button
          class="dy-session-head__btn"
          :disabled="loading"
          title="刷新"
          aria-label="刷新"
          @click="() => refresh()"
        >
          <!-- 同状态监控页：不用 el-button 的 :loading（会在图标前再插一个转圈把按钮撑宽），
               改成图标原地旋转，宽度恒定 -->
          <ArtSvgIcon
            icon="ri:refresh-line"
            :class="loading ? 'dy-spin' : ''"
          /><span class="dy-session-head__btn-label">刷新</span>
        </el-button>
      </div>
    </div>


    <!-- 统计卡片 -->
    <ElRow :gutter="20">
      <ElCol v-for="stat in statCards" :key="stat.label" :xs="12" :sm="8" :md="8" :lg="4">
        <div class="art-card flex items-center justify-between h-20 px-5 mb-5">
          <div class="min-w-0">
            <div class="text-xs text-g-500">{{ stat.label }}</div>
            <!--
              数据没到时不显示 0 —— 那会让"还没加载"看起来像"这场直播真的是 0"（审计 P1-11）。
              用与数值同宽的骨架条占位，卡片高度不变、不会跳。
            -->
            <div v-if="!detail" class="mt-1 h-5 w-16">
              <el-skeleton-item variant="text" style="width: 100%; height: 100%" />
            </div>
            <!-- 卡片会 truncate 数值，所以补 title 显示完整值（评审 P2 点过这个问题） -->
            <div
              v-else
              class="text-[20px] font-medium text-g-900 mt-1 leading-none truncate"
              :title="stat.title || stat.value"
            >
              {{ stat.value }}
            </div>
          </div>
          <div class="size-9 rounded-lg flex-cc bg-theme/10 shrink-0">
            <ArtSvgIcon :icon="stat.icon" class="text-base text-theme" />
          </div>
        </div>
      </ElCol>
    </ElRow>

    <!--
      手机端：榜单/词云/动态切成四个 tab（礼物榜单 / 主播排名 / 弹幕榜单 / 动态）。
      统计卡在 tab 之上，始终可见；桌面不渲染这条，页面保持原来的整页滚动。
    -->
    <DyMobileTabs v-if="isMobile" v-model="mobileTab" :tabs="mobileTabs" />
    <!--
      三个榜单：单行三列。
      原来这里是 el-row + 左右两个 el-col，各自 flex 竖堆若干个卡 ——
      两栏内容高度天然不同，底部必然参差，数据少时更明显（强行对齐也对不齐）。
      改成单行 grid 后，行内卡片等高，底部由布局保证齐平。
    -->
    <div class="dy-detail-grid dy-detail-grid--3 mb-5">
          <div class="art-card p-5 flex flex-col" :class="paneClass('gifts')">
            <div class="art-card-header">
              <div class="title">
                <h4>礼物排行</h4>
                <p>钻石 Top</p>
              </div>
            </div>
            <div class="dy-scroll flex-1 min-h-0 flex flex-col gap-2.5 mt-4">
              <div
                v-for="(u, i) in detail?.gifts || []"
                :key="u.nickname"
                class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2 c-p"
                role="button"
                tabindex="0"
                :aria-label="`查看 ${u.nickname} 的送礼明细`"
                @click="openGiftDetail(u)"
                @keydown.enter.prevent="openGiftDetail(u)"
                @keydown.space.prevent="openGiftDetail(u)"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="u.avatar_url" class="shrink-0">{{
                  u.nickname?.[0]
                }}</el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ u.nickname }}</span>
                <span class="text-sm font-bold text-theme shrink-0">{{
                  fmtFull(u.total_diamonds)
                }}</span>
              </div>
              <!-- 数据没到时先说"在加载"，而不是"暂无礼物"（后者会被读成这场直播真的没礼物） -->
              <div v-if="!detail" class="flex flex-col gap-2.5">
                <!--
                  骨架行套用真实行的类名与内边距（.dy-rank-row + px-3 py-2）：
                  真实行高 48px（32px 头像 + 上下各 8px），骨架若只有 32px，
                  数据到达时整块内容会往下跳（用户反馈的"跳动感"）。
                -->
                <div
                  v-for="i in 5"
                  :key="i"
                  class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
                >
                  <span class="w-6 h-6 rounded-md shrink-0 overflow-hidden">
                    <el-skeleton-item variant="text" style="width: 100%; height: 100%" />
                  </span>
                  <el-avatar :size="32" class="shrink-0">
                    <el-skeleton-item variant="circle" style="width: 100%; height: 100%" />
                  </el-avatar>
                  <el-skeleton-item variant="text" style="flex: 1; height: 16px" />
                  <el-skeleton-item variant="text" style="width: 64px; height: 16px; flex: 0 0 auto" />
                </div>
              </div>
              <el-empty
                v-else-if="!detail?.gifts?.length"
                description="暂无礼物"
                :image-size="60"
              />
            </div>
          </div>
          <div class="art-card p-5 flex flex-col" :class="paneClass('anchors')">
            <div class="art-card-header">
              <div class="title">
                <h4>团播主播排名</h4>
                <p>累计钻石</p>
              </div>
            </div>
            <div class="dy-scroll flex-1 min-h-0 flex flex-col gap-2.5 mt-4">
              <div
                v-for="(a, i) in detail?.anchorRanking || []"
                :key="a.anchor_name"
                class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2 c-p"
                role="button"
                tabindex="0"
                :aria-label="`查看 ${a.anchor_name} 的送礼人员`"
                @click="openAnchorPeopleList(a)"
                @keydown.enter.prevent="openAnchorPeopleList(a)"
                @keydown.space.prevent="openAnchorPeopleList(a)"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="a.anchor_avatar" class="shrink-0">{{
                  a.anchor_name?.[0]
                }}</el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ a.anchor_name }}</span>
                <span class="text-sm font-bold text-theme shrink-0">{{
                  fmtFull(a.total_diamonds)
                }}</span>
              </div>
              <div v-if="!detail" class="flex flex-col gap-2.5">
                <!--
                  骨架行套用真实行的类名与内边距（.dy-rank-row + px-3 py-2）：
                  真实行高 48px（32px 头像 + 上下各 8px），骨架若只有 32px，
                  数据到达时整块内容会往下跳（用户反馈的"跳动感"）。
                -->
                <div
                  v-for="i in 5"
                  :key="i"
                  class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
                >
                  <span class="w-6 h-6 rounded-md shrink-0 overflow-hidden">
                    <el-skeleton-item variant="text" style="width: 100%; height: 100%" />
                  </span>
                  <el-avatar :size="32" class="shrink-0">
                    <el-skeleton-item variant="circle" style="width: 100%; height: 100%" />
                  </el-avatar>
                  <el-skeleton-item variant="text" style="flex: 1; height: 16px" />
                  <el-skeleton-item variant="text" style="width: 64px; height: 16px; flex: 0 0 auto" />
                </div>
              </div>
              <el-empty
                v-else-if="!detail?.anchorRanking?.length"
                description="暂无主播数据"
                :image-size="60"
              />
            </div>
          </div>
          <div class="art-card p-5 flex flex-col" :class="paneClass('danmaku')">
            <div class="art-card-header">
              <div class="title">
                <h4>弹幕排行</h4>
                <p>发言次数 Top 20</p>
              </div>
            </div>
            <div class="dy-scroll flex-1 min-h-0 flex flex-col gap-2.5 mt-4">
              <!--
                行结构与另两个榜单保持一致：
                头像同样是 32px（原来是 26px，整行比另两列矮 6px，
                于是同样高度下这里能多显示一行 —— 视觉上"三个榜不一样高"）。
              -->
              <div
                v-for="(d, i) in (detail?.danmakuRanking || []).slice(0, 20)"
                :key="d.nickname"
                class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
              >
                <span
                  class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
                  :class="rankClass(i)"
                  >{{ i + 1 }}</span
                >
                <el-avatar :size="32" :src="d.avatar" class="shrink-0">{{
                  d.nickname?.[0]
                }}</el-avatar>
                <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ d.nickname }}</span>
                <span class="text-sm font-bold text-g-800 shrink-0">{{ d.msg_count }}条</span>
              </div>
              <div v-if="!detail" class="flex flex-col gap-2.5">
                <!--
                  骨架行套用真实行的类名与内边距（.dy-rank-row + px-3 py-2）：
                  真实行高 48px（32px 头像 + 上下各 8px），骨架若只有 32px，
                  数据到达时整块内容会往下跳（用户反馈的"跳动感"）。
                -->
                <div
                  v-for="i in 5"
                  :key="i"
                  class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
                >
                  <span class="w-6 h-6 rounded-md shrink-0 overflow-hidden">
                    <el-skeleton-item variant="text" style="width: 100%; height: 100%" />
                  </span>
                  <el-avatar :size="32" class="shrink-0">
                    <el-skeleton-item variant="circle" style="width: 100%; height: 100%" />
                  </el-avatar>
                  <el-skeleton-item variant="text" style="flex: 1; height: 16px" />
                  <el-skeleton-item variant="text" style="width: 56px; height: 16px; flex: 0 0 auto" />
                </div>
              </div>
              <el-empty
                v-else-if="!detail?.danmakuRanking?.length"
                description="暂无弹幕"
                :image-size="60"
              />
            </div>
          </div>
    </div>

    <!--
      第二行：词云 + 最新动态。
      时间线已移除 —— 它把钻石/礼物/弹幕三条线叠在同一根 Y 轴上，
      而弹幕量级比礼物高两个数量级，礼物会被压成贴地的一条线，读不出信息。
    -->
    <div class="dy-detail-grid dy-detail-grid--2 mb-5">
      <div class="art-card p-5 flex flex-col" :class="paneClass('danmaku')">
        <div class="art-card-header">
          <div class="title">
            <h4>弹幕词云</h4>
            <p>高频词汇</p>
          </div>
        </div>
        <!--
          加载中也显示"词云形状"的骨架（原来直接落到"暂无词频数据"，
          会被读成这场直播真的没有词频 —— 与本页其它块的做法保持一致）。
          .dy-cloud-box 是本块真实容器（有确定高度），骨架用同样的容器撑住，数据到达不跳。
        -->
        <div v-if="!detail" class="dy-cloud-box mt-3">
          <el-skeleton animated class="w-full h-full">
            <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-3 p-4">
              <el-skeleton-item
                v-for="(w, i) in [64, 46, 80, 38, 56, 34, 72, 44, 60, 40, 52, 30]"
                :key="i"
                variant="text"
                :style="`width:${w}px; height:${i % 3 === 0 ? 22 : 16}px`"
              />
            </div>
          </el-skeleton>
        </div>
        <div v-else-if="detail?.danmakuWords?.length" class="dy-cloud-box mt-3">
          <canvas id="wordcloudCanvas" class="w-full h-full block"></canvas>
        </div>
        <el-empty v-else description="暂无词频数据" :image-size="60" />
      </div>
      <div class="art-card p-5 flex flex-col" :class="paneClass('feed')">
        <div class="art-card-header">
          <div class="title">
            <h4>最新动态</h4>
            <p>
              弹幕 + 礼物
              <!-- 说明清楚"为什么只有这些"，避免被误认为数据缺失 -->
              <template v-if="!activeQuery && feedTotal > FEED_FETCH_LIMIT">
                · 已载入最新 {{ fmtNum(FEED_FETCH_LIMIT) }} / 共 {{ fmtNum(feedTotal) }} 条，更早的请搜索
              </template>
              <template v-else-if="activeQuery">
                · 全量命中 {{ fmtNum(feedSearchTotal) }} 条
                <!-- 检索失败时原来只把计数置 0，界面读起来像"确实没有"；这里明确区分 -->
                <span v-if="feedSearchError" class="text-danger">（检索失败，显示的不是搜索结果）</span>
              </template>
            </p>
          </div>
        </div>

        <!--
          搜索：交给服务端在全量弹幕里检索（前端只有最新 2000 条）。
          样式与「房间管理」页的搜索框保持一致：固定宽度 + ArtSvgIcon 前缀。
        -->
        <div class="dy-feed-search mt-3 mb-2">
          <el-input
            v-model="feedSearch"
            placeholder="搜索全部弹幕的用户或内容"
            class="dy-feed-search-input"
            clearable
            @keyup.enter="submitFeedSearch"
            @clear="clearFeedSearch"
          >
            <template #prefix>
              <ArtSvgIcon icon="ri:search-line" class="text-g-400" />
            </template>
            <template #suffix>
              <!--
                加载状态放在输入框内（而不是按钮上）：
                按钮如果切换成 loading 转圈，文字会被替换掉，视觉上就是"按钮变了一下"。
                这里保持按钮文字与尺寸完全不变，只在输入框里给一个转圈反馈。
              -->
              <ArtSvgIcon
                v-if="feedSearching"
                icon="ri:loader-4-line"
                class="text-g-400 dy-feed-search-spin"
              />
            </template>
          </el-input>
          <el-button type="primary" @click="submitFeedSearch">搜索</el-button>
        </div>

        <!--
          滚动区向右多占一个滚动条宽度（feedSbWidth，见脚本里的注释）：
          这样消息行的右边界与上面的搜索行严格对齐，滚动条落在卡片右内边距里。
          滚动条宽度是运行时量的（无滚动条时为 0 → 不加偏移）。
        -->
        <div
          ref="feedScrollRef"
          class="dy-scroll flex-1 min-h-0"
          :style="feedSbWidth ? { marginRight: `-${feedSbWidth}px` } : undefined"
        >
          <!--
            渐进披露（取代原来的"固定行高 64px 虚拟滚动"）：
            行高会随内容换行而变（弹幕 2–3 行、礼物行更高），写死高度必然重叠，
            所以这里不对高度做任何假设 —— 只渲染最新 N 条 + 底部「加载更多」。
          -->
          <div class="dy-feed-list">
            <div
              v-for="m in renderedFeed"
              :key="m._key"
              class="dy-feed-row"
              :class="m._type === 'gift' ? 'dy-feed-row--gift' : ''"
            >
              <el-avatar :size="32" :src="m.avatar_url" class="shrink-0">{{
                m.nickname?.[0]
              }}</el-avatar>
              <div class="min-w-0 flex-1">
                <!-- 第一行：昵称 + 礼物标签（左）· 时间（右） -->
                <div class="dy-feed-row__meta" :title="clubTitle(m.club)">
                  <span class="dy-feed-row__name">{{ m.nickname }}</span>
                  <!--
                    消费等级图标 + 粉丝团胶囊，放在昵称**后面**（用户要求：放前面和头像不协调）。
                    数据优先用这条消息当时的快照；历史数据后端会退回该用户最新档案。
                    胶囊文字：有团名用团名，没团名用归属主播名，都没有就只留等级圆牌。
                  -->
                  <img
                    v-if="m.club?.payIconUrl"
                    :src="m.club.payIconUrl"
                    class="block h-[17px] w-auto shrink-0 self-center"
                    :title="'消费等级 Lv.' + (m.club?.payLevel ?? '')"
                    alt=""
                    loading="lazy"
                  />
                  <span
                    v-if="m.club && m.club.clubLevel != null"
                    class="inline-flex items-center gap-[3px] h-[16px] rounded-full pl-[2px] shrink-0 max-w-[170px]"
                    :class="[
                      m.club.clubStatus === 2 ? 'bg-[#c9c9c9]' : m.club.starGuard ? 'bg-[#ff8f3f]' : 'bg-[#f5c04e]',
                      m.club.clubName ? 'pr-[6px]' : 'pr-[2px]'
                    ]"
                    :title="clubTitle(m.club)"
                  >
                    <span
                      class="inline-flex items-center justify-center h-[12px] min-w-[18px] px-[3px] rounded-full bg-white/90 text-[9px] font-bold leading-none"
                      :class="m.club.clubStatus === 2 ? 'text-[#8a8a8a]' : m.club.starGuard ? 'text-[#ff8f3f]' : 'text-[#b07d00]'"
                    >{{ m.club.clubLevel }}</span>
                    <span
                      v-if="m.club.clubName"
                      class="text-[10px] leading-none text-white truncate"
                    >{{ m.club.clubName }}</span>
                  </span>
                  <span v-if="m._type === 'gift'" class="dy-feed-row__tag">礼物</span>
                  <span class="dy-feed-row__time">{{ fmtTime(m.timestamp) }}</span>
                </div>
                <!-- 第二行：内容（礼物行带图标、数量、钻石数） -->
                <template v-if="m._type === 'gift'">
                  <div class="dy-feed-row__text dy-feed-row__gift">
                    <el-image
                      v-if="m.gift_icon"
                      :src="m.gift_icon"
                      fit="contain"
                      class="dy-feed-row__gift-icon"
                    />
                    <ArtSvgIcon v-else icon="ri:gift-2-line" class="dy-feed-row__gift-icon" />
                    <span class="dy-feed-row__gift-name">{{ m.gift_name }}</span>
                    <span v-if="(m.count || 0) > 1" class="dy-feed-row__dim">×{{ m.count }}</span>
                    <span v-if="m.total_diamonds" class="dy-feed-row__diamond">
                      <ArtSvgIcon icon="ri:diamond-line" />
                      {{ fmtNum(m.total_diamonds) }}
                    </span>
                    <span v-if="m.to_nickname" class="dy-feed-row__dim">
                      → {{ m.to_nickname }}
                    </span>
                  </div>
                </template>
                <span
                  v-else
                  class="dy-feed-row__text"
                  v-html="replaceDouyinEmoji(esc(m.content || ''))"
                ></span>
              </div>
            </div>

            <!-- 还有更多：给一个明确出口，而不是静默截断 -->
            <div v-if="hasMoreFeed" class="py-2 text-center">
              <el-button size="small" text type="primary" @click="loadMoreFeed">
                加载更多（还有 {{ fmtNum(displayedFeed.length - feedShownCount) }} 条）
              </el-button>
            </div>
            <div v-else-if="displayedFeed.length" class="py-2 text-center text-xs text-g-500">
              已显示全部 {{ fmtNum(displayedFeed.length) }} 条
            </div>
          </div>
          <!--
            加载中显示与真实动态行同形的骨架（原来直接落到"暂无动态"）。
            头像用与真实行相同的 el-avatar :size="32" 包一层，骨架项填满它 ——
            原来这里写死 24px 而真实行是 32px，数据到达时整块会往下跳。
            这样写也让以后改头像尺寸时骨架自动跟随（不必再来改一次骨架）。
          -->
          <div v-if="!detail" class="flex flex-col gap-2.5 mt-3">
            <div v-for="i in 6" :key="i" class="dy-feed-row flex items-start gap-3">
              <el-avatar :size="32" class="shrink-0">
                <el-skeleton-item variant="circle" style="width: 100%; height: 100%" />
              </el-avatar>
              <div class="flex-1 min-w-0">
                <el-skeleton-item variant="text" style="width: 38%; height: 12px" />
                <el-skeleton-item variant="text" style="width: 78%; height: 12px; margin-top: 8px" />
              </div>
              <el-skeleton-item variant="text" style="width: 40px; height: 12px; flex: 0 0 auto" />
            </div>
          </div>
          <el-empty
            v-else-if="!displayedFeed.length"
            :description="
              activeQuery ? `没有匹配「${activeQuery}」的动态` : '暂无动态'
            "
            :image-size="60"
          />
        </div>
      </div>
    </div>

    <!--
      弹窗统一约定（全站一致，别在这里破例）：
        1. 一律使用 Element 的**标准右上角 X**（内容放 #header 插槽，不自己画关闭按钮 —— 
           自制按钮的位置、尺寸、悬停态都和别人不一样，看着就是"两个产品"）
        2. X 与 footer 里的「取消/关闭」行为完全一致：只关闭，不提交、不改数据
        3. 遮罩点击统一禁用（close-on-click-modal=false），避免误触把表单关掉
      这里原来用 :show-header="false" + 自绘 X，已改回标准写法（顺便去掉了
      .detail-dialog 那两条为自绘布局服务的 padding 覆盖，交给 Element 默认内边距）。
    -->
    

    <el-dialog
      v-model="giftDialogVisible"
      width="500"
      class="detail-dialog"
      align-center
      :close-on-click-modal="false"
    >
      <template #header>
        <div class="flex items-center gap-3">
          <el-avatar :size="40" :src="giftDialogAvatar" class="shrink-0">{{
            giftDialogUser?.[0]
          }}</el-avatar>
          <div class="min-w-0 flex-1">
            <div class="text-base font-medium text-g-900 truncate">{{ giftDialogUser }}</div>
            <div class="text-xs text-g-500 flex items-center gap-2 mt-0.5">
              <span>{{ giftDialogList.length }} 种礼物</span>
              <span class="flex items-center gap-1">
                <ArtSvgIcon icon="ri:diamond-line" class="text-g-400" />共
                {{ fmtNum(giftDialogTotal) }}
              </span>
            </div>
            
          </div>
        </div>
      </template>
      <div
        v-loading="giftDialogLoading"
        element-loading-text="正在加载全场礼物明细…"
        class="flex min-h-[240px] flex-col gap-2.5 max-h-80 overflow-y-auto"
      >
          <div
            v-for="(g, i) in giftDialogList"
            :key="i"
            class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
          >
            <el-image
              v-if="g.gift_icon"
              :src="g.gift_icon"
              fit="contain"
              class="!size-7 shrink-0"
              :preview-src-list="[g.gift_icon]"
              preview-teleported
            />
            <ArtSvgIcon v-else icon="ri:gift-2-line" class="text-base shrink-0 text-g-500" />
            <div class="flex-1 min-w-0">
              <div class="text-sm text-g-800 truncate">{{ g.gift_name }}</div>
              <div v-if="g.to_nickname" class="text-xs text-g-500 truncate">
                送给 {{ g.to_nickname }}
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-sm font-bold text-theme">{{ fmtFull(g.total_diamonds) }}</div>
              <div class="text-xs text-g-500">{{ g.count }} 个</div>
            </div>
          </div>
          <el-empty v-if="!giftDialogList.length" description="暂无明细" :image-size="60" />
      </div>
    </el-dialog>

    <!-- 同上：标准 X + 遮罩禁用（内容放 #header 插槽） -->
    <el-dialog
      v-model="peopleDialogVisible"
      :width="isMobile ? '92%' : '500px'"
      class="detail-dialog"
      align-center
      :close-on-click-modal="false"
    >
      <template #header>
        <div class="flex items-center gap-3">
          <el-avatar :size="40" :src="peopleAnchorAvatar" class="shrink-0">{{
            peopleAnchorName?.[0]
          }}</el-avatar>
          <div class="min-w-0 flex-1">
            <div class="text-base font-medium text-g-900 truncate">{{ peopleAnchorName }}</div>
            <div class="text-xs text-g-500 mt-0.5"
              >送出礼物的人员榜单 · {{ peopleDialogList.length }} 人</div
            >
          </div>
          <!--
            下载榜单图片：图标按钮，放在标题栏、绝对定位（不占布局高度 —— 实测头部仍是 58px）。
            与关闭键中心对齐在 Y=24（关闭键是 absolute top0 right0 48×48，中心即 24）。
            点它 → 弹窗内容切成模板网格 → 选哪个用它下载并自动切回榜单。
            （曾试过放底部 footer，用户反馈"留白太多"，故回到标题栏。）
          -->
          <!--
            补录礼物：加号图标，紧挨着下载按钮左侧（主播排名弹窗里，收礼人自动锁定成当前主播）。
            没有 manual_gift.add 权限的人**整个按钮都不出现**（用户要求：访客看不到补录入口）；
            已经进了补录面板的人仍然显示返回箭头，否则出不来。
          -->
          <button
            v-if="manualGiftOpen || can('manual_gift.add')"
            class="rank-dl-btn dy-pressable size-8 flex-cc rounded-lg text-g-600 hover:bg-g-100 hover:text-theme !right-[96px]"
            :title="manualGiftOpen ? '返回榜单' : '补录礼物'"
            :aria-label="manualGiftOpen ? '返回榜单' : '补录礼物'"
            @click="toggleManualGift"
          >
            <ArtSvgIcon :icon="manualGiftOpen ? 'ri:arrow-left-line' : 'ri:add-line'" class="text-base" />
          </button>
          <button
            class="rank-dl-btn dy-pressable size-8 flex-cc rounded-lg text-g-600 hover:bg-g-100 hover:text-theme disabled:opacity-50"
            :disabled="rankDownloading || !rankThemes.length"
            :title="rankPickerOpen ? '返回榜单' : '下载榜单图片'"
            :aria-label="rankPickerOpen ? '返回榜单' : '下载榜单图片'"
            @click="toggleRankPicker"
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
      <!-- 选模板视图：16 套一屏网格铺完（手机 2 列），选哪个用它下载并自动切回榜单 -->
      <!-- 补录礼物：和模板网格同一个容器策略（高度固定，内容内部滚动） -->
      <div v-if="manualGiftOpen" class="dy-people-panel flex flex-col overflow-x-hidden">
        <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-3 pr-1">
          <!-- ① 这个人是谁 -->
          <div>
            <div class="text-xs font-medium text-g-600 mb-1 flex items-center gap-1">
              <span class="size-4 rounded bg-theme/10 text-theme flex-cc text-[10px]">1</span>这个人是谁
            </div>
            <el-input
              v-model="manualGiftQuery"
              placeholder="输入昵称或抖音号搜索；搜不到就作为新观众"
              clearable
              @input="searchManualUser"
            >
              <template #prefix><ArtSvgIcon icon="ri:user-search-line" /></template>
            </el-input>
            <!--
              候选列表**只在真正搜索时出现**（有输入就出现，单字也算）。
              之前一直挂着一个 76px 高、写着「输入至少 2 个字开始搜索」的空框，
              白占一大块地方（用户："这个模块根本不需要"）。
              下限原本是 2 个字，用户要求取消：库里单字昵称是真实存在的
              （gifts 11,750 条 / danmaku 13,033，「毅」1769 条、「平」454），
              补录时选不中这些人才是 bug。
            -->
            <div
              v-if="manualGiftQuery.trim().length >= 1 && !manualGiftUser.sec_uid"
              class="mt-1 max-h-[120px] overflow-y-auto overflow-x-hidden rounded border border-g-200"
            >
              <div v-if="manualGiftSearching" class="py-2 flex items-center justify-center gap-1.5 text-xs text-g-500">
                <ArtSvgIcon icon="ri:loader-4-line" class="animate-spin" />正在搜索全库…
              </div>
              <div v-else-if="!manualGiftCandidates.length" class="py-2 text-center text-xs text-g-400">
                没有匹配到人，确认后按「新观众」记
              </div>
              <button
                v-for="c in manualGiftCandidates"
                :key="c.sec_uid || c.nickname"
                type="button"
                class="w-full text-left px-2 py-1.5 text-xs hover:bg-g-50 flex items-center justify-between gap-2"
                @click="pickManualUser(c)"
              >
                <span class="truncate">{{ c.nickname }}</span>
                <span class="text-g-400 shrink-0">{{ c.unique_id || c.user_display_id || '' }}</span>
              </button>
            </div>
            <div class="mt-0.5 text-[11px] truncate" :class="manualGiftUser.sec_uid ? 'text-success' : 'text-g-400'">
              {{ manualGiftUser.sec_uid ? '已选中：' + manualGiftUser.nickname : (manualGiftQuery ? '将作为新观众（manual:' + manualGiftQuery + '）' : '未选人') }}
            </div>
          </div>

          <!-- ② 礼物 + 单价 + 次数 + 时间（一行放完） -->
          <div>
            <div class="text-xs font-medium text-g-600 mb-1 flex items-center gap-1">
              <span class="size-4 rounded bg-theme/10 text-theme flex-cc text-[10px]">2</span>礼物与数量
            </div>
            <!--
              一行放完：礼物名吃剩余宽度，单价/次数/时间固定宽度。
              原来用 grid-cols-12 分栏，但 el-input-number / el-date-picker 自带 150px 宽度，
              会把列撑爆、时间选择器直接溢出弹窗右边（用户截图里那种"排版混乱"）。
            -->
            <!--
              礼物名单独一行（要能看清长名字），单价/次数/时间三格一行带小标题。
              原来用 grid-cols-12 分栏：el-input-number / el-date-picker 自带 150px 宽度，
              会把列撑爆、时间选择器直接溢出弹窗右边（用户截图里那种"排版混乱"）。
            -->
            <div class="flex flex-col gap-2">
              <div>
                <div class="mb-1 text-[11px] leading-none text-g-500">礼物</div>
                <el-select
                  v-model="manualGiftName"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选礼物，或直接输入礼物名"
                  class="w-full"
                  :filter-method="onGiftFilter"
                  @change="fillManualGiftPrice"
                >
                  <el-option v-for="g in filteredGiftOptions" :key="g.name" :label="g.name" :value="g.name">
                    <span class="flex items-center justify-between gap-3">
                      <span class="truncate">{{ g.name }}</span>
                      <span class="text-g-400 text-xs tabular-nums shrink-0">{{ g.price }} 钻</span>
                    </span>
                  </el-option>
                </el-select>
              </div>
              <div class="grid grid-cols-[88px_80px_1fr] gap-2">
                <div>
                  <div class="mb-1 text-[11px] leading-none text-g-500">单价（钻）</div>
                  <el-input-number v-model="manualGiftPrice" :min="1" :controls="false" class="!w-full" />
                </div>
                <div>
                  <div class="mb-1 text-[11px] leading-none text-g-500">次数</div>
                  <el-input-number v-model="manualGiftCount" :min="1" :controls="false" class="!w-full" />
                </div>
                <div>
                  <div class="mb-1 text-[11px] leading-none text-g-500">时间</div>
                  <el-date-picker
                    v-model="manualGiftTime"
                    type="datetime"
                    class="!w-full"
                    :clearable="false"
                    format="MM-DD HH:mm"
                  />
                </div>
              </div>
            </div>
            <div class="mt-1 text-[11px] text-g-500">
              单价 <b class="text-g-700">{{ fmtNum(manualGiftPrice || 0) }}</b> ×
              次数 <b class="text-g-700">{{ manualGiftCount || 0 }}</b> =
              <b class="text-theme tabular-nums">{{ fmtNum((manualGiftPrice || 0) * (manualGiftCount || 0)) }}</b> 钻
              <span class="text-g-400">（金额自动算，不可手填）</span>
            </div>
          </div>

          <!-- ③ 本场补录记录 -->
          <div>
            <div class="text-xs font-medium text-g-600 mb-1">
              本场补录记录
              <span class="text-g-400 font-normal">（{{ manualGiftList.length }} 条 · 合计 {{ fmtNum(manualGiftTotal) }} 钻）</span>
            </div>
            <div v-if="!manualGiftList.length" class="text-[11px] text-g-400 py-1">还没有补录记录</div>
            <div v-else class="flex flex-col gap-1">
              <div
                v-for="r in manualGiftList"
                :key="r.id"
                class="flex items-center gap-2 text-xs px-2 py-1 rounded-md bg-g-50 border border-g-300 min-w-0"
              >
                <span class="truncate flex-1 min-w-0">{{ r.gift_name }} ×{{ r.repeat_count }} · {{ r.nickname }}</span>
                <span class="tabular-nums text-theme shrink-0 w-[64px] text-right">{{ fmtNum(r.total_diamonds) }} 钻</span>
                <el-button v-if="can('manual_gift.delete')" size="small" text type="danger" class="shrink-0 !px-1.5" @click="removeManualGift(r)">撤销</el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部固定：不随内容滚动 -->
        <div class="shrink-0 mt-2 pt-2 border-t border-g-100 flex items-center justify-end gap-3">
          <el-button @click="manualGiftOpen = false">取消</el-button>
          <el-button type="primary" class="!min-w-[88px]" :loading="manualGiftSaving" @click="submitManualGiftAndClose">补录</el-button>
        </div>
      </div>

      <div v-else-if="rankPickerOpen" class="dy-people-panel overflow-y-auto pr-1">
        <div class="mb-2.5 text-xs text-g-500">选择模板（选完自动下载榜单图片）</div>
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

      <div v-else class="dy-people-panel flex flex-col gap-2.5 overflow-y-auto pr-1">
          <div
            v-for="(p, i) in peopleDialogList"
            :key="i"
            class="dy-detail-row flex items-center gap-3 rounded-xl bg-g-100/50 px-3 py-2"
          >
            <span
              class="w-6 h-6 rounded-md flex-cc text-xs font-bold shrink-0"
              :class="rankClass(i)"
              >{{ i + 1 }}</span
            >
            <el-avatar :size="28" :src="p.avatar_url" class="shrink-0">{{
              p.nickname?.[0]
            }}</el-avatar>
            <span class="flex-1 min-w-0 truncate text-sm text-g-800">{{ p.nickname }}</span>
            <span class="text-sm font-bold text-theme shrink-0">{{
              fmtFull(p.total_diamonds)
            }}</span>
          </div>
          <el-empty v-if="!peopleDialogList.length" description="暂无数据" :image-size="60" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import {
    fetchSessionDetail,
    fetchSessionGiftDetails,
    fetchDanmaku,
    fetchRankThemes,
    addManualGift,
    deleteManualGift,
    fetchManualGifts,
    anonymousLookup,
    fetchGiftPrices,
    getRankImageUrl,
    getRankImageZipUrl,
    type SessionDetail,
    type GiftRankItem,
    type AnchorRankItem
  } from '@/api/douyin'
  import { ElMessage } from 'element-plus'
  import { downloadWithAuth } from '@/utils/download'
  import { renderWordCloud } from '@/utils/wordcloud'
  import { replaceDouyinEmoji, esc } from '@/utils/douyin-emoji'
  import { fmtTime, formatDuration, fmtNum, fmtFull, fmtTitle, fmtSessionRange, rankClass } from '@/utils/format'
  import { apiErrorMessage } from '@/utils/douyin-error'
  import { rankThemeLabel } from '@/utils/rank-themes'
  import { useIsMobile } from '@/hooks/core/useIsMobile'
  import { usePermissionStore } from '@/store/modules/permission'

  /** 按消息存的粉丝团快照（club_json 解析后） */
  interface FeedClub {
    payLevel?: number | null
    payIconUrl?: string | null
    clubLevel?: number | null
    clubName?: string | null
    clubStatus?: number | null
    starGuard?: boolean
    /** 归属主播名（后端把 club_json.ca 解出来的） */
    an?: string | null
    /** 是否来自"该用户最新档案"回退（历史数据没有快照） */
    fallback?: boolean
  }

  interface FeedItem {
    _type: 'danmaku' | 'gift'
    _key: string
    _ts: number
    nickname: string
    content?: string
    gift_name?: string
    count?: number
    total_diamonds?: number
    to_nickname?: string
    gift_icon?: string
    timestamp?: number
    avatar_url?: string
    _top?: number
    /** 这个人发这条消息时的消费等级/粉丝团 */
    club?: FeedClub | null
  }

  defineOptions({ name: 'DouyinDetail' })

  const route = useRoute()
  const router = useRouter()
  const sessionId = String(route.params.sessionId)
  const detail = ref<SessionDetail | null>(null)

  /* ---------- 手机端 tab（榜单 / 数据 / 动态） ---------- */
  const { isMobile } = useIsMobile()

  /** 细粒度操作权限（超管恒真；未加载时放行） */
  const permissionStore = usePermissionStore()
  const can = (action: string) => permissionStore.hasPerm(action)
  const mobileTab = ref('gifts')
  const mobileTabs = [
    { key: 'gifts', label: '礼物榜单' },
    { key: 'anchors', label: '主播排名' },
    { key: 'danmaku', label: '弹幕榜单' },
    { key: 'feed', label: '动态' }
  ]
  /** 手机上只显示当前 tab 的区块；桌面返回空串 */
  function paneClass(key: string): string {
    if (!isMobile.value) return ''
    return mobileTab.value === key ? 'dy-mobile-pane--on' : 'dy-mobile-pane--off'
  }
  const streamerId = computed(() => detail.value?.session?.streamer_id)
  const loading = ref(true)
  /** 取数失败的原因（与「真的没有数据」区分开） */
  const queryError = ref('')

  /**
   * 「最新动态」的取数与渲染策略。
   *
   * 修过的 bug（DESIGN-REVIEW P1-9）：
   *  1) 原来 `items.slice(-limit)` 作用在**升序**数组上 → 取到的是**最旧**的 N 条，
   *     标题写着"最新动态"却不最新。已改为降序取前 N。
   *  2) 原来"全部"模式用固定行高 64px 虚拟滚动，而弹幕会换行 2–3 行、礼物行更高
   *     → 行与行必然重叠、完全不可读。已改为渐进披露，不再猜行高。
   *  3) 原来一次 `fetchDanmaku(sessionId, 50000)`：实测场次 153（6.5 万条弹幕）
   *     单这一请求就要 **19 秒 / 22MB**，回来后还要在主线程 map + 排序 5 万条 ——
   *     这才是"全部"卡顿的真正原因。现在只取最新 2000 条（762ms / 902KB），
   *     更早的内容由**服务端**按关键字检索。
   */
  const feedRaw = ref<FeedItem[]>([])
  /** 搜索框里的文字（输入中，未提交） */
  const feedSearch = ref('')
  /** 已生效的搜索词（服务端检索用的就是它） */
  const activeQuery = ref('')
  /** 搜索请求进行中 */
  const feedSearching = ref(false)
  /** 本场次弹幕总数（后端 total，用于说明"只展示最新 N 条"） */
  const feedTotal = ref(0)
  /** 本次搜索在服务端命中的总数 */
  const feedSearchTotal = ref(0)
  /** 检索失败标记（用于把"没搜到"和"没搜成"区分开） */
  const feedSearchError = ref('')

  /** 一次取多少条（后端上限也是 2000） */
  const FEED_FETCH_LIMIT = 2000
  /** 渐进披露：首屏渲染多少条，点「加载更多」递增 */
  const FEED_PAGE = 200

  /**
   * 当前要展示的列表。
   *
   * 搜索已改为**服务端检索**（前端只有最新 2000 条，搜不到更早的内容），
   * 这里只在 activeQuery 与输入框一致时再兜一层过滤，
   * 保证弹幕与礼物都按同一个词筛过、不会出现"服务端筛了、前端又混进没筛的"。
   */
  const displayedFeed = computed(() => {
    const q = activeQuery.value.trim().toLowerCase()
    // 输入框已改动但还没提交搜索：先按当前列表展示，避免打字时列表跳动
    if (!q || q !== feedSearch.value.trim().toLowerCase()) return feedRaw.value
    return feedRaw.value.filter((d) => {
      const content = d._type === 'gift' ? d.gift_name : d.content
      return (
        (content || '').toLowerCase().includes(q) || (d.nickname || '').toLowerCase().includes(q)
      )
    })
  })

  /** 实际渲染的条数（渐进披露：点「加载更多」每次加一档） */
  const feedShownCount = ref(FEED_PAGE)
  const renderedFeed = computed(() => displayedFeed.value.slice(0, feedShownCount.value))
  const hasMoreFeed = computed(() => displayedFeed.value.length > feedShownCount.value)

  function loadMoreFeed() {
    feedShownCount.value += 400
  }

  /** 提交搜索：交给服务端在全量弹幕里检索 */
  async function submitFeedSearch() {
    activeQuery.value = feedSearch.value.trim()
    await searchFeed()
    if (feedScrollRef.value) feedScrollRef.value.scrollTop = 0
  }

  /** 清空搜索：恢复为「最新 2000 条」 */
  async function clearFeedSearch() {
    if (!activeQuery.value && !feedSearch.value) return
    feedSearch.value = ''
    activeQuery.value = ''
    feedSearchError.value = ''
    feedSearchTotal.value = 0
    feedShownCount.value = FEED_PAGE
    await loadDanmakuFeed()
    if (feedScrollRef.value) feedScrollRef.value.scrollTop = 0
  }

  const feedScrollRef = ref<HTMLElement>()

  /*
   * 动态滚动区的滚动条宽度（px）——用来把滚动条"让进"卡片右内边距。
   *
   * 问题：滚动条是**占布局宽度**的（实测有头 Chrome 下 10px），
   * 于是消息行的右边界比上面的搜索行少 10px，看着像"消息不在模块中间"（用户反馈）。
   * 把滚动条移出卡片又不好看（用户已明确否掉），所以改成：滚动区向右多占一个滚动条宽度，
   * 内容区宽度恢复成完整的卡片内容宽 → 与搜索行**严格对齐**，滚动条落在卡片的右内边距里。
   *
   * 只量一次并记住：滚动条宽度取决于浏览器/系统（8/10/11px，无滚动条时为 0），
   * 而每次跟随变化会形成"变宽 → 不再溢出 → 滚动条消失 → 变窄 → 又溢出"的抖动。
   */
  const feedSbWidth = ref(0)
  let feedSbMeasured = false
  function measureFeedScrollbar() {
    const el = feedScrollRef.value
    if (!el || feedSbMeasured) return
    const w = el.offsetWidth - el.clientWidth
    if (w > 0) {
      feedSbWidth.value = w
      feedSbMeasured = true
    }
  }
  // 行数变化（首次载入 / 搜索 / 加载更多）后，DOM 更新完再量一次
  watch(
    () => renderedFeed.value.length,
    () => nextTick(measureFeedScrollbar)
  )
  onMounted(() => nextTick(measureFeedScrollbar))

  const giftDialogVisible = ref(false)
  /** 最近一次打开"某人送了哪些礼物"弹窗用的行（直播中轮询要重新套用同一筛选） */
  const lastGiftDialogRow = ref<GiftRankItem | null>(null)
  /** 最近一次打开"主播送礼人榜单"弹窗用的主播行 */
  const lastAnchorDialogRow = ref<AnchorRankItem | null>(null)
  const giftDialogUser = ref('')
  const giftDialogList = ref<NonNullable<SessionDetail['giftFeed']>>([])
  /**
   * 全量礼物明细（两个弹窗用）。
   * 从 /detail 拆出来了：单独一份 3299KB / 7024 条（实测），首屏不需要。
   * 首次打开弹窗时拉一次并缓存，同一场次内不重复请求。
   */
  const giftDetailsFull = ref<NonNullable<SessionDetail['giftFeed']> | null>(null)
  const giftDetailsLoading = ref(false)
  /**
   * 拉全量礼物明细。
   * @param force true = 无视已有数据重新拉（直播中弹窗开着时要靠它刷新人数/金额）
   *
   * 原来这里只要拉过一次就直接 return，于是"场次详情直播中打开弹窗后人数不再变化，
   * 必须退出场次重进才会更新"（用户反馈）。
   */
  /**
   * 把最新的 giftFeed（最近 200 条）并进全量明细。
   *
   * 直播中每 15 秒重拉一次 /gift-details 是 3MB+ 的请求（实测 7024 条 / 3299KB），
   * 之前轮询就是这么干的 —— 既慢又容易和用户的下载/补录操作打架。
   * 现在轮询只把详情页已返回的 giftFeed 增量并进去，全量明细在打开弹窗时拉一次。
   */
  function mergeGiftFeedIntoFull() {
    const full = giftDetailsFull.value
    const feed = detail.value?.giftFeed
    if (!full || !feed?.length) return
    const key = (g: {
      user_sec_uid?: string
      nickname?: string
      gift_name?: string
      to_nickname?: string
      count?: number
      total_diamonds?: number
      create_time?: number
    }) =>
      [
        g.user_sec_uid || g.nickname,
        g.gift_name || '',
        g.to_nickname || '',
        g.count ?? '',
        g.total_diamonds ?? '',
        g.create_time ?? ''
      ].join('|')
    const seen = new Set(full.map(key))
    const add = feed.filter((g) => !seen.has(key(g)))
    if (add.length) giftDetailsFull.value = [...full, ...add]
  }

  async function ensureGiftDetails(force = false) {
    if (!force && (giftDetailsFull.value || giftDetailsLoading.value)) {
      // 已有全量数据时只做增量合并，不再整份重拉
      if (giftDetailsFull.value) mergeGiftFeedIntoFull()
      return
    }
    giftDetailsLoading.value = true
    try {
      const r = await fetchSessionGiftDetails(String(sessionId))
      giftDetailsFull.value = r?.giftDetails || []
    } catch (e) {
      // 拉不到就退回"最近 200 条"，弹窗仍可打开（内容是子集），并在控制台留痕
      console.warn('[detail] 全量礼物明细拉取失败，回退到最近若干条:', e)
      giftDetailsFull.value = detail.value?.giftFeed || []
    } finally {
      giftDetailsLoading.value = false
    }
  }
  /**
   * 榜单行的头像（弹窗标题用）。
   *
   * 原来取 `giftDialogList[0].avatar_url`，也就是**第一条明细**的头像 ——
   * 同一场次里有人先用匿名、后用真名，第一条可能是匿名那条，头像是假的/旧的，
   * 而榜单里那一行是按 sec_uid 聚合后拿到的最新头像，所以"排行对、展开不对"。
   * 现在优先用榜单行自带的头像，其次才回退到明细里的头像。
   */
  const giftDialogAvatar = computed(
    () => lastGiftDialogRow.value?.avatar_url || giftDialogList.value[0]?.avatar_url || ''
  )
  const giftDialogTotal = computed(() =>
    giftDialogList.value.reduce((s, g) => s + (g.total_diamonds || 0), 0)
  )

  /*
   * 榜单图片下载（「送出礼物的人员榜单」弹窗里）。
   * 模板清单从后端拿（后端再从 thanks-rank.js 读，唯一来源），不在前端硬编码。
   */
  const rankTheme = ref('')
  const rankThemes = ref<string[]>([])
  const rankDefaultTheme = ref('depth-glass')
  const rankDownloading = ref(false)


  /** 弹窗内容是否切到"选模板"视图（点标题栏那颗下载图标切换） */
  const rankPickerOpen = ref(false)

  /** 从模板网格选一个：记下选择并立即按它下载，然后切回榜单 */
  async function onPickRankTheme(theme: string) {
    rankTheme.value = theme
    rankPickerOpen.value = false
    await downloadRankImages()
  }

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

  /**
   * 下载榜单图片。
   * 榜单会分页（每页 10 人，实测 36 人 2 页），而且**同一模板不同收礼人的页数不同**，
   * 所以第一页的响应头 X-Total-Pages 决定后面还要不要继续下载。
   */
  async function downloadRankImages() {
    const sid = String(route.params.sessionId || '')
    if (!sid) return
    await ensureRankThemes()
    const theme = rankTheme.value || rankDefaultTheme.value
    rankDownloading.value = true
    try {
      /*
       * 只下 zip：服务端把分页的每一页打进一个文件。
       * 不再逐页下载 —— 手机浏览器（iOS Safari / Android Chrome）只允许**第一次**
       * 程序化下载，逐页时只能存到第 1 张（用户反馈"只能下一张 / 下不全"）。
       */
      await downloadWithAuth(
        getRankImageZipUrl(sid, {
          theme,
          to: peopleAnchorName.value,
          avatar: peopleAnchorAvatar.value
        }),
        `榜单_${sid}.zip`
      )
      ElMessage.success('榜单已打包成 zip 下载（内含全部分页）')
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '榜单图片下载失败'))
    } finally {
      rankDownloading.value = false
    }
  }

  const peopleDialogVisible = ref(false)
  const peopleAnchorName = ref('')
  const peopleAnchorAvatar = ref('')
  const peopleDialogList = ref<{ nickname: string; avatar_url?: string; total_diamonds: number }[]>(
    []
  )

  /*
   * 竞态守卫：用户快速连点多个人时，先发起的请求可能**后返回**，
   * 于是后点的那个人的名字配上先点的那个人的明细（用户反馈"显示的礼物和人乱"）。
   * 每次打开递增序号，await 回来后发现序号已变就丢弃这次结果。
   */
  let giftDialogSeq = 0
  let peopleDialogSeq = 0
  /** 全量明细还在拉（弹窗里显示加载态，避免看起来"卡住不动"） */
  const giftDialogLoading = ref(false)

  /**
   * 判断两条记录是不是同一名用户。
   *
   * 同一个场次里，同一个人可能**先用匿名、后用真名**（或者中途改昵称），
   * 于是明细里出现两条 nickname 不同、user_sec_uid 相同的数据。
   * 榜单按 sec_uid 聚合是对的；弹窗如果只按昵称筛，就会漏行、头像也会取错。
   *
   * 规则：两边都有 sec_uid 就比 sec_uid；任一侧缺失才退回比昵称。
   */
  function isSameGiftUser(
    gift: { user_sec_uid?: string; nickname?: string },
    row: { user_sec_uid?: string; nickname?: string }
  ) {
    if (gift.user_sec_uid && row.user_sec_uid) return gift.user_sec_uid === row.user_sec_uid
    return (gift.nickname || '').trim() === (row.nickname || '').trim()
  }

  /**
   * @param force  重新拉全量明细（直播中用）
   * @param silent 自动刷新触发：不显示 loading、列表空了也不清空 —— 避免弹窗忽高忽低
   */
  async function openGiftDetail(gift: GiftRankItem, force = false, silent = false) {
    const seq = ++giftDialogSeq
    lastGiftDialogRow.value = gift
    // silent 刷新时不要动标题：auto refresh 拿的是同一行，改标题只会闪一下
    if (!silent) giftDialogUser.value = gift.nickname
    const sameUser = (g: { user_sec_uid?: string; nickname?: string }) => isSameGiftUser(gift, g)
    // 先用"最近若干条"里的即时结果把弹窗打开（有内容可看），再拉全量补齐
    const quick = (detail.value?.giftFeed || []).filter(sameUser).map((g) => ({
      ...g,
      nickname: gift.nickname || g.nickname,
      avatar_url: gift.avatar_url || g.avatar_url
    }))
    if (!silent && quick.length) giftDialogList.value = quick
    if (!silent) {
      giftDialogVisible.value = true
      giftDialogLoading.value = true
    }
    try {
      await ensureGiftDetails(force)
    } finally {
      if (seq === giftDialogSeq && !silent) giftDialogLoading.value = false
    }
    // 已经点了别的人 → 这次的结果作废，不要覆盖
    if (seq !== giftDialogSeq) return
    /*
     * 命中后统一成**榜单行**的昵称和头像。
     *
     * 同一个人可能先用匿名、后用真名：明细里两条记录的 nickname / avatar 不同，
     * 弹窗里就会一会儿匿名头像、一会儿真名头像，看起来"头像不对"。
     * 榜单是按 sec_uid 聚合后的最新身份，以它为准，把明细行都标成同一个身份。
     */
    const rows = (giftDetailsFull.value || []).filter(sameUser).map((g) => ({
      ...g,
      nickname: gift.nickname || g.nickname,
      avatar_url: gift.avatar_url || g.avatar_url
    }))
    /*
     * 全量明细里一条都没匹配到（接口降级 / sec_uid 缺失）时，
     * 不要把已经显示的内容清空 —— 以前这里直接赋值，于是弹窗变成空白（用户反馈"偶尔是空白"）。
     */
    if (rows.length || !silent) {
      giftDialogList.value = rows.length ? rows : quick.length ? quick : giftDialogList.value
    }
  }

  /**
   * 按当前弹窗里的主播，重新算「送礼人员」列表。
   * 单独抽出来是为了补录/撤销之后能**原地刷新列表**，
   * 又不会像 openAnchorPeopleList 那样把视图复位回榜单（撤销时用户还在补录面板里）。
   *
   * 聚合键用 **user_sec_uid**（没有才退回昵称）：
   * 同一个人匿名 + 真名两条记录要合成一行，否则榜单里一个人、弹窗里两行，
   * 而且两行的头像还各是各的（用户："一个场次内又用过匿名用过真名，头像会不对"）。
   */
  async function loadAnchorPeople(force = false) {
    const anchor = lastAnchorDialogRow.value
    if (!anchor) return
    await ensureGiftDetails(force)
    const map = new Map<
      string,
      { nickname: string; avatar_url?: string; total_diamonds: number; anon: boolean }
    >()
    const isAnon = (n?: string) => !n || /^匿名/.test(n) || /^dou\d+/.test(n)
    ;(giftDetailsFull.value || [])
      .filter((g) => (g.to_nickname || '').trim() === (anchor.anchor_name || '').trim())
      .forEach((g) => {
        const key = g.user_sec_uid || g.nickname || ''
        if (!key) return
        const cur = map.get(key) || {
          nickname: g.nickname || '匿名用户',
          avatar_url: g.avatar_url,
          total_diamonds: 0,
          anon: isAnon(g.nickname)
        }
        cur.total_diamonds += g.total_diamonds || 0
        if (!cur.avatar_url && g.avatar_url) cur.avatar_url = g.avatar_url
        // 真名优先于匿名/dou 号：显示更好认，头像也跟着用真名那条
        if (cur.anon && !isAnon(g.nickname)) {
          cur.nickname = g.nickname || cur.nickname
          if (g.avatar_url) cur.avatar_url = g.avatar_url
          cur.anon = false
        }
        map.set(key, cur)
      })
    const list = [...map.values()]
      .map(({ nickname, avatar_url, total_diamonds }) => ({ nickname, avatar_url, total_diamonds }))
      .sort((a, b) => b.total_diamonds - a.total_diamonds)
    /*
     * 切分页/接口异常时可能算出空列表 —— 空列表不要覆盖已有内容，
     * 否则直播中每 15 秒弹窗会闪成空白（"有时候点开弹窗是空白的"）。
     */
    if (list.length || !peopleDialogList.value.length) peopleDialogList.value = list
  }

  /**
   * @param force  重新拉全量明细（直播中用）
   * @param silent 自动刷新触发：**不动视图状态**（不关补录面板、不关主题选择、不重开弹窗）
   *
   * 之前轮询无条件调 openAnchorPeopleList(row, true)，每 15 秒就把 manualGiftOpen 置回 false，
   * 于是直播中刚点开的「补录礼物」面板立刻被关掉、下载榜单也被打断
   * （用户反馈"自动刷新导致直播中没法下载感谢榜单、没法补录礼物"）。
   */
  async function openAnchorPeopleList(anchor: AnchorRankItem, force = false, silent = false) {
    const seq = ++peopleDialogSeq
    if (!silent) {
      // 每次打开都回到列表视图：否则上次停在「下载榜单/补录礼物」上，标题栏两个箭头会同时亮着
      manualGiftOpen.value = false
      rankPickerOpen.value = false
      lastAnchorDialogRow.value = anchor
      peopleAnchorName.value = anchor.anchor_name
      peopleAnchorAvatar.value = anchor.anchor_avatar || ''
      peopleDialogVisible.value = true
      void ensureRankThemes()
    }
    await loadAnchorPeople(force)
    if (seq !== peopleDialogSeq) return
    if (!silent) peopleDialogVisible.value = true
  }

  /**
   * 拉取"最新 N 条"动态。
   *
   * 注意：调用方必须 await —— 原来这里不 await 且没有 catch，
   * 一旦弹幕接口失败就是 unhandled rejection，而外层 refresh 的 catch 完全抓不到，
   * 页面会停在"标题显示命中数、列表是上一次的内容"这种自相矛盾的状态。
   */
  async function loadDanmakuFeed() {
    /*
     * 只取最新 2000 条。
     * 原来是 `fetchDanmaku(sessionId, 50000)`：实测场次 153（6.5 万条弹幕）
     * 单这一请求就要 **19 秒 / 22MB**，返回后还要在主线程 map + 排序 5 万条 ——
     * 这是"全部"卡顿的真正原因，不是渲染（渲染本来就有渐进披露兜着）。
     * 更早的内容改由服务端按关键字检索（见 searchFeed）。
     */
    const dmData = await fetchDanmaku(sessionId, FEED_FETCH_LIMIT)
    const dmList = dmData.data || dmData.messages || []
    feedTotal.value = dmData.total ?? dmList.length
    // 动态只需要最近若干条礼物（后端 giftFeed = 最新 200 条），全量明细走弹窗按需拉
    const giftList = detail.value?.giftFeed || []
    feedRaw.value = buildFeedItems(dmList, giftList)
  }

  /** 弹幕 + 礼物 → 统一的时间线数组（按时间**降序**，最新在前） */
  /**
   * club_json（按消息存的粉丝团/消费等级快照）→ 渲染用对象。
   * 短名：pl 消费等级、pi 图标、cl 团等级、cn 团名、ca 归属主播 id、cs 状态、gu 星守护徽章。
   */
  /** 徽章悬浮文案：团名 / 归属主播 / 状态 / 星守护（有才显示） */
  function clubTitle(c?: FeedClub | null): string | undefined {
    if (!c) return undefined
    const parts = [
      c.clubName ? '团名：' + c.clubName : '',
      c.an ? '归属主播：' + c.an : '',
      c.clubStatus === 2 ? '已退团/未点亮' : '在团',
      c.starGuard ? '星守护' : ''
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : undefined
  }

  function parseClub(raw: any) {
    if (!raw) return null
    try {
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!o || (o.pl == null && o.cl == null)) return null
      return {
        payLevel: o.pl,
        payIconUrl: o.pi,
        clubLevel: o.cl,
        clubName: o.cn,
        clubStatus: o.cs,
        an: o.an || null,
        starGuard: Boolean(o.gu && /star_guard/i.test(String(o.gu)) && !/gray/i.test(String(o.gu)))
      }
    } catch {
      return null
    }
  }

  function buildFeedItems(dmList: any[], giftList: any[]): FeedItem[] {
    const items: FeedItem[] = []
    dmList.forEach((d: any) => {
      const ts = Number(d.timestamp || d.create_time) || 0
      if (!d.content) return
      items.push({
        _type: 'danmaku',
        _key: 'dm_' + ts + '_' + d.nickname,
        _ts: ts > 1e12 ? ts : ts * 1000,
        nickname: d.nickname,
        content: d.content,
        timestamp: d.timestamp || d.create_time,
        avatar_url: d.avatar_url || d.avatar,
        club: parseClub(d.club || d.club_json)
      })
    })
    giftList.forEach((g) => {
      const ts = Number(g.create_time || 0)
      items.push({
        _type: 'gift',
        _key: 'gf_' + ts + '_' + g.nickname + '_' + g.gift_name,
        _ts: ts > 1e12 ? ts : ts * 1000,
        nickname: g.nickname,
        gift_name: g.gift_name,
        count: g.count || 0,
        total_diamonds: g.total_diamonds || 0,
        to_nickname: g.to_nickname || '',
        gift_icon: g.gift_icon || '',
        timestamp: g.create_time,
        avatar_url: g.avatar_url || '',
        club: parseClub(g.club || g.club_json)
      })
    })
    // 按时间降序：监测场景关注"刚刚发生了什么"。
    // 原来升序 + slice(-limit) 取到的是**最旧**的 N 条，标题写着"最新"却不最新。
    items.sort((a, b) => b._ts - a._ts)
    return items
  }

  /**
   * 在全量弹幕与礼物里搜索。
   *
   * 前端只有最新 2000 条弹幕、最近 200 条礼物，搜不到更早的 —— 所以关键字交给**服务端**用 SQL 检索
   * （实测全量 6.5 万条弹幕里搜"哈哈哈哈"：192ms / 236 条命中）。
   * 空关键字则恢复为最新的 2000 条（礼物用主详情里带的最近 200 条，不额外请求）。
   *
   * 礼物也要走服务端：原来只在前端过滤最近 200 条 giftFeed，
   * 于是搜礼物时服务端弹幕命中 0 → 标题写「全量命中 0 条」，而列表里明明有礼物行
   * （用户反馈"搜索礼物时全量命中都显示 0"）。命中也就不再是"最近 200 条"的口径。
   */
  async function searchFeed() {
    const q = feedSearch.value.trim()
    feedSearching.value = true
    feedShownCount.value = 200
    try {
      const [dmData, giftData] = await Promise.all([
        fetchDanmaku(sessionId, FEED_FETCH_LIMIT, q),
        // 礼物检索失败不该把整个搜索判为失败：弹幕结果照样给出来
        q ? fetchSessionGiftDetails(String(sessionId), q).catch(() => null) : Promise.resolve(null)
      ])
      const dmList = dmData.data || dmData.messages || []
      const dmTotal = dmData.total ?? dmList.length

      const gifts = q ? giftData?.giftDetails || [] : detail.value?.giftFeed || []
      const giftTotal = q ? giftData?.total ?? gifts.length : 0

      feedSearchTotal.value = dmTotal + giftTotal
      feedSearchError.value = ''
      feedRaw.value = buildFeedItems(dmList, gifts)
    } catch {
      // 搜索失败保持原列表，避免把"搜不到"伪装成"没有"；同时给界面一个明确标记，
      // 否则标题会显示"全量命中 0 条"而列表还是旧数据，读起来自相矛盾。
      feedSearchTotal.value = 0
      feedSearchError.value = '检索失败'
    } finally {
      feedSearching.value = false
    }
  }

  const statCards = computed(() => [
    {
      label: '峰值在线',
      icon: 'ri:signal-wifi-line',
      // 全部走 fmtNum，保证同一排卡片口径一致（原来这里单独用 toLocaleString）
      value: fmtNum(detail.value?.session?.online_peak || 0),
      title: fmtTitle(detail.value?.session?.online_peak || 0)
    },
    {
      label: '总钻石',
      icon: 'ri:diamond-line',
      value: fmtNum(detail.value?.summary?.total_diamonds || 0),
      title: fmtTitle(detail.value?.summary?.total_diamonds || 0)
    },
    {
      label: '点赞',
      icon: 'ri:thumb-up-line',
      value: fmtNum(detail.value?.session?.stats_like || 0),
      title: fmtTitle(detail.value?.session?.stats_like || 0)
    },
    {
      label: '弹幕',
      icon: 'ri:chat-3-line',
      value: fmtNum(detail.value?.summary?.danmaku_count || 0)
    },
    {
      label: '用户',
      icon: 'ri:user-3-line',
      value: fmtNum(detail.value?.summary?.user_count || 0)
    },
    {
      label: '时长',
      icon: 'ri:time-line',
      value:
        detail.value?.session?.duration_min != null
          ? formatDuration(detail.value.session.duration_min)
          : '进行中'
    }
  ])

  let timer: number | undefined

  function renderCloud() {
    if (detail.value?.danmakuWords?.length) {
      nextTick(() => {
        renderWordCloud(detail.value!.danmakuWords || [])
        // 画完再挂观察：此时真实容器（不是骨架）已经替换进 DOM。
        observeCloudBox()
      })
    }
  }

  /**
   * 词云容器尺寸变化时重绘。
   *
   * 为什么必须有：canvas 的绘制依赖容器实际尺寸，而首次绘制时布局往往还没稳定
   * （网格行高、flex 分配都要等一帧）。实测首次绘制只拿到 224px 高，
   * 于是词云被压扁、着色覆盖率只有 18%。
   *
   * ⚠️ 还要处理「容器被替换」：模板里骨架和真实容器**用同一个 class**，
   * 首屏 observe 到的是骨架；数据到达后骨架被 v-else-if 换掉，
   * 旧元素脱离 DOM → 观察失效 → 移动端词云再也不重绘（canvas 停在默认 300×150 ✗）。
   * 所以每次渲染后都重新 observe 当前那个 `.dy-cloud-box`。
   */
  let cloudObserver: ResizeObserver | undefined
  let observedEl: Element | null = null
  function observeCloudBox() {
    if (typeof ResizeObserver === 'undefined') return
    const el = document.querySelector('.dy-cloud-box')
    if (!el) return
    if (cloudObserver && observedEl === el) return // 同一个元素，已观察
    cloudObserver?.disconnect()
    observedEl = el
    let last = ''
    cloudObserver = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const key = `${Math.round(r.width)}x${Math.round(r.height)}`
      // 尺寸没变就不重绘，避免死循环（重绘会改 canvas 属性，但不会改容器尺寸）
      if (key === last) return
      last = key
      renderWordCloud(detail.value?.danmakuWords || [])
    })
    cloudObserver.observe(el)
  }

  async function refresh(opts: { silent?: boolean } = {}) {
    // silent：直播中每 15 秒的轮询走这个分支 —— 不置 loading，
    // 否则页面会每 15 秒整体变淡一次、期间刷新按钮还是禁用的（用户实测反馈）。
    if (!opts.silent) loading.value = true
    try {
      detail.value = await fetchSessionDetail(sessionId)
      queryError.value = ''
      renderCloud()
      observeCloudBox()
      /*
       * 轮询时必须与"当前检索条件"保持一致：
       * 原来无条件调 loadDanmakuFeed()（最新 2000 条、不带关键字），
       * 于是用户搜完停在那儿，15 秒后列表被悄悄换掉，而标题还写着「全量命中 N 条」——
       * 数字与列表对不上（审计 P1-4）。现在有检索词就重新按词取数，否则取最新。
       */
      if (activeQuery.value) await searchFeed()
      else await loadDanmakuFeed()
    } catch (e) {
      // 以前这里只有 finally 没有 catch：场次不存在/接口失败时异常逃逸，
      // 页面停在一片全 0 的假数据上，用户以为"这场真的没有数据"（UI-AUDIT P1-11）
      queryError.value = apiErrorMessage(e, '场次详情加载失败')
    } finally {
      if (!opts.silent) loading.value = false
    }
  }

  onMounted(() => {
    refresh()
    timer = window.setInterval(async () => {
      if (!detail.value?.session?.is_live) return
      await refresh({ silent: true })
      /*
       * 用户正在操作弹窗时，轮询只刷新页面数据，**不碰弹窗**。
       * 否则正在补录礼物 / 选下载主题 / 等下载的过程中，列表会被重新算一遍，
       * 面板被关掉、下载被打断（用户："自动刷新导致直播中没法下载感谢榜单，没法补录礼物"）。
       */
      if (manualGiftOpen.value || rankPickerOpen.value || rankDownloading.value) return
      /*
       * 弹窗开着时也要跟着刷：原来弹窗里的列表只在"打开那一刻"取一次全量明细，
       * 直播中人数/金额就一直停在旧数字，必须退出场次重进才更新（用户反馈）。
       */
      if (giftDialogVisible.value && lastGiftDialogRow.value) {
        await openGiftDetail(lastGiftDialogRow.value, false, true)
      }
      if (peopleDialogVisible.value && lastAnchorDialogRow.value) {
        await openAnchorPeopleList(lastAnchorDialogRow.value, false, true)
      }
    }, 15000)
  })
  onUnmounted(() => {
    clearInterval(timer)
    cloudObserver?.disconnect()
  })

  /* ===== 补录礼物（虚拟记录）===== */
  /** 拉本场补录记录 */
  async function loadManualGiftList() {
    const sid = String(route.params.sessionId || '')
    if (!sid) return
    try {
      const r: any = await fetchManualGifts(sid)
      manualGiftList.value = r?.items || []
      manualGiftTotal.value = r?.total_diamonds || 0
    } catch (e) {
      console.warn('[manual-gift] 列表拉取失败', e)
    }
  }

  /** 首次切到补录视图：礼物候选 + 本场记录 */
  async function ensureManualGiftData() {
    if (!manualGiftOptions.value.length) {
      try {
        const r = await fetchGiftPrices({})
        const items = (r as any)?.items || []
        manualGiftOptions.value = items
          .map((g: any) => ({ name: g.gift_name || g.name, price: Number(g.latest_price || g.eff_max_unit || 0) }))
          .filter((g: any) => g.name && g.price > 0)
      } catch (e) {
        console.warn('[manual-gift] 礼物候选拉取失败:', e)
      }
    }
    await loadManualGiftList()
  }

  /** 补录成功后：关视图 + 刷新记录和页面 */
  async function submitManualGiftAndClose() {
    const ok = await submitManualGift()
    if (!ok) return
    manualGiftOpen.value = false
    await loadManualGiftList()
    // 弹窗里那份"送礼人榜单"也要重取，否则数字和总览不一致（用户反馈刷新不及时）
    // 原地刷新列表（不要走 openAnchorPeopleList，否则会把刚关掉的视图状态又重置一遍）
    if (lastAnchorDialogRow.value) await loadAnchorPeople(true)
    await refresh({ silent: true })
  }

  /** 撤销一条补录 */
  async function removeManualGift(r: { id: number; gift_name?: string }) {
    try {
      await ElMessageBox.confirm('撤销这条补录：' + (r.gift_name || '') + '？该场次的统计会一起回滚。', '确认撤销', {
        type: 'warning',
        confirmButtonText: '撤销',
        cancelButtonText: '取消'
      })
    } catch {
      return
    }
    try {
      await deleteManualGift(r.id)
      ElMessage.success('已撤销')
      await loadManualGiftList()
      /*
       * 撤销后必须把弹窗里这份「送礼人员」也重算：
       * 之前只刷新了页面数据，弹窗里仍留着那个人（用户反馈"数对了但榜单上还有记录"）。
       */
      await loadAnchorPeople(true)
      await refresh({ silent: true })
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '撤销失败'))
    }
  }

  /** 是否切到"补录礼物"视图（和 rankPickerOpen 同一套思路：弹窗内切换，不拉长） */
  const manualGiftOpen = ref(false)
  const manualGiftList = ref<{ id: number; gift_name: string; repeat_count: number; nickname: string; total_diamonds: number }[]>([])
  const manualGiftTotal = ref(0)
  const manualGiftQuery = ref('')
  const manualGiftCandidates = ref<any[]>([])
  /** 搜人请求进行中（全库查询要 1~3 秒，不显示 loading 用户会以为没搜） */
  const manualGiftSearching = ref(false)
  const manualGiftUser = ref<{ sec_uid?: string; nickname?: string; user_display_id?: string }>({})
  const manualGiftName = ref('')
  const manualGiftPrice = ref<number>(1)
  const manualGiftCount = ref<number>(1)
  const manualGiftTime = ref<Date | null>(null)
  const manualGiftTo = ref('')
  const manualGiftSaving = ref(false)
  const manualGiftOptions = ref<{ name: string; price: number }[]>([])

  /** 打开弹窗：第一次打开才去拉礼物名+单价的候选列表（689 条，一次就够） */
  /** 点加号：切换视图；首次打开时拉礼物候选和本场补录记录 */
  /**
   * 下载榜单 / 补录礼物 是两个互斥视图：
   * 之前各自 toggle，打开一个不清另一个 —— 状态会残留，
   * 表现为"点下载没反应"或"返回箭头指错"，而且两个视图高度不同，弹窗会忽高忽低。
   */
  function toggleRankPicker() {
    rankPickerOpen.value = !rankPickerOpen.value
    if (rankPickerOpen.value) manualGiftOpen.value = false
  }

  async function toggleManualGift() {
    manualGiftOpen.value = !manualGiftOpen.value
    if (manualGiftOpen.value) rankPickerOpen.value = false
    if (!manualGiftOpen.value) return
    /*
     * 收礼人 / 时间先填好，再去拉「本场补录记录 + 礼物候选」。
     * 原来这两行写在 await 之后：数据没回来之前，时间选择器是空的（看着像没填），
     * 先赋值可以保证打开即有值。
     * 收礼人从「主播排名」点加号进来时必然是当前主播，不需要用户再选一次。
     */
    manualGiftTo.value = peopleAnchorName.value || ''
    if (!manualGiftTime.value) manualGiftTime.value = new Date()
    await ensureManualGiftData()
    if (manualGiftOptions.value.length) return
    try {
      const r = await fetchGiftPrices({})
      const items = (r as any)?.items || []
      manualGiftOptions.value = items
        .map((g: any) => ({ name: g.gift_name || g.name, price: Number(g.latest_price || g.eff_max_unit || 0) }))
        .filter((g: any) => g.name && g.price > 0)
    } catch (e) {
      console.warn('[manual-gift] 礼物候选拉取失败:', e)
    }
  }

  let manualGiftSearchTimer: number | undefined
  /**
   * 搜人请求序号：单字放开后，第一次按键就会发查询（单字一次要 2~4 秒），
   * 中途停顿再打字很可能出现"后发先到" —— 旧关键词的结果覆盖掉新的。
   * 每次请求领一个号，回来时对不上就丢弃。
   */
  let manualGiftSearchSeq = 0
  /** 搜人：输入停顿 300ms 再查（复用信息查询接口） */
  function searchManualUser() {
    const q = manualGiftQuery.value.trim()
    manualGiftUser.value = {}
    if (manualGiftSearchTimer) clearTimeout(manualGiftSearchTimer)
    /*
     * 单字也查（后端已放开）：库里单字昵称是真实存在的，补录时选不中这些人才是 bug。
     * 只取 20 个候选（下拉最多也只用 20 个）：单字命中可能上百人，
     * 每人后端都要查全库 + 调抖音接口，拉 100 个回来只会让下拉卡住。
     */
    if (!q) {
      manualGiftCandidates.value = []
      return
    }
    manualGiftSearchTimer = window.setTimeout(async () => {
      const my = ++manualGiftSearchSeq
      manualGiftSearching.value = true
      try {
        // skip_api：补录只需要昵称+抖音号，不调抖音接口补粉丝数/签名（否则每次 3~4 秒）
        const r: any = await anonymousLookup(q, undefined, undefined, 20, true)
        if (my !== manualGiftSearchSeq) return
        manualGiftCandidates.value = (r?.users || []).filter((u: any) => u.sec_uid).slice(0, 20)
      } catch {
        if (my !== manualGiftSearchSeq) return
        manualGiftCandidates.value = []
      } finally {
        if (my === manualGiftSearchSeq) manualGiftSearching.value = false
      }
    }, 300)
  }

  function pickManualUser(c: any) {
    manualGiftUser.value = { sec_uid: c.sec_uid, nickname: c.nickname, user_display_id: c.unique_id || '' }
    manualGiftQuery.value = c.nickname
    manualGiftCandidates.value = []
  }

  /*
   * 礼物下拉的搜索：Element 自带的 filterable 在这份 696 条的列表上不生效
   * （实测输入「抖音」仍然把全部礼物列出来），改成自己按 filter-method 过滤。
   */
  const manualGiftFilter = ref('')
  const filteredGiftOptions = computed(() => {
    const q = manualGiftFilter.value.trim().toLowerCase()
    if (!q) return manualGiftOptions.value
    return manualGiftOptions.value.filter((g) => g.name.toLowerCase().includes(q))
  })

  function onGiftFilter(q: string) {
    manualGiftFilter.value = q || ''
  }

  /** 选了礼物名 → 自动带出单价 */
  function fillManualGiftPrice() {
    const hit = manualGiftOptions.value.find((g) => g.name === manualGiftName.value)
    if (hit && hit.price > 0) manualGiftPrice.value = hit.price
  }

  async function submitManualGift(): Promise<boolean> {
    const sid = String(route.params.sessionId || '')
    if (!sid) return false
    if (!manualGiftName.value) { ElMessage.warning('请选择或输入礼物名'); return false }
    if (!manualGiftPrice.value || manualGiftPrice.value <= 0) { ElMessage.warning('单价必须大于 0'); return false }
    if (!manualGiftCount.value || manualGiftCount.value < 1) { ElMessage.warning('次数必须 ≥ 1'); return false }
    const nickname = manualGiftUser.value.nickname || manualGiftQuery.value.trim()
    if (!nickname) { ElMessage.warning('请选择或输入昵称'); return false }

    manualGiftSaving.value = true
    try {
      const r = await addManualGift(sid, {
        nickname,
        user_sec_uid: manualGiftUser.value.sec_uid || '',
        user_display_id: manualGiftUser.value.user_display_id || '',
        gift_name: manualGiftName.value,
        unit_price: Math.floor(manualGiftPrice.value),
        count: Math.floor(manualGiftCount.value),
        create_time: manualGiftTime.value ? manualGiftTime.value.getTime() : Date.now(),
        to_nickname: manualGiftTo.value || peopleAnchorName.value || ''
      })
      ElMessage.success('已补录 ' + manualGiftName.value + ' × ' + manualGiftCount.value + '，合计 ' + fmtNum((r as any).total_diamonds || 0) + ' 钻')
      return true
      manualGiftName.value = ''
      manualGiftCount.value = 1
      manualGiftUser.value = {}
      manualGiftQuery.value = ''
      await refresh({ silent: true })
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '补录失败'))
      return false
    } finally {
      manualGiftSaving.value = false
    }
  }

</script>

<style>
  /*
   * 弹窗内边距交给 Element 默认值（--el-dialog-padding-primary），
   * 这样标准 X 的位置、标题与正文的间距和其它弹窗完全一致。
   *
   * 原来这里是 `--el-dialog-padding-primary: 0px` + `.el-dialog__body { padding: 0 }`：
   * 因为当时用 :show-header="false" + 自绘关闭按钮，需要自己控制全部间距；
   * 现在改成 #header 插槽 + 标准 X（见模板里的"弹窗统一约定"），这两条覆盖不再需要。
   */

  /*
   * 榜单里可点进明细的行。
   * 原来是裸 div @click + `hover:bg-g-100/70 transition-colors`：
   * 鼠标可用但键盘完全不可达，而且没有任何按下反馈。
   */
  .dy-detail-row {
    transition: background-color var(--dy-dur-fast) ease;
  }

  @media (hover: hover) and (pointer: fine) {
    .dy-detail-row:hover {
      background-color: var(--art-gray-100);
    }
  }

  .dy-detail-row:active {
    background-color: var(--art-gray-200, var(--art-gray-100));
  }

  .dy-detail-row:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px var(--dy-focus-ring),
      0 0 0 4px var(--theme-color);
  }

  /*
   * 搜索框与按钮的样式写在全局 `custom/douyin-motion.scss` 里（按 .dy- 类名限定）。
   * 原因：本文件的 <style> 是**全局**的（没有 scoped），
   * 在这里写 :deep() 是无效写法 —— 它不会被 Vue 编译转换，而是原样输出，
   * 浏览器不认识 :deep() 于是整条规则被丢弃（实测样式完全没生效）。
   * 而全局块里又不能写裸的 `.el-input__wrapper`，那会泄漏到全站所有输入框。
   */
/* ---------- 手机端 tab：只显示当前那一组区块（榜单 / 数据 / 动态） ---------- */
@media (max-width: 767px) {
  .dy-mobile-pane--off {
    display: none !important;
  }
}

/* 主播送礼人员弹窗：三个视图（榜单 / 下载模板 / 补录礼物）共用固定高度，
   切换时弹窗不再忽高忽低（用户反馈"两个弹窗都会让弹窗高度变化"）。
   420px 是「补录」那一屏刚好放完（选中提示 + 礼物表单 + 合计 + 记录列表）的值。 */
.dy-people-panel {
  height: 420px;
}

@media (max-width: 767px) {
  .dy-people-panel {
    height: 420px;
  }
}
</style>
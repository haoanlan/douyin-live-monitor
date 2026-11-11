<!--
  礼物修改管理（/douyin/gift-prices）。

  ## 这一版按用户要求改的三件事

  1. 礼物名前面带 **icon**（gifts.icon 优先，gift_icons 兜底，没有就用通用礼物图标）
  2. 标签栏只分 **未映射 / 已映射**
       · 已映射 = 采集端已有明确价格的：代码内置表（lib/gift-price-builtin.js）或页面映射表
       · 未映射 = 两者都没有，采集时只能信消息里的 diamondCount（最可能不准）
  3. 单价列最多显示 **两种** 历史单价；改价走「操作 → 修改」的弹窗，弹窗里可以勾
     **同时重算历史数据**

  ## 映射为什么能保证"下次抓到就对"

  采集链路（lib/worker/message-handler.js）的价格优先级从低到高：
    消息里的 diamondCount  <  工坊宝箱融合计价  <  内置表  <  **页面映射表（gift_price_overrides）**
  弹窗保存就是写映射表，采集端有 10 秒 TTL 缓存，所以最迟 10 秒后新抓到的礼物就按新价算。
  历史数据不会自己变，要靠弹窗里的「同时重算历史数据」。
-->
<template>
  <!--
    礼物价格（高级表格版）

    结构对齐 Art Design Pro 的「高级表格」示例：
      ArtSearchBar（礼物名 / 标签）
      ElCard.art-table-card
        ├ ArtTableHeader（左侧：同步单价字段 / 统计；右侧：刷新 + 列设置等工具栏）
        └ ArtTable（礼物 / 标签 / 单价 / 操作 + 分页）

    原来的四个数字（总数 / 未映射 / 已映射 / 历史不一致）收进 ArtTableHeader 左侧，
    不再单独占一条统计卡 —— 之前那样顶部堆一排大数字，和系统里其它表格页不是一个风格。
  -->
  <div class="art-full-height">
    <ArtSearchBar
      v-model="formFilters"
      :items="formItems"
      :showExpand="false"
      @reset="handleReset"
      @search="handleSearch"
    />

    <ElCard class="art-table-card">
      <ArtTableHeader :loading="loading" @refresh="reload">
        <template #left>
          <div class="flex flex-wrap items-center gap-2">
            <!--
              不再放「刷新」按钮：ArtTableHeader 右侧自带的刷新图标已经绑了 @refresh="reload"，
              两个刷新按钮功能重复（用户要求只留右边那个）。
            -->
            <el-tooltip
              content="历史上只改了总价、没改单价字段的行，这里按总价把单价回填。不改任何金额。"
              placement="bottom"
            >
              <ElButton :loading="syncing" @click="syncUnitFields">
                <ArtSvgIcon icon="ri:price-tag-3-line" class="mr-1" />
                同步单价字段
              </ElButton>
            </el-tooltip>
            <span class="ml-1 text-xs text-g-500">
              共 <b class="text-g-700">{{ allCount }}</b> 个 ·
              未映射 <b class="text-warning">{{ unmappedCount }}</b> ·
              已映射 <b class="text-success">{{ mappedCount }}</b>
              <template v-if="inconsistentCount"> · 历史单价不一致 <b>{{ inconsistentCount }}</b></template>
              <template v-if="zeroCount"> · 钻石为 0 <b>{{ zeroCount }}</b></template>
            </span>
          </div>
        </template>
      </ArtTableHeader>

      <el-alert v-if="loadError" class="mb-2" type="error" :title="loadError" show-icon :closable="false">
        <template #default>
          <el-button size="small" class="mt-2" @click="reload">重试</el-button>
        </template>
      </el-alert>

      <ArtTable
        :data="pagedRows"
        :columns="columns"
        :loading="loading"
        :pagination="pagination"
        :show-table-header="false"
        row-key="gift_name"
        empty-text="没有匹配的礼物"
        class="gift-table"
        @pagination:size-change="onSizeChange"
        @pagination:current-change="onPageChange"
        @sort-change="onSortChange"
      >
        <!-- 礼物名：图标 + 名字（手机端把标签收进名字下面，省一列宽度） -->
        <template #gift_name="{ row }">
          <div class="flex min-w-0 items-center gap-2">
            <img
              v-if="row.icon_url && !iconFailed.has(row.gift_name)"
              :src="row.icon_url"
              class="gift-icon"
              alt=""
              @error="iconFailed.add(row.gift_name)"
            />
            <span v-else class="gift-icon gift-icon--empty">
              <ArtSvgIcon icon="ri:gift-line" />
            </span>
            <div class="min-w-0">
              <div class="truncate font-medium text-g-900 gift-name">{{ row.gift_name }}</div>
              <div v-if="!isMobile && row.rows > 0" class="gift-meta">
                {{ fmtNum(row.gift_count) }} 个 · {{ fmtBig(row.diamonds) }} 钻石 · {{ fmtNum(row.sessions) }} 场
              </div>
              <div v-if="isMobile" class="mt-0.5">
                <el-tag size="small" :type="isMapped(row) ? 'success' : 'warning'" effect="light">
                  {{ isMapped(row) ? '已映射' : '未映射' }}
                </el-tag>
              </div>
            </div>
          </div>
        </template>

        <!-- 标签列：未映射 / 已映射 -->
        <template #tag="{ row }">
          <el-tag size="small" :type="isMapped(row) ? 'success' : 'warning'" effect="light">
            {{ isMapped(row) ? '已映射' : '未映射' }}
          </el-tag>
        </template>

        <!-- 单价：当前采用的价 + 历史出现过的价（最多两种） -->
        <template #price="{ row }">
          <div class="flex flex-col items-end leading-tight">
            <span class="tabular-nums font-semibold text-g-900 price-main">{{ fmtPrice(currentPrice(row)) }}</span>
            <span
              v-if="(row.unit_variants?.length || 0) > 1"
              class="mt-0.5 text-[11px] tabular-nums text-warning"
              :title="`历史数据里按 ${fmtVariants(row)} 两种单价记过账`"
            >
              历史 {{ fmtVariants(row) }}
            </span>
            <span v-else-if="row.rows === 0" class="mt-0.5 text-[11px] text-g-400">暂无历史</span>
            <span
              v-else-if="row.unit_variants?.length === 1 && row.unit_variants[0] !== currentPrice(row)"
              class="mt-0.5 text-[11px] tabular-nums text-g-400"
            >
              历史 {{ fmtPrice((row.unit_variants || [])[0]) }}
            </span>
          </div>
        </template>

        <!-- 操作：只有「修改」 -->
        <!-- 操作：用模板统一的 ArtButtonTable 图标按钮（原来那个自造 pill 按钮风格和系统其它表格不一致） -->
        <template #actions="{ row }">
          <div style="display:flex;justify-content:flex-start;width:100%">
            <ArtButtonTable v-if="can('gift_price.write')" type="edit" @click="openEdit(row)" />
          </div>
        </template>
      </ArtTable>
    </ElCard>

    <!-- 设定单价弹窗 -->
    <el-dialog
      v-model="editOpen"
      :title="`设定单价 · ${editing?.gift_name || ''}`"
      width="540px"
      append-to-body
      destroy-on-close
    >
      <div v-if="editing" class="edit-body">
        <div class="flex items-center gap-3">
          <img
            v-if="editing.icon_url && !iconFailed.has(editing.gift_name)"
            :src="editing.icon_url"
            class="gift-icon gift-icon--lg"
            alt=""
            @error="iconFailed.add(editing.gift_name)"
          />
          <span v-else class="gift-icon gift-icon--lg gift-icon--empty">
            <ArtSvgIcon icon="ri:gift-line" />
          </span>
          <div class="min-w-0">
            <div class="truncate text-base font-semibold text-g-900">{{ editing.gift_name }}</div>
            <div class="mt-0.5 text-xs text-g-500">
              当前价 {{ fmtPrice(currentPrice(editing)) }}（{{ sourceLabel(editing) }}） · 历史 {{ fmtNum(editing.rows) }} 行 / {{ fmtNum(editing.gift_count) }} 个 /
              {{ fmtNum(editing.diamonds) }} 钻石 / {{ fmtNum(editing.sessions) }} 个场次
            </div>
          </div>
        </div>

        <!-- 历史出现过的单价（最多两种） -->
        <el-alert
          v-if="(editing.unit_variants?.length || 0) > 0"
          class="mt-4"
          :type="(editing.unit_variants?.length || 0) > 1 ? 'warning' : 'info'"
          :closable="false"
          show-icon
        >
          <template #title>
            历史出现过的单价：
            <b>{{ fmtPriceList(editing.unit_variants) }}</b>
            <template v-if="(editing.unit_variants || []).length > 1">
              （同一礼物记过两种价，说明历史数据确实对不上）
            </template>
          </template>
        </el-alert>

        <div class="mt-4 flex items-center gap-3">
          <span class="text-sm text-g-700">新单价</span>
          <el-input-number
            v-model="editPrice"
            :min="0"
            :step="1"
            :precision="0"
            size="large"
            class="!w-[180px]"
            @change="refreshPreview"
          />
          <span class="text-sm text-g-500">钻石 / 个</span>
        </div>

        <!-- 影响面预览 -->
        <div v-if="preview" class="preview-box">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-g-600">
            <span>影响行数 <b class="tabular-nums text-g-900">{{ fmtNum(preview.rows) }}</b></span>
            <span>涉及场次 <b class="tabular-nums text-g-900">{{ fmtNum(preview.sessions) }}</b></span>
            <span>
              总钻石
              <b class="tabular-nums text-g-900">{{ fmtNum(preview.old_diamonds) }}</b>
              →
              <b class="tabular-nums text-g-900">{{ fmtNum(preview.new_diamonds) }}</b>
              <span :class="preview.diff >= 0 ? 'text-success' : 'text-danger'">
                （{{ preview.diff >= 0 ? '+' : '' }}{{ fmtNum(preview.diff) }}）
              </span>
            </span>
          </div>
        </div>

        <div class="mt-4">
          <el-checkbox v-model="recompute" :disabled="!hasHistory">
            同时重算历史数据
          </el-checkbox>
          <p class="mt-1 mb-0 text-xs leading-5 text-g-500">
            <template v-if="hasHistory">
              会把上面这些历史行的单价/总钻石改成新价，并重建受影响场次的汇总、礼物排行、主播排行与时间线（可能要几十秒）。
            </template>
            <template v-else> 这个礼物还没有历史记录，保存后只影响之后采集到的数据。 </template>
          </p>
        </div>

        <p class="mt-3 mb-0 text-xs leading-5 text-g-500">
          无论是否重算历史，新单价都会写入映射表；采集端（message-handler）按「内置表 &lt; 映射表」的优先级取值，
          最迟 10 秒后新抓到的礼物就按新价计算。
        </p>
      </div>

      <template #footer>
        <el-button @click="editOpen = false">取消</el-button>
        <!-- 定宽：:loading 会插入转圈，不定宽按钮会被撑宽（点了变长） -->
        <el-button type="primary" class="!min-w-[88px]" :loading="savingEdit" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import type { ColumnOption } from '@/types'
import { usePermissionStore } from '@/store/modules/permission'
import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
import {
  fetchGiftPrices,
  previewGiftPriceRepair,
  previewGiftPriceUnitSync,
  repairGiftPrice,
  saveGiftPrice,
  syncGiftPriceUnitFields,
  type GiftPriceItem
} from '@/api/douyin'
import { apiErrorMessage } from '@/utils/douyin-error'
import { useIsMobile } from '@/hooks/core/useIsMobile'

defineOptions({ name: 'DouyinGiftPrices' })

/** 细粒度操作权限（超管恒真） */
const permissionStore = usePermissionStore()
const can = (action: string) => permissionStore.hasPerm(action)

const rows = ref<GiftPriceItem[]>([])
const loading = ref(false)
const loadError = ref('')
/*
 * 搜索栏（ArtSearchBar）的模型：它只负责收集条件，真正的过滤还是走 keyword/filter，
 * 这样原有的 reload / 分页 / 排序逻辑一行都不用改。
 */
const formFilters = reactive<{ keyword: string; tag: 'all' | 'unmapped' | 'mapped' }>({
  keyword: '',
  tag: 'all'
})
const formItems = [
  { label: '礼物名', key: 'keyword', type: 'input', placeholder: '按礼物名搜索', clearable: true },
  {
    label: '标签',
    key: 'tag',
    type: 'select',
    props: {
      placeholder: '全部标签',
      options: [
        { label: '全部标签', value: 'all' },
        { label: '未映射', value: 'unmapped' },
        { label: '已映射', value: 'mapped' }
      ]
    }
  }
]

function handleSearch() {
  keyword.value = formFilters.keyword || ''
  filter.value = (formFilters.tag || 'all') as 'all' | 'unmapped' | 'mapped'
  page.value = 1
  reload()
}

function handleReset() {
  formFilters.keyword = ''
  formFilters.tag = 'all'
  handleSearch()
}

const keyword = ref('')
const filter = ref<'all' | 'unmapped' | 'mapped'>('all')
const syncing = ref(false)

const page = ref(1)
const pageSize = ref(20)

const allCount = ref(0)
const unmappedCount = ref(0)
const mappedCount = ref(0)

/** 已经加载失败的图标（避免 img 一直重试、也避免显示破图） */
const iconFailed = reactive(new Set<string>())

const pagination = computed(() => ({ current: page.value, size: pageSize.value, total: rows.value.length }))
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return rows.value.slice(start, start + pageSize.value)
})

/*
 * 桌面：礼物 / 标签 / 单价 / 操作（礼物个数、钻石总额、场次在「修改」弹窗里看）
 * 手机：标签收进礼物名下面，只留 礼物 / 单价 / 操作 三列，避免横向滚动看不到关键列
 */
const { isMobile } = useIsMobile()
const columns = computed<ColumnOption[]>(() =>
  isMobile.value
    ? [
        { prop: 'gift_name', label: '礼物', minWidth: 130, useSlot: true, slotName: 'gift_name' },
        { prop: 'price', label: '单价', width: 100, align: 'right', useSlot: true, slotName: 'price' },
        { prop: 'actions', label: '操作', width: 72, align: 'left', fixed: 'right', useSlot: true, slotName: 'actions' }
      ]
    : [
        { prop: 'gift_name', label: '礼物', minWidth: 380, useSlot: true, slotName: 'gift_name' },
        { prop: 'tag', label: '标签', width: 130, align: 'center', useSlot: true, slotName: 'tag' },
        { prop: 'price', label: '单价（钻石）', minWidth: 220, align: 'right', useSlot: true, slotName: 'price' },
        { prop: 'actions', label: '操作', width: 88, align: 'left', fixed: 'right', useSlot: true, slotName: 'actions' }
      ]
)

const inconsistentCount = computed(() => rows.value.filter((r) => (r.price_kinds || 0) > 1).length)
const zeroCount = computed(() => rows.value.filter((r) => r.rows > 0 && r.diamonds === 0).length)

function fmtNum(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString('zh-CN')
}


function fmtPrice(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('zh-CN')
}
/** 大数字缩写：3.16亿 / 53.7万 —— 悬停看精确值 */
function fmtBig(n: number | null | undefined) {
  const v = Number(n ?? 0)
  if (v >= 1_0000_0000) return (v / 1_0000_0000).toFixed(2) + ' 亿'
  if (v >= 1_0000) return (v / 1_0000).toFixed(1) + ' 万'
  return v.toLocaleString('zh-CN')
}

/** 历史出现过的单价（最多两个），用 " / " 连起来，带千分位 */
function fmtPriceList(list: number[] | undefined) {
  const arr = (list || []).filter((v) => Number.isFinite(Number(v)))
  return arr.length ? arr.map((v) => fmtPrice(v)).join(' / ') : '—'
}

function fmtVariants(row: { unit_variants?: number[] }) {
  return fmtPriceList(row.unit_variants)
}

/** 当前采用的单价：页面映射 > 代码内置 > 最近一次消息价 */
function currentPrice(row: GiftPriceItem): number {
  if (row.override_price !== null && row.override_price !== undefined) return row.override_price
  if (row.builtin_price !== null && row.builtin_price !== undefined) return row.builtin_price
  if (typeof row.latest_price === 'number' && row.latest_price !== null) return row.latest_price
  if (row.unit_variants?.length) return row.unit_variants[row.unit_variants.length - 1]
  return 0
}

/** 价格来源：页面映射 / 代码内置 / 消息 */
function sourceLabel(row: GiftPriceItem) {
  if (row.override_price !== null) return '页面映射'
  if (row.builtin_price !== null) return '内置'
  return '消息价'
}

/** 已映射 = 页面映射价 或 代码内置价（采集端已经有明确价格） */
function isMapped(row: GiftPriceItem) {
  return row.override_price !== null || row.builtin_price !== null
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await fetchGiftPrices({
      q: keyword.value.trim(),
      only: filter.value === 'all' ? '' : filter.value
    })
    allCount.value = r?.all_total ?? 0
    unmappedCount.value = r?.unmapped_total ?? 0
    mappedCount.value = r?.mapped_total ?? 0
    rows.value = r?.items || []
    const maxPage = Math.max(1, Math.ceil(rows.value.length / pageSize.value))
    if (page.value > maxPage) page.value = maxPage
  } catch (e) {
    rows.value = []
    loadError.value = apiErrorMessage(e, '读取礼物修改失败')
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  load()
}



function onPageChange(p: number) {
  page.value = p
}
function onSizeChange(s: number) {
  pageSize.value = s
  page.value = 1
}

/** 排序在前端整表上做（否则只排当前页） */
function onSortChange({ prop, order }: { prop: string; order: string | null }) {
  if (!prop || !order) return
  const dir = order === 'ascending' ? 1 : -1
  rows.value = [...rows.value].sort((a, b) => (Number(a[prop as keyof GiftPriceItem]) - Number(b[prop as keyof GiftPriceItem])) * dir)
  page.value = 1
}

/* ---------------- 设定单价弹窗 ---------------- */

const editOpen = ref(false)
const editing = ref<GiftPriceItem | null>(null)
const editPrice = ref(0)
const recompute = ref(true)
const savingEdit = ref(false)
const preview = ref<{
  rows: number
  gift_count: number
  old_diamonds: number
  new_diamonds: number
  diff: number
  sessions: number
} | null>(null)

/** 这个礼物有没有历史行（没有就别勾重算，保存只影响之后采集） */
const hasHistory = computed(() => (editing.value?.rows || 0) > 0)

function openEdit(row: GiftPriceItem) {
  editing.value = row
  editPrice.value = currentPrice(row)
  recompute.value = (row.rows || 0) > 0
  preview.value = null
  editOpen.value = true
  refreshPreview()
}

/** 预览"改成这个价会影响多少数据"；只在弹窗打开时请求 */
let previewTimer: ReturnType<typeof setTimeout> | null = null
function refreshPreview() {
  if (!editing.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(async () => {
    const gift = editing.value?.gift_name
    const price = Number(editPrice.value)
    if (!gift || !Number.isFinite(price) || price < 0) return
    try {
      const p = await previewGiftPriceRepair(gift, price)
      if (editing.value?.gift_name === gift) preview.value = p
    } catch {
      /* 预览失败不打扰用户，保存时后端还会再算一次 */
    }
  }, 250)
}

/**
 * 保存：
 *   · 勾了「同时重算历史」→ /api/gift-prices/repair（内部会先写映射表，再改历史、逐场重建）
 *   · 没勾 → /api/gift-prices（只写映射表，只影响之后采集）
 * 两条路都会写映射表，所以"下次抓到的价是对的"这件事不依赖是否重算。
 */
async function saveEdit() {
  const row = editing.value
  if (!row) return
  const price = Number(editPrice.value)
  if (!Number.isFinite(price) || price < 0) {
    ElMessage.warning('单价必须是不小于 0 的数字')
    return
  }
  savingEdit.value = true
  const doRecompute = recompute.value && hasHistory.value
  const svc = doRecompute
    ? ElLoading.service({
        lock: true,
        text: `正在保存并重算「${row.gift_name}」的历史…`,
        background: 'rgba(0,0,0,.35)'
      })
    : null
  try {
    if (doRecompute) {
      const r = await repairGiftPrice({ giftName: row.gift_name, diamondPerUnit: price })
      const failed = r?.failed?.length || 0
      if (failed > 0) {
        ElMessage.warning(`单价已保存，但有 ${failed} 个场次重算失败（见后端日志）`)
      } else {
        ElMessage.success(
          `已存为 ${fmtPrice(price)}，重算 ${fmtNum(r?.updated_rows || 0)} 条历史 / ${fmtNum(
            r?.rebuilt_sessions || 0
          )} 个场次，用时 ${Math.round((r?.elapsed_ms || 0) / 1000)} 秒`
        )
      }
    } else {
      await saveGiftPrice({ giftName: row.gift_name, diamondPerUnit: price })
      ElMessage.success(`已存为 ${fmtPrice(price)}（映射已生效，之后采集到的该礼物按新价计算）`)
    }
    editOpen.value = false
    await load()
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '保存失败'))
  } finally {
    svc?.close()
    savingEdit.value = false
  }
}


/** 同步单价字段：只回填 diamond_count，金额一分不改，也不触发重算 */
async function syncUnitFields() {
  let p
  try {
    p = await previewGiftPriceUnitSync()
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '读取待同步数量失败'))
    return
  }
  if (!p || p.total_rows === 0) {
    ElMessage.success('没有需要同步的行，单价字段已经和总价一致')
    return
  }
  const sample = (p.items || [])
    .slice(0, 5)
    .map((it) => `· ${it.gift_name}：${it.rows} 行，${it.from_min}${it.from_min === it.from_max ? '' : '~' + it.from_max} → ${it.to_unit}`)
    .join('\n')
  try {
    await ElMessageBox.confirm(
      `有 ${p.total_rows} 行（${p.gifts} 个礼物）的单价字段和总价不一致。\n\n` +
        sample +
        (p.items.length > 5 ? '\n· …' : '') +
        `\n\n会把这些行的 diamond_count 按「总价 ÷ 个数」回填；金额一分不改，也不触发重算。`,
      '同步单价字段',
      { type: 'info', confirmButtonText: '开始同步', cancelButtonText: '取消', customClass: 'repair-confirm' }
    )
  } catch {
    return
  }
  syncing.value = true
  try {
    const r = await syncGiftPriceUnitFields()
    ElMessage.success(`已同步 ${r.updated_rows} 行的单价字段（金额未变）`)
    await load()
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '同步失败'))
  } finally {
    syncing.value = false
  }
}

onMounted(load)

  

</script>

<style scoped>
/* 概览卡：电脑端把顶部填满，四个数字一眼看完 */
.gift-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}
.gift-stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: var(--dy-radius-xl);
  background: var(--art-gray-100);
}
.gift-stat__label {
  font-size: 12px;
  color: var(--art-gray-500);
}
.gift-stat__value {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--art-gray-900);
  font-variant-numeric: tabular-nums;
}
.gift-stat__value--warn {
  color: var(--el-color-warning);
}
.gift-stat__value--ok {
  color: var(--el-color-success);
}

@media (max-width: 767px) {
  .gift-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .gift-stat__value {
    font-size: 18px;
  }
}

/* 「修改」按钮：浅主题底 + 圆角，比纯文字按钮更像一个可点的操作 */
.el-button.edit-btn {
  height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dy-radius-md);
  background: color-mix(in srgb, var(--theme-color) 10%, transparent);
  color: var(--theme-color);
  font-weight: 500;
}
.el-button.edit-btn:hover {
  background: color-mix(in srgb, var(--theme-color) 18%, transparent);
  color: var(--theme-color);
}


/* 礼物图标：28px 圆角小图，缺图时用淡底 + 通用礼物图标兜底 */
.gift-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--dy-radius-md);
  object-fit: cover;
  background: var(--art-gray-100);
  flex-shrink: 0;
}
.gift-icon--lg {
  width: 40px;
  height: 40px;
  border-radius: var(--dy-radius-lg);
}
.gift-icon--empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--art-gray-400);
  font-size: 16px;
}

/* 影响面预览盒 */
.preview-box {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--dy-radius-lg);
  background: var(--art-gray-100);
}

/* 窄屏单元格内边距收一点，避免「修改」按钮把 cell 撑出省略号小点 */
@media (max-width: 767px) {
  :deep(.el-table .cell) {
    padding-left: 8px;
    padding-right: 8px;
  }
}

/* 确认框里的换行要生效（ElMessageBox 默认把 \n 压成空格） */
:global(.repair-confirm .el-message-box__message) {
  white-space: pre-line;
}
/* 礼物名下面那行统计小字 */
.gift-meta {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--art-gray-500);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 电脑端：行高、图标、字号放大一点，页面不至于空 */
@media (min-width: 768px) {
  .gift-table :deep(.el-table td .cell) {
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .gift-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--dy-radius-md);
  }
  .gift-name {
    font-size: 15px;
  }
  .price-main {
    font-size: 16px;
  }
}
</style>

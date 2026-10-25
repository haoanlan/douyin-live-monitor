<!--
  礼物价格管理（/douyin/gift-prices）。

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
  <div class="douyin-page dy-stagger p-4">
    <article class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-lg font-semibold text-g-900 m-0">礼物价格</h3>
          <p class="mt-1 mb-0 text-sm leading-6 text-g-600">
            改价会写入映射表，<b class="font-medium text-g-800">之后采集到的该礼物按新价计算</b>（约 10 秒内生效）；
            勾选「同时重算历史数据」还会把已有的历史记录和总价一起改掉。
          </p>
        </div>
      </div>

      <!-- 标签页：未映射 / 已映射 -->
      <el-tabs v-model="tab" class="mt-2" @tab-change="onTabChange">
        <el-tab-pane name="unmapped">
          <template #label>
            <span>未映射</span>
            <span class="ml-1 text-xs text-g-500">{{ unmappedCount }}</span>
          </template>
        </el-tab-pane>
        <el-tab-pane name="mapped">
          <template #label>
            <span>已映射</span>
            <span class="ml-1 text-xs text-g-500">{{ mappedCount }}</span>
          </template>
        </el-tab-pane>
      </el-tabs>

      <!-- 工具条 -->
      <div class="flex flex-wrap items-center gap-3">
        <el-input
          v-model="keyword"
          placeholder="按礼物名搜索"
          clearable
          class="!w-[240px]"
          @keyup.enter="reload"
          @clear="reload"
        >
          <template #prefix><ArtSvgIcon icon="ri:search-line" /></template>
        </el-input>

        <el-button :loading="loading" @click="reload">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
          刷新
        </el-button>

        <el-tooltip
          content="历史上只改了总价、没改单价字段的行，这里按总价把单价回填。不改任何金额。"
          placement="bottom"
        >
          <el-button :loading="syncing" @click="syncUnitFields">
            <ArtSvgIcon icon="ri:price-tag-3-line" class="mr-1" />
            同步单价字段
          </el-button>
        </el-tooltip>

        <span class="text-xs text-g-500">
          当前列表 {{ rows.length }} 个礼物
          <span v-if="inconsistentCount" class="ml-2">· 历史单价不一致 {{ inconsistentCount }}</span>
          <span v-if="zeroCount" class="ml-2">· 钻石为 0 {{ zeroCount }}</span>
        </span>
      </div>

      <el-alert
        v-if="loadError"
        class="mt-4"
        type="error"
        :title="loadError"
        show-icon
        :closable="false"
      >
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
        class="mt-2"
        @pagination:size-change="onSizeChange"
        @pagination:current-change="onPageChange"
        @sort-change="onSortChange"
      >
        <!-- 礼物名：图标 + 名字 + 价格来源 -->
        <template #gift_name="{ row }">
          <div class="flex min-w-0 items-center gap-2">
            <img
              v-if="row.icon_url && !iconFailed.has(row.gift_name)"
              :src="row.icon_url"
              class="gift-icon"
              alt=""
              loading="lazy"
              @error="iconFailed.add(row.gift_name)"
            />
            <span v-else class="gift-icon gift-icon--empty">
              <ArtSvgIcon icon="ri:gift-line" />
            </span>
            <span class="truncate font-medium text-g-900">{{ row.gift_name }}</span>
            <el-tag size="small" :type="sourceTagType(row)" effect="light" class="shrink-0">
              {{ sourceLabel(row) }}
            </el-tag>
          </div>
        </template>

        <!-- 单价：当前采用的价 + 历史出现过的价（最多两种） -->
        <template #price="{ row }">
          <div class="flex flex-col items-end leading-tight">
            <span class="tabular-nums font-semibold text-g-900">{{ fmtPrice(currentPrice(row)) }}</span>
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

        <template #gift_count="{ row }">
          <span class="tabular-nums text-g-700">{{ fmtNum(row.gift_count) }}</span>
        </template>

        <template #diamonds="{ row }">
          <span class="tabular-nums font-medium text-g-900" :title="fmtNum(row.diamonds)">{{ fmtBig(row.diamonds) }}</span>
        </template>

        <!-- 操作：修改（弹窗）/ 恢复默认 -->
        <template #actions="{ row }">
          <el-button size="small" text type="primary" @click="openEdit(row)">
            <ArtSvgIcon icon="ri:edit-line" class="mr-1" />
            修改
          </el-button>
          <el-tooltip v-if="row.override_price !== null" content="恢复默认价（不影响历史）" placement="top">
            <ArtButtonTable type="delete" icon="ri:arrow-go-back-line" @click="resetOne(row)" />
          </el-tooltip>
        </template>
      </ArtTable>
    </article>

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
              {{ sourceLabel(editing) }} · 历史 {{ fmtNum(editing.rows) }} 行 / {{ fmtNum(editing.gift_count) }} 个 /
              {{ fmtNum(editing.diamonds) }} 钻石
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
        <el-button type="primary" :loading="savingEdit" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import type { ColumnOption } from '@/types'
import {
  deleteGiftPrice,
  fetchGiftPrices,
  previewGiftPriceRepair,
  previewGiftPriceUnitSync,
  repairGiftPrice,
  saveGiftPrice,
  syncGiftPriceUnitFields,
  type GiftPriceItem
} from '@/api/douyin'
import { apiErrorMessage } from '@/utils/douyin-error'

defineOptions({ name: 'DouyinGiftPrices' })

const rows = ref<GiftPriceItem[]>([])
const loading = ref(false)
const loadError = ref('')
const keyword = ref('')
const tab = ref('unmapped')
const syncing = ref(false)

const page = ref(1)
const pageSize = ref(20)

const unmappedCount = ref(0)
const mappedCount = ref(0)

/** 已经加载失败的图标（避免 img 一直重试、也避免显示破图） */
const iconFailed = reactive(new Set<string>())

const pagination = computed(() => ({ current: page.value, size: pageSize.value, total: rows.value.length }))
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return rows.value.slice(start, start + pageSize.value)
})

const columns: ColumnOption[] = [
  { prop: 'gift_name', label: '礼物', minWidth: 260, useSlot: true, slotName: 'gift_name' },
  { prop: 'price', label: '单价（钻石）', width: 170, align: 'right', useSlot: true, slotName: 'price' },
  {
    prop: 'gift_count',
    label: '礼物个数',
    width: 110,
    align: 'right',
    sortable: 'custom',
    useSlot: true,
    slotName: 'gift_count'
  },
  { prop: 'diamonds', label: '钻石总额', width: 150, align: 'right', sortable: 'custom', useSlot: true, slotName: 'diamonds' },
  { prop: 'sessions', label: '场次', width: 90, align: 'right', sortable: 'custom' },
  { prop: 'actions', label: '操作', width: 150, align: 'right', fixed: 'right', useSlot: true, slotName: 'actions' }
]

const inconsistentCount = computed(() => rows.value.filter((r) => (r.price_kinds || 0) > 1).length)
const zeroCount = computed(() => rows.value.filter((r) => r.rows > 0 && r.diamonds === 0).length)

function fmtNum(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString('zh-CN')
}

/** 大数字缩写：3.16亿 / 53.7万 —— 悬停看精确值 */
function fmtBig(n: number | null | undefined) {
  const v = Number(n ?? 0)
  if (v >= 1_0000_0000) return (v / 1_0000_0000).toFixed(2) + ' 亿'
  if (v >= 1_0000) return (v / 1_0000).toFixed(1) + ' 万'
  return v.toLocaleString('zh-CN')
}

function fmtPrice(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('zh-CN')
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

function sourceTagType(row: GiftPriceItem): 'success' | 'primary' | 'warning' {
  if (row.override_price !== null) return 'success'
  if (row.builtin_price !== null) return 'primary'
  return 'warning'
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await fetchGiftPrices({
      q: keyword.value.trim(),
      only: tab.value === 'mapped' ? 'mapped' : 'unmapped'
    })
    unmappedCount.value = r?.unmapped_total ?? 0
    mappedCount.value = r?.mapped_total ?? 0
    rows.value = r?.items || []
    const maxPage = Math.max(1, Math.ceil(rows.value.length / pageSize.value))
    if (page.value > maxPage) page.value = maxPage
  } catch (e) {
    rows.value = []
    loadError.value = apiErrorMessage(e, '读取礼物价格失败')
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  load()
}

/** 切标签 = 换 only 参数；用事件参数，别读 tab.value（tab-change 可能早于 v-model 更新） */
function onTabChange(name: string | number) {
  page.value = 1
  tab.value = name === 'mapped' ? 'mapped' : 'unmapped'
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

/** 恢复默认：删掉映射价 —— 只影响之后的采集，历史不动 */
async function resetOne(row: GiftPriceItem) {
  try {
    await ElMessageBox.confirm(
      `恢复「${row.gift_name}」的默认价？之后采集会回到「内置价 / 消息里的价」。历史数据不受影响。`,
      '恢复默认价',
      { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await deleteGiftPrice(row.gift_name)
    ElMessage.success('已恢复默认')
    await load()
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '恢复失败'))
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
/* 礼物图标：28px 圆角小图，缺图时用淡底 + 通用礼物图标兜底 */
.gift-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--art-gray-100);
  flex-shrink: 0;
}
.gift-icon--lg {
  width: 40px;
  height: 40px;
  border-radius: 10px;
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
  border-radius: 10px;
  background: var(--art-gray-100);
}

/* 确认框里的换行要生效（ElMessageBox 默认把 \n 压成空格） */
:global(.repair-confirm .el-message-box__message) {
  white-space: pre-line;
}
</style>

<!--
  礼物价格管理。

  设计目标（用户定的逻辑，越简单越好）：
    · 每个礼物只有**一个「单价」**——这个礼物的权威价；
    · 默认值取"数据里最近一次采集到的价"，看着不对直接在行内改；
    · 保存 → 写进 gift_price_overrides → **下次采集按新价写入**（最多 10 秒生效）；
    · 历史数据默认不动；确实要改历史再点「重算历史」（慢，要逐场重建预聚合）。

  采集时的价格优先级（lib/worker/message-handler.js）：
    消息里的 diamondCount < 工坊宝箱融合计价 < 内置表 < **本页面的覆盖价**

  版式用项目自带的 ArtDesignPro 组件（全局注册，不用 import）：
    ArtTable（带表头背景/斑马纹/分页/空态的封装）+ ArtButtonTable（表格操作图标按钮）
-->
<template>
  <div class="douyin-page dy-stagger p-4">
    <article class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-lg font-semibold text-g-900 m-0">礼物价格</h3>
          <p class="mt-1 mb-0 text-sm leading-6 text-g-600">
            每个礼物一个单价。改了保存，<b>下次采集</b>就按新价写入；历史数据默认不动，需要时再点「重算历史」。
          </p>
        </div>
      </div>

      <!-- 工具条 -->
      <div class="mt-4 flex flex-wrap items-center gap-3">
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

        <el-select v-model="only" placeholder="全部礼物" class="!w-[170px]" @change="reload">
          <el-option label="全部礼物" value="" />
          <el-option label="已设置的价" value="override" />
          <el-option label="历史价不一致" value="anomaly" />
          <el-option label="钻石为 0" value="zero" />
        </el-select>

        <el-button :loading="loading" @click="reload">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
          刷新
        </el-button>

        <span class="text-xs text-g-500">
          共 {{ rows.length }} 个礼物
          <span v-if="overriddenCount" class="ml-2">· 已设价 {{ overriddenCount }}</span>
          <span v-if="inconsistentCount" class="ml-2">· 历史不一致 {{ inconsistentCount }}</span>
          <span v-if="zeroCount" class="ml-2">· 钻石为 0 {{ zeroCount }}</span>
        </span>
      </div>

      <!-- 错误态：不能静默 -->
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

      <!-- ArtDesignPro 的表格封装：自带表头背景、斑马纹、空态、分页 -->
      <ArtTable
        :data="pagedRows"
        :columns="columns"
        :loading="loading"
        :pagination="pagination"
        :show-table-header="false"
        row-key="gift_name"
        empty-text="没有匹配的礼物"
        class="mt-4"
        @pagination:size-change="onSizeChange"
        @pagination:current-change="onPageChange"
        @sort-change="onSortChange"
      >
        <!-- 礼物名 + 状态标签 -->
        <template #gift_name="{ row }">
          <span class="font-medium text-g-900">{{ row.gift_name }}</span>
          <el-tag v-if="row.override_price !== null" size="small" type="success" effect="plain" class="ml-2">
            已设价
          </el-tag>
          <el-tag
            v-else-if="row.price_kinds > 1"
            size="small"
            type="warning"
            effect="plain"
            class="ml-2"
            :title="'历史数据里实际按 ' + row.eff_min_unit + ' 和 ' + row.eff_max_unit + ' 两种单价记过账'"
          >
            历史价 {{ row.eff_max_unit }} / {{ row.eff_min_unit }}
          </el-tag>
        </template>

        <!-- 数字列：千分位，避免 316260000 这种读不出来 -->
        <template #gift_count="{ row }">
          <span class="tabular-nums text-g-700">{{ fmtNum(row.gift_count) }}</span>
        </template>

        <template #diamonds="{ row }">
          <span class="tabular-nums font-medium text-g-900" :title="fmtNum(row.diamonds)">{{ fmtBig(row.diamonds) }}</span>
        </template>

        <!-- 唯一的价格列：可编辑 -->
        <template #price="{ row }">
          <el-input-number
            v-model="row.price"
            :min="0"
            :step="1"
            :precision="0"
            :controls="false"
            size="small"
            class="price-input !w-[120px]"
          />
        </template>

        <!-- 操作：图标按钮（ArtDesignPro 表格的标准样式） -->
        <template #actions="{ row }">
          <el-tooltip content="保存这个单价" placement="top">
            <ArtButtonTable
              icon="ri:save-3-line"
              icon-class="bg-theme/12 text-theme"
              :class="!isDirty(row) || saving === row.gift_name ? 'opacity-40 pointer-events-none' : ''"
              @click="save(row)"
            />
          </el-tooltip>
          <el-tooltip v-if="row.override_price !== null" content="恢复默认价" placement="top">
            <ArtButtonTable
              type="delete"
              icon="ri:arrow-go-back-line"
              @click="resetOne(row)"
            />
          </el-tooltip>
          <el-tooltip content="用当前单价重算历史数据" placement="top">
            <ArtButtonTable
              icon="ri:calculator-line"
              icon-class="bg-warning/12 text-warning"
              @click="repair(row)"
            />
          </el-tooltip>
        </template>
      </ArtTable>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ColumnOption } from '@/types'
import {
  deleteGiftPrice,
  fetchGiftPrices,
  previewGiftPriceRepair,
  repairGiftPrice,
  saveGiftPrice,
  type GiftPriceItem
} from '@/api/douyin'
import { apiErrorMessage } from '@/utils/douyin-error'

defineOptions({ name: 'DouyinGiftPrices' })

/** 行数据 + 两个页面态字段：price 是输入框的值，savedPrice 是"上次保存后的值"（用来判断脏） */
type Row = GiftPriceItem & { price: number; savedPrice: number }

const rows = ref<Row[]>([])
const loading = ref(false)
const loadError = ref('')
const keyword = ref('')
const only = ref<'' | 'override' | 'anomaly' | 'zero'>('')
/** 正在保存/重算的礼物名（按行显示禁用态） */
const saving = ref('')

/** 分页（前端切片，不用后端分页：689 个礼物名字一次取完更快） */
const page = ref(1)
const pageSize = ref(20)

const pagination = computed(() => ({
  current: page.value,
  size: pageSize.value,
  total: rows.value.length
}))

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return rows.value.slice(start, start + pageSize.value)
})

/**
 * 列定义走 ArtDesignPro 的 columns 渲染方式：
 * 需要自定义内容的列标 useSlot + slotName，模板里用 #<slotName> 提供。
 */
const columns: ColumnOption[] = [
  { prop: 'gift_name', label: '礼物名', minWidth: 220, useSlot: true, slotName: 'gift_name' },
  { prop: 'price', label: '单价（钻石）', width: 170, align: 'right', useSlot: true, slotName: 'price' },
  { prop: 'gift_count', label: '礼物个数', width: 110, align: 'right', sortable: 'custom', useSlot: true, slotName: 'gift_count' },
  { prop: 'diamonds', label: '钻石总额', width: 150, align: 'right', sortable: 'custom', useSlot: true, slotName: 'diamonds' },
  { prop: 'sessions', label: '场次', width: 90, align: 'right', sortable: 'custom' },
  { prop: 'actions', label: '操作', width: 160, align: 'right', fixed: 'right', useSlot: true, slotName: 'actions' }
]

const overriddenCount = computed(() => rows.value.filter((r) => r.override_price !== null).length)
const inconsistentCount = computed(() => rows.value.filter((r) => (r.price_kinds || 1) > 1).length)
const zeroCount = computed(() => rows.value.filter((r) => r.rows > 0 && r.diamonds === 0).length)

function fmtNum(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString('zh-CN')
}

/** 大数字缩写：3.16亿 / 53.7万 / 9,999 —— 表格里比一长串数字好读，悬停看精确值 */
function fmtBig(n: number | null | undefined) {
  const v = Number(n ?? 0)
  if (v >= 1_0000_0000) return (v / 1_0000_0000).toFixed(2) + ' 亿'
  if (v >= 1_0000) return (v / 1_0000).toFixed(1) + ' 万'
  return v.toLocaleString('zh-CN')
}

/** 单价列的初始值：覆盖价 > 最近一次采集价 > 内置价 > 0 */
function initialPrice(it: GiftPriceItem): number {
  if (it.override_price !== null && it.override_price !== undefined) return it.override_price
  if (typeof it.latest_price === 'number') return it.latest_price
  if (it.builtin_price !== null && it.builtin_price !== undefined) return it.builtin_price
  return 0
}

function isDirty(row: Row) {
  return Number(row.price) !== Number(row.savedPrice)
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await fetchGiftPrices({ q: keyword.value.trim(), only: only.value })
    rows.value = (r?.items || []).map((it) => {
      const p = initialPrice(it)
      return { ...it, price: p, savedPrice: p }
    })
    // 筛选后行数变少时，当前页可能越界
    const maxPage = Math.max(1, Math.ceil(rows.value.length / pageSize.value))
    if (page.value > maxPage) page.value = maxPage
  } catch (e) {
    rows.value = []
    loadError.value = apiErrorMessage(e, '读取礼物价格失败')
  } finally {
    loading.value = false
  }
}

/** 搜索/筛选变化：回到第一页再查 */
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
  rows.value = [...rows.value].sort((a, b) => (Number(a[prop as keyof Row]) - Number(b[prop as keyof Row])) * dir)
  page.value = 1
}

/** 保存单价：只写覆盖表，影响之后的采集；不动历史 */
async function save(row: Row) {
  const price = Number(row.price)
  if (!Number.isFinite(price) || price < 0) {
    ElMessage.warning('单价必须是不小于 0 的数字')
    return
  }
  saving.value = row.gift_name
  try {
    await saveGiftPrice({ giftName: row.gift_name, diamondPerUnit: price })
    row.override_price = price
    row.savedPrice = price
    ElMessage.success(`「${row.gift_name}」单价已存为 ${price}，下次采集按这个写入`)
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '保存失败'))
  } finally {
    saving.value = ''
  }
}

/** 恢复默认：删掉覆盖价，回退到内置价/消息价 */
async function resetOne(row: Row) {
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

/**
 * 重算历史：把该礼物**已有的**记录改成当前输入框里的价，并逐场重建预聚合。
 * 先给预览（多少行、多少场次、钻石总额怎么变），用户确认后才执行 —— 这个操作慢且不可撤销。
 */
async function repair(row: Row) {
  const price = Number(row.price)
  if (!Number.isFinite(price) || price < 0) {
    ElMessage.warning('单价必须是不小于 0 的数字')
    return
  }
  let preview
  try {
    preview = await previewGiftPriceRepair(row.gift_name, price)
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '计算影响失败'))
    return
  }
  if (!preview || preview.rows === 0) {
    ElMessage.info('这个礼物还没有历史记录，不用重算')
    return
  }
  const diff = preview.diff
  const diffText = `${diff >= 0 ? '+' : ''}${fmtNum(diff)}`
  try {
    await ElMessageBox.confirm(
      `用 ${price} 重算「${row.gift_name}」的历史记录？\n\n` +
        `· 更新 ${fmtNum(preview.rows)} 条记录，涉及 ${preview.sessions} 个场次\n` +
        `· 钻石总额：${fmtNum(preview.old_diamonds)} → ${fmtNum(preview.new_diamonds)}（${diffText}）\n` +
        `· 会逐场重建该场次的汇总、礼物排行、主播排行、时间线\n\n` +
        `耗时会随场次数增加（几十场可能 1 分钟），执行期间别关页面。`,
      '重算历史数据',
      { type: 'warning', confirmButtonText: '开始重算', cancelButtonText: '取消', customClass: 'repair-confirm' }
    )
  } catch {
    return
  }
  saving.value = row.gift_name
  try {
    const r = await repairGiftPrice({ giftName: row.gift_name, diamondPerUnit: price })
    const failed = r?.failed?.length || 0
    if (failed > 0) {
      ElMessage.warning(`已更新 ${r.updated_rows} 条，但 ${failed} 个场次重建失败（见后端日志）`)
    } else {
      ElMessage.success(
        `已重算 ${r.updated_rows} 条记录、${r.rebuilt_sessions} 个场次，用时 ${Math.round((r.elapsed_ms || 0) / 1000)} 秒`
      )
    }
    await load()
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '重算失败'))
  } finally {
    saving.value = ''
  }
}

onMounted(load)
</script>

<style scoped>
/*
  单价输入框：默认"隐形"（无边框、无背景），hover/focus 才显形。
  表格里 689 行如果每行都是明显的输入框，视觉噪音太大（用户反馈"太丑"）。
*/
.price-input :deep(.el-input__wrapper) {
  padding-left: 8px;
  padding-right: 8px;
  background: transparent;
  box-shadow: none;
  transition: box-shadow 0.16s, background-color 0.16s;
}
.price-input :deep(.el-input__wrapper:hover) {
  background: var(--el-fill-color-light);
}
.price-input :deep(.el-input__wrapper.is-focus) {
  background: var(--el-bg-color);
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}
.price-input :deep(.el-input__inner) {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
/* 重算确认框里的换行要生效（ElMessageBox 默认把 \n 压成空格） */
:global(.repair-confirm .el-message-box__message) {
  white-space: pre-line;
}
</style>

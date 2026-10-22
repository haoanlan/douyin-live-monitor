<!--
  礼物价格管理。

  ## 逻辑（用户定的，越简单越好）

  单价就是单价，**不是算出来的**：

    单价 = 映射表里的价（有映射 → 这就是"已改价"）
         ?? 最近一条礼物消息里的价（diamond_count，没有映射时就用它）

  改单价 = 保存映射 + **立即重算**该礼物所有历史记录与总价
  （把 gifts 里这些行的 diamond_count / total_diamonds 改成新价，
    再逐场重建汇总、礼物排行、主播排行、时间线）
  —— 所以不再有单独的「重算历史」按钮。

  页面用标签页区分：**全部礼物** / **已改价**（就是有映射的那些），
  不再用行内 tag 表示"已设价"。

  采集时的价格优先级（lib/worker/message-handler.js）：
    消息里的 diamondCount < 工坊宝箱融合计价 < 内置表 < **本页面的映射价**

  版式用项目自带的 ArtDesignPro 组件（全局注册，不用 import）。
-->
<template>
  <div class="douyin-page dy-stagger p-4">
    <article class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-lg font-semibold text-g-900 m-0">礼物价格</h3>
          <p class="mt-1 mb-0 text-sm leading-6 text-g-600">
            有映射价的礼物会按映射价采集；改了单价会立即重算该礼物的全部历史记录与总价。
          </p>
        </div>
      </div>

      <!-- 标签页：全部 / 已改价 -->
      <el-tabs v-model="tab" class="mt-2" @tab-change="onTabChange">
        <el-tab-pane name="all">
          <template #label>
            <span>全部礼物</span>
            <span class="ml-1 text-xs text-g-500">{{ allCount }}</span>
          </template>
        </el-tab-pane>
        <el-tab-pane name="override">
          <template #label>
            <span>已设价</span>
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
          共 {{ rows.length }} 个礼物
          <span v-if="inconsistentCount" class="ml-2">· 历史单价不一致 {{ inconsistentCount }}</span>
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
        <!-- 礼物名 + 少量提示（"已改价" 本身用标签页表达，这里不再重复标签） -->
        <template #gift_name="{ row }">
          <div class="flex items-center gap-2">
            <span class="font-medium text-g-900">{{ row.gift_name }}</span>
            <el-tooltip
              v-if="row.price_kinds > 1"
              :content="`历史数据里实际按 ${row.eff_min_unit} 和 ${row.eff_max_unit} 两种单价记过账`"
              placement="top"
            >
              <ArtSvgIcon icon="ri:error-warning-line" class="text-warning" />
            </el-tooltip>
          </div>
        </template>

        <!-- 单价：可编辑 -->
        <template #price="{ row }">
          <div class="flex items-center justify-end gap-2">
            <span class="text-[11px] text-g-400">{{ sourceLabel(row) }}</span>
            <el-input-number
              v-model="row.price"
              :min="0"
              :step="1"
              :precision="0"
              :controls="false"
              size="small"
              class="price-input !w-[110px]"
            />
          </div>
        </template>

        <template #gift_count="{ row }">
          <span class="tabular-nums text-g-700">{{ fmtNum(row.gift_count) }}</span>
        </template>

        <template #diamonds="{ row }">
          <span class="tabular-nums font-medium text-g-900" :title="fmtNum(row.diamonds)">{{ fmtBig(row.diamonds) }}</span>
        </template>

        <!-- 操作：保存（保存即重算）、恢复默认 -->
        <template #actions="{ row }">
          <el-tooltip content="保存单价，并重算该礼物的全部历史" placement="top">
            <ArtButtonTable
              icon="ri:save-3-line"
              icon-class="bg-theme/12 text-theme"
              :class="!isDirty(row) || saving === row.gift_name ? 'opacity-40 pointer-events-none' : ''"
              @click="save(row)"
            />
          </el-tooltip>
          <el-tooltip v-if="row.override_price !== null" content="恢复默认价（不影响历史）" placement="top">
            <ArtButtonTable type="delete" icon="ri:arrow-go-back-line" @click="resetOne(row)" />
          </el-tooltip>
        </template>
      </ArtTable>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import type { ColumnOption } from '@/types'
import {
  deleteGiftPrice,
  fetchGiftPrices,
  previewGiftPriceUnitSync,
  repairGiftPrice,
  saveGiftPrice,
  syncGiftPriceUnitFields,
  type GiftPriceItem
} from '@/api/douyin'
import { apiErrorMessage } from '@/utils/douyin-error'

defineOptions({ name: 'DouyinGiftPrices' })

/** 行数据 + 页面态字段：price 输入框的值，savedPrice 上次保存后的值（判断脏） */
type Row = GiftPriceItem & { price: number; savedPrice: number }

const rows = ref<Row[]>([])
const loading = ref(false)
const loadError = ref('')
const keyword = ref('')
/** 标签页：全部 / 已改价（= 有映射价） */
const tab = ref<'all' | 'override'>('all')
/** 正在保存/重算的礼物名 */
const saving = ref('')
const syncing = ref(false)

const page = ref(1)
const pageSize = ref(20)

const pagination = computed(() => ({ current: page.value, size: pageSize.value, total: rows.value.length }))
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return rows.value.slice(start, start + pageSize.value)
})

const columns: ColumnOption[] = [
  { prop: 'gift_name', label: '礼物名', minWidth: 220, useSlot: true, slotName: 'gift_name' },
  { prop: 'price', label: '单价（钻石）', width: 170, align: 'right', useSlot: true, slotName: 'price' },
  { prop: 'gift_count', label: '礼物个数', width: 110, align: 'right', sortable: 'custom', useSlot: true, slotName: 'gift_count' },
  { prop: 'diamonds', label: '钻石总额', width: 150, align: 'right', sortable: 'custom', useSlot: true, slotName: 'diamonds' },
  { prop: 'sessions', label: '场次', width: 90, align: 'right', sortable: 'custom' },
  { prop: 'actions', label: '操作', width: 130, align: 'right', fixed: 'right', useSlot: true, slotName: 'actions' }
]

/* 两个标签的计数来自后端（过滤前算好的），不能用 rows.length —— 那是当前筛选结果 */
const allCount = ref(0)
const mappedCount = ref(0)
const inconsistentCount = computed(() => rows.value.filter((r) => (r.price_kinds || 1) > 1).length)
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

/** 单价：映射价优先，否则用最近一条消息里的价；都没有再退回内置价 */
function initialPrice(it: GiftPriceItem): number {
  if (it.override_price !== null && it.override_price !== undefined) return it.override_price
  // 内置表（lib/gift-price-builtin.js）也是"映射价"，优先于消息价
  if (it.builtin_price !== null && it.builtin_price !== undefined) return it.builtin_price
  if (typeof it.latest_price === 'number' && it.latest_price !== null) return it.latest_price
  return 0
}

/** 单价来源标签：已改（覆盖）/ 内置（代码表）/ 消息 */
function sourceLabel(row: Row) {
  if (row.override_price !== null) return '已改'
  if (row.builtin_price !== null && row.builtin_price !== undefined) return '内置'
  return '消息'
}

function isDirty(row: Row) {
  return Number(row.price) !== Number(row.savedPrice)
}

async function load(onlyOverride?: '' | 'mapped') {
  loading.value = true
  loadError.value = ''
  try {
    const only = onlyOverride !== undefined ? onlyOverride : tab.value === 'override' ? 'mapped' : ''
    const r = await fetchGiftPrices({ q: keyword.value.trim(), only: only as '' | 'override' })
    allCount.value = r?.all_total ?? (r?.items || []).length
    mappedCount.value = r?.mapped_total ?? 0
    rows.value = (r?.items || []).map((it) => {
      const p = initialPrice(it)
      return { ...it, price: p, savedPrice: p }
    })
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

/**
 * 切标签页 = 换筛选条件（已改价 = only=override）。
 * 注意：Element Plus 的 tab-change 可能在 v-model 更新前触发，所以这里用事件参数，
 * 不要读 tab.value —— 否则会拿到旧值（实测切到「已改价」仍然查到 689 条）。
 */
function onTabChange(name: string | number) {
  page.value = 1
  tab.value = name === 'override' ? 'override' : 'all'
  load(tab.value === 'override' ? 'mapped' : '')
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

/**
 * 保存单价 = 写映射 + **立即重算该礼物的全部历史与总价**。
 *
 * 重算会逐场重建预聚合（场次汇总 / 礼物排行 / 主播排行 / 时间线），
 * 场次多的时候要几十秒，所以这里用全屏 loading 而不是行内 loading —— 避免用户以为卡死又点一次。
 */
async function save(row: Row) {
  const price = Number(row.price)
  if (!Number.isFinite(price) || price < 0) {
    ElMessage.warning('单价必须是不小于 0 的数字')
    return
  }
  saving.value = row.gift_name
  const svc = ElLoading.service({ lock: true, text: `正在保存并重算「${row.gift_name}」的历史…`, background: 'rgba(0,0,0,.35)' })
  try {
    await saveGiftPrice({ giftName: row.gift_name, diamondPerUnit: price })
    row.override_price = price
    row.price_source = 'override'
    const r = await repairGiftPrice({ giftName: row.gift_name, diamondPerUnit: price })
    const failed = r?.failed?.length || 0
    if (failed > 0) {
      ElMessage.warning(`单价已保存，但有 ${failed} 个场次重算失败（见后端日志）`)
    } else if ((r?.updated_rows || 0) === 0) {
      ElMessage.success(`单价已存为 ${price}（这个礼物还没有历史记录，从下次采集开始生效）`)
    } else {
      ElMessage.success(
        `单价已存为 ${price}，重算 ${r.updated_rows} 条历史记录 / ${r.rebuilt_sessions} 个场次，用时 ${Math.round((r.elapsed_ms || 0) / 1000)} 秒`
      )
    }
    await load()
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '保存失败'))
  } finally {
    svc.close()
    saving.value = ''
  }
}

/** 恢复默认：删掉映射价 —— 只影响之后的采集，历史不动 */
async function resetOne(row: Row) {
  try {
    await ElMessageBox.confirm(
      `恢复「${row.gift_name}」的默认价？之后采集会回到「消息里的价 / 内置价」。历史数据不受影响。`,
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
  let preview
  try {
    preview = await previewGiftPriceUnitSync()
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '读取待同步数量失败'))
    return
  }
  if (!preview || preview.total_rows === 0) {
    ElMessage.success('没有需要同步的行，单价字段已经和总价一致')
    return
  }
  const sample = (preview.items || [])
    .slice(0, 5)
    .map((it) => `· ${it.gift_name}：${it.rows} 行，${it.from_min}${it.from_min === it.from_max ? '' : '~' + it.from_max} → ${it.to_unit}`)
    .join('\n')
  try {
    await ElMessageBox.confirm(
      `有 ${preview.total_rows} 行（${preview.gifts} 个礼物）的单价字段和总价不一致。\n\n` +
        sample +
        (preview.items.length > 5 ? '\n· …' : '') +
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
/*
  单价输入框默认"隐形"：689 行每行一个明显的输入框视觉噪音太大。
  hover 显浅底、focus 显主色描边 —— 一眼能看出是可编辑的数字。
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
/* 确认框里的换行要生效（ElMessageBox 默认把 \n 压成空格） */
:global(.repair-confirm .el-message-box__message) {
  white-space: pre-line;
}
</style>

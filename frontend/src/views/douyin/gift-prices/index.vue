<!--
  礼物价格管理。

  设计目标（用户定的逻辑，越简单越好）：
    · 每个礼物只有**一个「单价」**——就是这个礼物的权威价；
    · 默认值取"数据里最近一次采集到的价"，看着不对直接在行内改；
    · 保存 → 写进 gift_price_overrides → **下次采集按新价写入** gifts（最多 10 秒生效）；
    · 历史数据默认不动；确实要改历史再单独点「重算历史」（慢，要逐场重建预聚合）。

  采集时的价格优先级（lib/worker/message-handler.js）：
    消息里的 diamondCount < 工坊宝箱融合计价 < 内置表 < **本页面的覆盖价**

  版式对齐 Art Design Pro（同 views/system/user-manage）。
-->
<template>
  <div class="douyin-page dy-stagger p-4">
    <article class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-lg font-semibold text-g-900 m-0">礼物价格</h3>
          <p class="mt-1 text-sm leading-6 text-g-600">
            每个礼物一个单价。改了保存，<b>下次采集</b>就按新价写入；历史数据默认不动，需要时再点「重算历史」。
          </p>
        </div>
        <el-button type="primary" @click="load">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" :class="loading ? 'dy-spin' : ''" />
          刷新
        </el-button>
      </div>

      <!-- 工具条 -->
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <el-input
          v-model="keyword"
          placeholder="按礼物名搜索"
          clearable
          class="!w-[240px]"
          @keyup.enter="load"
          @clear="load"
        >
          <template #prefix><ArtSvgIcon icon="ri:search-line" /></template>
        </el-input>

        <el-select v-model="only" placeholder="全部礼物" class="!w-[170px]" @change="load">
          <el-option label="全部礼物" value="" />
          <el-option label="已设置的价" value="override" />
          <el-option label="历史价不一致" value="anomaly" />
          <el-option label="钻石为 0" value="zero" />
        </el-select>

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
          <el-button size="small" class="mt-2" @click="load">重试</el-button>
        </template>
      </el-alert>

      <!--
        窄屏套横滚容器（同 user-manage）：不套时 el-table 表头与表体宽度会分叉，
        右侧保存按钮在手机上点不到。
      -->
      <div class="dy-table-scroll dy-table-scroll--wide">
        <el-table
          v-loading="loading"
          :data="rows"
          class="mt-4"
          row-key="gift_name"
          max-height="calc(100vh - 320px)"
          stripe
          empty-text="没有匹配的礼物"
        >
          <el-table-column prop="gift_name" label="礼物名" min-width="190" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="font-medium text-g-900">{{ row.gift_name }}</span>
              <el-tag v-if="row.override_price !== null" size="small" type="success" effect="plain" class="ml-2">
                已设价
              </el-tag>
              <el-tag v-else-if="row.price_kinds > 1" size="small" type="warning" effect="plain" class="ml-2">
                历史有 {{ row.max_unit }} 与 {{ row.min_unit }}
              </el-tag>
            </template>
          </el-table-column>

          <!-- 唯一的价格列：可编辑 -->
          <el-table-column label="单价（钻石）" width="180" align="right">
            <template #default="{ row }">
              <el-input-number
                v-model="row.price"
                :min="0"
                :step="1"
                :precision="0"
                :controls="false"
                size="small"
                class="!w-[120px] price-input"
              />
            </template>
          </el-table-column>

          <el-table-column label="出现" width="80" align="right">
            <template #default="{ row }"><span class="tabular-nums">{{ fmtNum(row.rows) }}</span></template>
          </el-table-column>

          <el-table-column label="礼物个数" width="96" align="right">
            <template #default="{ row }"><span class="tabular-nums">{{ fmtNum(row.gift_count) }}</span></template>
          </el-table-column>

          <el-table-column label="钻石总额" width="130" align="right">
            <template #default="{ row }">
              <span class="tabular-nums font-medium">{{ fmtNum(row.diamonds) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="场次" width="76" align="right">
            <template #default="{ row }"><span class="tabular-nums">{{ row.sessions }}</span></template>
          </el-table-column>

          <el-table-column label="操作" width="220" align="right" fixed="right">
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                size="small"
                :disabled="!isDirty(row) || saving === row.gift_name"
                :loading="saving === row.gift_name"
                @click="save(row)"
              >
                保存
              </el-button>
              <el-button
                v-if="row.override_price !== null"
                link
                type="info"
                size="small"
                @click="resetOne(row)"
              >
                恢复默认
              </el-button>
              <el-button link type="warning" size="small" @click="repair(row)">重算历史</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
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
/** 正在保存的礼物名（按行显示 loading） */
const saving = ref('')

const overriddenCount = computed(() => rows.value.filter((r) => r.override_price !== null).length)
const inconsistentCount = computed(() => rows.value.filter((r) => (r.price_kinds || 1) > 1).length)
const zeroCount = computed(() => rows.value.filter((r) => r.rows > 0 && r.diamonds === 0).length)

function fmtNum(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString('zh-CN')
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
  } catch (e) {
    rows.value = []
    loadError.value = apiErrorMessage(e, '读取礼物价格失败')
  } finally {
    loading.value = false
  }
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
/* 让单价输入框在表格里看起来像"可编辑的数字"，而不是一个突兀的方框 */
.price-input :deep(.el-input__wrapper) {
  padding-left: 8px;
  padding-right: 8px;
}
.price-input :deep(.el-input__inner) {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
/* 重算确认框里的换行要生效（ElMessageBox 默认把 \n 压成空格） */
:global(.repair-confirm .el-message-box__message) {
  white-space: pre-line;
}
</style>

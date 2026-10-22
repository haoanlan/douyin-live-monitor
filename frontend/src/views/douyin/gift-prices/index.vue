<!--
  礼物价格管理。

  版式对齐 Art Design Pro（同 views/system/user-manage）：
    douyin-page → article.art-card → 标题/说明 → 工具条 → dy-table-scroll → el-table

  为什么需要这个页面：
    抖音礼物消息里的 diamondCount 有时不准（同一礼物在不同消息里价格不同），
    而价格原来硬编码在 lib/worker/message-handler.js 的 GIFT_PRICE_MAP 里 ——
    改一次要改代码 + 发版 + 重启，线上根本来不及。

  这个页面做两件事：
    ① 覆盖价：写进数据库 gift_price_overrides，采集时优先级最高（最多 10 秒生效）；
    ② 重算历史：gifts 表里的 diamond_count / total_diamonds 是采集时写死的，
       勾选"同时重算历史"会把这些行改成新价，并逐场重建预聚合
       （场次汇总 / 礼物排行 / 主播排行 / 礼物明细 / 时间线）。

  ⚠ 重算是重操作：受影响的场次越多越慢（几十场可能要 1 分钟），
     所以先给预览（影响行数、场次数、钻石总额变化），确认后才执行。
-->
<template>
  <div class="douyin-page dy-stagger p-4">
    <article class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-lg font-semibold text-g-900 m-0">礼物价格</h3>
          <p class="mt-1 text-sm leading-6 text-g-600">
            修正「原始数据钻石单价不对」的礼物。改完立刻用于之后的采集；勾选重算会把历史记录也改过来。
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

        <el-select v-model="only" placeholder="全部礼物" class="!w-[160px]" @change="load">
          <el-option label="全部礼物" value="" />
          <el-option label="仅看已覆盖" value="override" />
          <el-option label="单价不一致" value="anomaly" />
          <el-option label="钻石为 0" value="zero" />
        </el-select>

        <span class="text-xs text-g-500">
          共 {{ rows.length }} 个礼物
          <span v-if="overriddenCount" class="ml-2">· 已覆盖 {{ overriddenCount }}</span>
          <span v-if="inconsistentCount" class="ml-2">· 单价不一致 {{ inconsistentCount }}</span>
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
        右侧「改价 / 清除覆盖」在手机上点不到。
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
          <el-table-column prop="gift_name" label="礼物名" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="font-medium text-g-900">{{ row.gift_name }}</span>
              <el-tag v-if="row.override_price !== null" size="small" type="success" effect="plain" class="ml-2">
                已覆盖
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="库内单价" width="140" align="right">
            <template #default="{ row }">
              <span v-if="row.min_unit === null" class="text-g-400">—</span>
              <span v-else-if="row.min_unit === row.max_unit" class="tabular-nums">{{ fmtNum(row.min_unit) }}</span>
              <span
                v-else
                class="tabular-nums text-red-500"
                :title="'历史数据里同时存在 ' + row.min_unit + ' 和 ' + row.max_unit"
              >
                {{ fmtNum(row.min_unit) }} ~ {{ fmtNum(row.max_unit) }}
              </span>
            </template>
          </el-table-column>

          <el-table-column label="生效单价" width="130" align="right">
            <template #default="{ row }">
              <span v-if="row.override_price !== null" class="font-semibold tabular-nums text-emerald-600">
                {{ fmtNum(row.override_price) }}
              </span>
              <span v-else-if="row.builtin_price !== null" class="tabular-nums text-g-700">
                {{ fmtNum(row.builtin_price) }}
                <span class="text-[11px] text-g-400">内置</span>
              </span>
              <span v-else class="text-g-400">消息价</span>
            </template>
          </el-table-column>

          <el-table-column label="出现" width="90" align="right">
            <template #default="{ row }"><span class="tabular-nums">{{ fmtNum(row.rows) }}</span></template>
          </el-table-column>

          <el-table-column label="礼物个数" width="100" align="right">
            <template #default="{ row }"><span class="tabular-nums">{{ fmtNum(row.gift_count) }}</span></template>
          </el-table-column>

          <el-table-column label="钻石总额" width="140" align="right">
            <template #default="{ row }">
              <span class="tabular-nums font-medium">{{ fmtNum(row.diamonds) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="场次" width="80" align="right">
            <template #default="{ row }"><span class="tabular-nums">{{ row.sessions }}</span></template>
          </el-table-column>

          <el-table-column label="操作" width="170" align="right" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openEdit(row)">改价</el-button>
              <el-button
                v-if="row.override_price !== null"
                link
                type="danger"
                size="small"
                @click="clearOverride(row)"
              >
                清除覆盖
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </article>

    <!-- 改价弹窗 -->
    <el-dialog
      v-model="editVisible"
      :title="'改价 · ' + (editing?.gift_name || '')"
      width="560px"
      :close-on-click-modal="false"
      @closed="resetEdit"
    >
      <div v-if="editing" class="flex flex-col gap-4">
        <div class="rounded-lg bg-g-50 px-3 py-2 text-[13px] leading-relaxed text-g-600">
          库里现有 <b>{{ fmtNum(editing.rows) }}</b> 条记录、<b>{{ fmtNum(editing.gift_count) }}</b> 个礼物、
          共 <b>{{ fmtNum(editing.diamonds) }}</b> 钻石，分布在 <b>{{ editing.sessions }}</b> 个场次。
          <span v-if="editing.builtin_price !== null">内置价 {{ fmtNum(editing.builtin_price) }}。</span>
        </div>

        <div class="flex items-center gap-3">
          <label class="shrink-0 whitespace-nowrap text-[13px] text-g-600">新单价（钻石）</label>
          <el-input-number
            v-model="newPrice"
            :min="0"
            :step="1"
            :precision="0"
            controls-position="right"
            style="width: 200px"
          />
        </div>

        <div class="flex items-center gap-3">
          <label class="shrink-0 whitespace-nowrap text-[13px] text-g-600">备注</label>
          <el-input v-model="note" placeholder="例如：原始消息价格不对，按官方 23333" maxlength="100" show-word-limit />
        </div>

        <!-- 影响预览 -->
        <div class="rounded-lg border border-g-200 px-3 py-2 text-[13px]">
          <div v-if="previewLoading" class="text-g-500">正在计算影响…</div>
          <div v-else-if="previewError" class="text-red-500">{{ previewError }}</div>
          <div v-else-if="preview" class="flex flex-col gap-1">
            <div class="font-medium text-g-800">影响预览</div>
            <div class="text-g-600">
              更新 <b>{{ fmtNum(preview.rows) }}</b> 条记录 · 涉及 <b>{{ preview.sessions }}</b> 个场次
            </div>
            <div class="text-g-600">
              钻石总额：{{ fmtNum(preview.old_diamonds) }}
              →
              <b>{{ fmtNum(preview.new_diamonds) }}</b>
              <span :class="preview.diff >= 0 ? 'text-emerald-600' : 'text-red-500'">
                （{{ preview.diff >= 0 ? '+' : '' }}{{ fmtNum(preview.diff) }}）
              </span>
            </div>
          </div>
        </div>

        <el-checkbox v-model="repairHistory">
          同时重算历史数据（按新价改写已有记录，并重建这些场次的汇总与榜单）
        </el-checkbox>
        <div v-if="repairHistory" class="text-[12px] leading-relaxed text-amber-600">
          重算会逐场重建预聚合，场次多时需要十几秒到一分钟，期间请不要关闭页面。
        </div>
      </div>

      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">
          {{ repairHistory ? '保存并重算' : '保存' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

const rows = ref<GiftPriceItem[]>([])
const loading = ref(false)
const loadError = ref('')
const keyword = ref('')
const only = ref<'' | 'override' | 'anomaly' | 'zero'>('')

const editVisible = ref(false)
const editing = ref<GiftPriceItem | null>(null)
const newPrice = ref(0)
const note = ref('')
const repairHistory = ref(false)
const saving = ref(false)

const preview = ref<{
  rows: number
  gift_count: number
  old_diamonds: number
  new_diamonds: number
  diff: number
  sessions: number
} | null>(null)
const previewLoading = ref(false)
const previewError = ref('')

/** 工具条上的统计只算"当前筛选结果"，避免和表格对不上 */
const overriddenCount = computed(() => rows.value.filter((r) => r.override_price !== null).length)
const inconsistentCount = computed(
  () => rows.value.filter((r) => r.min_unit !== null && r.max_unit !== null && r.min_unit !== r.max_unit).length
)
const zeroCount = computed(() => rows.value.filter((r) => r.rows > 0 && r.diamonds === 0).length)

function fmtNum(n: number | null | undefined) {
  const v = Number(n ?? 0)
  return v.toLocaleString('zh-CN')
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await fetchGiftPrices({ q: keyword.value.trim(), only: only.value })
    rows.value = r?.items || []
  } catch (e) {
    // 不弹 toast，页面上给错误态 + 重试（和大盘其它页一致）
    rows.value = []
    loadError.value = apiErrorMessage(e, '读取礼物价格失败')
  } finally {
    loading.value = false
  }
}

function openEdit(row: GiftPriceItem) {
  editing.value = row
  newPrice.value = row.override_price ?? row.builtin_price ?? row.max_unit ?? 0
  note.value = row.note || ''
  repairHistory.value = false
  preview.value = null
  previewError.value = ''
  editVisible.value = true
}

function resetEdit() {
  editing.value = null
  preview.value = null
  previewError.value = ''
  repairHistory.value = false
}

/** 价格变化时重新算影响（防抖，避免每敲一位就请求） */
let previewTimer: ReturnType<typeof setTimeout> | null = null
watch([newPrice, editVisible], () => {
  if (!editVisible.value || !editing.value) return
  if (previewTimer) clearTimeout(previewTimer)
  const price = Number(newPrice.value)
  if (!Number.isFinite(price) || price < 0) return
  previewTimer = setTimeout(async () => {
    previewLoading.value = true
    previewError.value = ''
    try {
      preview.value = await previewGiftPriceRepair(editing.value!.gift_name, price)
    } catch (e) {
      preview.value = null
      previewError.value = apiErrorMessage(e, '计算影响失败')
    } finally {
      previewLoading.value = false
    }
  }, 300)
})

async function submit() {
  if (!editing.value) return
  const price = Number(newPrice.value)
  if (!Number.isFinite(price) || price < 0) {
    ElMessage.warning('单价必须是不小于 0 的数字')
    return
  }
  saving.value = true
  try {
    if (repairHistory.value) {
      const r = await repairGiftPrice({
        giftName: editing.value.gift_name,
        diamondPerUnit: price,
        note: note.value.trim() || undefined
      })
      const failed = r?.failed?.length || 0
      if (failed > 0) {
        ElMessage.warning(`已更新 ${r.updated_rows} 条，但 ${failed} 个场次重建失败（见后端日志）`)
      } else {
        ElMessage.success(
          `已更新 ${r.updated_rows} 条记录，重建 ${r.rebuilt_sessions} 个场次，用时 ${Math.round((r.elapsed_ms || 0) / 1000)} 秒`
        )
      }
    } else {
      await saveGiftPrice({
        giftName: editing.value.gift_name,
        diamondPerUnit: price,
        note: note.value.trim() || undefined
      })
      ElMessage.success('已保存，之后的采集按新价计算（历史数据未改动）')
    }
    editVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, repairHistory.value ? '重算失败' : '保存失败'))
  } finally {
    saving.value = false
  }
}

async function clearOverride(row: GiftPriceItem) {
  try {
    await ElMessageBox.confirm(
      `清除「${row.gift_name}」的覆盖价后，采集会回退到内置价或消息里的价格。历史数据不受影响。`,
      '清除覆盖价',
      { type: 'warning', confirmButtonText: '清除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await deleteGiftPrice(row.gift_name)
    ElMessage.success('已清除')
    await load()
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, '清除失败'))
  }
}

onMounted(load)
</script>

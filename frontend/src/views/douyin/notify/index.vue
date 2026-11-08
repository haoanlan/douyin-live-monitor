<template>
  <div class="douyin-page p-4">
    <!-- 页头：和礼物价格页同一套语言（art-card + art-card-header） -->
    <div class="art-card p-4 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h4 class="m-0 text-base font-semibold text-g-900">通知管理</h4>
          <p class="m-0 mt-0.5 text-[11px] text-g-500">
            开播通知 / 下播战报 / 主播上场提醒都从这里配置：规则 → 渠道 → 记录。
          </p>
        </div>
        <div class="dy-seg">
          <button
            v-for="t in TABS"
            :key="t.value"
            type="button"
            class="dy-seg__item"
            :class="{ 'is-active': activeTab === t.value }"
            @click="switchTab(t.value)"
          >
            {{ t.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- ============ 事件规则 ============ -->
    <ElCard v-if="activeTab === 'rules'" class="art-table-card">
      <ArtTableHeader :loading="loading" @refresh="reloadAll">
        <template #left>
          <div class="flex flex-wrap items-center gap-2">
            <ElButton v-if="can('notify.manage')" type="primary" @click="openRuleDialog()">
              <ArtSvgIcon icon="ri:add-line" class="mr-1" />新建规则
            </ElButton>
            <span class="ml-1 text-xs text-g-500">
              共 <b class="text-g-700">{{ rules.length }}</b> 条 ·
              启用 <b class="text-success">{{ rules.filter((r) => r.enabled).length }}</b>
            </span>
          </div>
        </template>
      </ArtTableHeader>

      <ArtTable
        :data="rules"
        :columns="ruleColumns"
        :loading="loading"
        :show-table-header="false"
        row-key="id"
        empty-text="还没有规则，先建一条"
      >
        <template #event="{ row }">
          <span class="text-sm text-g-800">{{ eventLabel(row.event) }}</span>
        </template>
        <template #channels="{ row }">
          <span v-if="!row.channel_ids.length" class="text-xs text-danger">未配置</span>
          <span v-for="cid in row.channel_ids" :key="cid" class="dy-chip">{{ channelName(cid) }}</span>
        </template>
        <template #quiet="{ row }">
          <span class="text-xs text-g-500">
            {{ row.quiet_hours?.start ? `${row.quiet_hours.start}–${row.quiet_hours.end}` : '不限' }}
          </span>
        </template>
        <template #enabled="{ row }">
          <el-switch
            :model-value="!!row.enabled"
            :disabled="!can('notify.manage')"
            size="small"
            @change="(v: any) => toggleRule(row as NotifyRule, !!v)"
          />
        </template>
        <template #actions="{ row }">
          <ArtButtonTable v-if="can('notify.manage')" type="edit" @click="openRuleDialog(row as NotifyRule)" />
          <ArtButtonTable v-if="can('notify.manage')" type="delete" @click="removeRule(row as NotifyRule)" />
        </template>
      </ArtTable>
    </ElCard>

    <!-- ============ 推送渠道 ============ -->
    <ElCard v-else-if="activeTab === 'channels'" class="art-table-card">
      <ArtTableHeader :loading="loading" @refresh="reloadAll">
        <template #left>
          <div class="flex flex-wrap items-center gap-2">
            <ElButton v-if="can('notify.manage')" type="primary" @click="openChannelDialog()">
              <ArtSvgIcon icon="ri:add-line" class="mr-1" />新增渠道
            </ElButton>
            <span class="ml-1 text-xs text-g-500">
              企业微信 / 飞书 / 钉钉机器人，或任意 Webhook
            </span>
          </div>
        </template>
      </ArtTableHeader>

      <ArtTable
        :data="channels"
        :columns="channelColumns"
        :loading="loading"
        :show-table-header="false"
        row-key="id"
        empty-text="还没有推送渠道"
      >
        <template #name="{ row }">
          <span class="text-sm font-medium text-g-800">{{ row.name }}</span>
        </template>
        <template #type="{ row }">
          <el-tag size="small" effect="light">{{ channelTypeLabel(row.type) }}</el-tag>
        </template>
        <template #url="{ row }">
          <span class="truncate text-xs text-g-500" :title="row.config?.url">{{ maskUrl(row.config?.url) }}</span>
        </template>
        <template #enabled="{ row }">
          <el-switch
            :model-value="!!row.enabled"
            :disabled="!can('notify.manage')"
            size="small"
            @change="(v: any) => toggleChannel(row as NotifyChannel, !!v)"
          />
        </template>
        <template #actions="{ row }">
          <el-button
            v-if="can('notify.test')"
            link
            type="primary"
            :loading="testingId === row.id"
            @click="testChannel(row as NotifyChannel)"
          >
            测试
          </el-button>
          <ArtButtonTable v-if="can('notify.manage')" type="edit" @click="openChannelDialog(row as NotifyChannel)" />
          <ArtButtonTable v-if="can('notify.manage')" type="delete" @click="removeChannel(row as NotifyChannel)" />
        </template>
      </ArtTable>
    </ElCard>

    <!-- ============ 发送记录 ============ -->
    <ElCard v-else-if="activeTab === 'logs'" class="art-table-card">
      <ArtTableHeader :loading="false" @refresh="loadLogs(logPage)">
        <template #left>
          <div class="flex flex-wrap items-center gap-2">
            <div class="dy-seg">
              <button
                v-for="s in LOG_STATUS"
                :key="s.value"
                type="button"
                class="dy-seg__item"
                :class="{ 'is-active': logStatus === s.value }"
                @click="logStatus = s.value; loadLogs(1)"
              >
                {{ s.label }}
              </button>
            </div>
            <span class="text-xs text-g-500">共 <b class="text-g-700">{{ logTotal }}</b> 条</span>
          </div>
        </template>
      </ArtTableHeader>

      <ArtTable
        :data="logs"
        :columns="logColumns"
        :loading="false"
        :pagination="{ current: logPage, size: logSize, total: logTotal }"
        :show-table-header="false"
        row-key="id"
        empty-text="还没有发送记录"
        @pagination:current-change="loadLogs"
      >
        <template #created_at="{ row }">
          <span class="text-xs text-g-600">{{ fmtTime(row.created_at) }}</span>
        </template>
        <template #event="{ row }">
          <span class="text-sm text-g-800">{{ eventLabel(row.event) }}</span>
        </template>
        <template #status="{ row }">
          <el-tag :type="row.status === 'sent' ? 'success' : row.status === 'skipped' ? 'warning' : 'danger'" size="small" effect="light">
            {{ row.status === 'sent' ? '成功' : row.status === 'skipped' ? '跳过' : '失败' }}
          </el-tag>
        </template>
        <template #error="{ row }">
          <span class="text-xs" :class="row.error ? 'text-danger' : 'text-g-400'">{{ row.error || '—' }}</span>
        </template>
      </ArtTable>
    </ElCard>

    <!-- ============ 主播上场 ============ -->
    <template v-else>
      <div class="art-card p-4 mb-4">
        <div class="flex flex-wrap items-end gap-2">
          <div>
            <div class="mb-1 text-[11px] text-g-400">房间号（web_rid，直播间地址里的那串数字）</div>
            <el-input v-model="upWebRid" placeholder="例如 65209552987" style="width: 200px" @change="loadUpstage" />
          </div>
          <el-button :loading="upLoadingMembers" @click="loadMembers">拉团员榜</el-button>
          <el-button v-if="can('upstage.manage')" @click="resetStates">清空本场状态</el-button>
          <span class="text-[11px] text-g-400">
            映射 {{ upStatus?.rank?.mappedUsers || 0 }} 人 · 最近帧
            {{ upStatus?.runtime?.lastFrameAt ? fmtGap(upStatus.runtime.streamGapSecs) : '无' }}
            · 来源 {{ upStatus?.runtime?.lastSource || '—' }}
          </span>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ElCard class="art-table-card">
          <ArtTableHeader :loading="false" @refresh="loadUpstage">
            <template #left>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-g-500">关注名单 · 按 uid 匹配</span>
                <span class="text-xs text-g-400">（昵称只用于显示）</span>
              </div>
            </template>
          </ArtTableHeader>
          <div v-if="members.length" class="mb-2 flex flex-wrap gap-1 px-1">
            <button
              v-for="m in members.filter((x) => !watchUids.includes(x.uid))"
              :key="m.uid"
              type="button"
              class="dy-quick-host"
              @click="addWatch(m)"
            >
              + {{ m.nickname }}
            </button>
          </div>
          <ArtTable
            :data="watchList"
            :columns="watchColumns"
            :show-table-header="false"
            row-key="id"
            empty-text="还没有关注的主播"
          >
            <template #nickname="{ row }">
              <span class="text-sm text-g-800">{{ row.nickname || '（待补）' }}</span>
            </template>
            <template #uid="{ row }">
              <span class="text-xs text-g-500">{{ row.uid }}</span>
            </template>
            <template #actions="{ row }">
              <ArtButtonTable v-if="can('upstage.manage')" type="delete" @click="removeWatch(row as UpstageWatch)" />
            </template>
          </ArtTable>
        </ElCard>

        <ElCard class="art-table-card">
          <ArtTableHeader :loading="false" @refresh="loadUpstage">
            <template #left>
              <span class="text-xs text-g-500">上场事件 · 共 {{ upEventTotal }} 条 · 离场不推送</span>
            </template>
          </ArtTableHeader>
          <ArtTable
            :data="upEvents"
            :columns="upEventColumns"
            :show-table-header="false"
            row-key="id"
            empty-text="还没有事件"
          >
            <template #created_at="{ row }">
              <span class="text-xs text-g-600">{{ fmtTime(row.created_at) }}</span>
            </template>
            <template #event="{ row }">
              <el-tag size="small" :type="row.event === 'on_stage' ? 'success' : 'info'" effect="light">
                {{ upEventLabel(row.event) }}
              </el-tag>
            </template>
            <template #nickname="{ row }">
              <span class="text-sm text-g-800">{{ row.nickname || row.uid }}</span>
            </template>
            <template #detail="{ row }">
              <span class="text-xs text-g-500">{{ row.detail || '—' }}</span>
            </template>
          </ArtTable>
        </ElCard>
      </div>

      <div class="art-card mt-4 p-3">
        <div class="mb-1 text-[11px] text-g-600">
          人脸识别通道的帧从这里进来（Go 代理没有这个 proto，需要外部采集进程解码后提交）：
        </div>
        <div class="flex items-center gap-2">
          <code class="min-w-0 flex-1 truncate rounded bg-g-100 px-2 py-1 text-[11px] text-g-700">
            POST /api/upstage/frames  X-Upstage-Token: {{ upStatus?.frameToken || '…' }}
          </code>
          <el-button size="small" @click="copyToken">复制令牌</el-button>
        </div>
        <div class="mt-1 text-[11px] text-g-400">
          请求体：{"webRid":"65209552987","source":"face","frames":[{"uid":"2203876772819496","conf":0.62}]}
        </div>
      </div>
    </template>

    <!-- ============ 规则弹窗 ============ -->
    <el-dialog v-model="ruleDialogVisible" :title="ruleForm.id ? '编辑规则' : '新建规则'" width="520">
      <el-form label-width="88px" label-position="left">
        <el-form-item label="事件">
          <el-select v-model="ruleForm.event" placeholder="选择事件" class="w-full">
            <el-option-group v-for="g in eventGroups" :key="g.name" :label="g.name">
              <el-option v-for="e in g.items" :key="e.key" :label="e.label" :value="e.key" />
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="推送渠道">
          <el-select v-model="ruleForm.channel_ids" multiple placeholder="至少选一个" class="w-full">
            <el-option v-for="c in channels" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="免打扰">
          <div class="flex items-center gap-2">
            <el-time-select v-model="quietStart" start="00:00" step="00:30" end="23:30" placeholder="开始" style="width: 110px" />
            <span class="text-xs text-g-400">至</span>
            <el-time-select v-model="quietEnd" start="00:00" step="00:30" end="23:30" placeholder="结束" style="width: 110px" />
            <el-button link @click="clearQuiet">清除</el-button>
          </div>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="ruleForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitRule">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 渠道弹窗 ============ -->
    <el-dialog v-model="channelDialogVisible" :title="channelForm.id ? '编辑渠道' : '新增渠道'" width="520">
      <el-form label-width="88px" label-position="left">
        <el-form-item label="类型">
          <el-select v-model="channelForm.type" class="w-full">
            <el-option v-for="t in channelTypes" :key="t.key" :label="t.label" :value="t.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="channelForm.name" placeholder="例如：运营群机器人" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="channelForm.url" placeholder="Webhook 完整地址，或只填 key / token" />
          <p class="m-0 mt-1 text-[11px] text-g-400">{{ channelTypeHint }}</p>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="channelForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="channelDialogVisible = false">取消</el-button>
        <el-button :loading="testingId === -1" @click="testDraftChannel">测试这条</el-button>
        <el-button type="primary" :loading="saving" @click="submitChannel">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import type { ColumnOption } from '@/types'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'

  import {
    deleteNotifyChannel,
    deleteNotifyRule,
    fetchNotifyChannels,
    fetchNotifyLogs,
    fetchNotifyMeta,
    fetchNotifyRules,
    saveNotifyChannel,
    saveNotifyRule,
    testNotifyChannel,
    type NotifyChannel,
    type NotifyLog,
    type NotifyRule
  } from '@/api/notify'
  import {
    addUpstageWatch,
    deleteUpstageWatch,
    fetchUpstageEvents,
    fetchUpstageMembers,
    fetchUpstageStatus,
    fetchUpstageWatch,
    resetUpstage,
    type UpstageEvent,
    type UpstageStatus,
    type UpstageWatch
  } from '@/api/upstage'
  import { usePermissionStore } from '@/store/modules/permission'
  import { apiErrorMessage } from '@/utils/douyin-error'
  import { fmtTime } from '@/utils/format'

  defineOptions({ name: 'DouyinNotify' })

  const permissionStore = usePermissionStore()
  const can = (key: string) => permissionStore.hasPerm(key)

  const TABS = [
    { value: 'rules', label: '事件规则' },
    { value: 'channels', label: '推送渠道' },
    { value: 'logs', label: '发送记录' },
    { value: 'upstage', label: '主播上场' }
  ] as const

  const LOG_STATUS = [
    { value: '', label: '全部' },
    { value: 'sent', label: '成功' },
    { value: 'failed', label: '失败' },
    { value: 'skipped', label: '跳过' }
  ] as const

  const activeTab = ref<'rules' | 'channels' | 'logs' | 'upstage'>('rules')
  const loading = ref(false)
  const saving = ref(false)

  const events = ref<{ key: string; label: string; group: string }[]>([])
  const channelTypes = ref<{ key: string; label: string; hint: string }[]>([])

  const channels = ref<NotifyChannel[]>([])
  const rules = ref<NotifyRule[]>([])
  const logs = ref<NotifyLog[]>([])
  const logTotal = ref(0)
  const logPage = ref(1)
  const logSize = ref(20)
  const logStatus = ref('')

  /* ---------------- 列定义（高级表格） ---------------- */
  const ruleColumns: ColumnOption[] = [
    { prop: 'event', label: '事件', minWidth: 140, useSlot: true, slotName: 'event' },
    { prop: 'channels', label: '推送渠道', minWidth: 200, useSlot: true, slotName: 'channels' },
    { prop: 'quiet', label: '免打扰', width: 150, useSlot: true, slotName: 'quiet' },
    { prop: 'enabled', label: '状态', width: 90, align: 'center', useSlot: true, slotName: 'enabled' },
    { prop: 'actions', label: '操作', width: 120, align: 'right', useSlot: true, slotName: 'actions' }
  ]

  const channelColumns: ColumnOption[] = [
    { prop: 'name', label: '名称', minWidth: 160, useSlot: true, slotName: 'name' },
    { prop: 'type', label: '类型', width: 150, useSlot: true, slotName: 'type' },
    { prop: 'url', label: '地址', minWidth: 280, useSlot: true, slotName: 'url' },
    { prop: 'enabled', label: '状态', width: 90, align: 'center', useSlot: true, slotName: 'enabled' },
    { prop: 'actions', label: '操作', width: 150, align: 'right', useSlot: true, slotName: 'actions' }
  ]

  const logColumns: ColumnOption[] = [
    { prop: 'created_at', label: '时间', width: 180, useSlot: true, slotName: 'created_at' },
    { prop: 'event', label: '事件', width: 140, useSlot: true, slotName: 'event' },
    { prop: 'channel_name', label: '渠道', minWidth: 140 },
    { prop: 'status', label: '状态', width: 90, useSlot: true, slotName: 'status' },
    { prop: 'error', label: '失败原因', minWidth: 220, useSlot: true, slotName: 'error' }
  ]

  const watchColumns: ColumnOption[] = [
    { prop: 'nickname', label: '昵称', minWidth: 120, useSlot: true, slotName: 'nickname' },
    { prop: 'uid', label: 'UID', minWidth: 150, useSlot: true, slotName: 'uid' },
    { prop: 'actions', label: '', width: 70, align: 'right', useSlot: true, slotName: 'actions' }
  ]

  const upEventColumns: ColumnOption[] = [
    { prop: 'created_at', label: '时间', width: 170, useSlot: true, slotName: 'created_at' },
    { prop: 'event', label: '事件', width: 90, useSlot: true, slotName: 'event' },
    { prop: 'nickname', label: '主播', minWidth: 110, useSlot: true, slotName: 'nickname' },
    { prop: 'detail', label: '说明', minWidth: 140, useSlot: true, slotName: 'detail' }
  ]

  /* ---------------- 元数据 ---------------- */
  const eventGroups = computed(() => {
    const map = new Map<string, { key: string; label: string }[]>()
    for (const e of events.value) {
      if (!map.has(e.group)) map.set(e.group, [])
      map.get(e.group)!.push({ key: e.key, label: e.label })
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }))
  })

  const eventLabel = (key: string) => events.value.find((e) => e.key === key)?.label || key
  const channelTypeLabel = (key: string) => channelTypes.value.find((t) => t.key === key)?.label || key
  const channelTypeHint = computed(
    () => channelTypes.value.find((t) => t.key === channelForm.value.type)?.hint || ''
  )
  const channelName = (id: number) => channels.value.find((c) => c.id === id)?.name || `#${id}`

  function maskUrl(url?: string) {
    if (!url) return '—'
    return url.length <= 48 ? url : `${url.slice(0, 30)}…${url.slice(-12)}`
  }

  /* ---------------- 渠道 ---------------- */
  const channelDialogVisible = ref(false)
  const channelForm = ref<{
    id?: number
    type: NotifyChannel['type']
    name: string
    url: string
    enabled: boolean
  }>({ type: 'wecom', name: '', url: '', enabled: true })

  function openChannelDialog(row?: NotifyChannel) {
    channelForm.value = row
      ? {
          id: row.id,
          type: row.type,
          name: row.name,
          url: String(row.config?.url || ''),
          enabled: !!row.enabled
        }
      : { type: 'wecom', name: '', url: '', enabled: true }
    channelDialogVisible.value = true
  }

  async function submitChannel() {
    if (!channelForm.value.name.trim()) return ElMessage.warning('渠道名称必填')
    if (!channelForm.value.url.trim()) return ElMessage.warning('地址必填')
    saving.value = true
    try {
      const r = await saveNotifyChannel({
        id: channelForm.value.id,
        type: channelForm.value.type,
        name: channelForm.value.name.trim(),
        config: { url: channelForm.value.url.trim() },
        enabled: channelForm.value.enabled ? 1 : 0
      } as never)
      channels.value = r.items || []
      channelDialogVisible.value = false
      ElMessage.success('已保存')
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '保存渠道失败'))
    } finally {
      saving.value = false
    }
  }

  const testingId = ref<number | null>(null)

  async function testChannel(row: NotifyChannel) {
    testingId.value = row.id
    try {
      const r = await testNotifyChannel({ id: row.id })
      if (r.ok) ElMessage.success('测试消息已发送，请到群里确认')
      else ElMessage.error('发送失败：' + (r.error || '未知原因'))
      if (activeTab.value === 'logs') await loadLogs(1)
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '测试发送失败'))
    } finally {
      testingId.value = null
    }
  }

  async function testDraftChannel() {
    if (!channelForm.value.url.trim()) return ElMessage.warning('先填地址再测试')
    testingId.value = -1
    try {
      const r = await testNotifyChannel({
        type: channelForm.value.type,
        config: { url: channelForm.value.url.trim() }
      })
      if (r.ok) ElMessage.success('测试消息已发送，请到群里确认')
      else ElMessage.error('发送失败：' + (r.error || '未知原因'))
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '测试发送失败'))
    } finally {
      testingId.value = null
    }
  }

  async function toggleChannel(row: NotifyChannel, v: boolean) {
    try {
      const r = await saveNotifyChannel({
        id: row.id,
        type: row.type,
        name: row.name,
        config: row.config,
        enabled: v ? 1 : 0
      } as never)
      channels.value = r.items || []
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '更新渠道失败'))
    }
  }

  async function removeChannel(row: NotifyChannel) {
    try {
      await ElMessageBox.confirm(`删除渠道「${row.name}」？引用它的规则会推不出去。`, '确认删除', { type: 'warning' })
    } catch {
      return
    }
    try {
      const r = await deleteNotifyChannel(row.id)
      channels.value = r.items || []
      ElMessage.success('已删除')
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '删除失败'))
    }
  }

  /* ---------------- 规则 ---------------- */
  const ruleDialogVisible = ref(false)
  const quietStart = ref('')
  const quietEnd = ref('')
  const ruleForm = ref<{
    id?: number
    event: string
    channel_ids: number[]
    enabled: boolean
  }>({ event: '', channel_ids: [], enabled: true })

  function openRuleDialog(row?: NotifyRule) {
    if (!channels.value.length) {
      ElMessage.warning('先去「推送渠道」加一个渠道，规则才有地方推')
      activeTab.value = 'channels'
      return
    }
    ruleForm.value = row
      ? { id: row.id, event: row.event, channel_ids: [...row.channel_ids], enabled: !!row.enabled }
      : { event: events.value[0]?.key || '', channel_ids: [], enabled: true }
    quietStart.value = row?.quiet_hours?.start || ''
    quietEnd.value = row?.quiet_hours?.end || ''
    ruleDialogVisible.value = true
  }

  function clearQuiet() {
    quietStart.value = ''
    quietEnd.value = ''
  }

  async function submitRule() {
    if (!ruleForm.value.event) return ElMessage.warning('请选择事件')
    if (!ruleForm.value.channel_ids.length) return ElMessage.warning('至少选一个推送渠道')
    saving.value = true
    try {
      const r = await saveNotifyRule({
        id: ruleForm.value.id,
        event: ruleForm.value.event,
        channel_ids: ruleForm.value.channel_ids,
        quiet_hours:
          quietStart.value && quietEnd.value ? { start: quietStart.value, end: quietEnd.value } : null,
        enabled: ruleForm.value.enabled ? 1 : 0
      } as never)
      rules.value = r.items || []
      ruleDialogVisible.value = false
      ElMessage.success('已保存')
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '保存规则失败'))
    } finally {
      saving.value = false
    }
  }

  async function toggleRule(row: NotifyRule, v: boolean) {
    try {
      const r = await saveNotifyRule({
        id: row.id,
        event: row.event,
        channel_ids: row.channel_ids,
        conditions: row.conditions,
        quiet_hours: row.quiet_hours,
        enabled: v ? 1 : 0
      } as never)
      rules.value = r.items || []
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '更新规则失败'))
    }
  }

  async function removeRule(row: NotifyRule) {
    try {
      await ElMessageBox.confirm(`删除「${eventLabel(row.event)}」规则？`, '确认删除', { type: 'warning' })
    } catch {
      return
    }
    try {
      const r = await deleteNotifyRule(row.id)
      rules.value = r.items || []
      ElMessage.success('已删除')
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '删除失败'))
    }
  }

  /* ---------------- 记录 ---------------- */
  async function loadLogs(page = logPage.value) {
    logPage.value = page
    try {
      const r = await fetchNotifyLogs({ page, size: logSize.value, status: logStatus.value })
      logs.value = r.items || []
      logTotal.value = r.total || 0
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '读取发送记录失败'))
    }
  }

  /* ---------------- 主播上场 ---------------- */
  const upWebRid = ref('')
  const upLoadingMembers = ref(false)
  const members = ref<{ uid: string; nickname: string }[]>([])
  const watchList = ref<UpstageWatch[]>([])
  const upStatus = ref<UpstageStatus | null>(null)
  const upEvents = ref<UpstageEvent[]>([])
  const upEventTotal = ref(0)

  const watchUids = computed(() => watchList.value.map((w) => String(w.uid)))

  const upEventLabel = (e: string) =>
    ({ on_stage: '上场', on_stage_late: '补发', off_stage: '离场', pending: '挂起' } as Record<string, string>)[e] || e

  const fmtGap = (secs: number | null | undefined) =>
    secs == null ? '—' : secs < 60 ? `${secs} 秒前` : `${Math.round(secs / 60)} 分钟前`

  async function loadUpstage() {
    const rid = upWebRid.value.trim()
    /*
     * 没填房间号时也拉一次状态：令牌（frameToken）和参数跟房间无关，
     * 用户一进这个 tab 就应该能看到「外部采集进程要用的令牌」。
     */
    if (!rid) {
      try {
        upStatus.value = await fetchUpstageStatus({ webRid: '' })
      } catch {
        /* 忽略 */
      }
      return
    }
    try {
      const [w, s, ev] = await Promise.all([
        fetchUpstageWatch({ webRid: rid }),
        fetchUpstageStatus({ webRid: rid }),
        fetchUpstageEvents({ webRid: rid, page: 1, size: 10 })
      ])
      watchList.value = w.items || []
      upStatus.value = s
      upEvents.value = ev.items || []
      upEventTotal.value = ev.total || 0
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '读取上场提醒失败'))
    }
  }

  async function loadMembers() {
    if (!upWebRid.value.trim()) return ElMessage.warning('先填房间号')
    upLoadingMembers.value = true
    try {
      const r = await fetchUpstageMembers({ webRid: upWebRid.value.trim(), force: '1' })
      members.value = r.items || []
      if (!members.value.length) ElMessage.warning('团员榜暂时为空（可能没开播或该房间没有团员榜）')
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '拉团员榜失败'))
    } finally {
      upLoadingMembers.value = false
    }
  }

  async function addWatch(m: { uid: string; nickname: string }) {
    try {
      const r = await addUpstageWatch({ web_rid: upWebRid.value.trim(), uid: m.uid, nickname: m.nickname, enabled: 1 })
      watchList.value = r.items || []
      ElMessage.success(`已关注 ${m.nickname}`)
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '添加失败'))
    }
  }

  async function removeWatch(row: UpstageWatch) {
    try {
      const r = await deleteUpstageWatch(row.id)
      watchList.value = (r.items || []).filter((x) => x.web_rid === upWebRid.value.trim())
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '移除失败'))
    }
  }

  async function resetStates() {
    if (!upWebRid.value.trim()) return
    try {
      await resetUpstage(upWebRid.value.trim())
      ElMessage.success('本场状态已清空（不跨场记忆）')
      await loadUpstage()
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '清空失败'))
    }
  }

  async function copyToken() {
    const token = upStatus.value?.frameToken || ''
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      ElMessage.success('令牌已复制')
    } catch {
      ElMessage.warning('复制失败，请手动选择文本')
    }
  }

  /* ---------------- 加载 ---------------- */
  async function reloadAll() {
    loading.value = true
    try {
      const [c, r] = await Promise.all([fetchNotifyChannels(), fetchNotifyRules()])
      channels.value = c.items || []
      rules.value = r.items || []
      if (activeTab.value === 'logs') await loadLogs(logPage.value)
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '读取通知配置失败'))
    } finally {
      loading.value = false
    }
  }

  function switchTab(name: string) {
    activeTab.value = name as typeof activeTab.value
    if (name === 'logs') loadLogs(1)
    if (name === 'upstage') loadUpstage()
  }

  onMounted(async () => {
    try {
      const meta = await fetchNotifyMeta()
      events.value = meta.events || []
      channelTypes.value = meta.channelTypes || []
    } catch {
      /* 元数据失败不阻塞主流程 */
    }
    await reloadAll()
  })
</script>

<style scoped>
  .dy-chip {
    display: inline-block;
    margin-right: 4px;
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--art-gray-100, #f4f5f7);
    font-size: 11px;
    color: var(--art-gray-600, #5b6068);
  }
</style>

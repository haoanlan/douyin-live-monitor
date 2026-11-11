<template>
  <div class="art-full-height">
    <!-- 页头：和礼物价格页同一套语言（art-card + art-card-header） -->
    <div class="art-card mb-3 shrink-0 p-3">
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
    <ElCard v-if="activeTab === 'rules'" class="art-table-card flex-1">
      <ArtTableHeader v-model:columns="ruleColumnChecks" :loading="loading" @refresh="reloadAll">
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
        :columns="ruleColumnsShown"
        :loading="loading"
        :show-table-header="false"
        row-key="id"
        empty-text="还没有规则，先建一条"
      >
        <template #room="{ row }">
          <span class="block truncate text-xs text-g-600" :title="roomName(row.room_id)">
            {{ roomName(row.room_id) }}
          </span>
        </template>
        <template #event="{ row }">
          <span class="block truncate text-sm text-g-800" :title="eventLabel(row.event)">
            {{ eventLabel(row.event) }}
          </span>
        </template>
        <template #channels="{ row }">
          <div class="flex min-w-0 flex-wrap items-center gap-1">
            <span v-if="!row.channel_ids.length" class="text-xs text-danger">未配置</span>
            <span
              v-for="cid in row.channel_ids"
              :key="cid"
              class="dy-chip max-w-full truncate"
              :title="channelName(cid)"
            >
              {{ channelName(cid) }}
            </span>
          </div>
        </template>
        <template #watch="{ row }">
          <el-tooltip
            v-if="watchNames(row.conditions).length"
            :content="watchNames(row.conditions).join('、')"
            placement="top"
          >
            <span class="text-xs text-g-700 cursor-help">{{ watchLabelOf(row.conditions) }}</span>
          </el-tooltip>
          <span v-else class="text-xs text-g-500">全部</span>
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
      </ArtTable>
    </ElCard>

    <!-- ============ 推送渠道 ============ -->
    <ElCard v-else-if="activeTab === 'channels'" class="art-table-card flex-1">
      <ArtTableHeader v-model:columns="channelColumnChecks" :loading="loading" @refresh="reloadAll">
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
        :columns="channelColumnsShown"
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
      </ArtTable>
    </ElCard>

    <!-- ============ 发送记录 ============ -->
    <ElCard v-else-if="activeTab === 'logs'" class="art-table-card flex-1">
      <ArtTableHeader v-model:columns="logColumnChecks" :loading="false" @refresh="loadLogs(logPage)">
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
        :columns="logColumnsShown"
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
          <el-tooltip :content="row.error || '没有报错'" placement="top" :show-after="200">
            <el-tag
              :type="row.status === 'sent' ? 'success' : row.status === 'skipped' ? 'warning' : 'danger'"
              size="small"
              effect="light"
            >
              {{ row.status === 'sent' ? '成功' : row.status === 'skipped' ? '跳过' : '失败' }}
            </el-tag>
          </el-tooltip>
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
            <div class="mb-1 text-[11px] text-g-400">直播间</div>
            <!-- 从已添加的房间选，不用再手填 web_rid -->
            <el-select
              v-model="upWebRid"
              filterable
              placeholder="选择已添加的直播间"
              style="width: 220px"
              @change="loadUpstage"
            >
              <el-option v-for="r in roomOptions" :key="r.room_id" :label="r.name" :value="r.room_id">
                <span class="truncate">{{ r.name }}</span>
                <span class="ml-2 text-xs text-g-400">{{ r.room_id }}</span>
              </el-option>
            </el-select>
          </div>
          <el-button class="!min-w-[112px]" :loading="upLoadingMembers" @click="loadMembers">刷新名单</el-button>
          <el-button v-if="can('upstage.manage')" @click="resetStates">清空本场状态</el-button>
          <span class="text-[11px] text-success">● 自动模式：开启的主播命中即推送，名单每 60 秒自动维护</span>
          <span class="text-[11px] text-g-400">
            映射 {{ upStatus?.rank?.mappedUsers || 0 }} 人 · 最近帧
            {{ upStatus?.runtime?.lastFrameAt ? fmtGap(upStatus.runtime.streamGapSecs) : '无' }}
            · 来源 {{ upStatus?.runtime?.lastSource || '—' }}
          </span>
        </div>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <ElCard class="art-table-card">
          <ArtTableHeader :loading="false" @refresh="loadUpstage">
            <template #left>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-g-500">关注名单 · 按 uid 匹配</span>
                <span class="text-xs text-g-400">（昵称只用于显示）</span>
              </div>
            </template>
          </ArtTableHeader>
          <div v-if="seenList.length" class="mb-2 flex flex-wrap items-center gap-1 border-b border-g-200/60 px-3 pb-2">
            <span class="text-[11px] text-g-400 mr-1">现场识别到：</span>
            <button
              v-for="s in seenList.filter((x) => !watchUids.includes(x.uid))"
              :key="s.uid"
              type="button"
              class="dy-quick-host"
              @click="addWatch({ uid: s.uid, nickname: s.nickname || s.uid })"
            >
              + {{ s.nickname || s.uid }}
            </button>
          </div>
          <div v-if="members.length" class="mb-2 flex flex-wrap items-center gap-1 border-b border-g-200/60 px-3 pb-2">
            <span class="text-[11px] text-g-400 mr-1">团员榜：</span>
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
            <!-- 每个主播单独的推送开关：用户要求"能设定哪个主播推、哪个不推" -->
            <template #enabled="{ row }">
              <el-switch
                :model-value="!!row.enabled"
                :disabled="!can('upstage.manage')"
                size="small"
                @change="(v: any) => toggleWatch(row as UpstageWatch, !!v)"
              />
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

      <!-- 底部只留一个入口：接入细节收进弹窗，别在页面上占一大块 -->
      <div class="mt-2 shrink-0 text-right">
        <el-button link @click="frameHelpVisible = true">外部采集接入说明</el-button>
      </div>

      <el-dialog v-model="frameHelpVisible" title="外部采集接入说明" :width="isMobile ? '92%' : '620px'">
        <p class="m-0 mb-2 text-xs text-g-600">
          人脸识别消息（OnCamRecognition）在 Go 代理里没有 proto 定义，需要外部采集进程解码后提交到这个接口：
        </p>
        <div class="break-all rounded bg-g-100 p-2 font-mono text-[11px] text-g-700">
          POST /api/upstage/frames<br />
          X-Upstage-Token: {{ upStatus?.frameToken || '（打开本页后自动获取）' }}
        </div>
        <p class="m-0 mt-2 text-xs text-g-600">请求体：</p>
        <div class="rounded bg-g-100 p-2 font-mono text-[11px] text-g-700">
          {"webRid":"65209552987","source":"face","frames":[{"uid":"2203876772819496","conf":0.62}]}
        </div>
        <p class="m-0 mt-2 text-[11px] text-g-400">令牌每次服务重启都会变，脚本里要留成配置项。</p>
        <template #footer>
          <el-button @click="copyToken">复制令牌</el-button>
          <el-button type="primary" @click="frameHelpVisible = false">知道了</el-button>
        </template>
      </el-dialog>
    </template>

    <!-- ============ 规则弹窗 ============ -->
    <el-dialog v-model="ruleDialogVisible" :title="ruleForm.id ? '编辑规则' : '新建规则'" :width="isMobile ? '92%' : '520px'">
      <el-form :label-width="isMobile ? '68px' : '88px'" label-position="left">
        <el-form-item label="事件">
          <el-select v-model="ruleForm.event" placeholder="选择事件" class="w-full">
            <el-option-group v-for="g in eventGroups" :key="g.name" :label="g.name">
              <el-option v-for="e in g.items" :key="e.key" :label="e.label" :value="e.key" />
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="直播间">
          <el-popover placement="bottom-end" :width="280" trigger="click" popper-class="dy-host-pop">
            <template #reference>
              <button type="button" class="rule-room-btn">
                <ArtSvgIcon icon="ri:live-line" />
                <span class="min-w-0 flex-1 truncate text-left">{{ ruleRoomLabel }}</span>
                <ArtSvgIcon icon="ri:arrow-down-s-line" class="dy-picker-btn__caret" />
              </button>
            </template>
            <div class="dy-host-list max-h-[300px] overflow-y-auto">
              <div class="px-1 pb-1 text-[11px] text-g-400">不选 = 全部直播间</div>
              <label
                v-for="r in roomOptions"
                :key="r.room_id"
                class="dy-host-row"
                :class="{ 'is-checked': ruleForm.room_ids.includes(r.room_id) }"
                @click.prevent="toggleRuleRoom(r.room_id)"
              >
                <el-checkbox
                  :model-value="ruleForm.room_ids.includes(r.room_id)"
                  @click.stop
                  @change="toggleRuleRoom(r.room_id)"
                />
                <el-avatar :size="20" :src="r.avatar || undefined" class="shrink-0">{{ r.name?.[0] }}</el-avatar>
                <span class="min-w-0 flex-1 truncate text-sm text-g-800">{{ r.name }}</span>
              </label>
            </div>
          </el-popover>
        </el-form-item>
        <!-- 只对「主播上场」有意义；必须选人：只提醒你勾的这些人 -->
        <el-form-item v-if="ruleForm.event === 'anchor_on_stage'" label="关注的人">
          <el-popover placement="bottom-end" :width="300" trigger="click" popper-class="dy-host-pop">
            <template #reference>
              <button type="button" class="rule-room-btn rule-people-btn">
                <ArtSvgIcon icon="ri:user-voice-line" />
                <span class="min-w-0 flex-1 truncate text-left">{{ watchLabel }}</span>
                <ArtSvgIcon icon="ri:arrow-down-s-line" class="dy-picker-btn__caret" />
              </button>
            </template>
            <div class="dy-host-list max-h-[320px] overflow-y-auto">
              <div class="px-1 pb-1 text-[11px] text-g-400">不选 = 任何主播上场都提醒</div>
              <label
                v-for="pp in people"
                :key="pp.uid"
                class="dy-host-row"
                :class="{ 'is-checked': ruleForm.watch_uids.includes(pp.uid) }"
                @click.prevent="toggleWatchUid(pp.uid)"
              >
                <el-checkbox
                  :model-value="ruleForm.watch_uids.includes(pp.uid)"
                  @click.stop
                  @change="toggleWatchUid(pp.uid)"
                />
                <span class="min-w-0 flex-1 truncate text-sm text-g-800">
                  {{ pp.nickname || pp.uid }}
                </span>
                <span class="shrink-0 text-[11px] text-g-400">{{ pp.rooms }} 房</span>
              </label>
              <div v-if="!people.length" class="px-1 py-2 text-[11px] text-g-400">
                还没记录到任何人（等有直播间开播、有人出现在麦上）
              </div>
            </div>
          </el-popover>
        </el-form-item>

        <el-form-item label="推送渠道">
          <el-select v-model="ruleForm.channel_ids" multiple placeholder="至少选一个" class="w-full">
            <el-option v-for="c in channels" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="免打扰">
          <div class="flex w-full items-center gap-2">
            <el-time-picker
              v-model="quietRange"
              is-range
              format="HH:mm"
              value-format="HH:mm"
              range-separator="至"
              start-placeholder="开始"
              end-placeholder="结束"
              class="min-w-0 flex-1"
            />
            <el-button link class="shrink-0" @click="clearQuiet">清除</el-button>
          </div>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="ruleForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          class="!min-w-[112px]"
          :loading="testingRule"
          :disabled="!ruleForm.channel_ids.length"
          @click="testRuleChannels"
        >
          发送测试
        </el-button>
        <el-button @click="ruleDialogVisible = false">取消</el-button>
        <el-button type="primary" class="!min-w-[88px]" :loading="saving" @click="submitRule">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 渠道弹窗 ============ -->
    <el-dialog v-model="channelDialogVisible" :title="channelForm.id ? '编辑渠道' : '新增渠道'" :width="isMobile ? '92%' : '520px'">
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
        <el-button class="!min-w-[112px]" :loading="testingId === -1" @click="testDraftChannel">测试这条</el-button>
        <el-button type="primary" class="!min-w-[88px]" :loading="saving" @click="submitChannel">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, h, onMounted, ref } from 'vue'
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
    testNotifyRule,
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
    fetchUpstagePeople,
    fetchUpstageSeen,
    fetchUpstageStatus,
    fetchUpstageWatch,
    resetUpstage,
    setUpstageWatchEnabled,
    type UpstageEvent,
    type UpstagePerson,
    type UpstageSeen,
    type UpstageStatus,
    type UpstageWatch
  } from '@/api/upstage'
  import { fetchRooms } from '@/api/douyin'
  import { usePermissionStore } from '@/store/modules/permission'
  import { useIsMobile } from '@/hooks/core/useIsMobile'
  import { useTableColumns } from '@/hooks/core/useTableColumns'
  import { apiErrorMessage } from '@/utils/douyin-error'
  import { fmtTime } from '@/utils/format'

  defineOptions({ name: 'DouyinNotify' })

  const { isMobile } = useIsMobile()
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
  /*
   * 列按屏幕宽度分两套：手机上一屏只有 ~350px，塞「事件 + 渠道 + 免打扰 + 状态 + 操作」
   * 会把「推送渠道」表头挤成竖排（截图反馈）。手机上只留 事件 / 渠道 / 状态 / 操作，
   * 免打扰在手机上去掉（改规则时仍能看到）。
   */
  /*
   * 规则表：列不按屏幕宽度删减（手机上横向滚动，操作列固定右侧）。
   * 注意：这里用普通常量而不是 computed —— 列设置弹层是 VueDraggable v-model + 勾选，
   * computed 每次渲染都生成新数组，拖拽/隐藏写不回去，弹层就成空的了。
   */
  const ruleColumns: ColumnOption[] = [
    { prop: 'event', label: '事件', width: 150, useSlot: true, slotName: 'event' },
    { prop: 'room_id', label: '直播间', width: 150, useSlot: true, slotName: 'room' },
    { prop: 'channels', label: '推送渠道', minWidth: 180, useSlot: true, slotName: 'channels' },
    ...(isMobile.value
      ? []
      : [{ prop: 'watch', label: '关注的人', width: 130, useSlot: true, slotName: 'watch' } as ColumnOption]),
    { prop: 'quiet', label: '免打扰', width: 140, useSlot: true, slotName: 'quiet' },
    { prop: 'enabled', label: '状态', width: 80, align: 'left', useSlot: true, slotName: 'enabled' },
    {
      prop: 'operation',
      label: '操作',
      align: 'left',
      width: 120,
      fixed: 'right',
      formatter: (row: NotifyRule) =>
        h('div', { style: 'display:flex;align-items:center;justify-content:flex-start;gap:4px;width:100%' }, [
          ...(can('notify.manage')
            ? [
                h(ArtButtonTable, { type: 'edit', onClick: () => openRuleDialog(row) }),
                h(ArtButtonTable, { type: 'delete', onClick: () => removeRule(row) })
              ]
            : [])
        ])
    }
  ]

  /*
   * 列宽要能"收"：之前地址列 minWidth 280 + 其余固定宽度，加起来超过表格容器宽度，
   * 最后一列（操作）就压到卡片右边框上（截图里三个图标正好压在竖线上）。
   * 现在只给必要列固定宽度，地址列自适应。
   */
  const channelColumns: ColumnOption[] = [
    { prop: 'name', label: '名称', minWidth: 150, useSlot: true, slotName: 'name' },
    { prop: 'type', label: '类型', width: 130, useSlot: true, slotName: 'type' },
    { prop: 'url', label: '地址', minWidth: 240, useSlot: true, slotName: 'url' },
    { prop: 'enabled', label: '状态', width: 80, align: 'left', useSlot: true, slotName: 'enabled' },
    {
      prop: 'operation',
      label: '操作',
      align: 'left',
      width: 160,
      fixed: 'right',
      formatter: (row: NotifyChannel) =>
        h('div', { style: 'display:flex;align-items:center;justify-content:flex-start;gap:4px;width:100%' }, [
          ...(can('notify.test')
            ? [
                h(ArtButtonTable, {
                  icon: 'ri:send-plane-line',
                  iconClass: 'bg-primary/12 text-primary',
                  onClick: () => testChannel(row)
                })
              ]
            : []),
          ...(can('notify.manage')
            ? [
                h(ArtButtonTable, { type: 'edit', onClick: () => openChannelDialog(row) }),
                h(ArtButtonTable, { type: 'delete', onClick: () => removeChannel(row) })
              ]
            : [])
        ])
    }
  ]

  const logColumns: ColumnOption[] = [
    { prop: 'created_at', label: '时间', width: 180, useSlot: true, slotName: 'created_at' },
    { prop: 'event', label: '事件', width: 140, useSlot: true, slotName: 'event' },
    { prop: 'channel_name', label: '渠道', minWidth: 160 },
    { prop: 'status', label: '状态', width: 90, align: 'left', useSlot: true, slotName: 'status' },
    { prop: 'error', label: '失败原因', minWidth: 260, useSlot: true, slotName: 'error' }
  ]

  /*
   * 列设置（右上角"字段管理"）需要 v-model:columns 传一个**可写**的列表，
   * 之前这里只传了 ArtTable 的 :columns，ArtTableHeader 收不到，弹层就是空的。
   * 三张表统一走 useTableColumns：defs 是默认列，columns 是实际渲染（跟着勾选变化）。
   */
  const { columns: ruleColumnsShown, columnChecks: ruleColumnChecks } = useTableColumns(() => ruleColumns)
  const { columns: channelColumnsShown, columnChecks: channelColumnChecks } = useTableColumns(
    () => channelColumns
  )
  const { columns: logColumnsShown, columnChecks: logColumnChecks } = useTableColumns(() => logColumns)

  const watchColumns: ColumnOption[] = [
    { prop: 'nickname', label: '昵称', minWidth: 120, useSlot: true, slotName: 'nickname' },
    { prop: 'uid', label: 'UID', minWidth: 150, useSlot: true, slotName: 'uid' },
    { prop: 'enabled', label: '推送', width: 80, align: 'left', useSlot: true, slotName: 'enabled' },
    {
      prop: 'operation',
      label: '操作',
      align: 'left',
      width: 90,
      fixed: 'right',
      formatter: (row: UpstageWatch) =>
        h('div', { style: 'display:flex;align-items:center;justify-content:flex-start;gap:4px;width:100%' }, [
          ...(can('upstage.manage')
            ? [h(ArtButtonTable, { type: 'delete', onClick: () => removeWatch(row) })]
            : [])
        ])
    }
  ]

  const upEventColumns: ColumnOption[] = [
    { prop: 'created_at', label: '时间', width: 170, useSlot: true, slotName: 'created_at' },
    { prop: 'event', label: '事件', width: 90, useSlot: true, slotName: 'event' },
    { prop: 'nickname', label: '主播', minWidth: 110, useSlot: true, slotName: 'nickname' },
    { prop: 'source', label: '来源', width: 84, useSlot: true, slotName: 'source' },
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

  /**
   * 免打扰用一个「时间段选择器」（el-time-picker is-range）编辑，
   * 内部仍然存 start/end 两个字段（后端 quiet_hours 的格式）。
   */
  const quietRange = computed({
    get: (): [string, string] | null =>
      quietStart.value && quietEnd.value ? [quietStart.value, quietEnd.value] : null,
    set: (v: [string, string] | null) => {
      quietStart.value = v?.[0] || ''
      quietEnd.value = v?.[1] || ''
    }
  })
  /** 现场出现过的人（跨房间汇总），给"关注的人"下拉用 */
  const people = ref<UpstagePerson[]>([])
  async function loadPeople() {
    try {
      // 候选按规则里选中的直播间过滤；没选直播间 = 所有房间
      const rooms = ruleForm.value.room_ids.join(',')
      const r = await fetchUpstagePeople(rooms ? { rooms } : {})
      people.value = r.items || []
      /*
       * 房间一改，原来勾的人可能已经不在候选里了（他不在这些房间）。
       * 这里不强行删掉已选的（用户可能就是要跨房间），但把不在候选里的保留在列表末尾，
       * 避免"勾了的人突然消失"。
       */
      const known = new Set(people.value.map((x) => x.uid))
      for (const uid of ruleForm.value.watch_uids) {
        if (!known.has(uid)) {
          people.value.push({ uid, nickname: '', last_seen_at: 0, rooms: 0, from: 'manual' })
        }
      }
    } catch {
      people.value = []
    }
  }

  /** 勾选/取消关注某个人 */
  function toggleWatchUid(uid: string) {
    const list = ruleForm.value.watch_uids
    const i = list.indexOf(uid)
    if (i >= 0) list.splice(i, 1)
    else list.push(uid)
  }

  /** 规则上的 watch_uids → 名字（解析不到就用 uid） */
  function watchNames(conditions: unknown): string[] {
    const uids = (conditions as { watch_uids?: unknown })?.watch_uids
    if (!Array.isArray(uids) || !uids.length) return []
    return uids.map((uid) => {
      const hit = people.value.find((x) => x.uid === String(uid))
      return hit?.nickname || String(uid)
    })
  }

  /** 表格「关注的人」列：N 人 / N 人 + 新人 / 全部 */
  function watchLabelOf(conditions: unknown): string {
    const count = watchNames(conditions).length
    if (!count) return '全部'
    return `${count} 人`
  }

  /** 按钮上显示的文案 */
  const watchLabel = computed(() => {
    const uids = ruleForm.value.watch_uids
    if (!uids.length) return '全部主播'
    const names = watchNames({ watch_uids: uids })
    return names.length === 1 ? names[0] : `${names[0]} 等 ${names.length} 个`
  })

  const ruleForm = ref<{
    id?: number
    event: string
    /**
     * 空数组 = 所有直播间；否则只对选中的这几个生效。
     * 存库时拼成逗号串写进 notify_rules.room_id（room_id 即 web_rid，和 dispatch 过滤用的是同一个）。
     */
    room_ids: string[]
    /**
     * 「关注的人」（只对「主播上场」有意义）：空数组 = 谁上场都提醒。
     * 存进 conditions.watch_uids，dispatch 按 uid 过滤。
     */
    watch_uids: string[]
    /**
     * 关注方式：
     *   any           这个房间谁上场都提醒
     *   listed        只提醒名单里的人
     *   listed_or_new 名单里的人 + 规则保存后新出现的人（兜底防漏）
     */
    match_mode: 'any' | 'listed' | 'listed_or_new'
    channel_ids: number[]
    enabled: boolean
  }>({
    event: '',
    channel_ids: [],
    room_ids: [],
    watch_uids: [],
    match_mode: 'any',
    enabled: true
  })

  function openRuleDialog(row?: NotifyRule) {
    if (!channels.value.length) {
      ElMessage.warning('先去「推送渠道」加一个渠道，规则才有地方推')
      activeTab.value = 'channels'
      return
    }
    ruleForm.value = row
      ? {
          id: row.id,
          event: row.event,
          room_ids: row.room_id ? String(row.room_id).split(',').filter(Boolean) : [],
          watch_uids: Array.isArray((row.conditions as { watch_uids?: unknown })?.watch_uids)
            ? ((row.conditions as { watch_uids: unknown[] }).watch_uids || []).map(String)
            : [],
          match_mode:
            ((row.conditions as { mode?: string })?.mode as 'any' | 'listed' | 'listed_or_new') ||
            (Array.isArray((row.conditions as { watch_uids?: unknown })?.watch_uids) &&
            ((row.conditions as { watch_uids: unknown[] }).watch_uids || []).length
              ? 'listed'
              : 'any'),
          channel_ids: [...row.channel_ids],
          enabled: !!row.enabled
        }
      : {
          event: events.value[0]?.key || '',
          room_ids: [],
          watch_uids: [],
          match_mode: 'any',
          channel_ids: [],
          enabled: true
        }
    quietStart.value = row?.quiet_hours?.start || ''
    quietEnd.value = row?.quiet_hours?.end || ''
    ruleDialogVisible.value = true
    void loadPeople()
  }

  /** 弹层里勾选/取消某个直播间 */
  function toggleRuleRoom(id: string) {
    const list = ruleForm.value.room_ids
    const i = list.indexOf(id)
    if (i >= 0) list.splice(i, 1)
    else list.push(id)
  }

  /** 按钮上显示的文案：没选=全部直播间，选了 1 个显示名字，多个显示「名字 等 N 个」 */
  const ruleRoomLabel = computed(() => {
    const ids = ruleForm.value.room_ids
    if (!ids.length) return '全部直播间'
    const names = ids.map((id) => roomOptions.value.find((r) => r.room_id === id)?.name || id)
    return names.length === 1 ? names[0] : `${names[0]} 等 ${names.length} 个`
  })

  /** 规则上的 room_id → 直播间名（空 = 全部直播间） */
  function roomName(id?: string | null) {
    if (!id) return '全部直播间'
    return String(id)
      .split(',')
      .filter(Boolean)
      .map((rid) => roomOptions.value.find((r) => r.room_id === rid)?.name || rid)
      .join('、')
  }

  /** 弹窗里改了直播间 → 候选人跟着变 */
  watch(
    () => ruleForm.value.room_ids.slice().sort().join(','),
    () => {
      if (ruleDialogVisible.value) void loadPeople()
    }
  )

  function clearQuiet() {
    quietStart.value = ''
    quietEnd.value = ''
  }

  const testingRule = ref(false)
  /** 规则「发送测试」：按选中的渠道各发一条样例，把每个渠道的结果显示出来 */
  async function testRuleChannels() {
    if (!ruleForm.value.channel_ids.length) return ElMessage.warning('先选推送渠道')
    testingRule.value = true
    try {
      const r = await testNotifyRule({
        event: ruleForm.value.event,
        channel_ids: ruleForm.value.channel_ids
      })
      const rows = r.results || []
      const ok = rows.filter((x) => x.ok).length
      const failed = rows.filter((x) => !x.ok)
      if (failed.length) {
        ElMessage.error(
          `${ok} 个渠道已发送，${failed.length} 个失败：` +
            failed.map((x) => `${x.name || x.channel_id}(${x.error || '未知错误'})`).join('；')
        )
      } else {
        ElMessage.success(`已发送到 ${ok} 个渠道，去对应群里看看`)
      }
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '发送测试失败'))
    } finally {
      testingRule.value = false
    }
  }

  async function submitRule() {
    if (!ruleForm.value.event) return ElMessage.warning('请选择事件')
    if (ruleForm.value.event === 'anchor_on_stage' && !ruleForm.value.watch_uids.length) {
      return ElMessage.warning('主播上场提醒要先选「关注的人」——只提醒你勾选的主播')
    }
    if (!ruleForm.value.channel_ids.length) return ElMessage.warning('至少选一个推送渠道')
    saving.value = true
    try {
      const r = await saveNotifyRule({
        id: ruleForm.value.id,
        event: ruleForm.value.event,
        room_id: ruleForm.value.room_ids.length ? ruleForm.value.room_ids.join(',') : null,
        // 上场提醒固定为「只提醒名单里的人」；其它事件不带条件
        conditions:
          ruleForm.value.event === 'anchor_on_stage'
            ? { mode: 'listed', watch_uids: ruleForm.value.watch_uids }
            : {},
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
        room_id: row.room_id || null,
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
  const frameHelpVisible = ref(false)
  /** 已添加的直播间（下拉用，不再手填 web_rid） */
  const roomOptions = ref<{ room_id: string; name: string; avatar?: string }[]>([])
  const upLoadingMembers = ref(false)
  const members = ref<{ uid: string; nickname: string }[]>([])
  const watchList = ref<UpstageWatch[]>([])
  const upStatus = ref<UpstageStatus | null>(null)
  const upEvents = ref<UpstageEvent[]>([])
  const seenList = ref<UpstageSeen[]>([])
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

  /** 单个主播的推送开关 */
  async function toggleWatch(row: UpstageWatch, enabled: boolean) {
    try {
      const r = await setUpstageWatchEnabled({
        web_rid: row.web_rid || upWebRid.value.trim(),
        uid: row.uid,
        nickname: row.nickname,
        enabled: enabled ? 1 : 0
      })
      const rid = upWebRid.value.trim()
      watchList.value = (r.items || []).filter((x: UpstageWatch) => x.web_rid === rid)
    } catch (e) {
      ElMessage.error(apiErrorMessage(e, '更新推送开关失败'))
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
    // 已添加的直播间：上场提醒的直播间下拉直接用它们，不再让用户手填 web_rid
    try {
      const rooms = await fetchRooms()
      const list = Array.isArray(rooms) ? rooms : (rooms as any)?.rooms || []
      roomOptions.value = list
        .map((r: any) => ({
          room_id: String(r.room_id || r.roomId || ''),
          name: r.name || String(r.room_id || ''),
          avatar: r.avatar || ''
        }))
        .filter((r: { room_id: string }) => r.room_id)
      if (!upWebRid.value && roomOptions.value.length) upWebRid.value = roomOptions.value[0].room_id
    } catch {
      /* 房间列表失败不阻塞页面 */
    }
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
  /*
   * 规则弹窗里的「直播间」按钮：外观对齐上面的 el-select（不是 chip 样式）。
   * 数值来自实测 el-select__wrapper：高 36px、圆角 6px、1px inset 阴影当边框、白底、字号 14px。
   */
  .rule-room-btn {
    display: flex;
    width: 100%;
    height: 36px;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    border: none;
    border-radius: 6px;
    background: var(--el-fill-color-blank, #fff);
    box-shadow: 0 0 0 1px var(--el-border-color, #dcdfe6) inset;
    font-size: 14px;
    color: var(--el-text-color-regular, #606266);
    cursor: pointer;
    text-align: left;
  }

  .rule-room-btn:hover {
    box-shadow: 0 0 0 1px var(--el-border-color-hover, #c0c4cc) inset;
  }

  .dy-chip {
    display: inline-block;
    margin-right: 4px;
    padding: 1px 6px;
    border-radius: var(--dy-radius-sm);
    background: var(--art-gray-100, #f4f5f7);
    font-size: 11px;
    color: var(--art-gray-600, #5b6068);
  }
</style>

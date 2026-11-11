const fs = require('fs')
const p = 'frontend/src/views/douyin/notify/index.vue'
let s = fs.readFileSync(p, 'utf8')
const crlf = s.includes('\r\n')
let t = s.split('\r\n').join('\n')

// ---------- 1) 规则表：恢复全部列（不再按手机删列） ----------
const ruleStart = t.indexOf('  const ruleColumns = computed<ColumnOption[]>(() => [')
const ruleEnd = t.indexOf('  /*\n   * 列宽要能"收"')
if (ruleStart < 0 || ruleEnd < 0) throw new Error('定位规则表失败')
const newRule = `  /*
   * 规则表：列不再按屏幕宽度删减（手机上横向滚动，操作列固定右侧）。
   * 之前为了挤进 350px 删了「直播间 / 免打扰 / 状态」，反而看不见自己配了什么。
   */
  const ruleColumns: ColumnOption[] = [
    { prop: 'event', label: '事件', width: 150, useSlot: true, slotName: 'event' },
    { prop: 'room_id', label: '直播间', width: 150, useSlot: true, slotName: 'room' },
    { prop: 'channels', label: '推送渠道', minWidth: 180, useSlot: true, slotName: 'channels' },
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

`
t = t.slice(0, ruleStart) + newRule + t.slice(ruleEnd)

// ---------- 2) 渠道表：恢复 类型 / 地址 ----------
const chStart = t.indexOf('  const channelColumns = computed<ColumnOption[]>(() => [')
const chEnd = t.indexOf('  /*\n   * 发送记录：只留')
if (chStart < 0 || chEnd < 0) throw new Error('定位渠道表失败')
const newChannel = `  const channelColumns: ColumnOption[] = [
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

`
t = t.slice(0, chStart) + newChannel + t.slice(chEnd)

// ---------- 3) 发送记录：恢复「失败原因」列 ----------
const logStart = t.indexOf('  /*\n   * 发送记录：只留')
const logEnd = t.indexOf('  const watchColumns')
if (logStart < 0 || logEnd < 0) throw new Error('定位发送记录失败')
const newLog = `  const logColumns: ColumnOption[] = [
    { prop: 'created_at', label: '时间', width: 180, useSlot: true, slotName: 'created_at' },
    { prop: 'event', label: '事件', width: 140, useSlot: true, slotName: 'event' },
    { prop: 'channel_name', label: '渠道', minWidth: 160 },
    { prop: 'status', label: '状态', width: 90, align: 'left', useSlot: true, slotName: 'status' },
    { prop: 'error', label: '失败原因', minWidth: 260, useSlot: true, slotName: 'error' }
  ]

`
t = t.slice(0, logStart) + newLog + t.slice(logEnd)

fs.writeFileSync(p, crlf ? t.split('\n').join('\r\n') : t)
console.log('OK 规则/渠道/发送记录 列已恢复')

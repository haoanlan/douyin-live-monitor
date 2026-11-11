/**
 * 通知管理 API。
 *
 * 后端对应 lib/routes/notify.js；渠道/规则的读写要求 notify.manage，
 * 测试发送要求 notify.test（R_SUPER 恒通过）。
 *
 * 注意：这里的 request 用法是 `request.get({ url, params })`（见 douyin-http.ts 的 toConfig）。
 */
import request from '@/api/douyin-http'

export interface NotifyChannel {
  id: number
  type: 'wecom' | 'feishu' | 'dingtalk' | 'webhook'
  name: string
  config: { url?: string; token?: string }
  enabled: number | boolean
}

export interface NotifyRule {
  id: number
  event: string
  room_id?: string | null
  channel_ids: number[]
  conditions: Record<string, unknown>
  quiet_hours?: { start?: string; end?: string } | null
  enabled: number | boolean
}

export interface NotifyLog {
  id: number
  rule_id?: number | null
  event: string
  channel_id?: number | null
  channel_name?: string
  payload?: string
  status: 'sent' | 'failed'
  error?: string
  created_at: number
}

export function fetchNotifyMeta() {
  return request.get<{ events: { key: string; label: string; group: string }[]; channelTypes: { key: string; label: string; hint: string }[] }>({
    url: '/api/notify/meta'
  })
}

export function fetchNotifyChannels() {
  return request.get<{ items: NotifyChannel[] }>({ url: '/api/notify/channels' })
}

export function saveNotifyChannel(data: Partial<NotifyChannel>) {
  return request.post<{ id: number; items: NotifyChannel[] }>({ url: '/api/notify/channels', data })
}

export function deleteNotifyChannel(id: number) {
  return request.post<{ items: NotifyChannel[] }>({ url: '/api/notify/channels/delete', data: { id } })
}

export function testNotifyChannel(data: { id?: number; type?: string; config?: Record<string, unknown> }) {
  return request.post<{ ok: boolean; error?: string }>({ url: '/api/notify/channels/test', data })
}

export function fetchNotifyRules() {
  return request.get<{ items: NotifyRule[] }>({ url: '/api/notify/rules' })
}

export function saveNotifyRule(data: Partial<NotifyRule>) {
  return request.post<{ id: number; items: NotifyRule[] }>({ url: '/api/notify/rules', data })
}

/** 规则「发送测试」：按当前选中的渠道各发一条样例，返回每个渠道的结果 */
export function testNotifyRule(data: { event?: string; channel_ids: number[] }) {
  return request.post<{ results: { channel_id: number; name?: string; type?: string; ok: boolean; error?: string }[] }>({
    url: '/api/notify/rules/test',
    data
  })
}

export function deleteNotifyRule(id: number) {
  return request.post<{ items: NotifyRule[] }>({ url: '/api/notify/rules/delete', data: { id } })
}

export function fetchNotifyLogs(params: { page?: number; size?: number; status?: string } = {}) {
  return request.get<{ total: number; items: NotifyLog[] }>({ url: '/api/notify/logs', params })
}

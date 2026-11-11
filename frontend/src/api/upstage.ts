/**
 * 主播上场提醒 API。
 *
 * 帧入口（/api/upstage/frames）由外部采集进程用 X-Upstage-Token 调用，
 * 页面这边只用名单 / 状态 / 事件。
 */
import request from '@/api/douyin-http'

export interface UpstageWatch {
  id: number
  web_rid: string
  uid: string
  nickname?: string
  enabled: boolean
}

export interface UpstageStatus {
  runtime: { webRid: string; lastFrameAt: number; lastSource: string; streamGapSecs: number | null } | null
  rank: { webRid: string; roomId: string; mappedUsers: number; mappedAt: number } | null
  states: { web_rid: string; uid: string; hits: number; present: number; last_seen_at: number; pending: number }[]
  params: {
    confMin: number
    needHits: number
    goneSecs: number
    cooldownSecs: number
    streamGapSecs: number
  }
  frameToken: string
}

export interface UpstageEvent {
  id: number
  web_rid: string
  uid: string
  nickname?: string
  event: string
  detail?: string
  created_at: number
}

export function fetchUpstageWatch(params: { webRid?: string } = {}) {
  return request.get<{ items: UpstageWatch[] }>({ url: '/api/upstage/watch', params })
}

export function addUpstageWatch(data: { web_rid: string; uid: string; nickname?: string; enabled?: number }) {
  return request.post<{ items: UpstageWatch[] }>({ url: '/api/upstage/watch', data })
}

export function deleteUpstageWatch(id: number) {
  return request.post<{ items: UpstageWatch[] }>({ url: '/api/upstage/watch/delete', data: { id } })
}

export function fetchUpstageMembers(params: { webRid: string; force?: string }) {
  return request.get<{ items: { uid: string; nickname: string }[]; status: { roomId: string; mappedUsers: number } }>({
    url: '/api/upstage/members',
    params
  })
}

export function fetchUpstageStatus(params: { webRid: string }) {
  return request.get<UpstageStatus>({ url: '/api/upstage/status', params })
}

export function resetUpstage(webRid: string) {
  return request.post<{ ok: boolean }>({ url: '/api/upstage/reset', data: { webRid } })
}

export function fetchUpstageEvents(params: { webRid?: string; page?: number; size?: number } = {}) {
  return request.get<{ total: number; items: UpstageEvent[] }>({ url: '/api/upstage/events', params })
}

export interface UpstageSeen {
  web_rid: string
  uid: string
  nickname?: string
  source?: string
  last_seen_at: number
}

export function fetchUpstageSeen(params: { webRid: string }) {
  return request.get<{ items: UpstageSeen[] }>({ url: '/api/upstage/seen', params })
}

export interface UpstagePerson {
  uid: string
  nickname?: string | null
  /** 最近一次在哪个房间出现（不返回给页面，仅用于补昵称） */
  last_seen_at: number
  rooms: number
  conf?: number | null
}

/** 现场出现过的人（跨房间汇总，给规则里「关注的人」下拉用） */
export function fetchUpstagePeople() {
  return request.get<{ items: UpstagePerson[] }>({ url: '/api/upstage/people' })
}

/** 切换某个主播的推送开关（enabled 0/1） */
export function setUpstageWatchEnabled(data: { web_rid: string; uid: string; nickname?: string; enabled: number }) {
  return request.post<{ items: UpstageWatch[] }>({ url: '/api/upstage/watch', data })
}
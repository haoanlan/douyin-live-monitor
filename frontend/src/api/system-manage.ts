import request from '@/utils/http'
import type { AppRouteRecord } from '@/types/router'

/**
 * 系统管理（用户 / 角色 / 菜单）三页的数据适配层。
 *
 * 这三页是从 Art Design Pro 原版恢复回来的（`568ba55` 里被当"未注册模板页"删掉），
 * 它们期望的是模板那套接口形状：
 *   · 列表：{ records, total, current, size }
 *   · 菜单：AppRouteRecord[] 路由树（meta.title / meta.icon / meta.authMark ...）
 * 我们的后端是 /api/user/list、/api/admin/{roles,menus}，
 * 所以统一在这一层做**形状转换**，页面代码保持模板原样。
 */

/** 后端列表接口可能把数组放在 items / roles / records 里，这里统一取一次 */
function pickArray<T>(res: any, key: string): T[] {
  if (Array.isArray(res)) return res
  if (!res) return []
  if (Array.isArray(res[key])) return res[key]
  if (Array.isArray(res.items)) return res.items
  if (Array.isArray(res.records)) return res.records
  if (Array.isArray(res.data)) return res.data
  return []
}

// ---------------- 用户 ----------------

/** 获取用户列表（后端已按 {records,current,size,total} 返回，直接透传） */
export function fetchGetUserList(params: Api.SystemManage.UserSearchParams) {
  return request.get<Api.SystemManage.UserList>({
    url: '/api/user/list',
    params
  })
}

// ---------------- 角色 ----------------

/**
 * 获取角色列表。
 * 后端 /api/admin/roles 返回 { roles: [{ key, name, note, menu_count, action_count }] }，
 * 这里映射成模板要的 RoleListItem，并在**前端**做过滤 / 分页
 * （角色总量只有个位数，没必要为此加后端分页）。
 */
export async function fetchGetRoleList(
  params: Api.SystemManage.RoleSearchParams = {}
): Promise<Api.SystemManage.RoleList> {
  const res: any = await request.get({ url: '/api/admin/roles' })
  const roles = pickArray<any>(res, 'roles')

  let rows: Api.SystemManage.RoleListItem[] = roles.map((r, i) => ({
    roleId: i + 1,
    roleName: r.name || r.key || '',
    roleCode: r.key || '',
    description: r.note || '',
    enabled: true,
    createTime: ''
  }))

  const kw = (v?: string) => (v || '').toLowerCase().trim()
  const name = kw(params.roleName)
  const code = kw(params.roleCode)
  const desc = kw(params.description)
  if (name) rows = rows.filter((r) => r.roleName.toLowerCase().includes(name))
  if (code) rows = rows.filter((r) => r.roleCode.toLowerCase().includes(code))
  if (desc) rows = rows.filter((r) => (r.description || '').toLowerCase().includes(desc))

  const current = Number(params.current) || 1
  const size = Number(params.size) || 20
  const total = rows.length
  const records = rows.slice((current - 1) * size, current * size)
  return { records, total, current, size }
}

// ---------------- 菜单 ----------------

/**
 * 获取菜单树。
 * 后端 /api/admin/menus 返回扁平列表 { items: [{ key,title,path,icon,parentKey,sort,visible,hidden,menuType,perms }] }，
 * 模板页吃的是 AppRouteRecord 树，这里按 parentKey 组树并补 meta。
 *
 * perms → meta.authMark（模板用它显示"权限标识"那一列）；
 * 以后如果加 menu_type='button' 的行，会自然变成子节点。
 */
export async function fetchGetMenuList(): Promise<AppRouteRecord[]> {
  const res: any = await request.get({ url: '/api/admin/menus' })
  const items = pickArray<any>(res, 'items')

  interface Node {
    key: string
    title: string
    path?: string
    icon?: string
    parentKey?: string | null
    sort?: number
    visible?: number
    hidden?: number
    menuType?: string
    perms?: string
  }

  const nodes: Node[] = items
  const childrenOf = new Map<string, Node[]>()
  for (const n of nodes) {
    const p = n.parentKey || ''
    if (!childrenOf.has(p)) childrenOf.set(p, [])
    childrenOf.get(p)!.push(n)
  }
  for (const list of childrenOf.values()) list.sort((a, b) => (a.sort || 100) - (b.sort || 100))

  const toRoute = (n: Node): AppRouteRecord => {
    const children = (childrenOf.get(n.key) || []).map(toRoute)
    const route: any = {
      path: n.path || '',
      name: n.key,
      meta: {
        title: n.title,
        icon: n.icon || '',
        keepAlive: false,
        hidden: !!n.hidden,
        ...(n.perms ? { authMark: n.perms, authList: [{ title: n.perms, authMark: n.perms }] } : {})
      }
    }
    if (children.length) route.children = children
    return route as AppRouteRecord
  }

  return (childrenOf.get('') || []).map(toRoute)
}

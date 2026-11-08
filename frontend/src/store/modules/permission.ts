/**
 * 权限状态（页面 + 操作）
 *
 * 数据来源只有一个：GET /api/auth/permissions
 *   · menus/menuPaths —— 当前角色能看的页面（role_menus）
 *   · actions         —— 当前角色能做的操作（role_actions）
 *
 * 用途：
 *   1. 路由守卫里按 menuPaths 过滤侧边栏 / 拦截越权跳转
 *   2. 页面里用 hasPerm('room.pause') 决定按钮显隐
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import request from '@/api/douyin-http'

interface PermPayload {
  role: string
  isSuper: boolean
  actions: string[]
  menuPaths: string[]
  menuKeys: string[]
}

export const usePermissionStore = defineStore('permissionStore', () => {
  const loaded = ref(false)
  const loading = ref(false)
  const role = ref('')
  const isSuper = ref(false)
  const actions = ref<string[]>([])
  const menuPaths = ref<string[]>([])
  const menuKeys = ref<string[]>([])

  async function load(force = false) {
    if (loading.value) return
    if (loaded.value && !force) return
    loading.value = true
    try {
      const r: any = await request.get({ url: '/api/auth/permissions' })
      role.value = r?.role || ''
      isSuper.value = Boolean(r?.isSuper)
      actions.value = Array.isArray(r?.actions) ? r.actions : []
      menuPaths.value = Array.isArray(r?.menuPaths) ? r.menuPaths : []
      menuKeys.value = Array.isArray(r?.menuKeys) ? r.menuKeys : []
      loaded.value = true
    } catch {
      // 拿不到就当作"没有细粒度权限"，页面级仍由菜单/路由兜底
      loaded.value = false
    } finally {
      loading.value = false
    }
  }

  function reset() {
    loaded.value = false
    role.value = ''
    isSuper.value = false
    actions.value = []
    menuPaths.value = []
    menuKeys.value = []
  }

  /** 有没有某个操作权限（超管恒真；未加载时一律放行，避免白屏） */
  function hasPerm(action: string): boolean {
    if (isSuper.value) return true
    if (!loaded.value) return true
    return actions.value.includes(action)
  }

  /** 统一成绝对路径（前端路由里有的带前导斜杠、有的不带，不归一会全被过滤掉） */
  function normPath(p: string): string {
    if (!p) return ''
    const s = String(p).split('?')[0].split('#')[0].replace(/\/+$/, '')
    if (!s) return ''
    return s.startsWith('/') ? s : '/' + s
  }

  /** 这条路径是否被授权（超管恒真；未加载时放行） */
  function canVisit(path: string): boolean {
    if (isSuper.value || !loaded.value) return true
    const t = normPath(path)
    if (!t) return true
    /*
     * **精确匹配**，不做前缀匹配。
     * 前缀匹配的坑：父目录 '/douyin' 一旦被授权，'/douyin/' 开头的所有子页
     * （房间管理、礼物价格、状态监控…）就全被放行了，取消勾选等于没生效。
     */
    return menuPaths.value.some((p) => normPath(p) === t)
  }

  /**
   * 按路径裁剪菜单树（保留有被授权子节点的父级）。
   *
   * 注意两点（踩过的坑）：
   *   1. 子路由的 path 是相对父级的（'dashboard'），要和父级拼成绝对路径再比对；
   *   2. 父级目录本身（如 /douyin）可能没被单独授权，但只要子节点有授权就要保留，
   *      否则整棵子树会被剪掉 —— 表现就是"登录后侧边栏空白 + 跳 /500"。
   */
  function filterMenus<T extends { path?: string; children?: T[] }>(list: T[]): T[] {
    if (isSuper.value || !loaded.value) return list

    const joinPath = (parent: string, child: string) => {
      if (!child) return parent
      if (child.startsWith('/')) return child
      return `${parent.replace(/\/+$/, '')}/${child}`.replace(/\/{2,}/g, '/')
    }

    const walk = (nodes: T[], parentPath: string): T[] => {
      const out: T[] = []
      for (const n of nodes) {
        const full = joinPath(parentPath, n.path || '')
        const children = n.children?.length ? walk(n.children, full) : []
        if (children.length) {
          out.push({ ...n, children })
        } else if (canVisit(full)) {
          out.push(n)
        }
      }
      return out
    }

    // 不兜底成"全放行"：勾掉全部页面就该是空菜单（之前兜底会让取消勾选完全失效）
    return walk(list, '')
  }

  return {
    loaded,
    loading,
    role,
    isSuper,
    actions,
    menuPaths,
    menuKeys,
    load,
    reset,
    hasPerm,
    canVisit,
    filterMenus
  }
})

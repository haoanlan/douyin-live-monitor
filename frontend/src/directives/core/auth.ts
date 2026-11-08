/**
 * v-auth 权限指令
 *
 * 两种用法：
 *   1. `v-auth="'room.pause'"` —— **操作权限**（带点号）：查 /api/auth/permissions
 *      返回的 actions（role_actions），没有就移除元素。这是本项目的用法。
 *   2. `v-auth="'add'"` —— 模板原有的用法：查当前路由 meta.authList。
 *      我们没配 authList 的页面视为放行，避免整页按钮被误删。
 *
 * 数据来源统一在 store/modules/permission.ts，加载时机是路由守卫（beforeEach）里。
 */
import { router } from '@/router'
import { usePermissionStore } from '@/store/modules/permission'
import { App, Directive, DirectiveBinding } from 'vue'

export type AuthDirective = Directive<HTMLElement, string>

function isAllowed(key: string): boolean {
  if (!key) return true

  // 带点号的是操作权限（room.pause / gift_price.write …）
  if (key.includes('.')) {
    try {
      return usePermissionStore().hasPerm(key)
    } catch {
      return true
    }
  }

  const authList = (router.currentRoute.value.meta.authList as Array<{ authMark: string }>) || []
  // 没配 authList 的页面不做限制（否则模板里 v-auth="'add'" 会把按钮全删掉）
  if (!authList.length) return true
  return authList.some((item) => item.authMark === key)
}

function checkAuthPermission(el: HTMLElement, binding: DirectiveBinding<string>): void {
  if (!isAllowed(binding.value)) removeElement(el)
}

function removeElement(el: HTMLElement): void {
  el.parentNode?.removeChild(el)
}

const authDirective: AuthDirective = {
  mounted: checkAuthPermission,
  updated: checkAuthPermission
}

export function setupAuthDirective(app: App): void {
  app.directive('auth', authDirective)
}

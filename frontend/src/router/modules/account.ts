import { AppRouteRecord } from '@/types/router'

/**
 * 系统管理（只有管理员看得到）。
 *
 * 结构照 Art Design Pro 原版的「系统管理」分组：用户管理 / 角色管理 / 菜单管理。
 * 以前这个模块叫「账号管理」，只有用户管理一个子页；现在补齐三个 ——
 * 这三者是同一件事的三个部分（谁能进、能看哪些页、页本身怎么配）。
 *
 * 侧边栏会按 meta.roles 自动对普通用户隐藏。
 */
export const accountRoutes: AppRouteRecord = {
  path: '/system',
  name: 'System',
  component: '/index/index',
  meta: {
    title: '系统管理',
    icon: 'ri:settings-3-line',
    roles: ['R_SUPER']
  },
  children: [
    {
      path: 'user',
      name: 'SystemUser',
      component: '/system/user-manage',
      meta: {
        title: '用户管理',
        icon: 'ri:user-settings-line',
        keepAlive: true,
        roles: ['R_SUPER']
      }
    },
    {
      path: 'role',
      name: 'SystemRole',
      component: '/douyin/permissions/roles',
      meta: {
        title: '角色管理',
        icon: 'ri:shield-user-line',
        keepAlive: true,
        roles: ['R_SUPER']
      }
    },
    {
      path: 'menu',
      name: 'SystemMenu',
      component: '/douyin/permissions/menus',
      meta: {
        title: '菜单管理',
        icon: 'ri:menu-line',
        keepAlive: true,
        roles: ['R_SUPER']
      }
    }
  ]
}

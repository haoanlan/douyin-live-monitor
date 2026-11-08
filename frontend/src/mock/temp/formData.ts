/**
 * 模板页（system/user、system/role、system/menu）留下的两份 mock 数据。
 *
 * 原来在 `@/mock/temp/formData`，和那 99 个"未注册的模板页"一起被删掉了；
 * 现在把三个系统管理页恢复成模板原版，这两处引用还在，所以补一个最小实现：
 *   · ACCOUNT_TABLE_DATA —— 只被用来"给列表里没有头像的行随便配一个头像"，
 *     我们的账号表本来就没有头像，保留空字符串即可（不引入无意义的假头像）。
 *   · ROLE_LIST_DATA —— 用户弹窗里的角色下拉，直接映射我们的两个角色。
 */
export interface AccountTableRowMock {
  avatar: string
}

export const ACCOUNT_TABLE_DATA: AccountTableRowMock[] = [
  { avatar: '' },
  { avatar: '' },
  { avatar: '' },
  { avatar: '' }
]

export interface RoleListRowMock {
  roleName: string
  roleCode: string
}

export const ROLE_LIST_DATA: RoleListRowMock[] = [
  { roleName: '超级管理员', roleCode: 'R_SUPER' },
  { roleName: '访客', roleCode: 'R_GUEST' }
]

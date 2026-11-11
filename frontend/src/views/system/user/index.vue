<!-- 用户管理页面 -->
<!-- art-full-height 自动计算出页面剩余高度 -->
<!-- art-table-card 一个符合系统样式的 class，同时自动撑满剩余高度 -->
<!-- 更多 useTable 使用示例请移步至 功能示例 下面的高级表格示例或者查看官方文档 -->
<!-- useTable 文档：https://www.artd.pro/docs/zh/guide/hooks/use-table.html -->
<template>
  <div class="user-page art-full-height">
    <!-- 搜索栏 -->
    <UserSearch v-model="searchForm" @search="handleSearch" @reset="resetSearchParams"></UserSearch>

    <ElCard class="art-table-card">
      <!-- 表格头部 -->
      <ArtTableHeader v-model:columns="columnChecks" :loading="loading" @refresh="refreshData">
        <template #left>
          <ElSpace wrap>
            <ElButton @click="showDialog('add')" v-ripple>新增用户</ElButton>
          </ElSpace>
        </template>
      </ArtTableHeader>

      <!-- 表格 -->
      <ArtTable
        :loading="loading"
        :data="data"
        :columns="columns"
        :pagination="pagination"
        @selection-change="handleSelectionChange"
        @pagination:size-change="handleSizeChange"
        @pagination:current-change="handleCurrentChange"
      >
      </ArtTable>

      <!-- 用户弹窗 -->
      <UserDialog
        v-model:visible="dialogVisible"
        :type="dialogType"
        :user-data="currentUserData"
        @submit="handleDialogSubmit"
      />
    </ElCard>
  </div>
</template>

<script setup lang="ts">
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import { useTable } from '@/hooks/core/useTable'
  import { fetchGetUserList, fetchGetRoleList } from '@/api/system-manage'
  import { deleteUser as apiDeleteUser, resetUserPassword, updateUser } from '@/api/auth-douyin'
  import { useUserStore } from '@/store/modules/user'
  import UserSearch from './modules/user-search.vue'
  import UserDialog from './modules/user-dialog.vue'
  import { ElTag, ElMessage, ElMessageBox } from 'element-plus'
  import { DialogType } from '@/types'

  defineOptions({ name: 'User' })

  type UserListItem = Api.SystemManage.UserListItem

  /**
   * dashboard_users.role 的取值 → 显示名。
   *
   * 不能写死：角色管理改的是库里 roles 表的 name（默认「超级管理员 / 访客」），
   * 这里硬编码「管理员 / 普通用户」就会两页对不上（用户反馈"角色和实际不对"）。
   * 启动时从 /api/admin/roles 拉一次；接口失败才退回内置两项。
   */
  const roleLabels = ref<Record<string, string>>({ R_SUPER: '管理员', R_GUEST: '普通用户' })

  async function loadRoleLabels() {
    try {
      const list = await fetchGetRoleList()
      const map: Record<string, string> = {}
      for (const r of list?.records || []) {
        if (r.roleCode) map[r.roleCode] = r.roleName || r.roleCode
      }
      if (Object.keys(map).length) roleLabels.value = map
    } catch {
      /* 拉不到就沿用内置名称，不影响其它功能 */
    }
  }
  onMounted(loadRoleLabels)

  const myId = useUserStore().getUserInfo?.userId

  // 弹窗相关
  const dialogType = ref<DialogType>('add')
  const dialogVisible = ref(false)
  const currentUserData = ref<Partial<UserListItem>>({})

  // 选中行
  const selectedRows = ref<UserListItem[]>([])

  // 搜索表单
  const searchForm = ref({
    userName: undefined
  })



  const {
    columns,
    columnChecks,
    data,
    loading,
    pagination,
    getData,
    replaceSearchParams,
    resetSearchParams,
    handleSizeChange,
    handleCurrentChange,
    refreshData
  } = useTable({
    // 核心配置
    core: {
      apiFn: fetchGetUserList,
      apiParams: {
        current: 1,
        size: 20,
        ...searchForm.value
      },
      // 自定义分页字段映射，未设置时将使用全局配置 tableConfig.ts 中的 paginationKey
      // paginationKey: {
      //   current: 'pageNum',
      //   size: 'pageSize'
      // },
      columnsFactory: () => [
        { type: 'selection' }, // 勾选列
        { type: 'index', width: 60, label: '序号' }, // 序号
        /*
         * 列按**本地字段**来（表 dashboard_users）：
         *   username / role / enabled / create_time / last_login_time
         * 模板原来的 性别 / 手机号 / 邮箱 / 头像 我们库里根本没有，
         * 硬留着只会永远显示空白，所以换成真实有的「角色 / 状态 / 创建时间 / 上次登录」。
         */
        {
          prop: 'userName',
          label: '用户名',
          minWidth: 180,
          formatter: (row) =>
            h('div', { class: 'flex-c gap-2' }, [
              h(
                'span',
                {
                  class:
                    'inline-flex size-7 items-center justify-center rounded-md bg-theme/10 text-theme text-xs font-medium'
                },
                String(row.userName || '?').slice(0, 1).toUpperCase()
              ),
              h('span', { class: 'font-medium text-g-900' }, row.userName),
              row.id === myId ? h(ElTag, { size: 'small', effect: 'plain' }, () => '当前登录') : null
            ])
        },
        {
          prop: 'userRoles',
          label: '角色',
          width: 140,
          formatter: (row) => {
            const code = row.userRoles?.[0] || ''
            return h(
              ElTag,
              { type: code === 'R_SUPER' ? 'warning' : 'info', effect: 'light' },
              () => roleLabels.value[code] || code || '—'
            )
          }
        },
        {
          prop: 'status',
          label: '状态',
          width: 100,
          formatter: (row) =>
            h(
              ElTag,
              { type: row.status === '1' ? 'success' : 'danger', effect: 'light' },
              () => (row.status === '1' ? '启用' : '停用')
            )
        },
        {
          prop: 'createTime',
          label: '创建时间',
          width: 180,
          formatter: (row) => row.createTime || '—'
        },
        {
          prop: 'updateTime',
          label: '上次登录',
          width: 180,
          formatter: (row) => row.updateTime || '—'
        },
        {
          prop: 'operation',
          label: '操作',
          width: 160,
          align: 'right',
          fixed: 'right', // 固定列
          formatter: (row) =>
            h('div', { style: 'display:flex;align-items:center;justify-content:flex-end;gap:4px;width:100%' }, [
              h(ArtButtonTable, { type: 'edit', onClick: () => showDialog('edit', row) }),
              h(ArtButtonTable, {
                icon: 'ri:lock-password-line',
                iconClass: 'bg-warning/12 text-warning',
                onClick: () => resetPassword(row)
              }),
              h(ArtButtonTable, {
                type: 'delete',
                onClick: () => deleteUser(row)
              })
            ])
        }
      ]
    }
  })

  /**
   * 搜索处理
   * @param params 参数
   */
  const handleSearch = (params: Api.SystemManage.UserSearchParams) => {
    replaceSearchParams(params)
    getData()
  }

  /**
   * 显示用户弹窗
   */
  const showDialog = (type: DialogType, row?: UserListItem): void => {
    console.log('打开弹窗:', { type, row })
    dialogType.value = type
    currentUserData.value = row || {}
    nextTick(() => {
      dialogVisible.value = true
    })
  }

  /**
   * 删除账号（后端会保护「最后一个管理员」和自己）
   */
  const deleteUser = async (row: UserListItem): Promise<void> => {
    try {
      await ElMessageBox.confirm(`确定删除账号「${row.userName}」吗？该操作不可恢复。`, '删除账号', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'error'
      })
    } catch {
      return
    }
    try {
      await apiDeleteUser({ id: Number(row.id) })
      ElMessage.success('已删除')
      refreshData()
    } catch (e: any) {
      ElMessage.error(e?.backendMessage || e?.message || '删除失败')
    }
  }

  /** 重置密码（后端按 id 改，下次登录生效） */
  const resetPassword = async (row: UserListItem): Promise<void> => {
    let pwd = ''
    try {
      const r = await ElMessageBox.prompt(`给「${row.userName}」设置新密码（至少 6 位）`, '重置密码', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPattern: /^.{6,}$/,
        inputErrorMessage: '至少 6 位'
      })
      pwd = r.value
    } catch {
      return
    }
    try {
      await resetUserPassword({ id: Number(row.id), newPassword: pwd })
      ElMessage.success('密码已重置，下次登录生效')
    } catch (e: any) {
      ElMessage.error(e?.backendMessage || e?.message || '重置失败')
    }
  }

  /**
   * 处理弹窗提交事件
   */
  const handleDialogSubmit = async () => {
    try {
      dialogVisible.value = false
      currentUserData.value = {}
    } catch (error) {
      console.error('提交失败:', error)
    }
  }

  /**
   * 处理表格行选择变化
   */
  const handleSelectionChange = (selection: UserListItem[]): void => {
    selectedRows.value = selection
    console.log('选中行数据:', selectedRows.value)
  }
</script>

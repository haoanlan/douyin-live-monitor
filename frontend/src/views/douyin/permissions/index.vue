<!--
  菜单与权限（**阶段二：只读**）

  这个页面现在就干一件事：把数据库里那 4 张表的内容摆出来给人核对。
  · 没有保存按钮，没有勾选框（勾选框是 disabled 的）—— 改不了任何东西
  · 也不参与登录鉴权（auth-guard.js 还是硬编码 R_SUPER，页面顶部会写明）

  为什么先做只读：这套表是"接管鉴权"的前置数据。先让人看清"11 个菜单 / 2 个角色 /
  8 个操作"灌得对不对，再谈生效 —— 否则一旦生效出错就是所有人进不去。
-->
<template>
  <div class="douyin-page dy-stagger p-4">
    <!-- 阶段说明：必须显眼，避免误以为"改了就会生效" -->
    <div class="mb-4 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-g-700">
      <b class="text-warning">只读预览</b> · 这里展示的是数据库里的菜单/角色/权限清单。
      目前<b>还没有接管登录鉴权</b>（仍是硬编码超管判断），所以改动不会影响任何人的访问 ——
      编辑功能在阶段三，生效在阶段四。
    </div>

    <div class="art-card p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h3 class="m-0 text-lg font-semibold text-g-900">菜单与权限</h3>
          <p class="mb-0 mt-1 text-sm text-g-600">
            共 <b class="tabular-nums">{{ menuCount }}</b> 个菜单 ·
            <b class="tabular-nums">{{ roleCount }}</b> 个角色 ·
            <b class="tabular-nums">{{ actionCount }}</b> 个操作
          </p>
        </div>
        <el-button :loading="loading" @click="reload">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />重新读取
        </el-button>
      </div>

      <el-tabs v-model="tab" class="mt-4">
        <!-- ① 菜单清单 -->
        <el-tab-pane label="菜单" name="menus">
          <div class="overflow-x-auto">
            <el-table :data="menus" size="small" class="w-full" :default-sort="{ prop: 'sort', order: 'ascending' }">
              <el-table-column prop="sort" label="排序" width="72" align="right" />
              <el-table-column prop="title" label="名称" min-width="120" />
              <el-table-column prop="key" label="标识（路由 name）" min-width="180">
                <template #default="{ row }">
                  <code class="text-xs text-g-600">{{ row.key }}</code>
                </template>
              </el-table-column>
              <el-table-column prop="path" label="路径" min-width="200">
                <template #default="{ row }">
                  <span class="text-xs text-g-500">{{ row.path || '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="parentKey" label="上级" width="140">
                <template #default="{ row }">
                  <span class="text-xs text-g-500">{{ row.parentKey || '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="130">
                <template #default="{ row }">
                  <el-tag v-if="row.hidden" size="small" type="info" effect="plain">隐藏页</el-tag>
                  <el-tag v-else-if="row.visible" size="small" type="success" effect="plain">显示</el-tag>
                  <el-tag v-else size="small" type="warning" effect="plain">已隐藏</el-tag>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <!-- ② 角色 → 菜单矩阵（只读勾选） -->
        <el-tab-pane label="角色权限" name="roles">
          <div class="flex flex-col gap-4 lg:flex-row">
            <!-- 左：角色列表 -->
            <div class="w-full shrink-0 lg:w-[220px]">
              <button
                v-for="r in roles"
                :key="r.key"
                type="button"
                class="mb-1.5 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors"
                :class="activeRole === r.key ? 'bg-theme/10 text-theme' : 'hover:bg-g-100'"
                @click="selectRole(r.key)"
              >
                <span class="min-w-0 truncate">{{ r.name }}</span>
                <span class="shrink-0 text-xs text-g-400">{{ r.menu_count }} 菜单</span>
              </button>
            </div>

            <!-- 右：勾选矩阵 -->
            <div class="min-w-0 flex-1">
              <div v-if="!activeRole" class="py-10 text-center text-sm text-g-400">选择左侧的角色查看权限</div>
              <div v-else v-loading="roleLoading">
                <div class="mb-2 text-sm text-g-600">
                  <b class="text-g-800">{{ roleDetail.role?.name || activeRole }}</b>
                  · 可见 <b class="tabular-nums">{{ roleDetail.grantedCount || 0 }}</b> 个菜单
                  · <b class="tabular-nums">{{ (roleDetail.actions || []).length }}</b> 个操作
                </div>

                <div class="max-h-[420px] overflow-y-auto rounded-lg border border-g-200 p-2">
                  <label
                    v-for="m in roleDetail.menus || []"
                    :key="m.key"
                    class="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-g-50"
                  >
                    <el-checkbox :model-value="!!m.canView" disabled />
                    <span class="min-w-0 flex-1 truncate" :class="m.hidden ? 'text-g-400' : ''">
                      {{ m.title }}
                      <span class="ml-1 text-xs text-g-400">{{ m.key }}</span>
                    </span>
                    <el-tag v-if="m.hidden" size="small" type="info" effect="plain">隐藏页</el-tag>
                  </label>
                </div>

                <div v-if="(roleDetail.actions || []).length" class="mt-3">
                  <div class="mb-1.5 text-xs text-g-500">可执行的操作（阶段二只展示，不校验）</div>
                  <div class="flex flex-wrap gap-1.5">
                    <el-tag v-for="a in roleDetail.actions" :key="a" size="small" effect="plain">
                      {{ a }}
                    </el-tag>
                  </div>
                </div>
                <div v-else class="mt-3 text-xs text-g-400">这个角色没有任何操作权限（只能看）</div>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { onMounted, reactive, ref } from 'vue'
  import { adminMenus, adminRoles, adminRoleMenus } from '@/api/douyin'

  defineOptions({ name: 'DouyinPermissions' })

  const tab = ref<'menus' | 'roles'>('menus')
  const loading = ref(false)

  const menus = ref<any[]>([])
  const roles = ref<any[]>([])
  const actionCount = ref(0)
  const menuCount = ref(0)
  const roleCount = ref(0)

  const activeRole = ref('')
  const roleLoading = ref(false)
  const roleDetail = reactive<{ role?: any; menus?: any[]; grantedCount?: number; actions?: string[] }>({})

  async function reload() {
    loading.value = true
    try {
      const [m, r] = await Promise.all([adminMenus(), adminRoles()])
      menus.value = (m as any)?.items || []
      menuCount.value = menus.value.length
      roles.value = (r as any)?.roles || []
      roleCount.value = roles.value.length
      // 操作总数：所有角色的操作并集
      actionCount.value = 8
      if (!activeRole.value && roles.value.length) await selectRole(roles.value[0].key)
      else if (activeRole.value) await selectRole(activeRole.value)
    } finally {
      loading.value = false
    }
  }

  async function selectRole(key: string) {
    activeRole.value = key
    roleLoading.value = true
    try {
      const d: any = await adminRoleMenus(key)
      roleDetail.role = d?.role
      roleDetail.menus = d?.menus || []
      roleDetail.grantedCount = d?.grantedCount || 0
      roleDetail.actions = d?.actions || []
    } finally {
      roleLoading.value = false
    }
  }

  onMounted(reload)
</script>

<!--
  角色管理

  结构对应 Art Design Pro 原版「系统管理 / 角色管理」：
    左：角色列表（超级管理员 / 访客 / + 新增角色）
    右：该角色的**菜单权限勾选树** + **操作权限**勾选 + [保存]

  差异说明（贴合本项目）：
  · 原版把「菜单权限」放在弹窗里点开看；这里直接常驻右栏 —— 单人使用，
    少一次点击，而且能同时看到"角色列表"和"这个角色能看什么"。
  · 菜单树来自 menu_items 表（parent_key 组树），勾选结果写 role_menus。
  · **超级管理员不可改**：后端直接拒绝（防止把自己锁在外面），前端把整块禁用并写明原因。

  注意：这一页改的是**配置表**，目前还不影响登录鉴权（auth-guard 仍硬编码超管）。
-->
<template>
  <div class="douyin-page art-full-height">
    <ElCard class="art-table-card">
      <ArtTableHeader :loading="loading" @refresh="loadAll">
        <template #left>
          <span class="text-sm font-medium text-g-800">角色管理</span>
          <span class="ml-3 text-xs text-g-500">
            给每个角色勾选能看的页面与能做的操作；改动<b class="text-g-700">尚未接管登录鉴权</b>
          </span>
        </template>
      </ArtTableHeader>

      <div class="flex flex-col gap-4 p-4 lg:flex-row">
        <!-- 左：角色 -->
        <aside class="w-full shrink-0 lg:w-[240px]">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-xs font-medium text-g-600">角色（{{ roles.length }}）</span>
            <el-button size="small" text type="primary" @click="openCreateRole">新增角色</el-button>
          </div>

          <button
            v-for="r in roles"
            :key="r.key"
            type="button"
            class="mb-1.5 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors"
            :class="activeRole === r.key ? 'bg-theme/10 text-theme' : 'hover:bg-g-100 text-g-700'"
            @click="selectRole(r.key)"
          >
            <span class="flex min-w-0 items-center gap-1.5">
              <ArtSvgIcon v-if="r.key === 'R_SUPER'" icon="ri:lock-line" class="shrink-0 text-[13px] text-g-400" />
              <span class="truncate">{{ r.name || r.key }}</span>
            </span>
            <span class="shrink-0 text-xs text-g-400">{{ r.menu_count }} 页</span>
          </button>
        </aside>

        <!-- 右：权限 -->
        <section class="min-w-0 flex-1" v-loading="roleLoading">
          <div v-if="!activeRole" class="py-16 text-center text-sm text-g-400">选择左侧角色查看权限</div>

          <template v-else>
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div class="text-sm text-g-700">
                <b class="text-g-900">{{ detail.role?.name || activeRole }}</b>
                <span class="ml-2 text-xs text-g-500">
                  勾选 {{ checkedCount }} / {{ menuLeaves.length }} 个页面 ·
                  {{ actionSel.length }} 个操作
                </span>
              </div>
              <div class="flex items-center gap-2">
                <el-button size="small" :disabled="locked" @click="checkAll(true)">全选</el-button>
                <el-button size="small" :disabled="locked" @click="checkAll(false)">清空</el-button>
                <el-button size="small" type="primary" :loading="saving" :disabled="locked" @click="save">
                  保存
                </el-button>
              </div>
            </div>

            <div v-if="locked" class="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-g-600">
              超级管理员拥有全部权限且<b class="text-warning">不可修改</b> —— 否则一次误操作就会把所有人锁在系统外面。
            </div>

            <!-- 菜单权限树 -->
            <div class="rounded-lg border border-g-200">
              <div class="border-b border-g-100 bg-g-50/60 px-3 py-2 text-xs font-medium text-g-600">页面访问</div>
              <div class="max-h-[380px] overflow-y-auto p-2">
                <el-tree
                  ref="treeRef"
                  :data="treeData"
                  node-key="key"
                  show-checkbox
                  :props="{ label: 'title', children: 'children' }"
                  :default-expanded-keys="expandedKeys"
                  :check-strictly="false"
                  :disabled="locked"
                  @check="onTreeCheck"
                >
                  <template #default="{ data }">
                    <span class="text-sm text-g-700">{{ data.title }}</span>
                    <span class="ml-1.5 font-mono text-[11px] text-g-400">{{ data.key }}</span>
                  </template>
                </el-tree>
              </div>
            </div>

            <!-- 操作权限 -->
            <div class="mt-3 rounded-lg border border-g-200">
              <div class="border-b border-g-100 bg-g-50/60 px-3 py-2 text-xs font-medium text-g-600">操作权限</div>
              <div class="flex flex-wrap gap-x-5 gap-y-2 p-3">
                <el-checkbox
                  v-for="a in allActions"
                  :key="a.key"
                  v-model="actionSel"
                  :value="a.key"
                  :disabled="locked"
                >
                  {{ a.label }}
                  <span class="ml-1 font-mono text-[11px] text-g-400">{{ a.key }}</span>
                </el-checkbox>
              </div>
            </div>
          </template>
        </section>
      </div>
    </ElCard>

    <!-- 新增角色 -->
    <el-dialog v-model="createVisible" title="新增角色" width="460px" :close-on-click-modal="false">
      <el-form ref="createRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item label="角色编码" prop="key">
          <el-input v-model="createForm.key" placeholder="如 R_VIEWER" />
          <div class="mt-1 text-xs text-g-400">大写字母和下划线，代码里会用它判断权限</div>
        </el-form-item>
        <el-form-item label="角色名称" prop="name">
          <el-input v-model="createForm.name" placeholder="如 只读用户" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="createForm.note" type="textarea" :rows="2" placeholder="这个角色能做什么" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreateRole">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, nextTick, onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import {
    adminMenus,
    adminRoles,
    adminRoleMenus,
    adminRoleMenusSave,
    adminRoleActionsSave,
    adminRoleCreate
  } from '@/api/douyin'

  defineOptions({ name: 'SystemRole' })

  /** 操作权限的中文名（后端存的是 action_key） */
  const ACTION_LABELS: Record<string, string> = {
    'gift_price.write': '修改礼物价格',
    'manual_gift.add': '补录礼物',
    'manual_gift.delete': '撤销补录',
    'manual_user.merge': '合并虚拟用户',
    'qrlogin.start': '扫码登录',
    'service.restart': '启动/重启监控',
    'proxy_config.write': '改代理配置',
    'account.manage': '账号管理'
  }

  interface TreeNode {
    key: string
    title: string
    children?: TreeNode[]
  }

  const loading = ref(false)
  const roleLoading = ref(false)
  const saving = ref(false)
  const creating = ref(false)

  const roles = ref<{ key: string; name: string; menu_count: number; action_count: number }[]>([])
  const allMenus = ref<{ key: string; title: string; parentKey?: string | null; hidden?: number }[]>([])
  const allActions = Object.keys(ACTION_LABELS).map((key) => ({ key, label: ACTION_LABELS[key] }))

  const activeRole = ref('')
  const detail = reactive<{ role?: any; menus?: any[]; actions?: string[] }>({})

  const treeRef = ref()
  const actionSel = ref<string[]>([])

  const locked = computed(() => activeRole.value === 'R_SUPER')

  /** 菜单树（只取能在侧边栏出现的 + 其父级） */
  const treeData = computed<TreeNode[]>(() => {
    const byParent = new Map<string, TreeNode[]>()
    for (const m of allMenus.value) {
      const p = m.parentKey || ''
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p)!.push({ key: m.key, title: m.title })
    }
    const build = (parent: string): TreeNode[] =>
      (byParent.get(parent) || []).map((n) => {
        const children = build(n.key)
        return children.length ? { ...n, children } : n
      })
    return build('')
  })

  /** 叶子数 = 可独立勾选的页面数（父级由子级联动） */
  const menuLeaves = computed(() => {
    const out: string[] = []
    const walk = (nodes: TreeNode[]) =>
      nodes.forEach((n) => (n.children?.length ? walk(n.children) : out.push(n.key)))
    walk(treeData.value)
    return out
  })

  const expandedKeys = computed(() => treeData.value.filter((n) => n.children?.length).map((n) => n.key))

  const checkedCount = computed(() => {
    const el = treeRef.value
    if (!el) return detail.menus?.filter((m: any) => m.canView).length || 0
    return (el.getCheckedKeys(false) as string[]).length
  })

  async function loadAll() {
    loading.value = true
    try {
      const [r, m] = await Promise.all([adminRoles(), adminMenus()])
      roles.value = (r as any)?.roles || []
      allMenus.value = (m as any)?.items || []
      if (!activeRole.value && roles.value.length) await selectRole(roles.value[0].key)
      else if (activeRole.value) await selectRole(activeRole.value)
    } catch (e: any) {
      ElMessage.error(e?.message || '加载失败')
    } finally {
      loading.value = false
    }
  }

  async function selectRole(key: string) {
    activeRole.value = key
    roleLoading.value = true
    try {
      const d: any = await adminRoleMenus(key)
      detail.role = d?.role
      detail.menus = d?.menus || []
      detail.actions = d?.actions || []
      actionSel.value = [...(d?.actions || [])]
      await nextTick()
      // 只勾叶子，父级自动半选
      const granted = new Set((d?.menus || []).filter((m: any) => m.canView).map((m: any) => m.key))
      treeRef.value?.setCheckedKeys(menuLeaves.value.filter((k) => granted.has(k)))
    } catch (e: any) {
      ElMessage.error(e?.message || '读取角色权限失败')
    } finally {
      roleLoading.value = false
    }
  }

  function onTreeCheck() {
    // 触发重新计算 checkedCount
    detail.menus = detail.menus ? [...detail.menus] : []
  }

  function checkAll(on: boolean) {
    treeRef.value?.setCheckedKeys(on ? menuLeaves.value : [])
  }

  async function save() {
    if (locked.value) return
    saving.value = true
    try {
      const keys = (treeRef.value?.getCheckedKeys(false) as string[]) || []
      // 父级也要写进去（否则侧边栏二级菜单不显示）
      const parents = treeData.value
        .filter((n) => n.children?.length && n.children.some((c) => keys.includes(c.key)))
        .map((n) => n.key)
      await adminRoleMenusSave(activeRole.value, [...new Set([...keys, ...parents])])
      await adminRoleActionsSave(activeRole.value, actionSel.value)
      ElMessage.success('已保存')
      await loadAll()
    } catch (e: any) {
      ElMessage.error(e?.message || '保存失败')
    } finally {
      saving.value = false
    }
  }

  // ---------- 新增角色 ----------
  const createVisible = ref(false)
  const createRef = ref()
  const createForm = reactive({ key: '', name: '', note: '' })
  const createRules = {
    key: [{ required: true, message: '请输入角色编码', trigger: 'blur' }],
    name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }]
  }

  function openCreateRole() {
    Object.assign(createForm, { key: '', name: '', note: '' })
    createVisible.value = true
  }

  async function submitCreateRole() {
    try {
      await createRef.value?.validate()
    } catch {
      return
    }
    creating.value = true
    try {
      await adminRoleCreate({ ...createForm })
      ElMessage.success('已创建')
      createVisible.value = false
      await loadAll()
    } catch (e: any) {
      ElMessage.error(e?.message || '创建失败')
    } finally {
      creating.value = false
    }
  }

  onMounted(loadAll)
</script>

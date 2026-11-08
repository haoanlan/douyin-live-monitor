<template>
  <ElDialog
    v-model="visible"
    :title="`菜单权限 · ${roleName}`"
    width="560px"
    align-center
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <template v-if="locked">
      <div class="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-g-600">
        超级管理员拥有全部权限且<b class="text-warning">不可修改</b>。
      </div>
    </template>

    <div class="text-xs text-g-500 mb-2">
      已选 <b class="text-g-700">{{ checkedCount }}</b> 个页面 ·
      <b class="text-g-700">{{ actionSel.length }}</b> 个操作
    </div>

    <!-- 内容整体限高并在弹窗内滚动：操作权限有 19 条，不限高会把页脚按钮挤出屏幕 -->
    <div class="max-h-[58vh] overflow-y-auto pr-1">

    <!-- 页面（菜单）权限 -->
    <ElScrollbar height="42vh" class="rounded-lg border border-g-200">
      <ElTree
        ref="treeRef"
        v-loading="loading"
        :data="treeData"
        show-checkbox
        node-key="key"
        :default-expand-all="isExpandAll"
        :props="{ label: 'title', children: 'children' }"
        :disabled="locked"
        class="px-2 py-1"
        @check="syncCounts"
      >
        <template #default="{ data }">
          <span class="text-sm text-g-700">{{ data.title }}</span>
          <span class="ml-1.5 font-mono text-[11px] text-g-400">{{ data.key }}</span>
        </template>
      </ElTree>
    </ElScrollbar>

    <!-- 操作权限：按分组展示，一条操作一个勾选（暂停 / 删除 / 重启 等都在这里分开） -->
    <div class="mt-3 rounded-lg border border-g-200">
      <div class="border-b border-g-100 bg-g-50/60 px-3 py-1.5 text-xs font-medium text-g-600">
        操作权限
      </div>
      <div v-loading="loading" class="p-3">
        <div v-for="g in actionGroups" :key="g.group" class="mb-2 last:mb-0">
          <div class="mb-1 text-[11px] text-g-400">{{ g.group }}</div>
          <ElCheckboxGroup v-model="actionSel" :disabled="locked" class="flex flex-wrap gap-x-5 gap-y-2">
            <ElCheckbox v-for="a in g.items" :key="a.key" :value="a.key">
              {{ a.label }}
              <span class="ml-1 font-mono text-[10px] text-g-300">{{ a.key }}</span>
            </ElCheckbox>
          </ElCheckboxGroup>
        </div>
      </div>
    </div>
    </div>

    <template #footer>
      <ElButton @click="toggleExpandAll">{{ isExpandAll ? '全部收起' : '全部展开' }}</ElButton>
      <ElButton :disabled="locked" @click="toggleSelectAll">{{ isSelectAll ? '取消全选' : '全部选择' }}</ElButton>
      <ElButton type="primary" :disabled="locked" :loading="saving" @click="savePermission">保存</ElButton>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
  import { ElButton, ElCheckbox, ElCheckboxGroup, ElDialog, ElScrollbar, ElTree, ElMessage } from 'element-plus'
  import { adminMenus, adminRoleMenus, adminRoleMenusSave, adminRoleActionsSave } from '@/api/douyin'

  type RoleListItem = Api.SystemManage.RoleListItem

  interface Props {
    modelValue: boolean
    roleData?: RoleListItem
  }
  interface Emits {
    (e: 'update:modelValue', value: boolean): void
    (e: 'success'): void
  }

  const props = withDefaults(defineProps<Props>(), { modelValue: false, roleData: undefined })
  const emit = defineEmits<Emits>()

  const visible = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value)
  })

  interface TreeNode {
    key: string
    title: string
    children?: TreeNode[]
  }
  interface ActionItem {
    key: string
    label: string
    group: string
  }

  const treeRef = ref()
  const loading = ref(false)
  const saving = ref(false)
  const locked = ref(false)
  const isExpandAll = ref(true)
  const isSelectAll = ref(false)

  const allMenus = ref<{ key: string; title: string; parentKey?: string | null }[]>([])
  const actionCatalog = ref<ActionItem[]>([])
  const actionSel = ref<string[]>([])

  const roleKey = computed(() => props.roleData?.roleCode || '')
  const roleName = computed(() => props.roleData?.roleName || roleKey.value)

  /** 扁平菜单 → 树（按 parentKey 组，顺序沿用后端 sort） */
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

  /** 叶子节点（勾选只认叶子，父节点由 el-tree 自动联动） */
  const menuLeaves = computed(() => {
    const out: string[] = []
    const walk = (nodes: TreeNode[]) =>
      nodes.forEach((n) => (n.children?.length ? walk(n.children) : out.push(n.key)))
    walk(treeData.value)
    return out
  })

  const actionGroups = computed(() => {
    const map = new Map<string, ActionItem[]>()
    for (const a of actionCatalog.value) {
      if (!map.has(a.group)) map.set(a.group, [])
      map.get(a.group)!.push(a)
    }
    return [...map.entries()].map(([group, items]) => ({ group, items }))
  })

  const checkedCount = computed(() => {
    const keys = (treeRef.value?.getCheckedKeys(false) as string[]) || []
    return keys.length
  })

  function syncCounts() {
    const keys = (treeRef.value?.getCheckedKeys(false) as string[]) || []
    isSelectAll.value = keys.length === menuLeaves.value.length && keys.length > 0
  }

  async function loadCatalog() {
    if (actionCatalog.value.length) return
    const { getAdminActions } = await import('@/api/douyin')
    const r: any = await getAdminActions()
    actionCatalog.value = (r?.items || []).map((a: any) => ({
      key: a.key,
      label: a.label || a.key,
      group: a.group || '其它'
    }))
  }

  async function open() {
    if (!roleKey.value) return
    loading.value = true
    try {
      const [m, d] = await Promise.all([adminMenus(), adminRoleMenus(roleKey.value)])
      allMenus.value = (m as any)?.items || []
      await loadCatalog()
      locked.value = Boolean((d as any)?.locked)
      actionSel.value = [...((d as any)?.actions || [])]
      await nextTick()
      const granted = new Set(
        ((d as any)?.menus || []).filter((x: any) => x.canView).map((x: any) => x.key)
      )
      treeRef.value?.setCheckedKeys(menuLeaves.value.filter((k) => granted.has(k)))
      syncCounts()
    } catch (e: any) {
      ElMessage.error(e?.backendMessage || e?.message || '读取权限失败')
    } finally {
      loading.value = false
    }
  }

  watch(
    () => props.modelValue,
    (v) => {
      if (v) open()
    }
  )

  function toggleExpandAll() {
    const nodes = treeRef.value?.store?.nodesMap || {}
    Object.values(nodes).forEach((n: any) => (n.expanded = !isExpandAll.value))
    isExpandAll.value = !isExpandAll.value
  }

  function toggleSelectAll() {
    if (!isSelectAll.value) {
      treeRef.value?.setCheckedKeys(menuLeaves.value)
      isSelectAll.value = true
    } else {
      treeRef.value?.setCheckedKeys([])
      isSelectAll.value = false
    }
  }

  async function savePermission() {
    if (locked.value || !roleKey.value) return
    saving.value = true
    try {
      const leaves = (treeRef.value?.getCheckedKeys(false) as string[]) || []
      // 带上父节点：目录本身也要在 role_menus 里，否则侧边栏父级不显示
      const parents = treeData.value
        .filter((n) => n.children?.length && n.children.some((c) => leaves.includes(c.key)))
        .map((n) => n.key)
      await adminRoleMenusSave(roleKey.value, [...new Set([...leaves, ...parents])])
      await adminRoleActionsSave(roleKey.value, actionSel.value)
      ElMessage.success('权限已保存')
      visible.value = false
      emit('success')
    } catch (e: any) {
      ElMessage.error(e?.backendMessage || e?.message || '保存失败')
    } finally {
      saving.value = false
    }
  }

  function handleClose() {
    treeRef.value?.setCheckedKeys([])
    actionSel.value = []
  }
</script>

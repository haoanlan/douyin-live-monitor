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
  <div class="art-full-height">
    <ArtSearchBar
      v-model="formFilters"
      :items="formItems"
      :showExpand="false"
      @reset="handleReset"
      @search="handleSearch"
    />

    <ElCard class="art-table-card">
      <ArtTableHeader :loading="loading" @refresh="loadRoles">
        <template #left>
          <ElButton type="primary" @click="showDialog('add')">新增角色</ElButton>
        </template>
      </ArtTableHeader>

      <ArtTable rowKey="key" :loading="loading" :columns="columns" :data="filtered" />

      <!-- 新增 / 编辑 -->
      <el-dialog
        v-model="editVisible"
        :title="dialogType === 'add' ? '新增角色' : '编辑角色'"
        width="30%"
        align-center
        :close-on-click-modal="false"
      >
        <el-form ref="editRef" :model="editForm" :rules="editRules" label-width="96px">
          <el-form-item label="角色名称" prop="name">
            <el-input v-model="editForm.name" placeholder="请输入角色名称" />
          </el-form-item>
          <el-form-item label="角色编码" prop="key">
            <el-input v-model="editForm.key" :disabled="dialogType === 'edit'" placeholder="如：R_VIEWER" />
          </el-form-item>
          <el-form-item label="描述" prop="note">
            <el-input v-model="editForm.note" type="textarea" :rows="3" placeholder="请输入角色描述" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="editVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submitEdit">提交</el-button>
        </template>
      </el-dialog>

      <!-- 菜单权限（原版是弹窗，不是常驻右栏） -->
      <el-dialog
        v-model="permVisible"
        title="菜单权限"
        width="520px"
        align-center
        :close-on-click-modal="false"
        @close="handlePermClose"
      >
        <div v-if="permLocked" class="mb-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-g-600">
          超级管理员拥有全部权限且<b class="text-warning">不可修改</b>。
        </div>
        <div class="mb-2 text-xs text-g-500">
          {{ permRoleName }} · 已选 <b class="text-g-700">{{ checkedCount }}</b> 个页面
        </div>

        <el-scrollbar height="50vh">
          <el-tree
            ref="treeRef"
            :data="treeData"
            show-checkbox
            node-key="key"
            :default-expand-all="isExpandAll"
            :props="{ label: 'title', children: 'children' }"
            :disabled="permLocked"
            @check="onTreeCheck"
          >
            <template #default="{ data }">
              <span class="text-sm text-g-700">{{ data.title }}</span>
              <span class="ml-1.5 font-mono text-[11px] text-g-400">{{ data.key }}</span>
            </template>
          </el-tree>
        </el-scrollbar>

        <div class="mt-3 rounded-lg border border-g-200">
          <div class="border-b border-g-100 bg-g-50/60 px-3 py-1.5 text-xs font-medium text-g-600">操作权限</div>
          <el-checkbox-group v-model="actionSel" class="flex flex-wrap gap-x-5 gap-y-2 p-3">
            <el-checkbox v-for="a in allActions" :key="a.key" :value="a.key" :disabled="permLocked">
              {{ a.label }}
            </el-checkbox>
          </el-checkbox-group>
        </div>

        <template #footer>
          <el-button @click="toggleExpandAll">{{ isExpandAll ? '全部收起' : '全部展开' }}</el-button>
          <el-button :disabled="permLocked" @click="toggleSelectAll">{{ isSelectAll ? '取消全选' : '全部选择' }}</el-button>
          <el-button type="primary" :loading="saving" :disabled="permLocked" @click="savePermission">保存</el-button>
        </template>
      </el-dialog>
    </ElCard>
  </div>
</template>

<script setup lang="ts">
  import { computed, h, nextTick, onMounted, reactive, ref } from 'vue'
  import { ElMessage, ElMessageBox, ElTag } from 'element-plus'
  import ArtButtonMore, { type ButtonMoreItem } from '@/components/core/forms/art-button-more/index.vue'
  import { useTableColumns } from '@/hooks/core/useTableColumns'
  import {
    adminMenus,
    adminRoles,
    adminRoleMenus,
    adminRoleMenusSave,
    adminRoleActionsSave,
    adminRoleCreate
  } from '@/api/douyin'

  defineOptions({ name: 'SystemRole' })

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

  interface RoleRow {
    key: string
    name: string
    note?: string
    menu_count: number
    action_count: number
  }
  interface TreeNode {
    key: string
    title: string
    children?: TreeNode[]
  }

  const loading = ref(false)
  const saving = ref(false)
  const roles = ref<RoleRow[]>([])
  const allMenus = ref<{ key: string; title: string; parentKey?: string | null }[]>([])

  // ---------- 搜索 ----------
  const initialSearch = { name: '', key: '', note: '' }
  const formFilters = reactive({ ...initialSearch })
  const appliedFilters = reactive({ ...initialSearch })

  const formItems = computed(() => [
    { label: '角色名称', key: 'name', type: 'input', props: { clearable: true } },
    { label: '角色编码', key: 'key', type: 'input', props: { clearable: true } },
    { label: '角色描述', key: 'note', type: 'input', props: { clearable: true } }
  ])

  const filtered = computed(() => {
    const name = (appliedFilters.name || '').toLowerCase().trim()
    const key = (appliedFilters.key || '').toLowerCase().trim()
    const note = (appliedFilters.note || '').toLowerCase().trim()
    return roles.value.filter((r) => {
      if (name && !(r.name || '').toLowerCase().includes(name)) return false
      if (key && !(r.key || '').toLowerCase().includes(key)) return false
      if (note && !(r.note || '').toLowerCase().includes(note)) return false
      return true
    })
  })

  function handleReset() {
    Object.assign(formFilters, { ...initialSearch })
    Object.assign(appliedFilters, { ...initialSearch })
    loadRoles()
  }
  function handleSearch() {
    Object.assign(appliedFilters, { ...formFilters })
  }

  // ---------- 数据 ----------
  async function loadRoles() {
    loading.value = true
    try {
      const [r, m] = await Promise.all([adminRoles(), adminMenus()])
      roles.value = (r as any)?.roles || []
      allMenus.value = (m as any)?.items || []
    } catch (e: any) {
      ElMessage.error(e?.message || '获取角色失败')
    } finally {
      loading.value = false
    }
  }

  // ---------- 表格列（照原版：编码/名称/描述/数量/状态/操作）----------
  const { columnChecks, columns } = useTableColumns(() => [
    { prop: 'key', label: '角色编码', width: 150 },
    { prop: 'name', label: '角色名称', minWidth: 140 },
    {
      prop: 'note',
      label: '角色描述',
      minWidth: 220,
      showOverflowTooltip: true,
      formatter: (row: RoleRow) => row.note || '—'
    },
    {
      prop: 'counts',
      label: '权限数量',
      width: 170,
      formatter: (row: RoleRow) => row.menu_count + ' 个页面 · ' + row.action_count + ' 个操作'
    },
    {
      prop: 'enabled',
      label: '角色状态',
      width: 110,
      formatter: () => h(ElTag, { type: 'success' }, () => '启用')
    },
    {
      prop: 'operation',
      label: '操作',
      width: 90,
      fixed: 'right',
      formatter: (row: RoleRow) =>
        h('div', [
          h(ArtButtonMore, {
            list: [
              { key: 'permission', label: '菜单权限', icon: 'ri:user-3-line' },
              { key: 'edit', label: '编辑角色', icon: 'ri:edit-2-line' },
              { key: 'delete', label: '删除角色', icon: 'ri:delete-bin-4-line', color: '#f56c6c' }
            ],
            onClick: (item: ButtonMoreItem) => onMore(item, row)
          })
        ])
    }
  ])
  void columnChecks

  function onMore(item: ButtonMoreItem, row: RoleRow) {
    if (item.key === 'permission') openPermission(row)
    else if (item.key === 'edit') showDialog('edit', row)
    else if (item.key === 'delete') deleteRole(row)
  }

  // ---------- 新增/编辑 ----------
  const editVisible = ref(false)
  const dialogType = ref<'add' | 'edit'>('add')
  const editRef = ref()
  const editForm = reactive({ key: '', name: '', note: '' })
  const editRules = {
    name: [
      { required: true, message: '请输入角色名称', trigger: 'blur' },
      { min: 2, max: 20, message: '长度在 2 到 20 个字符', trigger: 'blur' }
    ],
    key: [
      { required: true, message: '请输入角色编码', trigger: 'blur' },
      { min: 2, max: 50, message: '长度在 2 到 50 个字符', trigger: 'blur' }
    ],
    note: [{ required: true, message: '请输入角色描述', trigger: 'blur' }]
  }

  function showDialog(type: 'add' | 'edit', row?: RoleRow) {
    dialogType.value = type
    Object.assign(
      editForm,
      type === 'edit' && row ? { key: row.key, name: row.name, note: row.note || '' } : { key: '', name: '', note: '' }
    )
    editVisible.value = true
  }

  async function submitEdit() {
    try {
      await editRef.value?.validate()
    } catch {
      return
    }
    if (dialogType.value === 'edit') {
      ElMessage.warning('编辑角色的接口还没做（后端目前只有新建角色），先用「菜单权限」调整权限')
      return
    }
    saving.value = true
    try {
      await adminRoleCreate({ key: editForm.key, name: editForm.name, note: editForm.note })
      ElMessage.success('新增成功')
      editVisible.value = false
      await loadRoles()
    } catch (e: any) {
      ElMessage.error(e?.message || '提交失败')
    } finally {
      saving.value = false
    }
  }

  async function deleteRole(row: RoleRow) {
    try {
      await ElMessageBox.confirm('确定删除角色「' + (row.name || row.key) + '」吗？', '删除确认', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      })
    } catch {
      return
    }
    ElMessage.warning('删除角色的接口还没做，当前只做提示')
  }

  // ---------- 菜单权限弹窗 ----------
  const permVisible = ref(false)
  const permLocked = ref(false)
  const permRoleKey = ref('')
  const permRoleName = ref('')
  const treeRef = ref()
  const isExpandAll = ref(true)
  const isSelectAll = ref(false)
  const actionSel = ref<string[]>([])
  const allActions = Object.keys(ACTION_LABELS).map((key) => ({ key, label: ACTION_LABELS[key] }))

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

  const menuLeaves = computed(() => {
    const out: string[] = []
    const walk = (nodes: TreeNode[]) => nodes.forEach((n) => (n.children?.length ? walk(n.children) : out.push(n.key)))
    walk(treeData.value)
    return out
  })

  const checkedCount = computed(() => (treeRef.value?.getCheckedKeys(false) as string[])?.length || 0)

  async function openPermission(row: RoleRow) {
    permRoleKey.value = row.key
    permRoleName.value = row.name || row.key
    permLocked.value = row.key === 'R_SUPER'
    permVisible.value = true
    try {
      const d: any = await adminRoleMenus(row.key)
      actionSel.value = [...(d?.actions || [])]
      await nextTick()
      const granted = new Set((d?.menus || []).filter((m: any) => m.canView).map((m: any) => m.key))
      treeRef.value?.setCheckedKeys(menuLeaves.value.filter((k) => granted.has(k)))
      isSelectAll.value = menuLeaves.value.every((k) => granted.has(k))
    } catch (e: any) {
      ElMessage.error(e?.message || '读取权限失败')
    }
  }

  function handlePermClose() {
    treeRef.value?.setCheckedKeys([])
    actionSel.value = []
  }

  function onTreeCheck() {
    isSelectAll.value = (treeRef.value?.getCheckedKeys(false) as string[])?.length === menuLeaves.value.length
  }

  function toggleExpandAll() {
    const tree = treeRef.value
    if (!tree) return
    const nodes = tree.store.nodesMap
    Object.values(nodes).forEach((node: any) => {
      node.expanded = !isExpandAll.value
    })
    isExpandAll.value = !isExpandAll.value
  }

  function toggleSelectAll() {
    if (!isSelectAll.value) treeRef.value?.setCheckedKeys(menuLeaves.value)
    else treeRef.value?.setCheckedKeys([])
    isSelectAll.value = !isSelectAll.value
  }

  async function savePermission() {
    if (permLocked.value) return
    saving.value = true
    try {
      const keys = (treeRef.value?.getCheckedKeys(false) as string[]) || []
      const parents = treeData.value
        .filter((n) => n.children?.length && n.children.some((c) => keys.includes(c.key)))
        .map((n) => n.key)
      await adminRoleMenusSave(permRoleKey.value, [...new Set([...keys, ...parents])])
      await adminRoleActionsSave(permRoleKey.value, actionSel.value)
      ElMessage.success('权限保存成功')
      permVisible.value = false
      await loadRoles()
    } catch (e: any) {
      ElMessage.error(e?.message || '保存失败')
    } finally {
      saving.value = false
    }
  }

  onMounted(loadRoles)
</script>

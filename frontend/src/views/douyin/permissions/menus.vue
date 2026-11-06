<!--
  菜单管理 —— **移植自 Art Design Pro 原版** `src/views/system/menu/index.vue`

  ## 为什么是这一版
  前四版都是我自己排的版式，和 ar td.pro 的菜单管理页差得远。原因很简单：
  原版页面在开发时被删掉了，我只能照着"被改过的" user-manage 猜。
  这一版直接按原版的结构复刻：

    ArtSearchBar（菜单名称 / 路由地址 / 重置 / 查询）
    ElCard.art-table-card
      ├ ArtTableHeader（左侧：添加菜单 / 展开；右侧：刷新 / 列设置）
      └ ArtTable（树形：菜单名称 / 菜单类型 / 路由 / 权限标识 / 编辑时间 / 状态 / 操作）
      └ MenuDialog（新增 / 编辑）

  用的是项目里**现成**的组件（ArtSearchBar / ArtTableHeader / ArtTable / ArtButtonTable /
  useTableColumns 都还在），所以外观和 ar td.pro 一致，不需要我另造样式。

  ## 数据映射（我们的表 → 原版的行结构）
    menu_items.parent_key  → 树形 children
    menu_items.menu_type   → 「菜单类型」目录/菜单/按钮
    menu_items.perms       → 「权限标识」
    menu_items.updated_at  → 「编辑时间」
    menu_items.visible     → 「状态」启用/停用
-->
<template>
  <div class="menu-page art-full-height">
    <ArtSearchBar
      v-model="formFilters"
      :items="formItems"
      :showExpand="false"
      @reset="handleReset"
      @search="handleSearch"
    />

    <ElCard class="art-table-card">
      <ArtTableHeader
        :showZebra="false"
        :loading="loading"
        v-model:columns="columnChecks"
        @refresh="getMenuList"
      >
        <template #left>
          <ElButton type="primary" @click="handleAddMenu">添加菜单</ElButton>
          <ElButton @click="toggleExpand">{{ isExpanded ? '收起' : '展开' }}</ElButton>
        </template>
      </ArtTableHeader>

      <ArtTable
        ref="tableRef"
        rowKey="key"
        :loading="loading"
        :columns="columns"
        :data="filteredTableData"
        :stripe="false"
        :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
        :default-expand-all="false"
      />

      <!-- 新增 / 编辑 -->
      <el-dialog
        v-model="dialogVisible"
        :title="editingKey ? '编辑菜单' : '添加菜单'"
        width="520px"
        :close-on-click-modal="false"
      >
        <el-form :model="form" label-position="top">
          <el-form-item label="标识（路由 name）">
            <el-input v-model="form.key" :disabled="!!editingKey" placeholder="SystemMenus" />
          </el-form-item>
          <el-form-item label="菜单名称">
            <el-input v-model="form.title" placeholder="菜单管理" />
          </el-form-item>
          <div class="grid grid-cols-2 gap-3">
            <el-form-item label="菜单类型">
              <el-select v-model="form.menuType" class="w-full">
                <el-option label="目录" value="directory" />
                <el-option label="菜单" value="menu" />
                <el-option label="按钮" value="button" />
              </el-select>
            </el-form-item>
            <el-form-item label="上级菜单">
              <el-select v-model="form.parentKey" clearable placeholder="无（一级）" class="w-full">
                <el-option
                  v-for="m in topLevelOptions"
                  :key="m.key"
                  :label="m.title"
                  :value="m.key"
                  :disabled="m.key === editingKey"
                />
              </el-select>
            </el-form-item>
          </div>
          <el-form-item label="路由地址">
            <el-input v-model="form.path" placeholder="/douyin/system/menus" />
          </el-form-item>
          <div class="grid grid-cols-2 gap-3">
            <el-form-item label="权限标识">
              <el-input v-model="form.perms" placeholder="system:menu:list" />
            </el-form-item>
            <el-form-item label="排序">
              <el-input-number v-model="form.sort" :min="0" :step="10" :controls="false" class="!w-full" />
            </el-form-item>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <el-form-item label="状态">
              <el-switch v-model="form.visible" active-text="启用" inactive-text="停用" />
            </el-form-item>
            <el-form-item label="隐藏页">
              <el-switch v-model="form.hidden" />
            </el-form-item>
          </div>
        </el-form>

        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submit">确定</el-button>
        </template>
      </el-dialog>
    </ElCard>
  </div>
</template>

<script setup lang="ts">
  import { computed, h, nextTick, onMounted, reactive, ref } from 'vue'
  import { ElButton, ElMessage, ElMessageBox, ElTag } from 'element-plus'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import { useTableColumns } from '@/hooks/core/useTableColumns'
  import {
    adminMenus,
    adminMenuCreate,
    adminMenuUpdate,
    adminMenuDelete,
    adminMenuReorder,
    type AdminMenuItem
  } from '@/api/douyin'

  defineOptions({ name: 'SystemMenus' })

  interface Row extends AdminMenuItem {
    children?: Row[]
    hasChildren?: boolean
  }

  const loading = ref(false)
  const saving = ref(false)
  const isExpanded = ref(false)
  const tableRef = ref()
  const items = ref<AdminMenuItem[]>([])

  // ---------- 搜索 ----------
  const initialSearchState = { name: '', route: '' }
  const formFilters = reactive({ ...initialSearchState })
  const appliedFilters = reactive({ ...initialSearchState })

  const formItems = computed(() => [
    { label: '菜单名称', key: 'name', type: 'input', props: { clearable: true } },
    { label: '路由地址', key: 'route', type: 'input', props: { clearable: true } }
  ])

  function handleReset() {
    Object.assign(formFilters, { ...initialSearchState })
    Object.assign(appliedFilters, { ...initialSearchState })
    getMenuList()
  }

  function handleSearch() {
    Object.assign(appliedFilters, { ...formFilters })
    getMenuList()
  }

  // ---------- 数据 ----------
  async function getMenuList() {
    loading.value = true
    try {
      const r: any = await adminMenus()
      items.value = r?.items || []
    } catch (e: any) {
      ElMessage.error(e?.message || '获取菜单失败')
    } finally {
      loading.value = false
    }
  }

  /** 菜单类型文本 / 标签色（照原版的三类：目录 / 菜单 / 按钮） */
  function typeText(row: Row): string {
    if (row.menuType === 'button') return '按钮'
    if (row.children?.length) return '目录'
    if (row.menuType === 'directory') return '目录'
    return '菜单'
  }
  function typeTag(row: Row): 'primary' | 'success' | 'warning' | 'info' | 'danger' {
    if (row.menuType === 'button') return 'danger'
    if (row.children?.length) return 'info'
    return 'primary'
  }

  /** 把平铺的 menu_items 组装成树，再按搜索条件过滤 */
  const treeData = computed<Row[]>(() => {
    const byParent = new Map<string, AdminMenuItem[]>()
    for (const m of items.value) {
      const p = m.parentKey || ''
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p)!.push(m)
    }
    const build = (parent: string): Row[] =>
      (byParent.get(parent) || [])
        .slice()
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((m) => {
          const children = build(m.key)
          return { ...m, children, hasChildren: children.length > 0 }
        })
    return build('')
  })

  function searchMenu(rows: Row[]): Row[] {
    const name = (appliedFilters.name || '').toLowerCase().trim()
    const route = (appliedFilters.route || '').toLowerCase().trim()
    const out: Row[] = []
    for (const row of rows) {
      const children = row.children?.length ? searchMenu(row.children) : []
      const nameMatch = !name || (row.title || '').toLowerCase().includes(name)
      const routeMatch = !route || (row.path || '').toLowerCase().includes(route)
      if (children.length) {
        out.push({ ...row, children, hasChildren: true })
      } else if (nameMatch && routeMatch) {
        out.push({ ...row, children: [] })
      }
    }
    return out
  }

  const filteredTableData = computed(() => searchMenu(treeData.value))

  // ---------- 列（照原版）----------
  const { columnChecks, columns } = useTableColumns(() => [
    {
      prop: 'title',
      label: '菜单名称',
      minWidth: 180,
      formatter: (row: Row) =>
        h('span', { class: row.parentKey ? 'text-g-700' : 'font-medium text-g-900' }, row.title)
    },
    {
      prop: 'menuType',
      label: '菜单类型',
      width: 110,
      formatter: (row: Row) => h(ElTag, { type: typeTag(row) }, () => typeText(row))
    },
    {
      prop: 'path',
      label: '路由',
      minWidth: 200,
      formatter: (row: Row) => row.path || ''
    },
    {
      prop: 'perms',
      label: '权限标识',
      minWidth: 170,
      formatter: (row: Row) => row.perms || ''
    },
    {
      prop: 'updatedAt',
      label: '编辑时间',
      width: 170,
      formatter: (row: Row) => row.updatedAt || '—'
    },
    {
      prop: 'visible',
      label: '状态',
      width: 100,
      formatter: (row: Row) =>
        h(ElTag, { type: row.visible ? 'success' : 'info' }, () => (row.visible ? '启用' : '停用'))
    },
    {
      prop: 'operation',
      label: '操作',
      width: 160,
      align: 'right',
      formatter: (row: Row) =>
        h('div', { style: 'text-align:right' }, [
          h(ArtButtonTable, { type: 'add', title: '新增子菜单', onClick: () => handleAddChild(row) }),
          h(ArtButtonTable, { type: 'edit', onClick: () => handleEditMenu(row) }),
          h(ArtButtonTable, { type: 'delete', onClick: () => handleDeleteMenu(row) })
        ])
    }
  ])

  // ---------- 弹窗 ----------
  const dialogVisible = ref(false)
  const editingKey = ref('')
  const form = reactive({
    key: '',
    title: '',
    path: '',
    parentKey: '' as string | undefined,
    sort: 100,
    visible: true,
    hidden: false,
    menuType: 'menu' as 'directory' | 'menu' | 'button',
    perms: ''
  })

  const topLevelOptions = computed(() => items.value.filter((m) => !m.parentKey))

  function resetForm() {
    Object.assign(form, {
      key: '',
      title: '',
      path: '',
      parentKey: undefined,
      sort: 100,
      visible: true,
      hidden: false,
      menuType: 'menu',
      perms: ''
    })
  }

  function handleAddMenu() {
    editingKey.value = ''
    resetForm()
    dialogVisible.value = true
  }

  function handleAddChild(row: Row) {
    editingKey.value = ''
    resetForm()
    form.parentKey = row.key
    form.sort = (row.sort ?? 0) + 1
    dialogVisible.value = true
  }

  function handleEditMenu(row: Row) {
    editingKey.value = row.key
    Object.assign(form, {
      key: row.key,
      title: row.title,
      path: row.path || '',
      parentKey: row.parentKey || undefined,
      sort: row.sort ?? 100,
      visible: !!row.visible,
      hidden: !!row.hidden,
      menuType: (row.menuType as any) || 'menu',
      perms: row.perms || ''
    })
    dialogVisible.value = true
  }

  async function submit() {
    if (!form.title.trim()) return ElMessage.warning('菜单名称不能为空')
    if (!editingKey.value && !form.key.trim()) return ElMessage.warning('标识不能为空')
    saving.value = true
    try {
      const payload = {
        title: form.title.trim(),
        path: form.path.trim(),
        parentKey: form.parentKey || '',
        sort: form.sort,
        visible: form.visible ? 1 : 0,
        hidden: form.hidden ? 1 : 0,
        menuType: form.menuType,
        perms: form.perms.trim()
      }
      if (editingKey.value) {
        await adminMenuUpdate(editingKey.value, payload as any)
      } else {
        await adminMenuCreate({ key: form.key.trim(), ...payload } as any)
      }
      ElMessage.success('已保存')
      dialogVisible.value = false
      await getMenuList()
    } catch (e: any) {
      ElMessage.error(e?.message || '保存失败')
    } finally {
      saving.value = false
    }
  }

  async function handleDeleteMenu(row: Row) {
    try {
      await ElMessageBox.confirm(
        '确定要删除菜单「' + row.title + '」吗？删除后侧边栏不再显示，但代码里的路由仍可直接访问。',
        '提示',
        { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
    try {
      await adminMenuDelete(row.key)
      ElMessage.success('删除成功')
      await getMenuList()
    } catch (e: any) {
      ElMessage.error(e?.message || '删除失败')
    }
  }

  /** 展开 / 收起全部：照原版用 el-table 的 toggleRowExpansion */
  function toggleExpand() {
    isExpanded.value = !isExpanded.value
    nextTick(() => {
      const el = tableRef.value?.elTableRef
      if (!el || !filteredTableData.value) return
      const walk = (rows: Row[]) => {
        rows.forEach((row) => {
          if (row.children?.length) {
            el.toggleRowExpansion(row, isExpanded.value)
            walk(row.children)
          }
        })
      }
      walk(filteredTableData.value)
    })
  }

  /** 拖拽式重排没有做：用「排序号」字段，编辑里改数字即可（原版这里也是排序号） */
  void adminMenuReorder

  onMounted(getMenuList)
</script>

<!--
  菜单管理（阶段三：可编辑，但**还不影响登录鉴权**）

  编辑只写 menu_items 表；auth-guard.js 仍然硬编码 `role === 'R_SUPER'`，
  所以这里改了什么，谁能访问哪个页面**不会变**。真生效在阶段四。

  设计取舍（照 impeccable 的 craft-floor）：
  · 不做树形 —— 只有 12 个菜单，树是过度设计；「上级」用一列小字表达
  · 不用卡片墙 —— 一列数据，表格最省眼
  · 标识用等宽字体（它是路由 name，是"代码"）
  · 隐藏页整行降透明度 + 一个 tag，不靠颜色单独区分
  · 加载给骨架行，失败在表格区域内联重试（不弹窗）
  · 排序用「上移/下移」而不是拖拽：手机上没有拖拽习惯，也少一个依赖
-->
<template>
  <div class="douyin-page dy-stagger p-4">
    <!-- 一行的阶段说明，不抢注意力 -->
    <div class="mb-3 text-xs text-g-500">
      可编辑，但<b class="text-g-700">尚未接管登录鉴权</b> —— 改动不影响任何人现在能看到什么（生效在阶段四）。
    </div>

    <div class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="m-0 text-lg font-semibold text-g-900">菜单管理</h3>
          <p class="mb-0 mt-1 text-sm text-g-600">
            {{ items.length }} 个菜单 ·
            <span class="text-g-500">{{ visibleCount }} 个在侧边栏显示</span> ·
            <span class="text-g-500">{{ hiddenCount }} 个隐藏页</span>
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <el-button :loading="loading" @click="reload">
            <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />刷新
          </el-button>
          <el-button type="primary" @click="openCreate">
            <ArtSvgIcon icon="ri:add-line" class="mr-1" />新增菜单
          </el-button>
        </div>
      </div>

      <!-- 加载骨架 -->
      <div v-if="loading && !items.length" class="mt-4 flex flex-col gap-2">
        <div v-for="i in 6" :key="i" class="flex items-center gap-3 rounded-lg bg-g-50 px-3 py-2.5">
          <el-skeleton-item variant="text" style="width: 28px" />
          <el-skeleton-item variant="text" style="flex: 1; max-width: 160px" />
          <el-skeleton-item variant="text" style="flex: 1; max-width: 220px" />
          <el-skeleton-item variant="text" style="width: 60px" />
        </div>
      </div>

      <!-- 失败：区域内联重试 -->
      <div v-else-if="loadError" class="mt-6 py-10 text-center">
        <p class="mb-3 text-sm text-danger">{{ loadError }}</p>
        <el-button @click="reload">重试</el-button>
      </div>

      <!-- 空 -->
      <el-empty v-else-if="!items.length" description="还没有菜单记录" :image-size="70" class="mt-4" />

      <!-- 表格 -->
      <div v-else class="mt-4 overflow-x-auto">
        <el-table :data="items" size="small" class="w-full" row-key="key">
          <el-table-column label="排序" width="96">
            <template #default="{ row, $index }">
              <div class="flex items-center gap-0.5">
                <button
                  type="button"
                  class="flex h-6 w-5 items-center justify-center rounded text-g-400 hover:bg-g-100 hover:text-g-700 disabled:opacity-30"
                  :disabled="$index === 0 || reordering"
                  title="上移"
                  @click="move($index, -1)"
                >
                  <ArtSvgIcon icon="ri:arrow-up-s-line" />
                </button>
                <button
                  type="button"
                  class="flex h-6 w-5 items-center justify-center rounded text-g-400 hover:bg-g-100 hover:text-g-700 disabled:opacity-30"
                  :disabled="$index === items.length - 1 || reordering"
                  title="下移"
                  @click="move($index, 1)"
                >
                  <ArtSvgIcon icon="ri:arrow-down-s-line" />
                </button>
                <span class="ml-1 tabular-nums text-xs text-g-400">{{ row.sort }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="名称" min-width="150">
            <template #default="{ row }">
              <span class="text-sm" :class="row.hidden ? 'text-g-500' : 'text-g-800'">{{ row.title }}</span>
              <el-tag v-if="row.hidden" size="small" type="info" effect="plain" class="ml-1.5">隐藏页</el-tag>
            </template>
          </el-table-column>

          <el-table-column label="标识（路由 name）" min-width="180">
            <template #default="{ row }">
              <code class="rounded bg-g-50 px-1.5 py-0.5 text-xs text-g-600">{{ row.key }}</code>
            </template>
          </el-table-column>

          <el-table-column label="路径" min-width="190">
            <template #default="{ row }">
              <span class="text-xs text-g-500">{{ row.path || '—' }}</span>
            </template>
          </el-table-column>

          <el-table-column label="上级" width="130">
            <template #default="{ row }">
              <span class="text-xs text-g-500">{{ row.parentKey || '—' }}</span>
            </template>
          </el-table-column>

          <el-table-column label="侧边栏显示" width="110" align="center">
            <template #default="{ row }">
              <el-switch
                :model-value="!!row.visible"
                :loading="switching === row.key"
                :disabled="!!row.hidden"
                @change="(v: any) => toggleVisible(row, v)"
              />
            </template>
          </el-table-column>

          <el-table-column label="操作" width="130" align="right">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" text type="danger" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 新增/编辑：字段少，弹窗比行内编辑稳 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingKey ? '编辑菜单' : '新增菜单'"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-width="96px" label-position="right">
        <el-form-item label="标识" required>
          <el-input v-model="form.key" :disabled="!!editingKey" placeholder="路由 name，如 DouyinSearch" />
          <div class="mt-1 text-xs text-g-400">必须是代码里真实存在的路由 name，否则只会在表里多一条无用的记录</div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.title" placeholder="侧边栏显示的名字" />
        </el-form-item>
        <el-form-item label="路径">
          <el-input v-model="form.path" placeholder="/douyin/xxx" />
        </el-form-item>
        <el-form-item label="上级菜单">
          <el-select v-model="form.parentKey" clearable placeholder="无（一级菜单）" class="w-full">
            <el-option v-for="m in items" :key="m.key" :label="m.title + '  ' + m.key" :value="m.key" :disabled="m.key === editingKey" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="0" :step="10" :controls="false" class="!w-[140px]" />
        </el-form-item>
        <el-form-item label="侧边栏显示">
          <el-switch v-model="form.visible" />
        </el-form-item>
        <el-form-item label="隐藏页">
          <el-switch v-model="form.hidden" />
          <span class="ml-2 text-xs text-g-400">隐藏页不进侧边栏（如详情页、画像页）</span>
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="flex items-center justify-end gap-3">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import {
    adminMenus,
    adminMenuCreate,
    adminMenuUpdate,
    adminMenuDelete,
    adminMenuReorder,
    type AdminMenuItem
  } from '@/api/douyin'

  defineOptions({ name: 'DouyinPermissionsMenus' })

  const loading = ref(false)
  const loadError = ref('')
  const items = ref<AdminMenuItem[]>([])

  const visibleCount = computed(() => items.value.filter((m) => !!m.visible && !m.hidden).length)
  const hiddenCount = computed(() => items.value.filter((m) => !!m.hidden).length)

  const dialogVisible = ref(false)
  const editingKey = ref('')
  const saving = ref(false)
  const switching = ref('')
  const reordering = ref(false)

  const form = reactive({
    key: '',
    title: '',
    path: '',
    parentKey: '' as string | undefined,
    sort: 100,
    visible: true,
    hidden: false
  })

  async function reload() {
    loading.value = true
    loadError.value = ''
    try {
      const r: any = await adminMenus()
      items.value = r?.items || []
    } catch (e: any) {
      loadError.value = e?.message || '读取失败'
    } finally {
      loading.value = false
    }
  }

  function openCreate() {
    editingKey.value = ''
    Object.assign(form, { key: '', title: '', path: '', parentKey: undefined, sort: 100, visible: true, hidden: false })
    dialogVisible.value = true
  }

  function openEdit(row: any) {
    editingKey.value = row.key
    Object.assign(form, {
      key: row.key,
      title: row.title,
      path: row.path || '',
      parentKey: row.parentKey || undefined,
      sort: row.sort ?? 100,
      visible: !!row.visible,
      hidden: !!row.hidden
    })
    dialogVisible.value = true
  }

  async function submit() {
    if (!form.key.trim()) return ElMessage.warning('标识不能为空')
    if (!form.title.trim()) return ElMessage.warning('名称不能为空')
    saving.value = true
    try {
      const payload = {
        title: form.title.trim(),
        path: form.path.trim(),
        parentKey: form.parentKey || '',
        sort: form.sort,
        visible: form.visible ? 1 : 0,
        hidden: form.hidden ? 1 : 0
      }
      if (editingKey.value) {
        await adminMenuUpdate(editingKey.value, payload)
        ElMessage.success('已保存')
      } else {
        await adminMenuCreate({ key: form.key.trim(), ...payload })
        ElMessage.success('已新增')
      }
      dialogVisible.value = false
      await reload()
    } catch (e: any) {
      ElMessage.error(e?.message || '保存失败')
    } finally {
      saving.value = false
    }
  }

  async function toggleVisible(row: any, v: any) {
    switching.value = row.key
    try {
      await adminMenuUpdate(row.key, { visible: v ? 1 : 0 })
      row.visible = v ? 1 : 0
    } catch (e: any) {
      ElMessage.error(e?.message || '切换失败')
    } finally {
      switching.value = ''
    }
  }

  async function move(index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= items.value.length) return
    const list = [...items.value]
    const [moved] = list.splice(index, 1)
    list.splice(to, 0, moved)
    items.value = list
    reordering.value = true
    try {
      await adminMenuReorder(list.map((m) => m.key))
      ElMessage.success('顺序已保存')
      await reload()
    } catch (e: any) {
      ElMessage.error(e?.message || '排序保存失败')
      await reload()
    } finally {
      reordering.value = false
    }
  }

  async function remove(row: any) {
    try {
      await ElMessageBox.confirm(
        `删除菜单「${row.title}」？只会删表里的记录，代码里的路由仍然可以直接访问。`,
        '确认删除',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
    try {
      await adminMenuDelete(row.key)
      ElMessage.success('已删除')
      await reload()
    } catch (e: any) {
      ElMessage.error(e?.message || '删除失败')
    }
  }

  onMounted(reload)
</script>

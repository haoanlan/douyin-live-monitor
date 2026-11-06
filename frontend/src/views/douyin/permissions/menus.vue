<!--
  菜单管理

  **骨架照抄本项目模板**（`views/system/user-manage/index.vue`），不自己发明版式：
    .douyin-page > article.art-card.p-5
      ├ 标题行：h3.text-lg + p.text-sm + [主按钮]
      ├ 工具条：el-input 搜索 + [刷新] + 「共 N 个」
      ├ div.dy-table-scroll > el-table（v-loading / empty-text）
      └ el-dialog（表单项 label-position=top）

  说明：前两版自己排列表/两栏，用户反馈"没按模板重构"。模板已经有一套被全站接受的外壳，
  这里直接复用它 —— 页面之间长得一样，才是后台该有的样子。
-->
<template>
  <div class="douyin-page dy-stagger p-4">
    <article class="art-card p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="m-0 text-lg font-semibold text-g-900">菜单管理</h3>
          <p class="mt-1 text-sm leading-6 text-g-600">
            这里是侧边栏的清单：<b class="text-g-800">排序号小的在上面</b>，
            父级展开成二级菜单。<code class="pc-code">/douyin/detail/:id</code> 这类带参数的页面
            不会出现在这里（它们只能从别的页面点进去）。
          </p>
        </div>
        <el-button type="primary" @click="openCreate">
          <ArtSvgIcon icon="ri:add-line" class="mr-1" />
          新增菜单
        </el-button>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <el-input
          v-model="keyword"
          placeholder="按名称 / 标识 / 路径搜索"
          clearable
          class="!w-[260px]"
        >
          <template #prefix><ArtSvgIcon icon="ri:search-line" /></template>
        </el-input>
        <el-button :loading="loading" @click="reload">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
          刷新
        </el-button>
        <span class="text-xs text-g-500">
          共 {{ items.length }} 个菜单 · 侧边栏 {{ sidebarCount }} 项 · 隐藏页 {{ hiddenCount }} 项
        </span>
      </div>

      <div class="dy-table-scroll dy-table-scroll--wide">
        <el-table :data="filtered" class="mt-4" v-loading="loading" empty-text="没有匹配的菜单">
          <el-table-column label="排序" width="120" align="center">
            <template #default="{ row, $index }">
              <div class="flex items-center justify-center gap-1">
                <el-button size="small" text :disabled="$index === 0 || busy" title="上移" @click="move($index, -1)">
                  <ArtSvgIcon icon="ri:arrow-up-s-line" />
                </el-button>
                <span class="tabular-nums text-xs text-g-500">{{ row.sort }}</span>
                <el-button
                  size="small"
                  text
                  :disabled="$index === filtered.length - 1 || busy"
                  title="下移"
                  @click="move($index, 1)"
                >
                  <ArtSvgIcon icon="ri:arrow-down-s-line" />
                </el-button>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="名称" min-width="180">
            <template #default="{ row }">
              <div class="flex items-center gap-1.5">
                <ArtSvgIcon :icon="row.icon || 'ri:checkbox-blank-circle-line'" class="shrink-0 text-g-500" />
                <span class="text-sm" :class="row.parentKey ? 'text-g-700' : 'font-medium text-g-900'">
                  {{ row.parentKey ? '└ ' : '' }}{{ row.title }}
                </span>
                <el-tag v-if="row.hidden" size="small" type="info" effect="plain">隐藏页</el-tag>
                <el-tag v-else-if="!row.visible" size="small" type="warning" effect="plain">不显示</el-tag>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="标识" min-width="190">
            <template #default="{ row }">
              <code class="pc-code">{{ row.key }}</code>
            </template>
          </el-table-column>

          <el-table-column label="路径" min-width="200">
            <template #default="{ row }">
              <span class="text-xs text-g-600">{{ row.path || '—' }}</span>
            </template>
          </el-table-column>

          <el-table-column label="上级" width="150">
            <template #default="{ row }">
              <span class="text-xs text-g-600">{{ row.parentKey || '—' }}</span>
            </template>
          </el-table-column>

          <el-table-column label="侧边栏显示" width="120" align="center">
            <template #default="{ row }">
              <el-switch
                :model-value="!!row.visible"
                :disabled="!!row.hidden || busy"
                @change="(v: any) => toggleVisible(row, v)"
              />
            </template>
          </el-table-column>

          <el-table-column label="操作" width="160" align="right">
            <template #default="{ row }">
              <el-button size="small" plain @click="openEdit(row)">编辑</el-button>
              <el-button size="small" plain type="danger" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </article>

    <!-- 新增 / 编辑 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingKey ? '编辑菜单' : '新增菜单'"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-position="top">
        <el-form-item label="标识（路由 name）">
          <el-input v-model="form.key" :disabled="!!editingKey" placeholder="DouyinSearch" />
          <div class="mt-1 text-xs text-g-400">
            必须是代码里真实存在的路由 name；创建后不可改（否则和代码对不上）
          </div>
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.title" placeholder="侧边栏显示的名字" />
        </el-form-item>
        <el-form-item label="路径">
          <el-input v-model="form.path" placeholder="/douyin/xxx" />
        </el-form-item>
        <el-form-item label="上级菜单">
          <el-select v-model="form.parentKey" clearable placeholder="无（一级菜单）" class="w-full">
            <el-option
              v-for="m in items.filter((x) => !x.parentKey)"
              :key="m.key"
              :label="m.title"
              :value="m.key"
              :disabled="m.key === editingKey"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="排序号">
          <el-input-number v-model="form.sort" :min="0" :step="10" :controls="false" class="!w-[140px]" />
          <span class="ml-2 text-xs text-g-400">越小越靠上</span>
        </el-form-item>
        <el-form-item label="侧边栏显示">
          <el-switch v-model="form.visible" />
          <span class="ml-2 text-xs text-g-400">关掉后仍在库里，但侧边栏不显示</span>
        </el-form-item>
        <el-form-item label="隐藏页">
          <el-switch v-model="form.hidden" />
          <span class="ml-2 text-xs text-g-400">详情页/画像页这类，本来就不进侧边栏</span>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
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

  defineOptions({ name: 'SystemMenus' })

  const loading = ref(false)
  const busy = ref(false)
  const items = ref<AdminMenuItem[]>([])
  const keyword = ref('')

  const filtered = computed(() => {
    const k = keyword.value.trim().toLowerCase()
    const list = items.value.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    if (!k) return list
    return list.filter(
      (m) =>
        (m.title || '').toLowerCase().includes(k) ||
        (m.key || '').toLowerCase().includes(k) ||
        (m.path || '').toLowerCase().includes(k)
    )
  })

  const sidebarCount = computed(() => items.value.filter((m) => !!m.visible && !m.hidden).length)
  const hiddenCount = computed(() => items.value.filter((m) => !!m.hidden).length)

  const dialogVisible = ref(false)
  const editingKey = ref('')
  const saving = ref(false)

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
    try {
      const r: any = await adminMenus()
      items.value = r?.items || []
    } catch (e: any) {
      ElMessage.error(e?.message || '读取失败')
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
    busy.value = true
    try {
      await adminMenuUpdate(row.key, { visible: !!v ? 1 : 0 })
      await reload()
    } catch (e: any) {
      ElMessage.error(e?.message || '切换失败')
    } finally {
      busy.value = false
    }
  }

  async function move(index: number, delta: number) {
    const list = filtered.value.slice()
    const to = index + delta
    if (to < 0 || to >= list.length) return
    const [moved] = list.splice(index, 1)
    list.splice(to, 0, moved)
    busy.value = true
    try {
      await adminMenuReorder(list.map((m) => m.key))
      await reload()
    } catch (e: any) {
      ElMessage.error(e?.message || '排序保存失败')
      await reload()
    } finally {
      busy.value = false
    }
  }

  async function remove(row: any) {
    try {
      await ElMessageBox.confirm(
        '删除菜单「' + row.title + '」？只删表里的记录，代码里的路由仍可直接访问。',
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

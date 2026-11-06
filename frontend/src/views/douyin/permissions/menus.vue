<!--
  菜单管理 —— 按 frontend-design 的设计计划重做（第三版）

  ## 这一版和前两版的差别
  第一版：直接 el-table，被否"丑"—— 默认表格把菜单压成一堆等价文本框。
  第二版：改成自定义列表行，仍然是"一个平铺列表"—— 结构没有传达任何信息。
  第三版（这一版）：**按"进不进侧边栏"分两栏**。
     用户脑子里存的不是 menu_items 表，是"侧边栏长什么样"。
     把菜单按侧边栏顺序罗列，序号就是排位 —— 结构本身在传递信息。
     隐藏页（详情页/画像页）单独一栏，因为它们本来就不进侧边栏。

  ## 设计原则（frontend-design）
  · 结构对应用户心智，不对应表字段
  · 一行一个菜单：图标 + 名称 + 标识，三件套，不多
  · 只"敢"一处：左栏的大字序号（= 侧边栏排位），其余全部安静
  · 静时不吵：排序箭头 / 编辑 / 删除只在悬停时出现
  · 三态齐全：骨架 / 失败内联重试 / 空
  · 字只有两级：名称 14/500，元信息 11/400；等宽只用于标识和路径（它是代码，不是装饰）
-->
<template>
  <div class="douyin-page dy-stagger p-4">
    <!-- 头 -->
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h3 class="m-0 text-[17px] font-semibold tracking-[-0.01em] text-g-900">菜单管理</h3>
        <p class="mb-0 mt-1 text-[13px] leading-5 text-g-600">
          侧边栏按左栏的顺序出现；右栏是不进侧边栏的页面。改动不影响谁能访问（生效在阶段四）。
        </p>
      </div>
      <el-button size="small" type="primary" class="shrink-0" @click="openCreate">新增菜单</el-button>
    </div>

    <!-- 骨架 -->
    <div v-if="loading && !items.length" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div class="art-card p-5">
        <div v-for="i in 6" :key="i" class="mb-3 flex items-center gap-3">
          <el-skeleton-item variant="text" style="width: 24px; height: 20px" />
          <el-skeleton-item variant="text" style="width: 20px; height: 20px" />
          <el-skeleton-item variant="text" style="flex: 1; max-width: 160px" />
        </div>
      </div>
      <div class="art-card p-5">
        <el-skeleton :rows="3" animated />
      </div>
    </div>

    <!-- 失败 -->
    <div v-else-if="loadError" class="art-card px-6 py-14 text-center">
      <p class="mb-3 text-sm text-danger">{{ loadError }}</p>
      <el-button size="small" @click="reload">重试</el-button>
    </div>

    <!-- 空 -->
    <div v-else-if="!items.length" class="art-card px-6 py-14 text-center text-sm text-g-400">
      还没有菜单记录
    </div>

    <!-- 两栏 -->
    <div v-else class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <!-- 左：侧边栏 -->
      <section class="art-card overflow-hidden">
        <header class="flex items-baseline justify-between px-5 pb-3 pt-4">
          <h4 class="m-0 text-[13px] font-medium text-g-700">侧边栏</h4>
          <span class="tabular-nums text-[11px] text-g-400">{{ sidebarItems.length }} 项</span>
        </header>

        <div v-if="!sidebarItems.length" class="px-5 py-10 text-center text-[13px] text-g-400">
          没有会显示在侧边栏的菜单
        </div>

        <div v-else>
          <div
            v-for="(row, i) in sidebarItems"
            :key="row.key"
            class="group relative flex items-center gap-3 border-t border-g-100 px-5 py-3 transition-colors hover:bg-g-50/70"
          >
            <!-- 序号 = 侧边栏排位（这一版唯一"敢"的地方） -->
            <span
              class="w-6 shrink-0 text-right text-[15px] font-semibold tabular-nums leading-none text-g-300 transition-colors group-hover:text-theme"
            >{{ String(i + 1).padStart(2, '0') }}</span>

            <!-- 图标 = 菜单身份 -->
            <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-g-100 text-g-600">
              <ArtSvgIcon :icon="row.icon || 'ri:checkbox-blank-circle-line'" class="text-[14px]" />
            </span>

            <!-- 名称 + 路径 -->
            <div class="min-w-0 flex-1">
              <div class="truncate text-[14px] font-medium leading-5 text-g-900">{{ row.title }}</div>
              <div class="truncate font-mono text-[11px] leading-4 text-g-400">{{ row.path || row.key }}</div>
            </div>

            <!-- 标识：小、等宽、安静 -->
            <code class="hidden shrink-0 rounded bg-g-50 px-1.5 py-0.5 font-mono text-[11px] text-g-500 md:block">
              {{ row.key }}
            </code>

            <!-- 悬停才出现的操作 -->
            <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded text-g-400 hover:bg-g-100 hover:text-g-800 disabled:opacity-25"
                :disabled="i === 0 || busy"
                title="上移"
                @click="move(i, -1)"
              >
                <ArtSvgIcon icon="ri:arrow-up-s-line" class="text-[14px]" />
              </button>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded text-g-400 hover:bg-g-100 hover:text-g-800 disabled:opacity-25"
                :disabled="i === sidebarItems.length - 1 || busy"
                title="下移"
                @click="move(i, 1)"
              >
                <ArtSvgIcon icon="ri:arrow-down-s-line" class="text-[14px]" />
              </button>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded text-g-400 hover:bg-g-100 hover:text-g-800"
                title="编辑"
                @click="openEdit(row)"
              >
                <ArtSvgIcon icon="ri:edit-line" class="text-[13px]" />
              </button>
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded text-g-400 hover:bg-danger/10 hover:text-danger"
                title="删除"
                @click="remove(row)"
              >
                <ArtSvgIcon icon="ri:delete-bin-line" class="text-[13px]" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 右：隐藏页 + 已隐藏 -->
      <div class="flex flex-col gap-4">
        <section class="art-card overflow-hidden">
          <header class="flex items-baseline justify-between px-5 pb-3 pt-4">
            <h4 class="m-0 text-[13px] font-medium text-g-700">隐藏页</h4>
            <span class="tabular-nums text-[11px] text-g-400">{{ hiddenItems.length }} 项</span>
          </header>
          <p class="mx-5 mb-3 text-[11px] leading-4 text-g-400">
            详情页、画像页这类，从别的页面点进去，不进侧边栏。
          </p>

          <div v-if="!hiddenItems.length" class="px-5 pb-6 text-[13px] text-g-400">没有隐藏页</div>

          <div
            v-for="row in hiddenItems"
            :key="row.key"
            class="group flex items-center gap-2.5 border-t border-g-100 px-5 py-2.5 hover:bg-g-50/70"
          >
            <span class="flex size-6 shrink-0 items-center justify-center rounded bg-g-100/70 text-g-500">
              <ArtSvgIcon :icon="row.icon || 'ri:checkbox-blank-circle-line'" class="text-[12px]" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-[13px] leading-5 text-g-700">{{ row.title }}</div>
              <div class="truncate text-[11px] leading-4 text-g-400">
                属于 {{ row.parentKey || '—' }}
              </div>
            </div>
            <button
              type="button"
              class="flex size-6 shrink-0 items-center justify-center rounded text-g-400 opacity-0 transition-opacity hover:bg-g-100 hover:text-g-800 group-hover:opacity-100 group-focus-within:opacity-100"
              title="编辑"
              @click="openEdit(row)"
            >
              <ArtSvgIcon icon="ri:edit-line" class="text-[13px]" />
            </button>
          </div>
        </section>

        <!-- 已隐藏（visible=0 但不属于隐藏页）—— 很少见，单独一处免得找不到 -->
        <section v-if="offItems.length" class="art-card overflow-hidden">
          <header class="flex items-baseline justify-between px-5 pb-3 pt-4">
            <h4 class="m-0 text-[13px] font-medium text-g-700">已隐藏</h4>
            <span class="tabular-nums text-[11px] text-g-400">{{ offItems.length }} 项</span>
          </header>
          <p class="mx-5 mb-3 text-[11px] leading-4 text-g-400">在侧边栏里但被关掉了显示。</p>
          <div
            v-for="row in offItems"
            :key="row.key"
            class="group flex items-center gap-2.5 border-t border-g-100 px-5 py-2.5 hover:bg-g-50/70"
          >
            <span class="flex size-6 shrink-0 items-center justify-center rounded bg-g-100/70 text-g-400">
              <ArtSvgIcon :icon="row.icon || 'ri:checkbox-blank-circle-line'" class="text-[12px]" />
            </span>
            <div class="min-w-0 flex-1 truncate text-[13px] leading-5 text-g-500">{{ row.title }}</div>
            <button
              type="button"
              class="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-theme opacity-0 transition-opacity hover:bg-theme/10 group-hover:opacity-100 group-focus-within:opacity-100"
              @click="toggleVisible(row, 1)"
            >显示</button>
            <button
              type="button"
              class="flex size-6 shrink-0 items-center justify-center rounded text-g-400 opacity-0 transition-opacity hover:bg-g-100 hover:text-g-800 group-hover:opacity-100 group-focus-within:opacity-100"
              title="编辑"
              @click="openEdit(row)"
            >
              <ArtSvgIcon icon="ri:edit-line" class="text-[13px]" />
            </button>
          </div>
        </section>
      </div>
    </div>

    <!-- 新增/编辑 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingKey ? '编辑菜单' : '新增菜单'"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-width="84px" label-position="right" class="pt-1">
        <el-form-item label="标识" required>
          <el-input v-model="form.key" :disabled="!!editingKey" placeholder="DouyinSearch" class="font-mono" />
          <div class="mt-1 text-[11px] leading-4 text-g-400">路由 name，必须是代码里真实存在的；创建后不可改</div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.title" placeholder="侧边栏显示的名字" />
        </el-form-item>
        <el-form-item label="路径">
          <el-input v-model="form.path" placeholder="/douyin/xxx" class="font-mono" />
        </el-form-item>
        <el-form-item label="上级">
          <el-select v-model="form.parentKey" clearable placeholder="无（一级菜单）" class="w-full">
            <el-option
              v-for="m in items"
              :key="m.key"
              :label="m.title"
              :value="m.key"
              :disabled="m.key === editingKey"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="顺序">
          <el-input-number v-model="form.sort" :min="0" :step="10" :controls="false" class="!w-[120px]" />
          <span class="ml-2 text-[11px] text-g-400">越小越靠上</span>
        </el-form-item>
        <el-form-item label="进侧边栏">
          <el-switch v-model="form.visible" />
          <span class="ml-2 text-[11px] text-g-400">关掉后仍在库里，但侧边栏不显示</span>
        </el-form-item>
        <el-form-item label="隐藏页">
          <el-switch v-model="form.hidden" />
          <span class="ml-2 text-[11px] text-g-400">详情页/画像页这类，本来就不进侧边栏</span>
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="flex items-center justify-end gap-2.5">
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
  const busy = ref(false)

  /** 进侧边栏：visible 且不是隐藏页 */
  const sidebarItems = computed(() =>
    items.value.filter((m) => !!m.visible && !m.hidden).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  )
  /** 隐藏页：详情页 / 画像页这类 */
  const hiddenItems = computed(() => items.value.filter((m) => !!m.hidden).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)))
  /** 在侧边栏但被关掉显示的 */
  const offItems = computed(() => items.value.filter((m) => !m.visible && !m.hidden))

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

  /** 在「侧边栏」这一栏内上下移动：只重排可见项，其余项的 sort 保持不变 */
  async function move(index: number, delta: number) {
    const list = [...sidebarItems.value]
    const to = index + delta
    if (to < 0 || to >= list.length) return
    const [moved] = list.splice(index, 1)
    list.splice(to, 0, moved)

    busy.value = true
    try {
      // 重排后按 (i+1)*10 写，隐藏页和已隐藏的手工 sort 不被覆盖
      const upd = adminMenuReorder
      const keys = [...list.map((m) => m.key), ...hiddenItems.value.map((m) => m.key)]
      await upd(keys)
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

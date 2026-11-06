<!--
  菜单管理（阶段三：可编辑，但**还不影响登录鉴权**）

  ## 为什么不用 el-table
  第一版直接用了 el-table，用户反馈"丑"。原因不是表格本身，是**默认表格的视觉是组装感**：
  表头灰底 + 逐行分割线 + 六列等宽 —— 它把"菜单"这个有图标、有层级、有可见性状态的东西，
  压成了一堆等价的文本框。craft-floor 也明确把"同尺寸卡片/默认表格当页面结构"列为要拒绝的默认。

  ## 这一版的结构
  不用表格，用**列表行**：
    [图标]  名称 ······  标识（等宽）          状态      排序    ⋯
            路径（小字）
  · 图标是真实的路由图标（菜单本来就有 icon 字段）→ 它是身份，不是装饰
  · 名称 14px 中黑，标识/路径 11-12px 等宽浅灰 → 一眼分出主次
  · 状态用「点 + 文字」而不是 switch → 12 行里 12 个开关全是噪音
  · 排序只在悬停/聚焦时露出上移下移 → 静态时不占注意力
  · 隐藏页整组下沉并降透明度，带「隐藏页」小字 → 靠结构区分，不靠颜色硬染
-->
<template>
  <div class="douyin-page dy-stagger p-4">
    <div class="art-card overflow-hidden">
      <!-- 头：标题 + 一句阶段说明 + 动作 -->
      <div class="flex flex-wrap items-end justify-between gap-3 px-6 pb-4 pt-5">
        <div class="min-w-0">
          <h3 class="m-0 text-[17px] font-semibold tracking-[-0.01em] text-g-900">菜单管理</h3>
          <p class="mb-0 mt-1 text-[13px] leading-5 text-g-600">
            <span class="tabular-nums text-g-800">{{ items.length }}</span> 个菜单 ·
            <span class="tabular-nums text-g-800">{{ visibleCount }}</span> 个显示 ·
            <span class="tabular-nums text-g-800">{{ hiddenCount }}</span> 个隐藏页
            <span class="mx-1.5 text-g-300">|</span>
            改这里不影响谁能访问 —— 鉴权仍是硬编码超管（生效在阶段四）
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <el-button size="small" :loading="loading" @click="reload">刷新</el-button>
          <el-button size="small" type="primary" @click="openCreate">新增菜单</el-button>
        </div>
      </div>

      <!-- 列头（比表头轻：只要一条极淡的底 + 10px 字） -->
      <div
        class="grid items-center gap-3 bg-g-50/70 px-6 py-2 text-[10px] font-medium uppercase tracking-[0.08em] text-g-400"
        style="grid-template-columns: 22px minmax(0, 1.6fr) minmax(0, 1fr) 96px 68px 44px"
      >
        <span />
        <span>菜单</span>
        <span>标识 / 路径</span>
        <span class="text-center">状态</span>
        <span class="text-center">顺序</span>
        <span />
      </div>

      <!-- 加载骨架 -->
      <div v-if="loading && !items.length" class="divide-y divide-g-100">
        <div v-for="i in 6" :key="i" class="flex items-center gap-3 px-6 py-3.5">
          <el-skeleton-item variant="text" style="width: 22px; height: 22px" />
          <el-skeleton-item variant="text" style="flex: 1; max-width: 180px" />
          <el-skeleton-item variant="text" style="width: 120px" />
        </div>
      </div>

      <!-- 失败 -->
      <div v-else-if="loadError" class="px-6 py-14 text-center">
        <p class="mb-3 text-sm text-danger">{{ loadError }}</p>
        <el-button size="small" @click="reload">重试</el-button>
      </div>

      <!-- 空 -->
      <div v-else-if="!items.length" class="px-6 py-14 text-center text-sm text-g-400">还没有菜单记录</div>

      <!-- 列表 -->
      <div v-else>
        <div
          v-for="(row, i) in items"
          :key="row.key"
          class="group grid items-center gap-3 border-t border-g-100 px-6 py-3 transition-colors hover:bg-g-50/60"
          style="grid-template-columns: 22px minmax(0, 1.6fr) minmax(0, 1fr) 96px 68px 44px"
          :class="row.hidden ? 'opacity-70' : ''"
        >
          <!-- 图标：真实的路由图标 -->
          <span class="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-g-100 text-g-600">
            <ArtSvgIcon :icon="row.icon || 'ri:checkbox-blank-circle-line'" class="text-[13px]" />
          </span>

          <!-- 名称 + 路径 -->
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span
                class="truncate text-[14px] leading-5"
                :class="row.hidden ? 'text-g-600' : 'font-medium text-g-900'"
              >{{ row.title }}</span>
              <span
                v-if="row.hidden"
                class="shrink-0 rounded bg-g-100 px-1.5 py-px text-[10px] leading-4 text-g-500"
              >隐藏页</span>
            </div>
            <div class="mt-0.5 truncate text-[11px] leading-4 text-g-400">
              {{ row.parentKey ? '属于 ' + row.parentKey : '一级菜单' }}
            </div>
          </div>

          <!-- 标识 / 路径 -->
          <div class="min-w-0">
            <div class="truncate font-mono text-[11px] leading-4 text-g-600">{{ row.key }}</div>
            <div class="truncate font-mono text-[11px] leading-4 text-g-400">{{ row.path || '—' }}</div>
          </div>

          <!-- 状态：点 + 文字（不是 switch，12 个开关太吵） -->
          <div class="flex justify-center">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] leading-4 transition-colors disabled:opacity-50"
              :class="row.hidden
                ? 'text-g-400'
                : row.visible
                  ? 'text-success hover:bg-success/10'
                  : 'text-g-500 hover:bg-g-100'"
              :disabled="!!row.hidden || switching === row.key"
              :title="row.hidden ? '隐藏页不进侧边栏' : (row.visible ? '点击隐藏' : '点击显示')"
              @click="toggleVisible(row, !row.visible)"
            >
              <span
                class="size-1.5 rounded-full"
                :class="row.hidden ? 'bg-g-300' : row.visible ? 'bg-success' : 'bg-g-300'"
              />
              {{ row.hidden ? '隐藏' : row.visible ? '显示' : '已隐藏' }}
            </button>
          </div>

          <!-- 顺序：静态只显示数字，悬停露出箭头 -->
          <div class="flex items-center justify-center gap-0.5">
            <span class="tabular-nums text-[11px] text-g-400 group-hover:hidden">{{ row.sort }}</span>
            <div class="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
              <button
                type="button"
                class="flex size-5 items-center justify-center rounded text-g-400 hover:bg-g-100 hover:text-g-800 disabled:opacity-25"
                :disabled="i === 0 || reordering"
                title="上移"
                @click="move(i, -1)"
              >
                <ArtSvgIcon icon="ri:arrow-up-s-line" class="text-[13px]" />
              </button>
              <button
                type="button"
                class="flex size-5 items-center justify-center rounded text-g-400 hover:bg-g-100 hover:text-g-800 disabled:opacity-25"
                :disabled="i === items.length - 1 || reordering"
                title="下移"
                @click="move(i, 1)"
              >
                <ArtSvgIcon icon="ri:arrow-down-s-line" class="text-[13px]" />
              </button>
            </div>
          </div>

          <!-- 操作：悬停才出现，避免 12 行 × 2 个按钮的噪音 -->
          <div class="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded text-g-500 hover:bg-g-100 hover:text-g-900"
              title="编辑"
              @click="openEdit(row)"
            >
              <ArtSvgIcon icon="ri:edit-line" class="text-[13px]" />
            </button>
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded text-g-500 hover:bg-danger/10 hover:text-danger"
              title="删除"
              @click="remove(row)"
            >
              <ArtSvgIcon icon="ri:delete-bin-line" class="text-[13px]" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增/编辑 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingKey ? '编辑菜单' : '新增菜单'"
      width="500px"
      :close-on-click-modal="false"
      class="perm-dialog"
    >
      <el-form :model="form" label-width="88px" label-position="right" class="pt-1">
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
        <el-form-item label="侧边栏">
          <el-switch v-model="form.visible" active-text="显示" inactive-text="隐藏" />
        </el-form-item>
        <el-form-item label="隐藏页">
          <el-switch v-model="form.hidden" />
          <span class="ml-2 text-[11px] text-g-400">详情页/画像页这类不进侧边栏的页面</span>
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
      await adminMenuUpdate(row.key, { visible: !!v ? 1 : 0 })
      row.visible = !!v ? 1 : 0
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

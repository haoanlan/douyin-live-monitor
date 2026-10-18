<!--
  手机端的 tab 切换条（画像页 / 场次详情页共用）。

  为什么不用 el-tabs：这两个页面的内容是**同一份 DOM**（桌面整页滚动），
  只在手机上按 tab 显示其中一组。el-tabs 的 el-tab-pane 会把内容拆进各自的
  容器里，等于把模板重写一遍；这里只要一条切换条，配合页面里的
  `.dy-mobile-pane` / `.dy-mobile-pane--on` 控制显隐即可。

  视觉：浅灰底的**分段控件**（segmented），每项等宽平均分布、圆角矩形，
  选中项用白底浮起来 —— 与页面里其它"浅底圆角按钮"是同一套语言。
  （试过下划线式 tab：直角、按内容宽度排布，真机上被反馈"更丑"。）
-->
<template>
  <div class="dy-mobile-tabs" role="tablist">
    <button
      v-for="t in tabs"
      :key="t.key"
      type="button"
      role="tab"
      class="dy-mobile-tabs__item"
      :class="{ 'is-active': modelValue === t.key }"
      :aria-selected="modelValue === t.key"
      @click="$emit('update:modelValue', t.key)"
    >
      {{ t.label }}
      <span v-if="t.count != null" class="dy-mobile-tabs__count">{{ t.count }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
  defineOptions({ name: 'DyMobileTabs' })

  export interface MobileTab {
    key: string
    label: string
    count?: number | string
  }

  defineProps<{
    tabs: MobileTab[]
    modelValue: string
  }>()

  defineEmits<{ (e: 'update:modelValue', v: string): void }>()
</script>

<style lang="scss" scoped>
  .dy-mobile-tabs {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    gap: 3px;
    padding: 3px;
    margin-bottom: 12px;
    overflow: hidden;
    background: var(--art-gray-100);
    border-radius: 12px;
  }

  .dy-mobile-tabs__item {
    /* 平均分布：每项等宽，不再按文字长度挤在一起 */
    flex: 1 1 0;
    min-width: 0;
    padding: 8px 4px;
    overflow: hidden;
    font-size: 13px;
    font-weight: 500;
    color: var(--art-gray-600);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    background: transparent;
    border: 0;
    border-radius: 9px;
    transition:
      color 0.15s,
      background-color 0.15s,
      box-shadow 0.15s;
  }

  .dy-mobile-tabs__item.is-active {
    font-weight: 600;
    color: var(--theme-color);
    background: var(--default-box-color);
    box-shadow: 0 1px 3px rgb(16 24 40 / 8%);
  }

  .dy-mobile-tabs__count {
    margin-left: 4px;
    font-size: 11px;
    color: var(--art-gray-400);
  }
</style>

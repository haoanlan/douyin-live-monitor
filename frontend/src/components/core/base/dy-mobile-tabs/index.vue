<!--
  手机端的 tab 切换条（画像页 / 场次详情页共用）。

  为什么不用 el-tabs：这两个页面的内容是**同一份 DOM**（桌面整页滚动），
  只在手机上按 tab 显示其中一组。el-tabs 的 el-tab-pane 会把内容拆进各自的
  容器里，等于把模板重写一遍；这里只要一条切换条，配合页面里的
  `.dy-mobile-pane` / `.dy-mobile-pane--on` 控制显隐即可。

  视觉：下划线式 tab（和 Element 的 tab 一致），不用卡片胶囊 ——
  胶囊样式在真机上会跟下面的卡片边缘叠出一条线，反馈过一次。
  sticky 保留（长列表滚动时还能切），但底色是不透明的页面底色，
  避免内容从下面透出来。
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
    gap: 4px;
    margin-bottom: 12px;
    overflow-x: auto;
    background: var(--default-box-color);
    border-bottom: 1px solid var(--art-card-border);
    scrollbar-width: none;
  }

  .dy-mobile-tabs::-webkit-scrollbar {
    display: none;
  }

  .dy-mobile-tabs__item {
    flex: 0 0 auto;
    padding: 9px 12px;
    font-size: 13px;
    font-weight: 500;
    color: var(--art-gray-500);
    white-space: nowrap;
    cursor: pointer;
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    /* 压在容器那条 1px 线上，选中时线是连续的 */
    margin-bottom: -1px;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .dy-mobile-tabs__item.is-active {
    font-weight: 600;
    color: var(--theme-color);
    border-bottom-color: var(--theme-color);
  }

  .dy-mobile-tabs__count {
    margin-left: 4px;
    font-size: 11px;
    color: var(--art-gray-400);
  }
</style>

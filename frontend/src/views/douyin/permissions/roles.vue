<!--
  角色管理（下一轮实现）—— 先放占位，避免路由指向不存在的文件导致白屏。

  已实现的部分见「菜单管理」页；角色页的数据接口（GET /api/admin/roles、
  /api/admin/roles/:key/menus、PUT .../menus、PUT .../actions、POST /api/admin/roles）
  后端已经全部就绪并测过。
-->
<template>
  <div class="douyin-page p-4">
    <div class="art-card p-5">
      <h3 class="m-0 text-lg font-semibold text-g-900">角色管理</h3>
      <p class="mb-0 mt-2 text-sm text-g-600">
        这一页还没做（下一轮）。后端接口已经就绪：角色清单、角色菜单分配、角色操作分配、新建角色。
      </p>
      <div class="mt-4 rounded-xl border border-g-200 bg-g-50 px-4 py-3 text-sm text-g-600">
        当前可用的：<b class="text-g-800">菜单管理</b>（左侧菜单里）—— 已经能改名称、路径、上级、排序、显示开关、增删。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  defineOptions({ name: 'DouyinPermissionsRoles' })
</script>

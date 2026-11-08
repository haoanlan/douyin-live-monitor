<template>
  <ArtSearchBar
    ref="searchBarRef"
    v-model="formData"
    :items="formItems"
    :rules="rules"
    @reset="handleReset"
    @search="handleSearch"
  >
  </ArtSearchBar>
</template>

<script setup lang="ts">
  /*
   * 用户搜索栏。
   *
   * 模板原版有「用户名 / 手机号 / 邮箱 / 状态 / 性别」五个条件，
   * 但 dashboard_users 只有 username / role / enabled / create_time / last_login_time，
   * 手机号、邮箱、性别、在线状态这些字段我们库里根本没有 —— 留着只会永远筛出空结果。
   * 现在只保留后端真正支持的「用户名」（/api/user/list 也只按 userName 过滤）。
   */
  interface Props {
    modelValue: Api.SystemManage.UserSearchParams
  }
  interface Emits {
    (e: 'update:modelValue', value: Api.SystemManage.UserSearchParams): void
    (e: 'search', params: Api.SystemManage.UserSearchParams): void
    (e: 'reset'): void
  }
  const props = defineProps<Props>()
  const emit = defineEmits<Emits>()

  const searchBarRef = ref()
  const formData = computed({
    get: () => props.modelValue,
    set: (val) => emit('update:modelValue', val)
  })

  const rules = {}

  const formItems = computed(() => [
    {
      label: '用户名',
      key: 'userName',
      type: 'input',
      placeholder: '请输入用户名',
      clearable: true
    }
  ])

  function handleReset() {
    emit('reset')
  }

  async function handleSearch(params: Api.SystemManage.UserSearchParams) {
    await searchBarRef.value?.validate()
    emit('search', params)
  }
</script>

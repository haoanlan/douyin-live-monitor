<template>
  <ElDialog
    v-model="dialogVisible"
    :title="dialogType === 'add' ? '新增用户' : '编辑用户'"
    width="460px"
    align-center
    :close-on-click-modal="false"
  >
    <ElForm ref="formRef" :model="formData" :rules="rules" label-width="90px">
      <!-- 字段按 dashboard_users 来：username / password / role / enabled -->
      <ElFormItem label="用户名" prop="username">
        <ElInput v-model="formData.username" :disabled="dialogType === 'edit'" placeholder="2~32 位，字母数字与 _ . @ -" />
      </ElFormItem>
      <ElFormItem v-if="dialogType === 'add'" label="密码" prop="password">
        <ElInput v-model="formData.password" type="password" show-password placeholder="至少 6 位" />
      </ElFormItem>
      <ElFormItem label="角色" prop="role">
        <ElSelect v-model="formData.role" class="w-full">
          <ElOption
            v-for="role in roleList"
            :key="role.roleCode"
            :value="role.roleCode"
            :label="role.roleName"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem v-if="dialogType === 'edit'" label="启用">
        <ElSwitch v-model="formData.enabled" />
      </ElFormItem>
    </ElForm>
    <template #footer>
      <div class="dialog-footer">
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="saving" @click="handleSubmit">提交</ElButton>
      </div>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
  import { ROLE_LIST_DATA } from '@/mock/temp/formData'
  import { createUser, updateUser as apiUpdateUser } from '@/api/auth-douyin'
  import { ElMessage, type FormInstance, type FormRules } from 'element-plus'

  interface Props {
    visible: boolean
    type: string
    userData?: Partial<Api.SystemManage.UserListItem>
  }

  interface Emits {
    (e: 'update:visible', value: boolean): void
    (e: 'submit'): void
  }

  const props = defineProps<Props>()
  const emit = defineEmits<Emits>()

  const roleList = ref(ROLE_LIST_DATA)
  const saving = ref(false)

  const dialogVisible = computed({
    get: () => props.visible,
    set: (value) => emit('update:visible', value)
  })

  const dialogType = computed(() => props.type)
  const formRef = ref<FormInstance>()

  const formData = reactive({
    id: 0,
    username: '',
    password: '',
    role: 'R_GUEST',
    enabled: true
  })

  const rules: FormRules = {
    username: [
      { required: true, message: '请输入用户名', trigger: 'blur' },
      { min: 2, max: 32, message: '长度在 2 到 32 个字符', trigger: 'blur' }
    ],
    password: [
      { required: true, message: '请输入密码', trigger: 'blur' },
      { min: 6, message: '至少 6 位', trigger: 'blur' }
    ],
    role: [{ required: true, message: '请选择角色', trigger: 'change' }]
  }

  const initFormData = () => {
    const isEdit = props.type === 'edit' && props.userData
    const row = props.userData as any

    Object.assign(formData, {
      id: isEdit ? Number(row?.id) || 0 : 0,
      username: isEdit ? row?.userName || '' : '',
      password: '',
      role: isEdit ? row?.userRoles?.[0] || 'R_GUEST' : 'R_GUEST',
      enabled: isEdit ? row?.status === '1' : true
    })
  }

  watch(
    () => [props.visible, props.type, props.userData],
    ([visible]) => {
      if (visible) {
        initFormData()
        nextTick(() => formRef.value?.clearValidate())
      }
    },
    { immediate: true }
  )

  const handleSubmit = async () => {
    if (!formRef.value) return
    try {
      await formRef.value.validate()
    } catch {
      return
    }

    saving.value = true
    try {
      if (dialogType.value === 'add') {
        await createUser({
          userName: formData.username,
          password: formData.password,
          role: formData.role
        })
        ElMessage.success('已新增')
      } else {
        await apiUpdateUser({
          id: formData.id,
          role: formData.role,
          enabled: formData.enabled
        })
        ElMessage.success('已保存')
      }
      dialogVisible.value = false
      emit('submit')
    } catch (e: any) {
      ElMessage.error(e?.backendMessage || e?.message || '提交失败')
    } finally {
      saving.value = false
    }
  }
</script>

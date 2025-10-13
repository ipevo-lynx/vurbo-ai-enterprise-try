import type { LoginFormData } from '~/service/schema/user'

import { reactive } from 'vue'

import { useAuthStore } from '~/stores/auth'

export function useLoginPage() {
  const authStore = useAuthStore()

  // 頁面狀態管理
  const pageState = reactive({
    ui: {
      showPassword: false,
    },
    loading: {
      isSubmitting: false,
    },
    errors: {
      formError: '',
    },
    data: {
      formData: {
        email: 'admin@example.com',
        password: '123456',
      } as LoginFormData,
    },
  })

  // 切換密碼顯示/隱藏
  const togglePasswordVisibility = () => {
    pageState.ui.showPassword = !pageState.ui.showPassword
  }

  // 清除錯誤
  const clearError = () => {
    pageState.errors.formError = ''
    authStore.clearError()
  }

  // 處理登入
  const handleLogin = async (): Promise<boolean> => {
    pageState.loading.isSubmitting = true
    clearError()

    try {
      const success = await authStore.login(pageState.data.formData)

      if (!success && authStore.error) {
        pageState.errors.formError = authStore.error
      }

      return success
    }
    catch {
      pageState.errors.formError = '登入過程中發生未知錯誤'
      return false
    }
    finally {
      pageState.loading.isSubmitting = false
    }
  }

  // 重置表單
  const resetForm = () => {
    pageState.data.formData.email = 'admin@example.com'
    pageState.data.formData.password = '123456'
    clearError()
  }

  return {
    pageState,
    togglePasswordVisibility,
    clearError,
    handleLogin,
    resetForm,
  }
}

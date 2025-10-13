import type { LoginFormData, UserData } from '~/service/schema/user'

import { useFetch } from '#app'
import { $fetch } from 'ofetch'
import { defineStore } from 'pinia'

import { computed, ref } from 'vue'
import { validateSchema } from '~/service/schema/common'
import { LoginResponseSchema, LogoutResponseSchema, UserResponseSchema } from '~/service/schema/user'

export const useAuthStore = defineStore('auth', () => {
  // 狀態
  const currentUser = ref<UserData | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // 計算屬性
  const isLoggedIn = computed(() => !!currentUser.value)

  // 設置用戶資料
  const setUser = (user: UserData | null) => {
    currentUser.value = user
    error.value = null
  }

  // 清除用戶資料
  const clearUser = () => {
    currentUser.value = null
  }

  // 設置錯誤
  const setError = (errorMessage: string) => {
    error.value = errorMessage
  }

  // 清除錯誤
  const clearError = () => {
    error.value = null
  }

  // 登入
  const login = async (loginData: LoginFormData): Promise<boolean> => {
    isLoading.value = true
    clearError()

    try {
      const response = await $fetch('/api/auth/login', {
        method: 'POST',
        body: loginData,
      })

      const validatedResponse = validateSchema(LoginResponseSchema, response, '登入')

      if (validatedResponse.success && validatedResponse.data) {
        // 確保 data 不是陣列類型
        const loginData = Array.isArray(validatedResponse.data) ? validatedResponse.data[0] : validatedResponse.data
        if (loginData && 'user' in loginData) {
          const userData = loginData.user
          setUser(userData)
          return true
        }
      }

      const errorMessage = validatedResponse.message?.[0] || '登入失敗'
      setError(errorMessage)
      return false
    }
    catch (err: any) {
      const errorMessage = err?.data?.message?.[0] || err?.message || '登入過程中發生錯誤'
      setError(errorMessage)
      return false
    }
    finally {
      isLoading.value = false
    }
  }

  // 登出
  const logout = async (): Promise<boolean> => {
    isLoading.value = true
    clearError()

    try {
      const response = await $fetch('/api/auth/logout', {
        method: 'POST',
      })

      const validatedResponse = validateSchema(LogoutResponseSchema, response, '登出')

      if (validatedResponse.success) {
        clearUser()
        return true
      }
      else {
        const errorMessage = validatedResponse.message?.[0] || '登出失敗'
        setError(errorMessage)
        return false
      }
    }
    catch (err: any) {
      // 即使登出 API 失敗，也清除本地狀態
      clearUser()
      console.error('登出錯誤:', err)
      return true
    }
    finally {
      isLoading.value = false
    }
  }

  // 檢查認證狀態並獲取用戶資訊
  const checkAuthStatus = async (): Promise<boolean> => {
    // 如果已經有用戶資料，直接返回
    if (currentUser.value) {
      return true
    }

    // 注意使用 useFetch 時不能被包裝在 try-catch 內
    const { data: response, error: fetchError } = await useFetch('/api/user', {
      method: 'GET',
    })

    // 如果有錯誤，清除用戶狀態並返回 false
    if (fetchError.value) {
      clearUser()
      return false
    }

    const validatedResponse = validateSchema(UserResponseSchema, response.value, '獲取用戶資訊')

    if (validatedResponse.success && validatedResponse.data) {
      const userData = Array.isArray(validatedResponse.data) ? validatedResponse.data[0] : validatedResponse.data
      setUser(userData)
      return true
    }

    return false
  }

  // 重置所有狀態
  const reset = () => {
    clearUser()
    clearError()
    isLoading.value = false
  }

  return {
    // 狀態
    currentUser,
    isLoading,
    error,

    // 計算屬性
    isLoggedIn,

    // 方法
    setUser,
    clearUser,
    setError,
    clearError,
    login,
    logout,
    checkAuthStatus,
    reset,
  }
})

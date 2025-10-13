<script setup lang="ts">
import { navigateTo } from '#app'
import { definePageMeta } from '#imports'
import { useLoginPage } from '~/composables/page/useLoginPage'

// 使用 withoutNav layout
definePageMeta({
  layout: 'without-nav',
})

// 使用登入頁面邏輯
const { pageState, togglePasswordVisibility, handleLogin, resetForm } = useLoginPage()

// 處理表單提交
async function onSubmit() {
  const success = await handleLogin()

  if (success) {
    // 登入成功，重定向到首頁
    await navigateTo('/')
  }
  // 登入失敗的錯誤已在 pageState.errors.formError 中顯示
}

// 重設表單
function onReset() {
  resetForm()
}
</script>

<template>
  <div class="flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full space-y-8">
      <!-- 頁面標題 -->
      <div class="text-center">
        <h1 class="text-3xl font-bold text-gray-900">
          Vurbo AI Enterprise
        </h1>
        <h2 class="mt-6 text-2xl font-semibold text-gray-800">
          登入您的帳戶
        </h2>
        <p class="mt-2 text-sm text-gray-600">
          請使用您的帳號密碼登入系統
        </p>
      </div>

      <!-- 登入表單 -->
      <form
        class="mt-8 space-y-6"
        @submit.prevent="onSubmit"
      >
        <!-- 錯誤訊息顯示 -->
        <div
          v-if="pageState.errors.formError"
          class="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-md text-sm"
        >
          {{ pageState.errors.formError }}
        </div>

        <div class="space-y-4">
          <!-- 電子信箱輸入 -->
          <div>
            <label
              for="email"
              class="block text-sm font-medium text-gray-700 mb-1"
            >
              電子信箱
            </label>
            <input
              id="email"
              v-model="pageState.data.formData.email"
              type="email"
              autocomplete="email"
              required
              class="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="請輸入電子信箱"
            >
          </div>

          <!-- 密碼輸入 -->
          <div>
            <label
              for="password"
              class="block text-sm font-medium text-gray-700 mb-1"
            >
              密碼
            </label>
            <div class="relative">
              <input
                id="password"
                v-model="pageState.data.formData.password"
                :type="pageState.ui.showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                required
                class="appearance-none relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="請輸入密碼"
              >
              <button
                type="button"
                class="absolute inset-y-0 right-0 pr-3 flex items-center"
                @click="togglePasswordVisibility"
              >
                <span class="text-gray-400 hover:text-gray-600 text-sm">
                  {{ pageState.ui.showPassword ? '隱藏' : '顯示' }}
                </span>
              </button>
            </div>
          </div>
        </div>

        <!-- 測試帳號提示 -->
        <div class="bg-blue-50 border border-blue-300 text-blue-700 px-4 py-3 rounded-md text-sm">
          <p class="font-medium">
            測試帳號資訊：
          </p>
          <p>帳號：admin@example.com</p>
          <p>密碼：123456</p>
          <p class="mt-1 text-xs text-blue-600">
            （表單已預填入測試帳號）
          </p>
        </div>

        <!-- 操作按鈕 -->
        <div class="flex space-x-4">
          <button
            type="submit"
            :disabled="pageState.loading.isSubmitting"
            class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span
              v-if="pageState.loading.isSubmitting"
              class="flex items-center"
            >
              <svg
                class="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              登入中...
            </span>
            <span v-else>登入</span>
          </button>

          <button
            type="button"
            :disabled="pageState.loading.isSubmitting"
            class="w-full flex justify-center py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="onReset"
          >
            重置
          </button>
        </div>
      </form>

      <!-- 底部連結 -->
      <div class="text-center">
        <NuxtLink
          to="/"
          class="text-sm text-blue-600 hover:text-blue-500"
        >
          返回首頁
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>

</style>

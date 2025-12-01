<script setup lang="ts">
import { onMounted } from 'vue'

import { useAuthStore } from '~/stores/auth'

// 使用認證 store
const authStore = useAuthStore()

// 處理登出
async function handleLogout() {
  const success = await authStore.logout()
  if (success) {
    // 登出成功後重新整理頁面
    if (import.meta.client) {
      window.location.reload()
    }
  }
}

// 檢查認證狀態
onMounted(async () => {
  await authStore.checkAuthStatus()
})
</script>

<template>
  <div class="min-h-[100dvh] bg-gray-50 flex flex-col">
    <!-- 頂部導航 -->
    <nav class="bg-white shadow-sm border-b border-gray-200">
      <div class="container mx-auto px-4 py-4 flex justify-between items-center">
        <div>
          <NuxtLink
            to="/"
            class="text-2xl font-bold text-gray-900 hover:text-blue-600"
          >
            Vurbo AI Enterprise
          </NuxtLink>
          <p class="text-gray-600 text-sm">
            企業級 AI 開發平台
          </p>
        </div>

        <div class="flex items-center space-x-8">
          <!-- 導航選單 -->
          <nav class="hidden md:flex space-x-6">
            <NuxtLink
              to="/"
              class="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
            >
              首頁
            </NuxtLink>
            <NuxtLink
              to="/websocket-poc"
              class="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
            >
              🔌 WebSocket POC
            </NuxtLink>
          </nav>

          <!-- 登入狀態顯示 -->
          <div
            v-if="authStore.isLoggedIn"
            class="flex items-center space-x-3"
          >
            <span class="text-sm text-gray-700">
              歡迎，{{ authStore.currentUser?.name }}
            </span>
            <button
              class="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
              @click="handleLogout"
            >
              登出
            </button>
          </div>

          <!-- 未登入狀態 -->
          <div
            v-else
            class="flex items-center space-x-3"
          >
            <span class="text-sm text-gray-700">未登入</span>
            <NuxtLink
              to="/login"
              class="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              登入
            </NuxtLink>
          </div>
        </div>
      </div>
    </nav>

    <!-- 主要內容區域 -->
    <main class="flex-1 min-h-0">
      <slot />
    </main>

    <!-- 底部 -->
    <footer class="text-center py-6 border-t border-gray-200 bg-white mt-auto">
      <p class="text-sm text-gray-500">
        &copy; 2025 Vurbo AI Enterprise. All rights reserved.
      </p>
    </footer>
  </div>
</template>

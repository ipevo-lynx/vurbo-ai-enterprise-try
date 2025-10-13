<script setup>
import { useAuthStore } from '~/stores/auth'

// 初始化身份驗證狀態
const authStore = useAuthStore()

// 在應用啟動時檢查用戶登入狀態
// onMounted(async () => {
await authStore.checkAuthStatus()
// })
</script>

<template>
  <div class="">
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtLoadingIndicator
        :throttle="0"
        color="gray"
      />
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>

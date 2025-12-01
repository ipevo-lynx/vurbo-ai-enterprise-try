<script setup lang="ts">
// 這個組件確保內容只在客戶端渲染，避免 hydration mismatch
</script>

<template>
  <ClientOnly>
    <div>
      <slot />
    </div>
    <template #fallback>
      <div class="flex items-center justify-center min-h-screen">
        <div class="text-center">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p class="text-gray-600">
            載入中...
          </p>
        </div>
      </div>
    </template>
  </ClientOnly>
</template>

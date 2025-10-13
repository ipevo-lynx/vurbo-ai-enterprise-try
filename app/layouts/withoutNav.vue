<script setup lang="ts">
// Layout for pages that don't need navigation, only footer
</script>

<template>
  <div class="min-h-[100dvh] bg-gray-50 flex flex-col">
    <!-- 主要內容區域 -->
    <main class="flex-1">
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

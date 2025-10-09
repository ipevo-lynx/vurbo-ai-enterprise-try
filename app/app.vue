<script setup>
// 這裡可以加入 Vue 3 Composition API 的邏輯
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

<style>
/* 如果需要自定義樣式，可以在這裡加入 */
</style>

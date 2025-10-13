<script setup lang="ts">
import type { FeatureItem } from '~/service/schema/home'

interface Props {
  feature: FeatureItem
}

const props = defineProps<Props>()
</script>

<template>
  <div class="bg-white rounded-xl shadow-sm hover:shadow-lg transition-all duration-300 p-8 border border-gray-100 hover:border-blue-200">
    <!-- 圖示區域 -->
    <div class="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl mb-6">
      <span class="text-3xl">{{ props.feature.icon }}</span>
    </div>

    <!-- 標題 -->
    <h3 class="text-xl font-semibold text-gray-900 mb-3">
      {{ props.feature.name }}
    </h3>

    <!-- 描述 -->
    <p class="text-gray-600 leading-relaxed">
      {{ props.feature.description }}
    </p>
  </div>
</template>

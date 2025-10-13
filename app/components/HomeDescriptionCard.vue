<script setup lang="ts">
interface Props {
  title: string
  subtitle: string
  description: string[]
}

const props = defineProps<Props>()
</script>

<template>
  <div class="bg-gradient-to-br from-white to-blue-50 rounded-xl shadow-sm border border-gray-100 p-8 mb-8">
    <!-- 標題區域 -->
    <div class="text-center mb-8">
      <h1 class="text-4xl font-bold text-gray-900 mb-3">
        {{ props.title }}
      </h1>
      <p class="text-xl text-gray-600">
        {{ props.subtitle }}
      </p>
    </div>

    <!-- 描述列表 -->
    <div class="max-w-4xl mx-auto">
      <ul class="space-y-4">
        <li
          v-for="(item, index) in props.description"
          :key="index"
          class="flex items-start space-x-3"
        >
          <div class="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
            <div class="w-2 h-2 bg-blue-600 rounded-full" />
          </div>
          <p class="text-gray-700 leading-relaxed">
            {{ item }}
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>

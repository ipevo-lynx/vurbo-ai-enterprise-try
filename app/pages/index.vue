<script setup lang="ts">
import { computed, reactive } from 'vue'
import HomeDescriptionCard from '~/components/HomeDescriptionCard.vue'
import HomeFeatureCard from '~/components/HomeFeatureCard.vue'
import HomeWelcomeMessage from '~/components/HomeWelcomeMessage.vue'
import { useHomePage } from '~/composables/page/useHomePage'
import { useAuthStore } from '~/stores/auth'

// 使用首頁邏輯
const { fetchHomeData } = useHomePage()

// 使用認證 store
const authStore = useAuthStore()

// 獲取首頁資料
const { data: homeApiData, pending } = await fetchHomeData()

// 頁面狀態管理
const pageState = reactive({
  ui: {
    showWelcomeMessage: true,
    hasHomeApiData: computed(() => !!homeApiData.value?.data),
  },
  loading: {
    isLoading: computed(() => pending.value),
  },
  errors: {
    apiError: '',
  },
})

// 計算屬性直接使用 homeData
const homeData = computed(() => homeApiData.value?.data)

// 關閉歡迎訊息
function dismissWelcome() {
  pageState.ui.showWelcomeMessage = false
}

// 重新載入頁面
function reloadPage() {
  if (import.meta.client) {
    window.location.reload()
  }
}
</script>

<template>
  <div class="min-h-[calc(100vh-200px)]">
    <!-- 載入中狀態 -->
    <div
      v-if="pageState.loading.isLoading"
      class="flex items-center justify-center min-h-96"
    >
      <div class="text-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        <p class="text-gray-600">
          載入中...
        </p>
      </div>
    </div>

    <!-- 主要內容 -->
    <div
      v-else-if="pageState.ui.hasHomeApiData"
      class="container mx-auto px-4 py-8 space-y-8"
    >
      <!-- 歡迎訊息 -->
      <HomeWelcomeMessage
        v-if="pageState.ui.showWelcomeMessage && authStore.isLoggedIn"
        :user-name="authStore.currentUser?.name"
        @dismiss="dismissWelcome"
      />

      <!-- 主要內容卡片 -->
      <HomeDescriptionCard
        :title="homeData?.title || ''"
        :subtitle="homeData?.subtitle || ''"
        :description="homeData?.description || []"
      />
      <!-- 功能特色區域 -->
      <div class="py-8">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold text-gray-900 mb-4">
            主要功能
          </h2>
          <p class="text-lg text-gray-600 max-w-2xl mx-auto">
            探索我們提供的現代化開發工具和最佳實踐，讓您的開發流程更加高效
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-8">
          <HomeFeatureCard
            v-for="feature in homeData?.features"
            :key="feature.id"
            :feature="feature"
          />
        </div>
      </div>
    </div>

    <!-- 錯誤狀態 -->
    <div
      v-else
      class="flex items-center justify-center min-h-96"
    >
      <div class="text-center max-w-md mx-auto px-4">
        <div class="text-6xl mb-6">
          😞
        </div>
        <h2 class="text-2xl font-bold text-gray-900 mb-4">
          載入失敗
        </h2>
        <p class="text-gray-600 mb-8 leading-relaxed">
          很抱歉，無法載入首頁資料。請檢查網路連線或稍後再試。
        </p>
        <button
          class="px-6 py-3 text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors shadow-sm hover:shadow-md"
          @click="reloadPage"
        >
          重新載入
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>

</style>

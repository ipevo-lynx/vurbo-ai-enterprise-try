<script setup lang="ts">
import { computed, reactive } from 'vue'
import AudioRecordDialog from '~/components/AudioRecordDialog.vue'
import HomeDescriptionCard from '~/components/HomeDescriptionCard.vue'
import HomeFeatureCard from '~/components/HomeFeatureCard.vue'
import HomeWelcomeMessage from '~/components/HomeWelcomeMessage.vue'
import { useAudioPage } from '~/composables/page/useAudioPageSimplified'
import { useHomePage } from '~/composables/page/useHomePage'
import { useAuthStore } from '~/stores/auth'

// 首頁邏輯：取得首頁相關資料的功能
const { fetchHomeData } = useHomePage()

// 音訊錄音邏輯：解構取得所有音訊相關功能
const {
  pageState: audioPageState, // 音訊頁面狀態
  openDialog, // 開啟錄音對話框
  closeDialog, // 關閉錄音對話框
  getAvailableDevices, // 取得可用音訊設備
  selectSttEngine, // 選擇語音轉文字引擎
  selectMicrophoneDevice, // 選擇麥克風設備
  toggleTranscriptionLanguage, // 切換轉錄語言
  startRecording, // 開始錄音
  pauseRecording, // 暫停錄音
  resumeRecording, // 繼續錄音
  stopRecording, // 停止錄音
  downloadRecording, // 下載錄音檔案
  resetRecording, // 重置錄音狀態
  selectedLanguagesCount, // 已選擇語言數量
  recordingStats, // 錄音統計資訊
  changeTab, // 切換分頁
  initialize: _initialize, // 初始化函數（調試用）
  // AudioRecordDialog 需要的額外函數
  toggleTranslation,
  setTranslationMode,
  setSummaryTemplate,
  captureScreenAudio,
  detectVirtualAudioDevices,
  setSystemAudioSource,
} = useAudioPage()

// 認證狀態管理：使用 Pinia store 管理使用者認證
const authStore = useAuthStore()

// 錄音時長計算：從統計中取得
const recordingDuration = computed(() => {
  return recordingStats.value.currentDuration || 0
})

// 開發者調試工具（在瀏覽器控制台中可以使用）
if (process.client) {
  (window as any).audioDebug = {
    initialize: _initialize,
    getAvailableDevices,
    audioPageState,
    recordingStats,
  }
  console.log('🔧 音訊調試工具已載入，可在控制台使用 window.audioDebug')
}

// 時間格式化函數：將秒數轉換為 MM:SS 格式
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60) // 計算分鐘數
  const remainingSeconds = seconds % 60 // 計算剩餘秒數
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}` // 格式化為 MM:SS
}

// 檔案大小格式化函數：將位元組轉換為可讀格式
function formatFileSize(bytes: number): string {
  if (bytes === 0)
    return '0 B' // 0 位元組顯示為 0 B
  const sizes = ['B', 'KB', 'MB', 'GB'] // 單位陣列
  const i = Math.floor(Math.log(bytes) / Math.log(1024)) // 計算應使用的單位索引
  return `${(bytes / (1024 ** i)).toFixed(1)} ${sizes[i]}` // 格式化並返回
}

// 錄音狀態文字取得函數：根據當前錄音狀態返回對應文字
function getRecordingStatusText(): string {
  const hasSegments = audioPageState.value.data.recordingSegments?.length > 0
  const currentSession = audioPageState.value.data.currentSession

  if (currentSession?.status === 'recording') {
    return '正在錄音中' // 錄音進行中
  }
  else if (hasSegments && !currentSession) {
    return '錄音已暫停' // 有片段但沒有當前會話，表示暫停
  }
  else if (currentSession?.status === 'processing') {
    return '錄音已完成' // 錄音處理完成
  }
  else {
    return '準備錄音' // 預設狀態
  }
}

// 即時音量數據：提供精確的百分比和視覺級別
const volumePercentage = computed(() => {
  // 優先使用設備監測的音量（選擇設備時）
  if (audioPageState.value.data.realTimeAudioData?.volume !== undefined) {
    const volume = audioPageState.value.data.realTimeAudioData.volume
    return Math.max(0, Math.min(100, volume)) // 0-100% 的精確值
  }
  // 沒有音量數據時返回 0
  return 0
})

// 音量視覺級別 (1-10)：用於顯示音量條
const currentVolumeLevel = computed(() => {
  if (volumePercentage.value === 0)
    return 0
  return Math.max(1, Math.min(10, Math.ceil(volumePercentage.value / 10)))
})

// 音訊資料結構範例
const audioDataStructure = computed(() => ({
  sessionId: audioPageState.value.data.currentSession?.id || '',
  status: audioPageState.value.data.currentSession?.status || 'idle',
  startTime: audioPageState.value.data.currentSession?.startTime,
  duration: recordingDuration.value,
  device: {
    id: audioPageState.value.data.currentSession?.settings?.microphoneDevice?.deviceId,
    label: audioPageState.value.data.currentSession?.settings?.microphoneDevice?.label,
  },
  settings: {
    sttEngine: audioPageState.value.data.currentSession?.settings?.sttEngine,
    languages: audioPageState.value.data.currentSession?.settings?.transcriptionLanguages
      ?.filter((lang: any) => lang.selected)
      ?.map((lang: any) => lang.code),
  },
  realtime: {
    volumeLevel: currentVolumeLevel.value,
    volumePercentage: volumePercentage.value,
    timestamp: Date.now(),
  },
}))

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

      <!-- 音訊錄音控制區域 -->
      <div class="flex justify-center py-8">
        <button
          class="flex items-center space-x-3 px-8 py-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors shadow-lg hover:shadow-xl transform hover:scale-105 transition-transform"
          @click="openDialog"
        >
          <svg
            class="w-6 h-6"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
              clip-rule="evenodd"
            />
          </svg>
          <span class="text-lg">開始錄音</span>
        </button>
      </div>

      <!-- 錄音中狀態模擬 -->
      <div
        v-if="audioPageState.data.currentSession || audioPageState.data.recordingSegments?.length > 0"
        class="bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-xl p-6 mb-8 shadow-sm"
      >
        <div class="max-w-4xl mx-auto">
          <!-- 錄音狀態標題 -->
          <div class="flex items-center justify-between mb-6">
            <div class="flex items-center space-x-3">
              <div class="relative">
                <div class="w-4 h-4 bg-red-500 rounded-full animate-pulse" />
                <div class="absolute inset-0 w-4 h-4 bg-red-500 rounded-full animate-ping opacity-75" />
              </div>
              <h3 class="text-xl font-semibold text-gray-800">
                {{ getRecordingStatusText() }}
              </h3>
            </div>
            <div class="flex items-center space-x-4">
              <span class="text-sm text-gray-600">錄音時長：</span>
              <span class="font-mono text-lg text-red-600">{{ formatDuration(recordingDuration) }}</span>
            </div>
          </div>

          <!-- 錄音設備與音量資訊 -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <!-- 設備資訊 -->
            <div class="bg-white rounded-lg p-4 border">
              <h4 class="font-medium text-gray-800 mb-3 flex items-center">
                <svg
                  class="w-5 h-5 mr-2 text-blue-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                    clip-rule="evenodd"
                  />
                </svg>
                錄音設備
              </h4>
              <p class="text-sm text-gray-600 mb-1">
                {{ audioPageState.data.currentSession?.settings?.microphoneDevice?.label || '預設麥克風' }}
              </p>
              <p class="text-xs text-gray-500">
                設備ID: {{ audioPageState.data.currentSession?.settings?.microphoneDevice?.deviceId?.slice(0, 8) || 'default' }}...
              </p>
            </div>

            <!-- 即時音量指示器 -->
            <div class="bg-white rounded-lg p-4 border">
              <h4 class="font-medium text-gray-800 mb-3 flex items-center">
                <svg
                  class="w-5 h-5 mr-2 text-green-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.76L4.29 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.29l4.093-3.76z"
                    clip-rule="evenodd"
                  />
                  <path d="M12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" />
                </svg>
                音量級別
              </h4>
              <div class="flex items-center space-x-2">
                <div class="flex space-x-1 flex-1">
                  <div
                    v-for="i in 10"
                    :key="i"
                    class="h-3 flex-1 rounded-sm transition-all duration-150"
                    :class="[
                      i <= currentVolumeLevel
                        ? i <= 6 ? 'bg-green-500' : i <= 8 ? 'bg-yellow-500' : 'bg-red-500'
                        : 'bg-gray-200',
                    ]"
                  />
                </div>
                <span class="text-sm font-mono text-gray-600 w-16">{{ volumePercentage.toFixed(1) }}%</span>
              </div>
            </div>
          </div>

          <!-- 錄音片段信息 -->
          <div
            v-if="audioPageState.data.recordingSegments?.length > 0"
            class="bg-white rounded-lg p-4 border mb-6"
          >
            <h4 class="font-medium text-gray-800 mb-3 flex items-center">
              <svg
                class="w-5 h-5 mr-2 text-orange-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v-2h-1zm-2-2H7v4h6v-4zm2 0h1V9h-1v2zm1-4V5h-1v2h1zM5 5v6H4V5h1zm0 8H4v2h1v-2z"
                  clip-rule="evenodd"
                />
              </svg>
              錄音片段 ({{ audioPageState.data.recordingSegments?.length || 0 }} 個)
            </h4>
            <div class="space-y-2">
              <div
                v-for="(segment, index) in audioPageState.data.recordingSegments"
                :key="index"
                class="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
              >
                <span class="text-gray-700">片段 {{ index + 1 }}</span>
                <div class="flex items-center space-x-3 text-gray-600">
                  <span>{{ formatDuration(segment.duration || 0) }}</span>
                  <span>{{ formatFileSize(segment.blob?.size || 0) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 音訊資料架構預覽 -->
          <div class="bg-white rounded-lg p-4 border mb-6">
            <h4 class="font-medium text-gray-800 mb-3 flex items-center">
              <svg
                class="w-5 h-5 mr-2 text-purple-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
              音訊資料結構
            </h4>
            <div class="bg-gray-50 rounded p-3 font-mono text-sm text-gray-700 overflow-x-auto">
              <pre>{{ JSON.stringify(audioDataStructure, null, 2) }}</pre>
            </div>
          </div>

          <!-- 操作按鈕 -->
          <div class="flex justify-center space-x-4">
            <!-- 錄音進行中：暫停/恢復按鈕 -->
            <button
              v-if="(audioPageState.data.currentSession?.status === 'recording' || audioPageState.data.currentSession?.status === 'paused' || (audioPageState.data.recordingSegments?.length > 0 && !audioPageState.data.currentSession)) && audioPageState.data.currentSession?.status !== 'processing'"
              :disabled="false"
              class="px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
              @click="audioPageState.data.currentSession?.status === 'recording' ? pauseRecording() : resumeRecording()"
            >
              <svg
                class="w-5 h-5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  v-if="audioPageState.data.currentSession?.status === 'recording'"
                  fill-rule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clip-rule="evenodd"
                />
                <path
                  v-else
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clip-rule="evenodd"
                />
              </svg>
              <span>{{ audioPageState.data.currentSession?.status === 'recording' ? '暫停錄音' : '繼續錄音' }}</span>
            </button>

            <!-- 錄音完成後：下載按鈕 (取代原本的暫停/恢復按鈕位置) -->
            <button
              v-if="audioPageState.data.currentSession?.status === 'processing' && audioPageState.data.currentSession?.recordingFile"
              class="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
              @click="downloadRecording"
            >
              <svg
                class="w-5 h-5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414L10 14.414l-3.707-3.707a1 1 0 010-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
              <span>下載錄音檔 ({{ formatFileSize(audioPageState.data.currentSession.recordingFile.size) }})</span>
            </button>

            <!-- 錄音進行中：結束錄音按鈕 -->
            <button
              v-if="(audioPageState.data.currentSession?.status === 'recording' || audioPageState.data.currentSession?.status === 'paused' || audioPageState.data.recordingSegments?.length > 0) && audioPageState.data.currentSession?.status !== 'processing'"
              class="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
              @click="stopRecording"
            >
              <svg
                class="w-5 h-5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
                  clip-rule="evenodd"
                />
              </svg>
              <span>結束錄音</span>
            </button>

            <!-- 錄音完成後：重新錄音按鈕 (取代原本的結束錄音按鈕位置) -->
            <button
              v-if="audioPageState.data.currentSession?.status === 'processing'"
              class="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
              @click="() => { resetRecording(); openDialog(); }"
            >
              <svg
                class="w-5 h-5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                  clip-rule="evenodd"
                />
              </svg>
              <span>重新錄音</span>
            </button>
          </div>
        </div>
      </div>

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

    <!-- 音訊錄音對話框 -->
    <AudioRecordDialog
      :page-state="audioPageState"
      :close-dialog="closeDialog"
      :get-available-devices="getAvailableDevices"
      :select-stt-engine="selectSttEngine"
      :select-microphone-device="selectMicrophoneDevice"
      :toggle-transcription-language="toggleTranscriptionLanguage"
      :start-recording="startRecording"
      :selected-languages-count="selectedLanguagesCount"
      :change-tab="changeTab"
      :toggle-translation="toggleTranslation"
      :set-translation-mode="setTranslationMode"
      :set-summary-template="setSummaryTemplate"
      :capture-screen-audio="captureScreenAudio"
      :detect-virtual-audio-devices="detectVirtualAudioDevices"
      :set-system-audio-source="setSystemAudioSource"
    />
  </div>
</template>

<style scoped>

</style>

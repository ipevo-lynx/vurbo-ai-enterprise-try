<!-- 設備斷線測試頁面 -->
<script setup lang="ts">
import type { AudioDevice } from '~/service/schema/audio'
import { onMounted, ref } from 'vue'
import { useAudioPage } from '~/composables/page/useAudioPage'

// 使用音訊頁面組合函數
const {
  pageState,
  isRecording,
  isPaused,
  initialize,
  startRecording,
  stopRecording,
} = useAudioPage()

// 選擇的設備 ID
const selectedDeviceId = ref('')

// 選擇設備
function selectDevice() {
  if (selectedDeviceId.value) {
    const device = pageState.data.availableDevices.find(
      (d: AudioDevice) => d.deviceId === selectedDeviceId.value,
    )
    if (device) {
      pageState.data.settings.microphoneDevice = device
    }
  }
  else {
    pageState.data.settings.microphoneDevice = null
  }
}

// 獲取狀態文字
function getStatusText(status: string) {
  const statusMap = {
    connected: '✅ 已連接',
    disconnected: '❌ 已斷線',
    reconnecting: '🔄 重連中',
    failed: '💥 連線失敗',
  }
  return statusMap[status as keyof typeof statusMap] || status
}

// 獲取錄音狀態文字
function getRecordingStatusText(status: string) {
  const statusMap = {
    idle: '待機',
    recording: '錄音中',
    paused: '已暫停',
    processing: '處理中',
  }
  return statusMap[status as keyof typeof statusMap] || status
}

// 格式化持續時間
function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
}

// 頁面初始化
onMounted(async () => {
  await initialize()
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 py-8">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-3xl font-bold text-gray-900 mb-8">
        🎙️ 設備斷線處理測試
      </h1>

      <!-- 設備狀態面板 -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 class="text-xl font-semibold mb-4">
          設備狀態
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              當前設備連線狀態
            </label>
            <div class="flex items-center space-x-2">
              <div
                class="w-3 h-3 rounded-full"
                :class="{
                  'bg-green-500': pageState.data.deviceConnectionStatus === 'connected',
                  'bg-red-500': pageState.data.deviceConnectionStatus === 'disconnected',
                  'bg-yellow-500': pageState.data.deviceConnectionStatus === 'reconnecting',
                  'bg-gray-500': pageState.data.deviceConnectionStatus === 'failed',
                }"
              />
              <span class="text-sm font-medium">
                {{ getStatusText(pageState.data.deviceConnectionStatus) }}
              </span>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              可用設備數量
            </label>
            <span class="text-lg font-semibold">
              {{ pageState.data.availableDevices.length }} 個設備
            </span>
          </div>
        </div>

        <!-- 設備選擇 -->
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">
            選擇麥克風設備
          </label>
          <select
            v-model="selectedDeviceId"
            class="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            @change="selectDevice"
          >
            <option value="">
              請選擇設備
            </option>
            <option
              v-for="device in pageState.data.availableDevices"
              :key="device.deviceId"
              :value="device.deviceId"
            >
              {{ device.label }}
            </option>
          </select>
        </div>

        <!-- 當前選擇的設備 -->
        <div
          v-if="pageState.data.settings.microphoneDevice"
          class="mb-4"
        >
          <label class="block text-sm font-medium text-gray-700 mb-2">
            當前選擇的設備
          </label>
          <div class="p-3 bg-blue-50 border border-blue-200 rounded-md">
            <span class="font-medium">{{ pageState.data.settings.microphoneDevice.label }}</span>
            <span class="text-sm text-gray-600 ml-2">
              (ID: {{ pageState.data.settings.microphoneDevice.deviceId.slice(0, 8) }}...)
            </span>
          </div>
        </div>
      </div>

      <!-- 錄音控制面板 -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 class="text-xl font-semibold mb-4">
          錄音控制
        </h2>

        <div class="flex items-center space-x-4 mb-4">
          <button
            :disabled="!pageState.data.settings.microphoneDevice || isRecording || pageState.loading.isStartingRecording"
            class="px-6 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="startRecording"
          >
            {{ pageState.loading.isStartingRecording ? '啟動中...' : '🎙️ 開始錄音' }}
          </button>

          <button
            :disabled="!isRecording && !isPaused"
            class="px-6 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="stopRecording"
          >
            ⏹️ 停止錄音
          </button>
        </div>

        <!-- 錄音狀態 -->
        <div
          v-if="pageState.data.currentSession"
          class="mb-4"
        >
          <div class="flex items-center space-x-4 text-sm">
            <span class="font-medium">狀態:</span>
            <span
              class="px-2 py-1 rounded text-xs font-medium"
              :class="{
                'bg-red-100 text-red-800': pageState.data.currentSession.status === 'recording',
                'bg-yellow-100 text-yellow-800': pageState.data.currentSession.status === 'paused',
                'bg-gray-100 text-gray-800': pageState.data.currentSession.status === 'idle',
                'bg-blue-100 text-blue-800': pageState.data.currentSession.status === 'processing',
              }"
            >
              {{ getRecordingStatusText(pageState.data.currentSession.status) }}
            </span>
            <span class="font-medium">時長:</span>
            <span>{{ formatDuration(pageState.data.currentSession.duration) }}</span>
          </div>
        </div>
      </div>

      <!-- 錯誤訊息面板 -->
      <div
        v-if="pageState.errors.deviceError || pageState.errors.recordingError"
        class="bg-white rounded-lg shadow-md p-6 mb-6"
      >
        <h2 class="text-xl font-semibold mb-4 text-red-600">
          系統訊息
        </h2>

        <div
          v-if="pageState.errors.deviceError"
          class="mb-4"
        >
          <div class="p-4 bg-red-50 border border-red-200 rounded-md">
            <pre class="text-sm text-red-800 whitespace-pre-wrap">{{ pageState.errors.deviceError }}</pre>
          </div>
        </div>

        <div
          v-if="pageState.errors.recordingError"
          class="mb-4"
        >
          <div class="p-4 bg-orange-50 border border-orange-200 rounded-md">
            <p class="text-sm text-orange-800">
              {{ pageState.errors.recordingError }}
            </p>
          </div>
        </div>
      </div>

      <!-- 測試說明面板 -->
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-semibold mb-4">
          測試步驟
        </h2>

        <ol class="list-decimal list-inside space-y-2 text-sm text-gray-700">
          <li>連接外接麥克風設備（如 USB 麥克風或藍牙麥克風）</li>
          <li>在上方選擇框中選擇您的外接麥克風</li>
          <li>點擊「開始錄音」按鈕</li>
          <li>確認錄音狀態為「錄音中」</li>
          <li><strong>在錄音過程中，物理拔除或關閉您的外接麥克風</strong></li>
          <li>
            觀察系統是否：
            <ul class="list-disc list-inside ml-4 mt-2 space-y-1">
              <li>自動暫停錄音</li>
              <li>顯示設備斷線訊息</li>
              <li>提供重連指示</li>
            </ul>
          </li>
          <li>重新連接設備，觀察系統是否自動恢復錄音</li>
        </ol>

        <div class="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <p class="text-sm text-yellow-800">
            <strong>⚠️ 注意：</strong>請勿在測試過程中關閉此頁面，以免丟失錄音數據。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

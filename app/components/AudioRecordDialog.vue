<script setup lang="ts">
import type { AudioDevice, SttEngine } from '~/service/schema/audio'
import { computed } from 'vue'

// AudioRecordDialog: 音訊錄製對話框的屬性介面
interface Props {
  pageState: any // 頁面狀態物件
  closeDialog: () => void // 關閉對話框的函數
  getAvailableDevices: () => Promise<void> // 取得可用設備列表
  selectSttEngine: (engine: SttEngine) => void // 選擇語音轉文字引擎
  selectMicrophoneDevice: (device: AudioDevice) => void // 選擇麥克風設備
  toggleTranscriptionLanguage: (languageCode: string) => void // 切換轉錄語言
  toggleTranslation: () => void // 切換翻譯功能
  setTranslationMode: (mode: '句子' | '完整文件') => void // 設定翻譯模式
  setSummaryTemplate: (template: '通用' | '會議' | '訪談' | '自訂') => void // 設定摘要樣板
  startRecording: () => Promise<void> // 開始錄音
  selectedLanguagesCount: number // 已選擇語言數量
  changeTab: (tab: 'general' | 'advanced') => void // 切換分頁
  // 新增系統音訊相關 props
  captureScreenAudio: () => Promise<MediaStream | null> // 捕獲螢幕音訊
  detectVirtualAudioDevices: () => Promise<AudioDevice[]> // 偵測虛擬音訊設備
  setSystemAudioSource: (source: any) => void // 設定系統音訊來源
}

const props = defineProps<Props>()

// 計算當前音量級別的 computed 屬性
const currentVolumeLevel = computed(() => {
  if (!props.pageState.data.realTimeAudioData) {
    console.log('無 realTimeAudioData')
    return 0
  }

  const volume = props.pageState.data.realTimeAudioData.volume || 0
  //   console.log('當前音量:', volume, '%')

  // 將 0-100% 的音量轉換為 1-6 的級別
  if (volume === 0)
    return 0

  const level = Math.max(1, Math.min(6, Math.ceil(volume / 16.67))) // 100/6 ≈ 16.67
  //   console.log('音量級別:', level)
  return level
})

// 事件處理函數：語音轉文字引擎變更
function onSttEngineChange(event: Event) {
  const target = event.target as HTMLSelectElement
  if (target?.value) {
    props.selectSttEngine(target.value as SttEngine)
  }
}

// 事件處理函數：麥克風設備變更
function onMicrophoneChange(event: Event) {
  const target = event.target as HTMLSelectElement
  if (target?.value) {
    const device = props.pageState.data.availableDevices.find((d: AudioDevice) => d.deviceId === target.value)
    if (device) {
      props.selectMicrophoneDevice(device)
    }
  }
}

// 事件處理函數：翻譯模式變更
function onTranslationModeChange(event: Event) {
  const target = event.target as HTMLSelectElement
  if (target?.value) {
    props.setTranslationMode(target.value as '句子' | '完整文件')
  }
}

// 事件處理函數：摘要樣板變更
function onSummaryTemplateChange(event: Event) {
  const target = event.target as HTMLSelectElement
  if (target?.value) {
    props.setSummaryTemplate(target.value as '通用' | '會議' | '訪談' | '自訂')
  }
}

// 系統音訊相關函數：處理螢幕音訊捕獲
async function handleCaptureScreenAudio() {
  try {
    const stream = await props.captureScreenAudio()
    if (stream) {
      console.log('Successfully captured screen audio:', stream)
    }
  }
  catch (error) {
    console.error('Failed to capture screen audio:', error)
  }
}

// 系統音訊相關函數：偵測虛擬音訊設備
// async function handleDetectVirtualDevices() {
//   try {
//     const devices = await props.detectVirtualAudioDevices()
//     console.log('Virtual audio devices detected:', devices)
//   }
//   catch (error) {
//     console.error('Failed to detect virtual devices:', error)
//   }
// }

// 快速設定功能
function applyQuickSetup(scenario: 'meeting' | 'podcast' | 'presentation') {
  switch (scenario) {
    case 'meeting':
      // 視訊會議最佳設定
      props.selectSttEngine('Azure')
      props.setTranslationMode('句子')
      props.setSummaryTemplate('會議')
      // 自動觸發螢幕音訊捕獲
      handleCaptureScreenAudio()
      break

    case 'podcast':
      // 播客錄製最佳設定
      props.selectSttEngine('OpenAI')
      props.setTranslationMode('完整文件')
      props.setSummaryTemplate('訪談')
      break

    case 'presentation':
      // 簡報錄製最佳設定
      props.selectSttEngine('Google')
      props.setTranslationMode('句子')
      props.setSummaryTemplate('通用')
      handleCaptureScreenAudio()
      break
  }
}

// 取得音量條的樣式類別：根據音量級別返回適當顏色
function getVolumeBarClass(barIndex: number): string {
  const currentLevel = currentVolumeLevel.value
  //   console.log(`音量條 ${barIndex}: 當前級別 ${currentLevel}`)

  if (currentLevel < barIndex) {
    return 'bg-gray-300' // 未達到的音量條
  }

  // 根據音量級別使用不同顏色
  if (barIndex <= 2) {
    return 'bg-green-500' // 低音量：綠色
  }
  else if (barIndex <= 4) {
    return 'bg-yellow-500' // 中音量：黃色
  }
  else {
    return 'bg-red-500' // 高音量：紅色
  }
}
</script>

<template>
  <div
    v-if="pageState.ui.showDialog"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    @click.self="closeDialog"
  >
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden m-4">
      <!-- 標題列 -->
      <div class="flex items-center justify-between p-6 border-b">
        <h2 class="text-xl font-semibold text-gray-900">
          轉錄設定
        </h2>
        <button
          class="text-gray-400 hover:text-gray-600 transition-colors"
          @click="closeDialog"
        >
          <svg
            class="w-6 h-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <!-- 分頁標籤 -->
      <div class="flex border-b">
        <button
          class="px-6 py-3 text-sm font-medium transition-colors"
          :class="pageState.ui.selectedTab === 'general'
            ? 'border-b-2 border-blue-500 text-blue-600'
            : 'text-gray-500 hover:text-gray-700'"
          @click="changeTab('general')"
        >
          通用
        </button>
        <button
          class="px-6 py-3 text-sm font-medium transition-colors"
          :class="pageState.ui.selectedTab === 'advanced'
            ? 'border-b-2 border-blue-500 text-blue-600'
            : 'text-gray-500 hover:text-gray-700'"
          @click="changeTab('advanced')"
        >
          進階設定
        </button>
      </div>

      <!-- 內容區域 -->
      <div class="p-6 overflow-y-auto max-h-[60vh]">
        <!-- 快速設定嚮導（僅在通用設定頁顯示） -->
        <div
          v-if="pageState.ui.selectedTab === 'general'"
          class="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 mb-6"
        >
          <div class="flex items-start space-x-3">
            <div class="flex-shrink-0">
              <svg
                class="w-6 h-6 text-blue-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div class="flex-1">
              <h3 class="text-sm font-semibold text-blue-900 mb-2">
                🚀 快速設定建議
              </h3>
              <div class="space-y-2">
                <!-- 場景選擇 -->
                <div class="flex flex-wrap gap-2">
                  <button
                    class="px-3 py-1.5 bg-white border border-blue-200 rounded-full text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors"
                    @click="applyQuickSetup('meeting')"
                  >
                    📹 視訊會議轉錄
                  </button>
                  <button
                    class="px-3 py-1.5 bg-white border border-blue-200 rounded-full text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors"
                    @click="applyQuickSetup('podcast')"
                  >
                    🎙️ 播客/音訊轉錄
                  </button>
                  <button
                    class="px-3 py-1.5 bg-white border border-blue-200 rounded-full text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors"
                    @click="applyQuickSetup('presentation')"
                  >
                    🎯 簡報錄製
                  </button>
                </div>
                <p class="text-xs text-blue-600">
                  點擊場景按鈕快速套用最佳設定，或手動調整下方選項
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- 通用設定 -->
        <div
          v-if="pageState.ui.selectedTab === 'general'"
          class="space-y-6"
        >
          <!-- 語音設定 -->
          <div class="space-y-4">
            <h3 class="text-lg font-medium text-gray-900 flex items-center">
              <svg
                class="w-5 h-5 mr-2 text-red-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                  clip-rule="evenodd"
                />
              </svg>
              語音設定
            </h3>

            <!-- STT引擎選擇 -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">STT Engine</label>
              <div class="flex items-center justify-between p-3 border rounded-lg">
                <span class="text-gray-900">{{ pageState.data.settings.sttEngine }}</span>
                <select
                  :value="pageState.data.settings.sttEngine"
                  class="text-sm text-gray-600 border-none bg-transparent focus:ring-0"
                  @change="onSttEngineChange"
                >
                  <option value="Azure">
                    Azure
                  </option>
                  <option value="OpenAI">
                    OpenAI
                  </option>
                  <option value="Google">
                    Google
                  </option>
                  <option value="Local">
                    Local
                  </option>
                </select>
              </div>
            </div>

            <!-- 轉錄語言 -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                轉錄語言 ({{ selectedLanguagesCount }}/10)
              </label>
              <div class="space-y-2 max-h-32 overflow-y-auto border rounded-lg p-2">
                <div
                  v-for="language in pageState.data.settings.transcriptionLanguages"
                  :key="language.code"
                  class="flex items-center justify-between p-2 hover:bg-gray-50 rounded"
                >
                  <span class="text-sm text-gray-900">{{ language.name }}</span>
                  <div class="flex items-center">
                    <button
                      v-if="language.selected"
                      class="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center"
                      @click="toggleTranscriptionLanguage(language.code)"
                    >
                      <svg
                        class="w-3 h-3 text-white"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </button>
                    <button
                      v-else
                      class="w-6 h-6 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-gray-400 transition-colors"
                      @click="toggleTranscriptionLanguage(language.code)"
                    >
                      <svg
                        class="w-4 h-4 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 聲音來源 -->
          <div class="space-y-4">
            <h3 class="text-lg font-medium text-gray-900 flex items-center">
              <svg
                class="w-5 h-5 mr-2 text-green-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.776L4.134 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.134l4.249-3.776z"
                  clip-rule="evenodd"
                />
              </svg>
              聲音來源
            </h3>

            <!-- 麥克風設備選擇 -->
            <div>
              <label class="flex items-center text-sm font-medium text-gray-700 mb-2">
                <svg
                  class="w-4 h-4 mr-2 text-green-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                    clip-rule="evenodd"
                  />
                </svg>
                麥克風
              </label>

              <!-- 載入中狀態 -->
              <div
                v-if="pageState.loading.isGettingDevices"
                class="flex items-center justify-between p-3 border rounded-lg bg-gray-50"
              >
                <span class="text-gray-600">正在取得設備清單...</span>
                <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
              </div>

              <!-- 權限錯誤 -->
              <div
                v-else-if="pageState.errors.permissionError"
                class="p-3 border border-red-200 rounded-lg bg-red-50"
              >
                <p class="text-sm text-red-600">
                  {{ pageState.errors.permissionError }}
                </p>
                <button
                  class="mt-2 text-sm text-red-700 hover:text-red-800 underline"
                  @click="getAvailableDevices"
                >
                  重新嘗試
                </button>
              </div>

              <!-- 設備選擇 -->
              <div
                v-else
                class="flex items-center justify-between p-3 border rounded-lg"
              >
                <span class="text-gray-900">
                  {{ pageState.data.settings.microphoneDevice?.label || '未選擇設備' }}
                </span>
                <div class="flex items-center space-x-2">
                  <!-- 即時音量指示器 -->
                  <div class="flex space-x-1">
                    <div
                      v-for="i in 6"
                      :key="i"
                      class="w-1 h-4 rounded-full transition-colors duration-150"
                      :class="getVolumeBarClass(i)"
                    />
                  </div>
                  <!-- 音量數值顯示 -->
                  <span
                    v-if="pageState.data.realTimeAudioData"
                    class="text-xs font-mono text-gray-500 min-w-[3rem]"
                  >
                    {{ pageState.data.realTimeAudioData.volume || 0 }}%
                  </span>
                  <select
                    :value="pageState.data.settings.microphoneDevice?.deviceId || ''"
                    class="text-sm text-gray-600 border-none bg-transparent focus:ring-0"
                    @change="onMicrophoneChange"
                  >
                    <option value="">
                      選擇設備
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
              </div>
            </div>

            <!-- 擷取系統音訊 -->
            <div>
              <label class="flex items-center text-sm font-medium text-gray-700 mb-3">
                <svg
                  class="w-4 h-4 mr-2 text-red-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V8zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z"
                    clip-rule="evenodd"
                  />
                </svg>
                擷取系統音訊
              </label>

              <!-- 系統音訊說明 -->
              <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <h4 class="font-medium text-blue-900 mb-2">
                  📋 系統音訊捕獲說明
                </h4>
                <div class="text-sm text-blue-800 space-y-2">
                  <p><strong>目前可取得：</strong></p>
                  <ul class="list-disc list-inside ml-4 space-y-1">
                    <li>螢幕分享時的應用程式音訊</li>
                    <li>當前瀏覽器分頁音訊</li>
                    <li>Virtual Audio Cable 輸出（需額外安裝）</li>
                  </ul>

                  <p><strong>無法直接取得：</strong></p>
                  <ul class="list-disc list-inside ml-4 space-y-1">
                    <li>其他應用程式音訊（如 Spotify、Teams、Discord）</li>
                    <li>系統混音器的完整輸出</li>
                    <li>背景應用程式音訊</li>
                  </ul>

                  <p class="text-xs mt-2">
                    💡 <strong>建議：</strong>使用螢幕分享功能來捕獲特定應用程式的音訊，
                    或安裝 Virtual Audio Cable 來路由系統音訊。
                  </p>

                  <!-- 螢幕分享音訊詳細說明 -->
                  <div class="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <h5 class="font-medium text-amber-900 mb-2">
                      📺 螢幕分享音訊捕獲說明
                    </h5>
                    <div class="text-xs text-amber-800 space-y-2">
                      <p><strong>✅ 可以捕獲：</strong></p>
                      <ul class="list-disc list-inside ml-2 space-y-1">
                        <li>瀏覽器分頁音訊（YouTube、網頁播放器等）</li>
                        <li>支援音訊分享的視訊會議應用程式</li>
                        <li>某些桌面應用程式（視瀏覽器和系統支援而定）</li>
                      </ul>

                      <p><strong>❌ 無法直接捕獲：</strong></p>
                      <ul class="list-disc list-inside ml-2 space-y-1">
                        <li><strong>Spotify、Apple Music</strong> 等音樂串流應用程式</li>
                        <li>遊戲音訊（大部分情況下）</li>
                        <li>系統通知音效</li>
                      </ul>

                      <p><strong>🔧 Spotify 解決方案：</strong></p>
                      <ul class="list-disc list-inside ml-2 space-y-1">
                        <li>使用 <strong>Virtual Audio Cable</strong>（VB-Audio VoiceMeeter）</li>
                        <li>使用 <strong>OBS Studio</strong> 音訊路由</li>
                        <li>使用 Spotify Web Player（瀏覽器版本）</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 系統音訊來源選擇 -->
              <div class="space-y-3">
                <!-- 螢幕分享音訊 -->
                <div class="border rounded-lg p-4">
                  <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center">
                      <div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                        <svg
                          class="w-5 h-5 text-blue-600"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h12a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1V8z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      </div>
                      <div>
                        <h4 class="font-medium text-gray-900">
                          螢幕分享音訊
                        </h4>
                        <p class="text-sm text-gray-500">
                          捕獲特定應用程式視窗的音訊
                        </p>
                      </div>
                    </div>
                    <div class="flex items-center space-x-2">
                      <div
                        v-if="pageState.data.settings.systemAudioDevice?.source === 'screen-share'"
                        class="flex items-center space-x-2 text-green-600"
                      >
                        <svg
                          class="w-4 h-4"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clip-rule="evenodd"
                          />
                        </svg>
                        <span class="text-sm font-medium">已連接</span>
                      </div>
                      <button
                        :disabled="pageState.loading.isGettingDevices"
                        class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                        @click="handleCaptureScreenAudio"
                      >
                        {{ pageState.loading.isGettingDevices ? '設定中...' : '開始螢幕分享' }}
                      </button>
                    </div>
                  </div>
                  <p class="text-xs text-gray-500">
                    適用於：瀏覽器分頁、支援音訊分享的視訊會議等。
                    <strong>注意：</strong>Spotify 等獨立應用程式需要額外設定。
                  </p>
                </div>

                <!-- Virtual Audio Cable -->
                <!-- <div class="border rounded-lg p-4">
                  <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center">
                      <div class="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mr-3">
                        <svg class="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fill-rule="evenodd" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" clip-rule="evenodd"/>
                        </svg>
                      </div>
                      <div>
                        <h4 class="font-medium text-gray-900">Virtual Audio Cable</h4>
                        <p class="text-sm text-gray-500">路由所有系統音訊到瀏覽器</p>
                      </div>
                    </div>
                    <div class="flex items-center space-x-2">
                      <button
                        @click="handleDetectVirtualDevices"
                        class="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700"
                      >
                        檢測設備
                      </button>
                    </div>
                  </div>
                  <div class="space-y-2">
                    <p class="text-xs text-gray-500">
                      需要安裝：
                    </p>
                    <div class="grid grid-cols-1 gap-1 text-xs">
                      <span>• Windows: VB-Audio Virtual Cable</span>
                      <span>• macOS: BlackHole</span>
                      <span>• Linux: PulseAudio Loopback</span>
                    </div>
                  </div>
                </div> -->

                <!-- 當前設定顯示 -->
                <div
                  v-if="pageState.data.settings.systemAudioDevice"
                  class="bg-green-50 border border-green-200 rounded-lg p-3"
                >
                  <div class="flex items-center space-x-2">
                    <svg
                      class="w-4 h-4 text-green-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clip-rule="evenodd"
                      />
                    </svg>
                    <span class="text-sm font-medium text-green-800">
                      已設定系統音訊：{{ pageState.data.settings.systemAudioDevice.label }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 進階設定 -->
        <div
          v-if="pageState.ui.selectedTab === 'advanced'"
          class="space-y-6"
        >
          <!-- 內容設定 -->
          <div class="space-y-4">
            <h3 class="text-lg font-medium text-gray-900 flex items-center">
              <svg
                class="w-5 h-5 mr-2 text-blue-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 0v12h8V4H6z"
                  clip-rule="evenodd"
                />
              </svg>
              內容設定
            </h3>

            <!-- 翻譯設定 -->
            <div>
              <label class="flex items-center text-sm font-medium text-gray-700 mb-2">
                <svg
                  class="w-4 h-4 mr-2 text-blue-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M7 2a1 1 0 011 1v1h3a1 1 0 110 2H9.578a18.87 18.87 0 01-1.724 4.78c.29.354.596.696.914 1.026a1 1 0 11-1.44 1.389c-.188-.196-.373-.396-.554-.6a19.098 19.098 0 01-3.107 3.567 1 1 0 01-1.334-1.49 17.087 17.087 0 003.13-3.733 18.992 18.992 0 01-1.487-2.494 1 1 0 111.79-.89c.234.47.489.928.764 1.372.417-.934.752-1.913.997-2.927H3a1 1 0 110-2h3V3a1 1 0 011-1zm6 6a1 1 0 01.894.553l2.991 5.982a.869.869 0 01.02.037l.99 1.98a1 1 0 11-1.79.895L15.383 16h-4.764l-.724 1.447a1 1 0 11-1.788-.894l.99-1.98.019-.038 2.99-5.982A1 1 0 0113 8zm-1.382 6h2.764L13 11.236 11.618 14z"
                    clip-rule="evenodd"
                  />
                </svg>
                翻譯
              </label>
              <div class="flex items-center justify-between p-3 border rounded-lg">
                <span class="text-gray-900">{{ pageState.data.settings.translation.enabled ? '開啟' : '關閉' }}</span>
                <button
                  class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  :class="pageState.data.settings.translation.enabled ? 'bg-blue-600' : 'bg-gray-200'"
                  @click="toggleTranslation"
                >
                  <span
                    class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                    :class="pageState.data.settings.translation.enabled ? 'translate-x-6' : 'translate-x-1'"
                  />
                </button>
              </div>
            </div>

            <!-- 翻譯模式 -->
            <div v-if="pageState.data.settings.translation.enabled">
              <label class="flex items-center text-sm font-medium text-gray-700 mb-2">
                <svg
                  class="w-4 h-4 mr-2 text-blue-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
                    clip-rule="evenodd"
                  />
                </svg>
                翻譯模式
              </label>
              <div class="flex items-center justify-between p-3 border rounded-lg">
                <span class="text-gray-900">{{ pageState.data.settings.translation.mode }}</span>
                <select
                  :value="pageState.data.settings.translation.mode"
                  class="text-sm text-gray-600 border-none bg-transparent focus:ring-0"
                  @change="onTranslationModeChange"
                >
                  <option value="句子">
                    句子
                  </option>
                  <option value="完整文件">
                    完整文件
                  </option>
                </select>
              </div>
            </div>

            <!-- 摘要樣板 -->
            <div>
              <label class="flex items-center text-sm font-medium text-gray-700 mb-2">
                <svg
                  class="w-4 h-4 mr-2 text-yellow-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h12a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1V8z"
                    clip-rule="evenodd"
                  />
                </svg>
                摘要樣板
              </label>
              <div class="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <span class="text-gray-900">{{ pageState.data.settings.summaryTemplate.template }}</span>
                  <p class="text-xs text-gray-500 mt-1">
                    適當的設定能提升自動摘要品質。
                  </p>
                </div>
                <select
                  :value="pageState.data.settings.summaryTemplate.template"
                  class="text-sm text-gray-600 border-none bg-transparent focus:ring-0"
                  @change="onSummaryTemplateChange"
                >
                  <option value="通用">
                    通用
                  </option>
                  <option value="會議">
                    會議
                  </option>
                  <option value="訪談">
                    訪談
                  </option>
                  <option value="自訂">
                    自訂
                  </option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部按鈕 -->
      <div class="flex items-center justify-end space-x-4 p-6 border-t bg-gray-50">
        <button
          class="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          @click="closeDialog"
        >
          取消
        </button>
        <button
          :disabled="pageState.loading.isRecording"
          class="px-6 py-2 text-sm font-medium text-white rounded-lg transition-colors"
          :class="pageState.loading.isRecording
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-green-600 hover:bg-green-700'"
          @click="startRecording"
        >
          {{ pageState.loading.isRecording ? '啟動中...' : '開始' }}
        </button>
      </div>

      <!-- 錯誤訊息 -->
      <div
        v-if="pageState.errors.deviceError"
        class="p-4 bg-red-50 border-t border-red-200"
      >
        <p class="text-sm text-red-600">
          {{ pageState.errors.deviceError }}
        </p>
      </div>
    </div>
  </div>
</template>
